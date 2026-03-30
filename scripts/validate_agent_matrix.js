#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { analyzeText } = require('../lib/analyzer');

const repoRoot = path.resolve(__dirname, '..');

const fixtureCases = [
  ['anget_test/javascript/src/01_comment_simple.js', ['comment_task']],
  ['anget_test/javascript/src/02_comment_advanced.js', ['comment_task']],
  ['anget_test/javascript/src/03_terminal_task.js', ['terminal_task']],
  ['anget_test/javascript/src/04_context_blueprint.js', ['context_file']],
  ['anget_test/javascript/src/05_escaped_marker.js', ['comment_task']],
  ['anget_test/javascript/src/06_unit_contract.js', ['unit_test']],
  ['anget_test/javascript/src/07_escaped_terminal_task.js', ['terminal_task']],
  ['anget_test/javascript/src/08_escaped_context_blueprint.js', ['context_file']],
  ['anget_test/typescript/src/01_comment_simple.ts', ['comment_task']],
  ['anget_test/typescript/src/02_comment_advanced.ts', ['comment_task']],
  ['anget_test/typescript/src/03_unit_contract.ts', ['unit_test']],
  ['anget_test/react/src/01_d20_prompt.tsx', ['comment_task']],
  ['anget_test/react/src/02_component_contract.tsx', ['unit_test']],
  ['anget_test/python/app/01_d20_prompt.py', ['comment_task']],
  ['anget_test/python/app/02_unit_contract.py', ['unit_test']],
  ['anget_test/elixir/lib/01_d20_prompt.ex', ['comment_task']],
  ['anget_test/elixir/lib/03_terminal_task.exs', ['terminal_task']],
  ['anget_test/go/pkg/01_comment_prompt.go', ['comment_task']],
  ['anget_test/go/pkg/02_unit_contract.go', ['unit_test']],
  ['anget_test/rust/src/01_comment_prompt.rs', ['comment_task']],
  ['anget_test/rust/src/math.rs', ['unit_test']],
  ['anget_test/ruby/lib/01_d20_prompt.rb', ['comment_task']],
  ['anget_test/ruby/lib/02_unit_contract.rb', ['unit_test']],
  ['anget_test/ruby/lib/03_terminal_task.rb', ['terminal_task']],
  ['anget_test/c/src/01_comment_prompt.c', ['comment_task']],
  ['anget_test/c/src/02_comment_advanced.c', ['comment_task']],
  ['anget_test/c/src/03_terminal_task.c', ['terminal_task']],
  ['anget_test/c/src/04_unit_contract.c', ['unit_test']],
  ['anget_test/lua/lua/01_comment_simple.lua', ['comment_task']],
  ['anget_test/lua/lua/02_comment_advanced.lua', ['comment_task']],
  ['anget_test/lua/lua/03_unit_contract.lua', ['unit_test']],
  ['anget_test/lua/lua/04_terminal_task.lua', ['terminal_task']],
  ['anget_test/vim/autoload/01_comment_prompt.vim', ['comment_task']],
  ['anget_test/vim/autoload/02_comment_advanced.vim', ['comment_task']],
  ['anget_test/vim/autoload/03_terminal_task.vim', ['terminal_task']],
  ['anget_test/vim/autoload/04_unit_contract.vim', ['unit_test']],
  ['anget_test/shell/01_comment_prompt.sh', ['comment_task']],
  ['anget_test/shell/02_terminal_task.sh', ['terminal_task']],
  ['anget_test/docker/Dockerfile.prompt', ['comment_task', 'unit_test']],
  ['anget_test/docker/Dockerfile', ['unit_test']],
  ['anget_test/compose/docker-compose.yml', ['unit_test']],
  ['anget_test/markdown/prompt.md', ['comment_task']],
  ['anget_test/markdown/README.md', ['unit_test']],
  ['anget_test/mermaid/prompt.mmd', ['comment_task']],
  ['anget_test/mermaid/diagram.mmd', ['unit_test']],
  ['anget_test/toml/config.toml', ['comment_task']],
  ['anget_test/terraform/prompt.tf', ['comment_task']],
  ['anget_test/terraform/main.tf', ['terraform_required_version']],
  ['anget_test/yaml/config.yaml', ['unit_test']],
  ['anget_test/syntax/javascript_extra_delimiter.js', ['syntax_extra_delimiter']],
  ['anget_test/syntax/javascript_missing_comma.js', ['syntax_missing_comma']],
  ['anget_test/syntax/lua_missing_quote.lua', ['syntax_missing_quote']],
  ['anget_test/syntax/markdown_unclosed_fence.md', ['syntax_missing_delimiter']],
];

