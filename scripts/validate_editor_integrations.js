#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const { runEditorParityContract } = require('./editor_parity_contract');

const repoRoot = path.resolve(__dirname, '..');

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options,
  });
}

function runNodeChecks() {
  const files = [
    'realtime_dev_agent.js',
    'lib/analyzer.js',
    'lib/generation.js',
    'lib/generation-react.js',
    'lib/generation-structured.js',
    'lib/generation-unit-tests.js',
    'lib/support.js',
    'lib/language-profiles.js',
    'lib/language-snippets.js',
    'scripts/editor_parity_contract.js',
    'vscode/extension.js',
    'zed-extension/server/realtime_dev_agent_lsp.js',
  ];

  return files.map((file) => {
    const result = run('node', ['--check', file]);
    return {
      name: `node-check:${file}`,
      ok: result.status === 0,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  });
}

function runNvimSmoke() {
  const result = run('nvim', [
    '--headless',
    '-u',
    'NONE',
    '+source vim/plugin/realtime_dev_agent.vim',
    '+source vim/autoload/realtime_dev_agent/internal.vim',
    '+qa!',
  ]);

  return {
    name: 'nvim-smoke',
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function runVsCodePackage() {
  const outFile = path.join(repoRoot, 'realtime-dev-agent.vsix');
  if (fs.existsSync(outFile)) {
    fs.rmSync(outFile, { force: true });
  }
  const result = run('npm', ['run', 'package:vscode']);
  const summary = {
    name: 'vscode-package',
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
  if (fs.existsSync(outFile)) {
    fs.rmSync(outFile, { force: true });
  }
  return summary;
}

function validateVsCodePackaging() {
  return process.env.PINGU_VALIDATE_PACKAGE === '1';
}

function runParityContractChecks() {
  return runEditorParityContract(repoRoot).map((check) => ({
    name: check.name,
    ok: check.ok,
    status: check.ok ? 0 : 1,
    stdout: check.ok ? check.details : '',
    stderr: check.ok ? '' : check.details,
    editor: check.editor,
    feature: check.feature,
  }));
}

function runZedLspSmoke() {
  return new Promise((resolve) => {
    const server = path.join(repoRoot, 'zed-extension/server/realtime_dev_agent_lsp.js');
    const child = spawn('node', [server], {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let buffer = '';
    let nextRequestId = 1;
    let finalized = false;
    const pendingResponses = new Map();
    const stderr = [];
    const logMessages = [];
    const diagnosticsByUri = new Map();

    function send(message) {
      const payload = JSON.stringify(message);
      child.stdin.write(`Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`);
    }

    function request(method, params) {
      return new Promise((resolveRequest) => {
        const id = nextRequestId;
        nextRequestId += 1;
        pendingResponses.set(id, resolveRequest);
        send({ jsonrpc: '2.0', id, method, params });
      });
    }

    child.stdout.on('data', (chunk) => {
      buffer += String(chunk);
      while (true) {
        const separatorIndex = buffer.indexOf('\r\n\r\n');
        if (separatorIndex === -1) {
          return;
        }

        const header = buffer.slice(0, separatorIndex);
        const match = /Content-Length: (\d+)/i.exec(header);
        if (!match) {
          return;
        }

        const contentLength = Number(match[1]);
        const bodyStart = separatorIndex + 4;
        if (buffer.length < bodyStart + contentLength) {
          return;
        }

        const body = buffer.slice(bodyStart, bodyStart + contentLength);
        buffer = buffer.slice(bodyStart + contentLength);
        const message = JSON.parse(body);

        if (Object.prototype.hasOwnProperty.call(message, 'id') && !message.method) {
          const resolver = pendingResponses.get(message.id);
          if (resolver) {
            pendingResponses.delete(message.id);
            resolver(message.result);
          }
          continue;
        }

        if (message.method === 'textDocument/publishDiagnostics') {
          diagnosticsByUri.set(message.params && message.params.uri, message.params && message.params.diagnostics || []);
          continue;
        }

        if (message.method === 'window/logMessage') {
          logMessages.push(String(message.params && message.params.message || ''));
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr.push(String(chunk));
    });

    const finalize = (summary) => {
      if (finalized) {
        return;
      }
      finalized = true;
      resolve(summary);
    };

    async function runSmoke() {
      const commentUri = 'file:///tmp/realtime-dev-agent-zed-comment.js';
      const terminalUri = 'file:///tmp/realtime-dev-agent-zed-terminal.js';

      await request('initialize', {
        processId: process.pid,
        rootUri: null,
        capabilities: {},
      });
      send({ jsonrpc: '2.0', method: 'initialized', params: {} });

      send({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri: commentUri,
            languageId: 'javascript',
            version: 1,
            text: '//: funcao soma\n',
          },
        },
      });

      send({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri: terminalUri,
            languageId: 'javascript',
            version: 1,
            text: '// * git status\n',
          },
        },
      });

      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));

      const commentActions = await request('textDocument/codeAction', {
        textDocument: { uri: commentUri },
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 20 },
        },
        context: { diagnostics: diagnosticsByUri.get(commentUri) || [] },
      });

      const terminalActions = await request('textDocument/codeAction', {
        textDocument: { uri: terminalUri },
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 20 },
        },
        context: { diagnostics: diagnosticsByUri.get(terminalUri) || [] },
      });

      const commentHasEdit = Array.isArray(commentActions)
        && commentActions.some((action) => action && action.edit);
      const terminalHasCommand = Array.isArray(terminalActions)
        && terminalActions.some((action) =>
          action
          && action.command
          && action.command.command === 'realtimeDevAgent.runTerminalTask');

      await request('workspace/executeCommand', {
        command: 'realtimeDevAgent.runTerminalTask',
        arguments: [
          {
            uri: terminalUri,
            command: 'printf "zed-terminal-ok\\n"',
            cwd: repoRoot,
            line: 1,
            triggerText: '// * git status',
            removeTrigger: false,
          },
        ],
      });

      await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));

      const sawCommentDiagnostics = (diagnosticsByUri.get(commentUri) || []).length > 0;
      const sawTerminalLog = logMessages.some((message) => message.includes('zed-terminal-ok'));
      const sawTerminalReady = logMessages.some((message) => message.includes('terminal pronto para o proximo comando.'));
      const ok = sawCommentDiagnostics && commentHasEdit && terminalHasCommand && sawTerminalLog && sawTerminalReady;

      finalize({
        name: 'zed-lsp-smoke',
        ok,
        status: ok ? 0 : 1,
        stdout: JSON.stringify({
          sawCommentDiagnostics,
          commentHasEdit,
          terminalHasCommand,
          sawTerminalLog,
          sawTerminalReady,
        }),
        stderr: stderr.join(''),
      });
    }

    child.on('close', () => {
      finalize({
        name: 'zed-lsp-smoke',
        ok: false,
        status: 1,
        stdout: '',
        stderr: stderr.join(''),
      });
    });

    child.on('exit', () => {
      finalize({
        name: 'zed-lsp-smoke',
        ok: false,
        status: 1,
        stdout: '',
        stderr: stderr.join(''),
      });
    });

    runSmoke()
      .catch((error) => {
        finalize({
          name: 'zed-lsp-smoke',
          ok: false,
          status: 1,
          stdout: '',
          stderr: `${stderr.join('')}\n${error.stack || error.message || String(error)}`.trim(),
        });
      })
      .finally(() => {
        child.stdin.end();
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 300);
      });
  });
}

async function main() {
  const checks = [
    ...runNodeChecks(),
    ...runParityContractChecks(),
    runNvimSmoke(),
    await runZedLspSmoke(),
  ];

  if (validateVsCodePackaging()) {
    checks.push(runVsCodePackage());
  }

  const ok = checks.every((check) => check.ok);
  console.log(JSON.stringify({ ok, checks }, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
