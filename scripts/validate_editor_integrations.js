#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

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

function runZedLspSmoke() {
  return new Promise((resolve) => {
    const server = path.join(repoRoot, 'zed-extension/server/realtime_dev_agent_lsp.js');
    const child = spawn('node', [server], {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let buffer = '';
    let sawDiagnostics = false;

    function send(message) {
      const payload = JSON.stringify(message);
      child.stdin.write(`Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`);
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
        if (message.method === 'textDocument/publishDiagnostics') {
          sawDiagnostics = true;
        }
      }
    });

    const stderr = [];
    child.stderr.on('data', (chunk) => {
      stderr.push(String(chunk));
    });

    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { processId: process.pid, rootUri: null, capabilities: {} } });
    send({ jsonrpc: '2.0', method: 'initialized', params: {} });
    send({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri: 'file:///tmp/example.js',
          languageId: 'javascript',
          version: 1,
          text: '//: funcao soma\n',
        },
      },
    });

    let finalized = false;
    const finalize = () => {
      if (finalized) {
        return;
      }
      finalized = true;
      resolve({
        name: 'zed-lsp-smoke',
        ok: sawDiagnostics,
        status: sawDiagnostics ? 0 : 1,
        stdout: sawDiagnostics ? 'publishDiagnostics emitted' : '',
        stderr: stderr.join(''),
      });
    };

    child.on('close', finalize);
    child.on('exit', finalize);

    setTimeout(() => {
      child.stdin.end();
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 300);
    }, 1200);
  });
}

async function main() {
  const checks = [
    ...runNodeChecks(),
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