const syntheticCases = [
  buildSyntheticCase(
    'synthetic:elixir:public-contracts',
    'elixir/public_contracts.ex',
    [
      'defmodule Billing do',
      '  def soma(numero) do',
      '    numero + 1',
      '  end',
      'end',
    ].join('\n'),
    ['moduledoc', 'function_doc', 'function_spec'],
  ),
  buildSyntheticCase(
    'synthetic:elixir:debug-output',
    'elixir/debug_output.ex',
    [
      'defmodule Billing do',
      '  def soma(numero) do',
      '    IO.inspect(numero)',
      '  end',
      'end',
    ].join('\n'),
    ['debug_output'],
  ),
  buildSyntheticCase(
    'synthetic:elixir:undefined-variable',
    'elixir/undefined_variable.ex',
    [
      'defmodule Billing do',
      '  def soma(numero) do',
      '    numeroo + 1',
      '  end',
      'end',
    ].join('\n'),
    ['undefined_variable'],
    ['numero + 1'],
  ),
  buildSyntheticCase(
    'synthetic:elixir:functional-reassignment',
    'elixir/functional_reassignment.ex',
    [
      'defmodule Billing do',
      '  def soma(valor) do',
      '    valor = valor + 1',
      '  end',
      'end',
    ].join('\n'),
    ['functional_reassignment'],
  ),
  buildSyntheticCase(
    'synthetic:elixir:nested-condition',
    'elixir/nested_condition.ex',
    [
      'defmodule Billing do',
      '  def valida(a, b, c, d, e) do',
      '    if a do',
      '      if b do',
      '        if c do',
      '          if d do',
      '            if e do',
      '              :ok',
      '            end',
      '          end',
      '        end',
      '      end',
      '    end',
      '  end',
      'end',
    ].join('\n'),
    ['nested_condition'],
  ),
  buildSyntheticCase(
    'synthetic:javascript:todo-fixme',
    'javascript/todo_fixme.js',
    [
      'function processaPedido() {',
      '  // TODO: remover atalho depois da migracao',
      '  return true;',
      '}',
    ].join('\n'),
    ['todo_fixme'],
  ),
  buildSyntheticCase(
    'synthetic:javascript:function-doc',
    'javascript/function_doc.js',
    [
      'function processa(usuario) {',
      '  return usuario;',
      '}',
    ].join('\n'),
    ['function_doc'],
  ),
  buildSyntheticCase(
    'synthetic:javascript:flow-comment-and-missing-dependency',
    'javascript/missing_dependency.js',
    [
      'function abrePool() {',
      '  const pool = new Pool();',
      '  return pool;',
      '}',
    ].join('\n'),
    ['missing_dependency', 'flow_comment'],
  ),
  buildSyntheticCase(
    'synthetic:markdown:title',
    'docs/no_title.md',
    'guia operacional sem titulo principal\n',
    ['markdown_title'],
  ),
  buildSyntheticCase(
    'synthetic:docker:workdir',
    'docker/Dockerfile',
    'FROM node:20\nCOPY . .\nRUN npm test\n',
    ['dockerfile_workdir'],
  ),
  buildSyntheticCase(
    'synthetic:javascript:trailing-whitespace-and-tabs',
    'javascript/whitespace.js',
    `const valor = 1;   \n\tconst outro = 2;\n`,
    ['trailing_whitespace', 'tabs'],
  ),
  buildSyntheticCase(
    'synthetic:javascript:long-line',
    'javascript/long_line.js',
    `const linha = '${'x'.repeat(140)}';\n`,
    ['long_line'],
  ),
  buildSyntheticCase(
    'synthetic:javascript:large-file',
    'javascript/large_file.js',
    Array.from({ length: 301 }, (_, index) => `const linha_${index} = ${index};`).join('\n'),
    ['large_file'],
  ),
  buildSyntheticCase(
    'synthetic:ruby:generated-comment-is-stable',
    'ruby/generated_comment.rb',
    [
      '# Retorna um valor aleatorio entre 1 e 20 simulando a rolagem de um dado.',
      '# Retorno: Numero inteiro entre 1 e 20.',
      'def dados()',
      '  # Executa a etapa de efeito colateral necessaria para este fluxo.',
      '  rand(1..20)',
      'end',
    ].join('\n'),
    [],
    [],
    ['function_doc', 'function_spec', 'syntax_missing_quote'],
  ),
  buildSyntheticCase(
    'synthetic:typescript:enum-structure',
    'typescript/enum_structure.ts',
    '//: cria enum StatusPedido com pendente, aprovado e cancelado\n',
    ['comment_task'],
    ['export enum StatusPedido {', "Pendente = 'PENDENTE'"],
  ),
  buildSyntheticCase(
    'synthetic:javascript:object-structure',
    'javascript/object_structure.js',
    '//: cria objeto pedido com id, nome e status\n',
    ['comment_task'],
    ['const pedido = {', 'status: "ativo",'],
  ),
  buildSyntheticCase(
    'synthetic:python:enum-structure',
    'python/enum_structure.py',
    '#: cria enum PaymentStatus com pending, paid e refunded\n',
    ['comment_task'],
    ['class PaymentStatus(Enum):', 'PAID = "PAID"'],
  ),
  buildSyntheticCase(
    'synthetic:elixir:enum-structure',
    'elixir/enum_structure.ex',
    '#: cria enum status_pedido com pendente, aprovado e cancelado\n',
    ['comment_task'],
    ['@type status_pedido :: :pendente | :aprovado | :cancelado', 'def status_pedido_values do'],
  ),
  buildSyntheticCase(
    'synthetic:go:enum-structure',
    'go/enum_structure.go',
    '//: cria enum StatusPedido com pendente, aprovado e cancelado\n',
    ['comment_task'],
    ['type StatusPedido string', 'StatusPedidoAprovado StatusPedido = "APROVADO"'],
  ),
  buildSyntheticCase(
    'synthetic:rust:enum-structure',
    'rust/enum_structure.rs',
    '//: cria enum StatusPedido com pendente, aprovado e cancelado\n',
    ['comment_task'],
    ['pub enum StatusPedido {', 'Aprovado,'],
  ),
  buildSyntheticCase(
    'synthetic:ruby:enum-structure',
    'ruby/enum_structure.rb',
    '#: cria enum StatusPedido com pendente, aprovado e cancelado\n',
    ['comment_task'],
    ['StatusPedido = {', "aprovado: 'APROVADO'"],
  ),
  buildSyntheticCase(
    'synthetic:c:enum-structure',
    'c/enum_structure.c',
    '//: cria enum StatusPedido com pendente, aprovado e cancelado\n',
    ['comment_task'],
    ['typedef enum StatusPedido {', 'STATUS_PEDIDO_APROVADO,'],
  ),
  buildSyntheticCase(
    'synthetic:lua:enum-structure',
    'lua/enum_structure.lua',
    '--: cria enum StatusPedido com pendente, aprovado e cancelado\n',
    ['comment_task'],
    ['local StatusPedido = {', 'APROVADO = "APROVADO",'],
  ),
  buildSyntheticCase(
    'synthetic:vim:enum-structure',
    'vim/enum_structure.vim',
    '": cria enum StatusPedido com pendente, aprovado e cancelado\n',
    ['comment_task'],
    ['let s:status_pedido = {', "'aprovado': 'APROVADO'"],
  ),
  buildSyntheticCase(
    'synthetic:shell:enum-structure',
    'shell/enum_structure.sh',
    '#: cria enum StatusPedido com pendente, aprovado e cancelado\n',
    ['comment_task'],
    ['readonly STATUS_PEDIDO_APROVADO="APROVADO"'],
  ),
  buildSyntheticCase(
    'synthetic:javascript:class-structure',
    'javascript/class_structure.js',
    '//: cria class Pedido com id, nome e status\n',
    ['comment_task'],
    ['export class Pedido {', 'this.status = status;'],
  ),
  buildSyntheticCase(
    'synthetic:typescript:interface-structure',
    'typescript/interface_structure.ts',
    '//: cria interface Pedido com id, nome e status\n',
    ['comment_task'],
    ['export interface Pedido {', 'nome: string;'],
  ),
  buildSyntheticCase(
    'synthetic:python:class-structure',
    'python/class_structure.py',
    '#: cria class Pedido com id, nome e status\n',
    ['comment_task'],
    ['class Pedido:', 'self.status = status'],
  ),
  buildSyntheticCase(
    'synthetic:elixir:module-structure',
    'elixir/module_structure.ex',
    '#: cria modulo Billing com funcoes listar e criar\n',
    ['comment_task'],
    ['defmodule Billing do', 'def listar(itens) do'],
  ),
  buildSyntheticCase(
    'synthetic:go:struct-structure',
    'go/struct_structure.go',
    '//: cria struct Pedido com id, nome e status\n',
    ['comment_task'],
    ['type Pedido struct {', 'Status string'],
  ),
  buildSyntheticCase(
    'synthetic:rust:interface-structure',
    'rust/interface_structure.rs',
    '//: cria interface Validador com metodos validar e sincronizar\n',
    ['comment_task'],
    ['pub trait Validador {', 'fn validar(&self) -> bool;'],
  ),
  buildSyntheticCase(
    'synthetic:ruby:class-structure',
    'ruby/class_structure.rb',
    '#: cria class Pedido com id, nome e status\n',
    ['comment_task'],
    ['class Pedido', '@status = status'],
  ),
  buildSyntheticCase(
    'synthetic:c:struct-structure',
    'c/struct_structure.c',
    '//: cria struct Pedido com id, nome e status\n',
    ['comment_task'],
    ['typedef struct Pedido {', 'const char* status;'],
  ),
  buildSyntheticCase(
    'synthetic:lua:module-structure',
    'lua/module_structure.lua',
    '--: cria modulo Billing com funcoes listar e criar\n',
    ['comment_task'],
    ['local Billing = {}', 'function Billing.listar(itens)'],
  ),
  buildSyntheticCase(
    'synthetic:vim:namespace-structure',
    'vim/namespace_structure.vim',
    '": cria namespace billing com funcoes listar e criar\n',
    ['comment_task'],
    ['function! s:billing_listar(itens) abort', 'function! s:billing_criar(payload) abort'],
  ),
  buildSyntheticCase(
    'synthetic:shell:module-structure',
    'shell/module_structure.sh',
    '#: cria modulo billing com funcoes listar e criar\n',
    ['comment_task'],
    ['billing_listar() {', 'billing_criar() {'],
  ),
  buildSyntheticCase(
    'synthetic:typescript:enum-structure-idempotent',
    'typescript/enum_structure_existing.ts',
    [
      'export enum StatusPedido {',
      '  Pendente = "PENDENTE",',
      '  Aprovado = "APROVADO",',
      '  Cancelado = "CANCELADO",',
      '}',
      '',
      '//: cria enum StatusPedido com pendente, aprovado e cancelado',
    ].join('\n'),
    [],
    [],
    ['comment_task'],
  ),
  buildSyntheticCase(
    'synthetic:javascript:class-structure-idempotent',
    'javascript/class_structure_existing.js',
    [
      'export class Pedido {',
      '  constructor({ id = 0, nome = "", status = "ativo" } = {}) {',
      '    this.id = id;',
      '    this.nome = nome;',
      '    this.status = status;',
      '  }',
      '}',
      '',
      '//: cria class Pedido com id, nome e status',
    ].join('\n'),
    [],
    [],
    ['comment_task'],
  ),
  buildSyntheticCase(
    'synthetic:elixir:module-structure-idempotent',
    'elixir/module_structure_existing.ex',
    [
      'defmodule Billing do',
      '  def listar(itens) do',
      '    itens',
      '  end',
      '',
      '  def criar(payload) do',
      '    payload',
      '  end',
      'end',
      '',
      '#: cria modulo Billing com funcoes listar e criar',
    ].join('\n'),
    [],
    [],
    ['comment_task'],
  ),
];

