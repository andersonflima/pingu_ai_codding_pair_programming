#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { hasLiveOpenAiValidation } = require('./require_real_ai_command');

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
    'set noswapfile',
    "set shell=/bin/sh",
    "set shellcmdflag=-c",
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
    timeout: 15000,
    killSignal: 'SIGKILL',
  });
}

function runCase(name, buildCase) {
  const workspaceRoot = createWorkspace(`realtime-dev-agent-nvim-${name}-`);
  const setup = buildCase(workspaceRoot);
  const result = runNvimForFile(workspaceRoot, setup.targetFile);
  if (result.status !== 0) {
    const timeoutSuffix = result.error && result.error.code === 'ETIMEDOUT'
      ? `\nTempo limite excedido para ${name}.`
      : '';
    throw new Error(`${name}: nvim retornou ${result.status}\n${result.stderr || result.stdout}${timeoutSuffix}`);
  }
  return {
    name,
    workspaceRoot,
    ...setup.verify(workspaceRoot),
  };
}

function buildTextAutofixCase({
  relativePath,
  content,
  scripts = {},
  summarize,
  failureMessage,
}) {
  return function buildCase(workspaceRoot) {
    writePackageJson(workspaceRoot, scripts);
    const targetFile = path.join(workspaceRoot, relativePath);
    writeFile(targetFile, content);

    return {
      targetFile,
      verify() {
        const contents = fs.readFileSync(targetFile, 'utf8');
        const summary = summarize(contents, workspaceRoot);
        assert(Object.values(summary).every(Boolean), failureMessage);
        return summary;
      },
    };
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

const buildCMissingDelimiterCase = buildTextAutofixCase({
  relativePath: path.join('src', 'billing.c'),
  content: [
    'int soma(int valor) {',
    '  return valor + 1;',
  ].join('\n'),
  summarize: (contents) => ({
    closedBlock: String(contents || '').trimEnd().endsWith('}'),
  }),
  failureMessage: 'nvim c syntax_missing_delimiter: o bloco esperado nao foi fechado.',
});

const buildDockerfileWorkdirCase = buildTextAutofixCase({
  relativePath: path.join('docker', 'Dockerfile'),
  content: [
    'FROM node:20',
    'COPY . .',
  ].join('\n'),
  summarize: (contents) => ({
    insertedWorkdir: String(contents || '').includes('WORKDIR /app'),
  }),
  failureMessage: 'nvim dockerfile_workdir: WORKDIR /app nao foi inserido.',
});

const buildGoFunctionDocCase = buildTextAutofixCase({
  relativePath: path.join('src', 'billing.go'),
  content: [
    'func Soma(valor int) int {',
    '  return valor + 1',
    '}',
  ].join('\n'),
  summarize: (contents) => ({
    insertedDocumentation: String(contents || '').includes('comportamento principal'),
  }),
  failureMessage: 'nvim go function_doc: a documentacao esperada nao foi inserida.',
});

const buildLuaFunctionDocCase = buildTextAutofixCase({
  relativePath: path.join('src', 'billing.lua'),
  content: [
    'local function soma(valor)',
    '  return valor + 1',
    'end',
  ].join('\n'),
  summarize: (contents) => ({
    insertedDocumentation: String(contents || '').includes('Orquestra o comportamento principal'),
  }),
  failureMessage: 'nvim lua function_doc: a documentacao esperada nao foi inserida.',
});

const buildJavaScriptFunctionDocVariantsCase = buildTextAutofixCase({
  relativePath: path.join('src', 'billing_variants.js'),
  content: [
    'const soma = (a, b) => a + b;',
    '',
    'class Calculadora {',
    '  total(valor) {',
    '    return valor + 1;',
    '  }',
    '',
    '  parcial = (valor) => valor;',
    '}',
    '',
    'module.exports = { soma, Calculadora };',
  ].join('\n'),
  summarize: (contents) => ({
    insertedArrowDocumentation: String(contents || '').includes('Orquestra o comportamento principal de soma'),
    insertedMethodDocumentation: String(contents || '').includes('Orquestra o comportamento principal de total'),
    insertedFieldDocumentation: String(contents || '').includes('Orquestra o comportamento principal de parcial'),
  }),
  failureMessage: 'nvim javascript function_doc: variacoes de funcao nao receberam documentacao esperada.',
});

const buildJavaScriptRequireBindingPreservedCase = buildTextAutofixCase({
  relativePath: path.join('src', 'billing_require_binding.js'),
  content: [
    'function buildHasher(createHashh) {',
    '  const { createHash } = require(\'node:crypto\');',
    '  return createHash(\'sha256\');',
    '}',
    '',
    'module.exports = { buildHasher };',
  ].join('\n'),
  summarize: (contents) => ({
    preservedRequireBinding: String(contents || '').includes('const { createHash } = require(\'node:crypto\');'),
    preservedUsage: String(contents || '').includes('return createHash(\'sha256\');'),
  }),
  failureMessage: 'nvim javascript undefined_variable: a linha de require/destructuring nao deveria ter sido renomeada.',
});
function buildJavaScriptLocalRequireSourceValidationCase(workspaceRoot) {
  writePackageJson(workspaceRoot);
  writeFile(
    path.join(workspaceRoot, 'src', 'hash.js'),
    [
      'function createHash(value) {',
      '  return value;',
      '}',
      '',
      'module.exports = { createHash };',
    ].join('\n'),
  );
  const targetFile = path.join(workspaceRoot, 'src', 'billing_require_local_source.js');
  writeFile(
    targetFile,
    [
      'function buildHasher() {',
      '  const { createHashh } = require(\'./hash\');',
      '  return createHash(\'sha256\');',
      '}',
      '',
      'module.exports = { buildHasher };',
    ].join('\n'),
  );

  return {
    targetFile,
    verify() {
      const contents = fs.readFileSync(targetFile, 'utf8');
      const summary = {
        correctedRequireBinding: String(contents || '').includes('const { createHash } = require(\'./hash\');'),
        preservedUsage: String(contents || '').includes('return createHash(\'sha256\');'),
      };

      assert(
        summary.correctedRequireBinding,
        'nvim javascript undefined_variable: o binding local deveria ser validado pela origem do require e corrigido.',
      );
      assert(
        summary.preservedUsage,
        'nvim javascript undefined_variable: o uso do metodo nao deveria ser trocado para acompanhar um import invalido.',
      );

      return summary;
    },
  };
}

const buildMarkdownTitleCase = buildTextAutofixCase({
  relativePath: path.join('docs', 'api.md'),
  content: 'conteudo sem titulo\n',
  summarize: (contents) => ({
    insertedTitle: String(contents || '').includes('# Titulo do documento'),
  }),
  failureMessage: 'nvim markdown_title: o H1 esperado nao foi inserido.',
});

const buildMermaidMissingDelimiterCase = buildTextAutofixCase({
  relativePath: path.join('diagrams', 'authentication.mmd'),
  content: [
    'flowchart LR',
    '  A[Inicio --> B[Fim]',
  ].join('\n'),
  summarize: (contents) => ({
    closedDelimiter: String(contents || '').includes('  ]'),
  }),
  failureMessage: 'nvim mermaid syntax_missing_delimiter: o delimitador esperado nao foi fechado.',
});

const buildRustFunctionDocCase = buildTextAutofixCase({
  relativePath: path.join('src', 'billing.rs'),
  content: [
    'pub fn soma(valor: i32) -> i32 {',
    '    valor + 1',
    '}',
  ].join('\n'),
  summarize: (contents) => ({
    insertedDocumentation: String(contents || '').includes('Orquestra o comportamento principal'),
  }),
  failureMessage: 'nvim rust function_doc: a documentacao esperada nao foi inserida.',
});

const buildRubyFunctionDocCase = buildTextAutofixCase({
  relativePath: path.join('lib', 'billing.rb'),
  content: [
    'def soma(valor)',
    '  valor + 1',
    'end',
  ].join('\n'),
  summarize: (contents) => ({
    insertedDocumentation: String(contents || '').includes('comportamento principal'),
  }),
  failureMessage: 'nvim ruby function_doc: a documentacao esperada nao foi inserida.',
});

function buildRubyFunctionDocFarFromCursorCase(workspaceRoot) {
  writePackageJson(workspaceRoot);
  const targetFile = path.join(workspaceRoot, 'lib', 'billing_far.rb');
  const lines = Array.from({ length: 40 }, () => '');
  lines.push('def soma_longe(valor)');
  lines.push('  valor + 1');
  lines.push('end');
  writeFile(targetFile, lines.join('\n'));

  return {
    targetFile,
    verify() {
      const contents = fs.readFileSync(targetFile, 'utf8');
      const summary = {
        preservedFarFunctionWithoutAutofix: !String(contents || '').includes('comportamento principal'),
      };

      assert(
        summary.preservedFarFunctionWithoutAutofix,
        'nvim near_cursor scope: issue distante do cursor nao deveria entrar no batch automatico padrao.',
      );

      return summary;
    },
  };
}

const buildShellMissingQuoteCase = buildTextAutofixCase({
  relativePath: path.join('scripts', 'quote.sh'),
  content: 'echo "ok\n',
  summarize: (contents) => ({
    closedQuote: String(contents || '').includes('echo "ok"'),
  }),
  failureMessage: 'nvim shell syntax_missing_quote: a aspa esperada nao foi fechada.',
});

const buildTerraformRequiredVersionCase = buildTextAutofixCase({
  relativePath: path.join('infra', 'main.tf'),
  content: 'resource "aws_s3_bucket" "example" {}\n',
  summarize: (contents) => ({
    insertedRequiredVersion: String(contents || '').includes('required_version = ">= 1.5.0"'),
  }),
  failureMessage: 'nvim terraform_required_version: o bloco de versao nao foi inserido.',
});

const buildTomlMissingQuoteCase = buildTextAutofixCase({
  relativePath: path.join('config', 'app.toml'),
  content: 'host = "localhost\n',
  summarize: (contents) => ({
    closedQuote: String(contents || '').includes('host = "localhost"'),
  }),
  failureMessage: 'nvim toml syntax_missing_quote: a aspa esperada nao foi fechada.',
});

const buildVimFunctionDocCase = buildTextAutofixCase({
  relativePath: path.join('autoload', 'billing.vim'),
  content: [
    'function! Soma(valor)',
    '  return a:valor + 1',
    'endfunction',
  ].join('\n'),
  summarize: (contents) => ({
    insertedDocumentation: String(contents || '').includes('Orquestra o comportamento principal'),
  }),
  failureMessage: 'nvim vim function_doc: a documentacao esperada nao foi inserida.',
});

const buildYamlMissingQuoteCase = buildTextAutofixCase({
  relativePath: path.join('config', 'app.yaml'),
  content: 'name: "api\n',
  summarize: (contents) => ({
    closedQuote: String(contents || '').includes('name: "api"'),
  }),
  failureMessage: 'nvim yaml syntax_missing_quote: a aspa esperada nao foi fechada.',
});

function main() {
  const realAiAvailable = hasLiveOpenAiValidation();
  const cases = [];
  if (realAiAvailable) {
    cases.push(runCase('comment-task', buildCommentTaskCase));
    cases.push(runCase('context-file', buildContextFileCase));
  }
  cases.push(runCase('terminal-task', buildTerminalTaskCase));
  cases.push(runCase('c-missing-delimiter', buildCMissingDelimiterCase));
  cases.push(runCase('dockerfile-workdir', buildDockerfileWorkdirCase));
  cases.push(runCase('go-function-doc', buildGoFunctionDocCase));
  cases.push(runCase('javascript-function-doc-variants', buildJavaScriptFunctionDocVariantsCase));
  cases.push(runCase('javascript-require-binding-preserved', buildJavaScriptRequireBindingPreservedCase));
  cases.push(runCase('javascript-local-require-source-validation', buildJavaScriptLocalRequireSourceValidationCase));
  cases.push(runCase('lua-function-doc', buildLuaFunctionDocCase));
  cases.push(runCase('markdown-title', buildMarkdownTitleCase));
  cases.push(runCase('mermaid-missing-delimiter', buildMermaidMissingDelimiterCase));
  cases.push(runCase('rust-function-doc', buildRustFunctionDocCase));
  cases.push(runCase('ruby-function-doc', buildRubyFunctionDocCase));
  cases.push(runCase('ruby-function-doc-far-from-cursor', buildRubyFunctionDocFarFromCursorCase));
  cases.push(runCase('shell-missing-quote', buildShellMissingQuoteCase));
  cases.push(runCase('terraform-required-version', buildTerraformRequiredVersionCase));
  cases.push(runCase('toml-missing-quote', buildTomlMissingQuoteCase));
  cases.push(runCase('vim-function-doc', buildVimFunctionDocCase));
  cases.push(runCase('yaml-missing-quote', buildYamlMissingQuoteCase));

  console.log(JSON.stringify({
    ok: true,
    hasLiveOpenAiValidation: realAiAvailable,
    cases,
  }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || error.message || String(error));
    process.exit(1);
  }
}

module.exports = {
  assert,
  buildNvimScript,
  createWorkspace,
  runCase,
  runNvimForFile,
  vimString,
  writeFile,
  writePackageJson,
};
