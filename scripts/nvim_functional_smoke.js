#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function vimString(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

function createWorkspace(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(targetFile, contents) {
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.writeFileSync(targetFile, contents, 'utf8');
}

function writePackageJson(workspaceRoot, scripts = {}) {
  writeFile(
    path.join(workspaceRoot, 'package.json'),
    JSON.stringify({
      name: 'realtime-dev-agent-smoke',
      private: true,
      scripts,
    }, null, 2),
  );
}

function buildNvimScript(targetFile) {
  const pluginFile = path.join(repoRoot, 'vim', 'plugin', 'realtime_dev_agent.vim');
  const internalFile = path.join(repoRoot, 'vim', 'autoload', 'realtime_dev_agent', 'internal.vim');

  return [
    'set nomore',
    'let g:realtime_dev_agent_start_on_editor_enter = 0',
    'let g:realtime_dev_agent_review_on_open = 0',
    'let g:realtime_dev_agent_open_window_on_start = 0',
    'let g:realtime_dev_agent_show_window = 0',
    'let g:realtime_dev_agent_realtime_on_change = 0',
    'let g:realtime_dev_agent_auto_on_save = 0',
    'let g:realtime_dev_agent_open_qf = 0',
    'let g:realtime_dev_agent_realtime_open_qf = 0',
    "let g:realtime_dev_agent_terminal_strategy = 'headless-test'",
    `execute 'source ' . fnameescape(${vimString(pluginFile)})`,
    `execute 'source ' . fnameescape(${vimString(internalFile)})`,
    `execute 'edit ' . fnameescape(${vimString(targetFile)})`,
    'RealtimeDevAgentCheck',
    'write',
    'qa!',
  ].join('\n');
}

function runNvimForFile(workspaceRoot, targetFile) {
  const runnerScript = path.join(workspaceRoot, 'run-smoke.vim');
  writeFile(runnerScript, buildNvimScript(targetFile));

  return spawnSync('nvim', [
    '--headless',
    '-u',
    'NONE',
    '-i',
    'NONE',
    '-S',
    runnerScript,
  ], {
    cwd: workspaceRoot,
    encoding: 'utf8',
  });
}

function runCase(name, buildCase) {
  const workspaceRoot = createWorkspace(`realtime-dev-agent-nvim-${name}-`);
  const setup = buildCase(workspaceRoot);
  const result = runNvimForFile(workspaceRoot, setup.targetFile);
  if (result.status !== 0) {
    throw new Error(`${name}: nvim retornou ${result.status}\n${result.stderr || result.stdout}`);
  }
  return {
    name,
    workspaceRoot,
    ...setup.verify(workspaceRoot),
  };
}

function buildCommentTaskCase(workspaceRoot) {
  writePackageJson(workspaceRoot);
  const targetFile = path.join(workspaceRoot, 'src', 'comment.js');
  writeFile(targetFile, '//: funcao soma\n');

  return {
    targetFile,
    verify() {
      const contents = fs.readFileSync(targetFile, 'utf8');
      const summary = {
        applied: contents.includes('function soma(a, b)'),
        removedTrigger: !contents.includes('funcao soma'),
      };

      assert(summary.applied, 'nvim comment_task: snippet esperado nao foi aplicado.');
      assert(summary.removedTrigger, 'nvim comment_task: linha gatilho nao foi removida.');

      return summary;
    },
  };
}

function buildContextFileCase(workspaceRoot) {
  writePackageJson(workspaceRoot);
  const targetFile = path.join(workspaceRoot, 'src', 'context.js');
  writeFile(targetFile, '// ** bff para crud de usuario\n');

  return {
    targetFile,
    verify() {
      const contents = fs.readFileSync(targetFile, 'utf8');
      const contextFile = path.join(workspaceRoot, '.realtime-dev-agent', 'contexts', 'bff-crud-usuario.md');
      const entityFile = path.join(workspaceRoot, 'src', 'domain', 'entities', 'usuario.js');
      const gitignoreFile = path.join(workspaceRoot, '.gitignore');
      const summary = {
        removedTrigger: !contents.includes('bff para crud de usuario'),
        createdContextFile: fs.existsSync(contextFile),
        createdEntityFile: fs.existsSync(entityFile),
        updatedGitignore: fs.existsSync(gitignoreFile)
          && fs.readFileSync(gitignoreFile, 'utf8').includes('.realtime-dev-agent/'),
      };

      assert(summary.removedTrigger, 'nvim context_file: linha gatilho nao foi removida.');
      assert(summary.createdContextFile, 'nvim context_file: blueprint nao foi criado.');
      assert(summary.createdEntityFile, 'nvim context_file: scaffold de entidade nao foi criado.');
      assert(summary.updatedGitignore, 'nvim context_file: .gitignore nao foi atualizado.');

      return summary;
    },
  };
}

function buildTerminalTaskCase(workspaceRoot) {
  writePackageJson(workspaceRoot, {
    test: 'node ./write-terminal-output.js',
  });
  writeFile(
    path.join(workspaceRoot, 'write-terminal-output.js'),
    [
      'const fs = require("fs");',
      'fs.writeFileSync("terminal-smoke-ok.txt", "terminal-smoke-ok\\n", "utf8");',
      'console.log("terminal-smoke-ok");',
    ].join('\n'),
  );

  const targetFile = path.join(workspaceRoot, 'src', 'terminal.js');
  writeFile(targetFile, '// * rodar testes\n');

  return {
    targetFile,
    verify() {
      const contents = fs.readFileSync(targetFile, 'utf8');
      const outputFile = path.join(workspaceRoot, 'terminal-smoke-ok.txt');
      const summary = {
        removedTrigger: !contents.includes('rodar testes'),
        createdOutputFile: fs.existsSync(outputFile),
      };

      assert(summary.removedTrigger, 'nvim terminal_task: linha gatilho nao foi removida.');
      assert(summary.createdOutputFile, 'nvim terminal_task: comando inferido nao executou o script esperado.');

      return summary;
    },
  };
}

function main() {
  const cases = [
    runCase('comment-task', buildCommentTaskCase),
    runCase('context-file', buildContextFileCase),
    runCase('terminal-task', buildTerminalTaskCase),
  ];

  console.log(JSON.stringify({
    ok: true,
    cases,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
}