const snippetExpectations = {
  'anget_test/javascript/src/01_comment_simple.js': [
    'function soma(a, b)',
    'return a + b',
  ],
  'anget_test/typescript/src/02_comment_advanced.ts': [
    'function somar_10(numero)',
    'return numero + 10',
  ],
  'anget_test/python/app/01_d20_prompt.py': [
    'def dados()',
    'random.randint(1, 20)',
  ],
  'anget_test/elixir/lib/01_d20_prompt.ex': [
    'def dados() do',
    'Enum.random(1..20)',
  ],
  'anget_test/react/src/01_d20_prompt.tsx': [
    'export function D20DiceRoller()',
    'const [faceValue, setFaceValue] = useState(sides);',
  ],
  'anget_test/go/pkg/01_comment_prompt.go': [
    'func soma(a float64, b float64) float64 {',
    'return a + b',
  ],
  'anget_test/rust/src/01_comment_prompt.rs': [
    'fn soma(a: f64, b: f64) -> f64 {',
    'a + b',
  ],
  'anget_test/ruby/lib/01_d20_prompt.rb': [
    'def dados()',
    'rand(1..20)',
  ],
  'anget_test/c/src/01_comment_prompt.c': [
    'double soma(double a, double b) {',
    'return a + b;',
  ],
  'anget_test/c/src/02_comment_advanced.c': [
    'double somar_10(double numero) {',
    'return numero + 10;',
  ],
  'anget_test/lua/lua/02_comment_advanced.lua': [
    'function somar_10(numero)',
    'return numero + 10',
  ],
  'anget_test/vim/autoload/02_comment_advanced.vim': [
    'function! somar_10(numero)',
    'return numero + 10',
  ],
  'anget_test/shell/01_comment_prompt.sh': [
    'somar_10() {',
    'printf \'%s\\n\' "$(( numero + 10 ))"',
  ],
  'anget_test/toml/config.toml': [
    'timeout = 30',
  ],
  'anget_test/terraform/prompt.tf': [
    'terraform {',
    'required_version = ">= 1.5.0"',
  ],
};

