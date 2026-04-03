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

function buildNvimScript(targetFile, extraCommands = []) {
  const pluginFile = path.join(repoRoot, 'vim', 'plugin', 'realtime_dev_agent.vim');
  const internalFile = path.join(repoRoot, 'vim', 'autoload', 'realtime_dev_agent', 'internal.vim');
  const extra = Array.isArray(extraCommands) ? extraCommands : [];

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
    ...extra,
    `execute 'source ' . fnameescape(${vimString(pluginFile)})`,
    `execute 'source ' . fnameescape(${vimString(internalFile)})`,
    `execute 'edit ' . fnameescape(${vimString(targetFile)})`,
    'RealtimeDevAgentCheck',
    'write',
    'qa!',
  ].join('\n');
}

function runNvimForFile(workspaceRoot, targetFile, extraCommands = []) {
  const runnerScript = path.join(workspaceRoot, 'run-smoke.vim');
  writeFile(runnerScript, buildNvimScript(targetFile, extraCommands));

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
  const result = runNvimForFile(workspaceRoot, setup.targetFile, setup.vimCommands || []);
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
  vimCommands = [],
  summarize,
  failureMessage,
}) {
  return function buildCase(workspaceRoot) {
    writePackageJson(workspaceRoot, scripts);
    const targetFile = path.join(workspaceRoot, relativePath);
    writeFile(targetFile, content);

    return {
      targetFile,
      vimCommands,
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

const buildPythonMultilineImportPreservedCase = buildTextAutofixCase({
  relativePath: path.join('src', 'billing_multiline_import.py'),
  vimCommands: ["let g:realtime_dev_agent_auto_fix_kinds = ['undefined_variable']"],
  content: [
    'from room_state import (',
    '    ChatState,',
    '    create_empty_state,',
    '    create_invite,',
    '    create_private_room,',
    '    create_public_room,',
    '    get_room,',
    '    join_room,',
    '    leave_room,',
    '    list_rooms_for_client,',
    '    serialize_room,',
    ')',
    '',
    'state = {}',
    'invite = {}',
    'room = {}',
    'joined_room_ids = []',
    'factory = create_empty_state',
  ].join('\n'),
  summarize: (contents) => ({
    preservedImportedStateFactory: String(contents || '').includes('    create_empty_state,'),
    preservedImportedInviteFactory: String(contents || '').includes('    create_invite,'),
    preservedImportedJoinRoom: String(contents || '').includes('    join_room,'),
  }),
  failureMessage: 'nvim python undefined_variable: bloco multiline import nao deveria ser reescrito por nomes globais parecidos.',
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
const buildJavaScriptMultilineRequireBindingPreservedCase = buildTextAutofixCase({
  relativePath: path.join('src', 'billing_multiline_require_binding.js'),
  vimCommands: ["let g:realtime_dev_agent_auto_fix_kinds = ['undefined_variable']"],
  content: [
    'function buildRoomState() {',
    '  const {',
    '    createEmptyState,',
    '    createInvite,',
    '    createRoom,',
    '  } = require(\'./room_state\');',
    '  const state = createEmptyState();',
    '  const invite = createInvite();',
    '  const room = createRoom(state, invite);',
    '  return room;',
    '}',
    '',
    'module.exports = { buildRoomState };',
  ].join('\n'),
  summarize: (contents) => ({
    preservedImportedFactory: String(contents || '').includes('    createEmptyState,'),
    preservedImportedInvite: String(contents || '').includes('    createInvite,'),
    preservedImportedRoomFactory: String(contents || '').includes('    createRoom,'),
  }),
  failureMessage: 'nvim javascript undefined_variable: bloco multiline require nao deveria ser reescrito por variaveis locais parecidas.',
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
const buildElixirImportUsePreservedCase = buildTextAutofixCase({
  relativePath: path.join('lib', 'billing_import_use_block.ex'),
  vimCommands: ["let g:realtime_dev_agent_auto_fix_kinds = ['undefined_variable']"],
  content: [
    'defmodule BillingImportUseBlock do',
    '  use RoomState',
    '',
    '  def build do',
    '    import RoomState,',
    '      only: [',
    '        create_empty_state: 0,',
    '        create_invite: 0,',
    '        create_room: 2',
    '      ]',
    '',
    '    state = create_empty_state()',
    '    invite = create_invite()',
    '    room = create_room(state, invite)',
    '    room',
    '  end',
    'end',
  ].join('\n'),
  summarize: (contents) => ({
    preservedUseDirective: String(contents || '').includes('  use RoomState'),
    preservedImportedStateFactory: String(contents || '').includes('        create_empty_state: 0,'),
    preservedImportedInviteFactory: String(contents || '').includes('        create_invite: 0,'),
  }),
  failureMessage: 'nvim elixir undefined_variable: blocos de use/import nao deveriam ser reescritos.',
});

function writeMockUndefinedVariableAnalyzer(workspaceRoot, issueMessage, issueSuggestion) {
  const analyzerFile = path.join(workspaceRoot, 'mock-import-guard-analyzer.js');
  const issueAction = {
    op: 'replace_line',
    range: {
      start: { line: 1, character: 10 },
      end: { line: 1, character: 21 },
    },
    text: 'createHash',
  };
  const issueText = `[error] undefined_variable: ${issueMessage} | ${issueSuggestion} || ACTION:${JSON.stringify(issueAction)} || SNIPPET:   const { createHash } = require('./hash');`;
  writeFile(
    analyzerFile,
    [
      '#!/usr/bin/env node',
      '\'use strict\';',
      'const fs = require(\'fs\');',
      'const args = process.argv.slice(2);',
      'const analyzeIndex = args.indexOf(\'--analyze\');',
      'const sourceIndex = args.indexOf(\'--source-path\');',
      'const analyzedFile = analyzeIndex >= 0 ? String(args[analyzeIndex + 1] || \'\') : \'\';',
      'const sourceFile = sourceIndex >= 0 ? String(args[sourceIndex + 1] || analyzedFile) : analyzedFile;',
      'const content = analyzedFile ? fs.readFileSync(analyzedFile, \'utf8\') : \'\';',
      `const issueText = ${JSON.stringify(issueText)};`,
      'if (content.includes(\'createHashh\')) {',
      '  process.stdout.write(`${sourceFile}:2:11: ${issueText}\\n`);',
      '}',
    ].join('\n'),
  );
  return analyzerFile;
}

function writeMockAutofixGuard(workspaceRoot) {
  const guardFile = path.join(workspaceRoot, 'scripts', 'autofix_guard_cli.js');
  writeFile(
    guardFile,
    [
      '#!/usr/bin/env node',
      '\'use strict\';',
      'process.stdout.write(JSON.stringify({ ok: true, validationFailures: [], runtimeFailures: [] }));',
    ].join('\n'),
  );
  return guardFile;
}

function buildJavaScriptImportBindingGenericIssueBlockedCase(workspaceRoot) {
  writePackageJson(workspaceRoot);
  writeMockAutofixGuard(workspaceRoot);
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
  const mockAnalyzer = writeMockUndefinedVariableAnalyzer(
    workspaceRoot,
    'Variavel \'createHashh\' nao declarada',
    'Substitua por \'createHash\' para manter coerencia do escopo atual.',
  );
  const targetFile = path.join(workspaceRoot, 'src', 'billing_import_guard_generic.js');
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
    vimCommands: [`let g:realtime_dev_agent_script = ${vimString(mockAnalyzer)}`],
    verify() {
      const contents = fs.readFileSync(targetFile, 'utf8');
      const summary = {
        preservedImportBinding: String(contents || '').includes('const { createHashh } = require(\'./hash\');'),
      };

      assert(
        summary.preservedImportBinding,
        'nvim javascript undefined_variable: issue generico nao deveria reescrever binding de import.',
      );

      return summary;
    },
  };
}

function buildJavaScriptImportBindingValidatedIssueCase(workspaceRoot) {
  writePackageJson(workspaceRoot);
  writeMockAutofixGuard(workspaceRoot);
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
  const mockAnalyzer = writeMockUndefinedVariableAnalyzer(
    workspaceRoot,
    'Import \'createHashh\' nao exportado por \'./hash\'',
    'Substitua por \'createHash\' para alinhar com a origem importada.',
  );
  const targetFile = path.join(workspaceRoot, 'src', 'billing_import_guard_validated.js');
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
    vimCommands: [`let g:realtime_dev_agent_script = ${vimString(mockAnalyzer)}`],
    verify() {
      const contents = fs.readFileSync(targetFile, 'utf8');
      const summary = {
        correctedImportBinding: String(contents || '').includes('const { createHash } = require(\'./hash\');'),
      };

      assert(
        summary.correctedImportBinding,
        'nvim javascript undefined_variable: import validado pela origem deveria continuar aplicando.',
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
  cases.push(runCase('elixir-import-use-preserved', buildElixirImportUsePreservedCase));
  cases.push(runCase('javascript-function-doc-variants', buildJavaScriptFunctionDocVariantsCase));
  cases.push(runCase('javascript-multiline-require-binding-preserved', buildJavaScriptMultilineRequireBindingPreservedCase));
  cases.push(runCase('javascript-require-binding-preserved', buildJavaScriptRequireBindingPreservedCase));
  cases.push(runCase('javascript-local-require-source-validation', buildJavaScriptLocalRequireSourceValidationCase));
  cases.push(runCase('javascript-import-binding-generic-issue-blocked', buildJavaScriptImportBindingGenericIssueBlockedCase));
  cases.push(runCase('javascript-import-binding-validated-issue', buildJavaScriptImportBindingValidatedIssueCase));
  cases.push(runCase('lua-function-doc', buildLuaFunctionDocCase));
  cases.push(runCase('python-multiline-import-preserved', buildPythonMultilineImportPreservedCase));
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