function readFile(relativeFile) {
  return fs.readFileSync(path.join(repoRoot, relativeFile), 'utf8');
}

function buildSyntheticCase(
  id,
  relativeSourcePath,
  content,
  expectedKinds,
  expectedSnippetIncludes = [],
  forbiddenKinds = [],
) {
  return {
    id,
    sourcePath: path.join(repoRoot, '__synthetic__', relativeSourcePath),
    content,
    expectedKinds,
    expectedSnippetIncludes,
    forbiddenKinds,
  };
}

function analyzeFixtureSource(sourcePath, content) {
  return analyzeText(sourcePath, content, { maxLineLength: 120 });
}

function normalizeFixtureCases() {
  const fileCases = fixtureCases.map(([relativeFile, expectedKinds]) => ({
    id: relativeFile,
    sourcePath: path.join(repoRoot, relativeFile),
    content: readFile(relativeFile),
    expectedKinds,
    expectedSnippetIncludes: snippetExpectations[relativeFile] || [],
  }));

  return [...fileCases, ...syntheticCases];
}

function runFixtureMatrix() {
  const failures = normalizeFixtureCases().reduce((accumulator, fixture) => {
    const issues = analyzeFixtureSource(fixture.sourcePath, fixture.content);
    const kinds = new Set(issues.map((issue) => issue.kind));
    const missingKinds = fixture.expectedKinds.filter((kind) => !kinds.has(kind));
    const forbiddenKinds = fixture.forbiddenKinds || [];
    const presentForbiddenKinds = forbiddenKinds.filter((kind) => kinds.has(kind));
    const expectedSnippets = fixture.expectedSnippetIncludes || [];
    const snippetPayload = issues
      .map((issue) => String(issue.snippet || ''))
      .filter((snippet) => snippet.length > 0)
      .join('\n---\n');
    const missingSnippetIncludes = expectedSnippets.filter((snippet) => !snippetPayload.includes(snippet));
    if (missingKinds.length === 0 && missingSnippetIncludes.length === 0 && presentForbiddenKinds.length === 0) {
      return accumulator;
    }

    return accumulator.concat({
      fixtureId: fixture.id,
      sourcePath: fixture.sourcePath,
      expectedKinds: fixture.expectedKinds,
      forbiddenKinds,
      actualKinds: Array.from(kinds).sort(),
      missingKinds,
      missingSnippetIncludes,
      presentForbiddenKinds,
    });
  }, []);

  return {
    ok: failures.length === 0,
    total: normalizeFixtureCases().length,
    failures,
  };
}

function findTerminalIssue(relativeFile) {
  const absoluteFile = path.join(repoRoot, relativeFile);
  return analyzeFixtureSource(absoluteFile, readFile(relativeFile)).find((issue) => issue.kind === 'terminal_task');
}

function runCommand(command, cwd) {
  return spawnSync('/bin/sh', ['-lc', command], {
    cwd,
    encoding: 'utf8',
  });
}

function runExternalChecks(externalFixturesDir) {
  const externalRoot = path.resolve(externalFixturesDir);
  const checks = [];

  const cTerminalIssue = findTerminalIssue('anget_test/c/src/01_comment_prompt.c');
  const cRoot = path.join(externalRoot, 'c');
  if (cTerminalIssue && fs.existsSync(cRoot)) {
    const cResult = runCommand(cTerminalIssue.action.command, cRoot);
    checks.push({
      name: 'external-c-terminal-task',
      ok: cResult.status === 0,
      status: cResult.status,
      stdout: cResult.stdout,
      stderr: cResult.stderr,
    });
  }

  const elixirRoot = path.join(externalRoot, 'elixir');
  if (fs.existsSync(elixirRoot)) {
    const elixirResult = spawnSync('mix', ['test'], {
      cwd: elixirRoot,
      encoding: 'utf8',
    });
    const sandboxPubSubDenied = String(elixirResult.stderr || '').includes('Mix.PubSub')
      && String(elixirResult.stderr || '').includes(':eperm');
    checks.push({
      name: 'external-elixir-mix-test',
      ok: elixirResult.status === 0 || sandboxPubSubDenied,
      skipped: sandboxPubSubDenied,
      status: elixirResult.status,
      stdout: elixirResult.stdout,
      stderr: elixirResult.stderr,
    });
  }

  return checks;
}

function parseExternalDir(argv) {
  const explicitIndex = argv.indexOf('--external-dir');
  if (explicitIndex !== -1 && argv[explicitIndex + 1]) {
    return argv[explicitIndex + 1];
  }
  return process.env.PINGU_EXTERNAL_FIXTURES_DIR || '';
}

function main() {
  const summary = {
    matrix: runFixtureMatrix(),
    external: [],
  };

  const externalDir = parseExternalDir(process.argv.slice(2));
  if (externalDir) {
    summary.external = runExternalChecks(externalDir);
  }

  const failingExternal = summary.external.filter((item) => !item.ok);
  const ok = summary.matrix.ok && failingExternal.length === 0;

  console.log(JSON.stringify({
    ok,
    matrix: {
      ok: summary.matrix.ok,
      total: summary.matrix.total,
      failures: summary.matrix.failures,
    },
    external: summary.external,
  }, null, 2));

  process.exit(ok ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = {
  fixtureCases,
  snippetExpectations,
  normalizeFixtureCases,
  parseExternalDir,
  readFile,
  repoRoot,
  runExternalChecks,
  runFixtureMatrix,
};
