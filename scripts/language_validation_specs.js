#!/usr/bin/env node
'use strict';

const path = require('path');

function projectFile(relativePath, content) {
  return { relativePath, content };
}

function genericContextCase(spec, relativeFile, commentLine) {
  return {
    id: `${spec.id}:context_file:create`,
    relativeFile,
    content: `${commentLine}\n`,
    expectedKinds: ['context_file'],
    expectedSnippetIncludes: [
      `source_ext: ${spec.sourceExt}`,
      `source_root: ${spec.sourceRoot}`,
    ],
    expectedActionOp: 'write_file',
    expectedTargetFileSuffix: path.join('.realtime-dev-agent', 'contexts', 'bff-crud-usuario.md'),
  };
}

function genericUnitTestCase(spec, relativeFile, content, expectedTargetFileSuffix) {
  return {
    id: `${spec.id}:unit_test:create`,
    relativeFile,
    content,
    expectedKinds: ['unit_test'],
    expectedActionOp: 'write_file',
    expectedTargetFileSuffix,
  };
}

const GENERIC_LANGUAGE_VALIDATION_SPECS = Object.freeze({
  go: {
    id: 'go',
    sourceExt: '.go',
    sourceRoot: 'src',
    registrySampleFile: path.join('src', 'sample.go'),
    workspace: {
      dirs: ['src', 'tests'],
      files: [
        projectFile('go.mod', 'module pingu_validation\n\ngo 1.22\n'),
      ],
    },
    matrixCases: [
      {
        id: 'go:comment_task:struct',
        relativeFile: path.join('src', 'pedido.go'),
        content: '//:: criar uma struct pedido\n',
        expectedKinds: ['comment_task'],
        expectedSnippetIncludes: ['type Pedido struct {'],
      },
      genericContextCase(
        { id: 'go', sourceExt: '.go', sourceRoot: 'src' },
        path.join('src', 'context.go'),
        '// ** bff para crud de usuario',
      ),
      genericUnitTestCase(
        { id: 'go' },
        path.join('src', 'billing.go'),
        [
          'package billing',
          '',
          'func Soma(a int, b int) int {',
          '  return a + b',
          '}',
        ].join('\n'),
        path.join('tests', 'src', 'billing_test.go'),
      ),
    ],
    checkupCases: [
      {
        id: 'go:checkup:undefined_variable',
        relativeFile: path.join('src', 'billing_param_typo.go'),
        content: [
          'package billing',
          '',
          'func Soma(valor int) int {',
          '  return valorr + 1',
          '}',
        ].join('\n'),
        expectedKinds: ['undefined_variable'],
        expectedSnippetIncludes: ['return valor + 1'],
        forbiddenSnippetIncludes: ['pingu - correction'],
        applyKinds: ['undefined_variable'],
        mustClearKinds: ['undefined_variable'],
        expectedSourceIncludesAfterApply: ['return valor + 1'],
      },
      {
        id: 'go:checkup:function_doc',
        relativeFile: path.join('src', 'billing_docs.go'),
        content: [
          'package billing',
          '',
          'func Soma(valor int) int {',
          '  return valor + 1',
          '}',
        ].join('\n'),
        expectedKinds: ['function_doc'],
        expectedSnippetIncludes: ['comportamento principal'],
        applyKinds: ['function_doc'],
        mustClearKinds: ['function_doc'],
        expectedSourceIncludesAfterApply: ['comportamento principal'],
      },
    ],
  },
  rust: {
    id: 'rust',
    sourceExt: '.rs',
    sourceRoot: 'src',
    registrySampleFile: path.join('src', 'sample.rs'),
    workspace: {
      dirs: ['src', 'tests'],
      files: [
        projectFile('Cargo.toml', '[package]\nname = "pingu_validation"\nversion = "0.1.0"\n'),
      ],
    },
    matrixCases: [
      {
        id: 'rust:comment_task:struct',
        relativeFile: path.join('src', 'pedido.rs'),
        content: '//:: criar uma struct pedido\n',
        expectedKinds: ['comment_task'],
        expectedSnippetIncludes: ['pub struct Pedido {'],
      },
      genericContextCase(
        { id: 'rust', sourceExt: '.rs', sourceRoot: 'src' },
        path.join('src', 'context.rs'),
        '// ** bff para crud de usuario',
      ),
      genericUnitTestCase(
        { id: 'rust' },
        path.join('src', 'billing.rs'),
        [
          'pub fn soma(a: i32, b: i32) -> i32 {',
          '    a + b',
          '}',
        ].join('\n'),
        path.join('tests', 'src', 'billing_test.rs'),
      ),
    ],
    checkupCases: [
      {
        id: 'rust:checkup:undefined_variable',
        relativeFile: path.join('src', 'billing_param_typo.rs'),
        content: [
          'pub fn soma(valor: i32) -> i32 {',
          '    valorr + 1',
          '}',
        ].join('\n'),
        expectedKinds: ['undefined_variable'],
        expectedSnippetIncludes: ['valor + 1'],
        forbiddenSnippetIncludes: ['pingu - correction'],
        applyKinds: ['undefined_variable'],
        mustClearKinds: ['undefined_variable'],
        expectedSourceIncludesAfterApply: ['valor + 1'],
      },
      {
        id: 'rust:checkup:function_doc',
        relativeFile: path.join('src', 'billing_docs.rs'),
        content: [
          'pub fn soma(valor: i32) -> i32 {',
          '    valor + 1',
          '}',
        ].join('\n'),
        expectedKinds: ['function_doc'],
        expectedSnippetIncludes: ['comportamento principal'],
        applyKinds: ['function_doc'],
        mustClearKinds: ['function_doc'],
        expectedSourceIncludesAfterApply: ['comportamento principal'],
      },
    ],
  },
  ruby: {
    id: 'ruby',
    sourceExt: '.rb',
    sourceRoot: 'lib',
    registrySampleFile: path.join('lib', 'sample.rb'),
    workspace: {
      dirs: ['lib', 'test'],
      files: [
        projectFile('Gemfile', 'source "https://rubygems.org"\n'),
      ],
    },
    matrixCases: [
      {
        id: 'ruby:comment_task:class',
        relativeFile: path.join('lib', 'pedido.rb'),
        content: '#:: criar uma class pedido\n',
        expectedKinds: ['comment_task'],
        expectedSnippetIncludes: ['class Pedido'],
      },
      genericContextCase(
        { id: 'ruby', sourceExt: '.rb', sourceRoot: 'lib' },
        path.join('lib', 'context.rb'),
        '# ** bff para crud de usuario',
      ),
      genericUnitTestCase(
        { id: 'ruby' },
        path.join('lib', 'billing.rb'),
        [
          'def soma(a, b)',
          '  a + b',
          'end',
        ].join('\n'),
        path.join('test', 'lib', 'billing_test.rb'),
      ),
    ],
    checkupCases: [
      {
        id: 'ruby:checkup:function_doc',
        relativeFile: path.join('lib', 'billing_docs.rb'),
        content: [
          'def soma(valor)',
          '  valor + 1',
          'end',
        ].join('\n'),
        expectedKinds: ['function_doc'],
        expectedSnippetIncludes: ['comportamento principal'],
        applyKinds: ['function_doc'],
        mustClearKinds: ['function_doc'],
        expectedSourceIncludesAfterApply: ['comportamento principal'],
      },
      {
        id: 'ruby:checkup:tabs',
        relativeFile: path.join('lib', 'billing_tabs.rb'),
        content: [
          'def soma(valor)',
          '\tvalor + 1',
          'end',
        ].join('\n'),
        expectedKinds: ['tabs'],
        applyKinds: ['tabs'],
        mustClearKinds: ['tabs'],
        expectedSourceIncludesAfterApply: ['  valor + 1'],
        forbiddenSourceIncludesAfterApply: ['\t'],
      },
    ],
  },
  lua: {
    id: 'lua',
    sourceExt: '.lua',
    sourceRoot: 'src',
    registrySampleFile: path.join('src', 'sample.lua'),
    workspace: {
      dirs: ['src', 'tests'],
      files: [],
    },
    matrixCases: [
      {
        id: 'lua:comment_task:function',
        relativeFile: path.join('src', 'soma.lua'),
        content: '--:: criar uma funcao soma\n',
        expectedKinds: ['comment_task'],
        expectedSnippetIncludes: ['local function soma('],
      },
      genericContextCase(
        { id: 'lua', sourceExt: '.lua', sourceRoot: 'src' },
        path.join('src', 'context.lua'),
        '-- ** bff para crud de usuario',
      ),
      genericUnitTestCase(
        { id: 'lua' },
        path.join('src', 'billing.lua'),
        [
          'local function soma(a, b)',
          '  return a + b',
          'end',
          '',
          'return { soma = soma }',
        ].join('\n'),
        path.join('tests', 'src', 'billing_spec.lua'),
      ),
    ],
    checkupCases: [
      {
        id: 'lua:checkup:function_doc',
        relativeFile: path.join('src', 'billing_docs.lua'),
        content: [
          'local function soma(valor)',
          '  return valor + 1',
          'end',
        ].join('\n'),
        expectedKinds: ['function_doc'],
        expectedSnippetIncludes: ['comportamento principal'],
        applyKinds: ['function_doc'],
        mustClearKinds: ['function_doc'],
        expectedSourceIncludesAfterApply: ['comportamento principal'],
      },
      {
        id: 'lua:checkup:tabs',
        relativeFile: path.join('src', 'billing_tabs.lua'),
        content: [
          'local function soma(valor)',
          '\treturn valor + 1',
          'end',
        ].join('\n'),
        expectedKinds: ['tabs'],
        applyKinds: ['tabs'],
        mustClearKinds: ['tabs'],
        expectedSourceIncludesAfterApply: ['  return valor + 1'],
        forbiddenSourceIncludesAfterApply: ['\t'],
      },
    ],
  },
  vim: {
    id: 'vim',
    sourceExt: '.vim',
    sourceRoot: 'autoload',
    registrySampleFile: path.join('autoload', 'sample.vim'),
    workspace: {
      dirs: ['autoload', 'tests'],
      files: [],
    },
    matrixCases: [
      {
        id: 'vim:comment_task:function',
        relativeFile: path.join('autoload', 'soma.vim'),
        content: '":: criar uma funcao soma\n',
        expectedKinds: ['comment_task'],
        expectedSnippetIncludes: ['function! Soma('],
      },
      genericContextCase(
        { id: 'vim', sourceExt: '.vim', sourceRoot: 'autoload' },
        path.join('autoload', 'context.vim'),
        '" ** bff para crud de usuario',
      ),
      genericUnitTestCase(
        { id: 'vim' },
        path.join('autoload', 'billing.vim'),
        [
          'function! billing#soma(a, b)',
          '  return a:a + a:b',
          'endfunction',
        ].join('\n'),
        path.join('tests', 'autoload', 'billing_test.vim'),
      ),
    ],
    checkupCases: [
      {
        id: 'vim:checkup:function_doc',
        relativeFile: path.join('autoload', 'billing_docs.vim'),
        content: [
          'function! Soma(valor)',
          '  return a:valor + 1',
          'endfunction',
        ].join('\n'),
        expectedKinds: ['function_doc'],
        expectedSnippetIncludes: ['comportamento principal'],
        applyKinds: ['function_doc'],
        mustClearKinds: ['function_doc'],
        expectedSourceIncludesAfterApply: ['comportamento principal'],
      },
      {
        id: 'vim:checkup:tabs',
        relativeFile: path.join('autoload', 'billing_tabs.vim'),
        content: [
          'function! Soma(valor)',
          '\treturn a:valor + 1',
          'endfunction',
        ].join('\n'),
        expectedKinds: ['tabs'],
        applyKinds: ['tabs'],
        mustClearKinds: ['tabs'],
        expectedSourceIncludesAfterApply: ['  return a:valor + 1'],
        forbiddenSourceIncludesAfterApply: ['\t'],
      },
    ],
  },
  c: {
    id: 'c',
    sourceExt: '.c',
    sourceRoot: 'src',
    registrySampleFile: path.join('src', 'sample.c'),
    workspace: {
      dirs: ['src', 'tests'],
      files: [],
    },
    matrixCases: [
      {
        id: 'c:comment_task:struct',
        relativeFile: path.join('src', 'pedido.c'),
        content: '//:: criar uma struct pedido\n',
        expectedKinds: ['comment_task'],
        expectedSnippetIncludes: ['typedef struct Pedido {'],
      },
      genericContextCase(
        { id: 'c', sourceExt: '.c', sourceRoot: 'src' },
        path.join('src', 'context.c'),
        '// ** bff para crud de usuario',
      ),
      genericUnitTestCase(
        { id: 'c' },
        path.join('src', 'billing.c'),
        [
          'int soma(int a, int b) {',
          '  return a + b;',
          '}',
        ].join('\n'),
        path.join('tests', 'src', 'billing_test.c'),
      ),
    ],
    checkupCases: [
      {
        id: 'c:checkup:undefined_variable',
        relativeFile: path.join('src', 'billing_param_typo.c'),
        content: [
          'int soma(int valor) {',
          '  return valorr + 1;',
          '}',
        ].join('\n'),
        expectedKinds: ['undefined_variable'],
        expectedSnippetIncludes: ['return valor + 1;'],
        forbiddenSnippetIncludes: ['pingu - correction'],
        applyKinds: ['undefined_variable'],
        mustClearKinds: ['undefined_variable'],
        expectedSourceIncludesAfterApply: ['return valor + 1;'],
      },
      {
        id: 'c:checkup:tabs',
        relativeFile: path.join('src', 'billing_tabs.c'),
        content: [
          'int soma(int valor) {',
          '\treturn valor + 1;',
          '}',
        ].join('\n'),
        expectedKinds: ['tabs'],
        applyKinds: ['tabs'],
        mustClearKinds: ['tabs'],
        expectedSourceIncludesAfterApply: ['  return valor + 1;'],
        forbiddenSourceIncludesAfterApply: ['\t'],
      },
    ],
  },
  terraform: {
    id: 'terraform',
    sourceExt: '.tf',
    sourceRoot: 'infra',
    registrySampleFile: path.join('infra', 'sample.tf'),
    workspace: {
      dirs: ['infra', 'tests'],
      files: [],
    },
    matrixCases: [
      {
        id: 'terraform:comment_task:required_version',
        relativeFile: path.join('infra', 'main.tf'),
        content: '#:: criar terraform required version\n',
        expectedKinds: ['comment_task'],
        expectedSnippetIncludes: ['required_version = ">= 1.5.0"'],
      },
      genericContextCase(
        { id: 'terraform', sourceExt: '.tf', sourceRoot: 'infra' },
        path.join('infra', 'context.tf'),
        '# ** bff para crud de usuario',
      ),
      genericUnitTestCase(
        { id: 'terraform' },
        path.join('infra', 'main.tf'),
        'resource "aws_s3_bucket" "example" {}\n',
        path.join('tests', 'infra', 'main_test.sh'),
      ),
    ],
    checkupCases: [
      {
        id: 'terraform:checkup:required_version',
        relativeFile: path.join('infra', 'main.tf'),
        content: 'resource "aws_s3_bucket" "example" {}\n',
        expectedKinds: ['terraform_required_version'],
        expectedSnippetIncludes: ['required_version = ">= 1.5.0"'],
        applyKinds: ['terraform_required_version'],
        mustClearKinds: ['terraform_required_version'],
        expectedSourceIncludesAfterApply: ['required_version = ">= 1.5.0"'],
      },
      {
        id: 'terraform:checkup:tabs',
        relativeFile: path.join('infra', 'main_tabs.tf'),
        content: [
          'terraform {',
          '  required_version = ">= 1.5.0"',
          '}',
          '',
          'resource "aws_s3_bucket" "example" {',
          '\tbucket = "demo"',
          '}',
        ].join('\n'),
        expectedKinds: ['tabs'],
        applyKinds: ['tabs'],
        mustClearKinds: ['tabs'],
        expectedSourceIncludesAfterApply: ['  bucket = "demo"'],
        forbiddenSourceIncludesAfterApply: ['\t'],
      },
    ],
  },
  yaml: {
    id: 'yaml',
    sourceExt: '.yaml',
    sourceRoot: 'config',
    registrySampleFile: path.join('config', 'sample.yaml'),
    workspace: {
      dirs: ['config', 'tests'],
      files: [],
    },
    matrixCases: [
      {
        id: 'yaml:comment_task:services',
        relativeFile: path.join('config', 'compose.yaml'),
        content: '#:: criar lista de servicos api worker\n',
        expectedKinds: ['comment_task'],
        expectedSnippetIncludes: ['servicos:'],
      },
      genericContextCase(
        { id: 'yaml', sourceExt: '.yaml', sourceRoot: 'config' },
        path.join('config', 'context.yaml'),
        '# ** bff para crud de usuario',
      ),
      genericUnitTestCase(
        { id: 'yaml' },
        path.join('config', 'compose.yaml'),
        [
          'servicos:',
          '  - api',
        ].join('\n'),
        path.join('tests', 'config', 'compose_test.sh'),
      ),
    ],
    checkupCases: [
      {
        id: 'yaml:checkup:missing_quote',
        relativeFile: path.join('config', 'app.yaml'),
        content: 'name: "api\n',
        expectedKinds: ['syntax_missing_quote'],
        expectedSnippetIncludes: ['name: "api"'],
        applyKinds: ['syntax_missing_quote'],
        mustClearKinds: ['syntax_missing_quote'],
        expectedSourceIncludesAfterApply: ['name: "api"'],
      },
      {
        id: 'yaml:checkup:tabs',
        relativeFile: path.join('config', 'app_tabs.yaml'),
        content: [
          'services:',
          '\tapi: enabled',
        ].join('\n'),
        expectedKinds: ['tabs'],
        applyKinds: ['tabs'],
        mustClearKinds: ['tabs'],
        expectedSourceIncludesAfterApply: ['  api: enabled'],
        forbiddenSourceIncludesAfterApply: ['\t'],
      },
    ],
  },
  markdown: {
    id: 'markdown',
    sourceExt: '.md',
    sourceRoot: 'docs',
    registrySampleFile: path.join('docs', 'sample.md'),
    workspace: {
      dirs: ['docs', 'tests'],
      files: [],
    },
    matrixCases: [
      {
        id: 'markdown:comment_task:document',
        relativeFile: path.join('docs', 'api.md'),
        content: '<!-- :: criar documentacao de contrato da api -->\n',
        expectedKinds: ['comment_task'],
      },
      genericContextCase(
        { id: 'markdown', sourceExt: '.md', sourceRoot: 'docs' },
        path.join('docs', 'context.md'),
        '<!-- ** bff para crud de usuario -->',
      ),
      genericUnitTestCase(
        { id: 'markdown' },
        path.join('docs', 'api.md'),
        [
          '# API',
          '',
          'Contrato inicial.',
        ].join('\n'),
        path.join('tests', 'docs', 'api_test.sh'),
      ),
    ],
    checkupCases: [
      {
        id: 'markdown:checkup:title',
        relativeFile: path.join('docs', 'api.md'),
        content: 'conteudo sem titulo\n',
        expectedKinds: ['markdown_title'],
        expectedSnippetIncludes: ['# Titulo do documento'],
        applyKinds: ['markdown_title'],
        mustClearKinds: ['markdown_title'],
        expectedSourceIncludesAfterApply: ['# Titulo do documento'],
      },
      {
        id: 'markdown:checkup:fence',
        relativeFile: path.join('docs', 'fenced-example.md'),
        content: [
          '# API',
          '',
          '```js',
          'console.log("ok")',
        ].join('\n'),
        expectedKinds: ['syntax_missing_delimiter'],
        expectedSnippetIncludes: ['```'],
        applyKinds: ['syntax_missing_delimiter'],
        mustClearKinds: ['syntax_missing_delimiter'],
        expectedSourceIncludesAfterApply: ['```'],
      },
    ],
  },
  mermaid: {
    id: 'mermaid',
    sourceExt: '.mmd',
    sourceRoot: 'diagrams',
    registrySampleFile: path.join('diagrams', 'sample.mmd'),
    workspace: {
      dirs: ['diagrams', 'tests'],
      files: [],
    },
    matrixCases: [
      {
        id: 'mermaid:comment_task:flow',
        relativeFile: path.join('diagrams', 'authentication.mmd'),
        content: '%%:: criar diagrama de fluxo autenticacao\n',
        expectedKinds: ['comment_task'],
      },
      genericContextCase(
        { id: 'mermaid', sourceExt: '.mmd', sourceRoot: 'diagrams' },
        path.join('diagrams', 'context.mmd'),
        '%% ** bff para crud de usuario',
      ),
      genericUnitTestCase(
        { id: 'mermaid' },
        path.join('diagrams', 'authentication.mmd'),
        [
          'flowchart LR',
          '  A[Inicio] --> B[Fim]',
        ].join('\n'),
        path.join('tests', 'diagrams', 'authentication_test.sh'),
      ),
    ],
    checkupCases: [
      {
        id: 'mermaid:checkup:missing_delimiter',
        relativeFile: path.join('diagrams', 'authentication.mmd'),
        content: [
          'flowchart LR',
          '  A[Inicio --> B[Fim]',
        ].join('\n'),
        expectedKinds: ['syntax_missing_delimiter'],
        expectedSnippetIncludes: ['  ]'],
        applyKinds: ['syntax_missing_delimiter'],
        mustClearKinds: ['syntax_missing_delimiter'],
        expectedSourceIncludesAfterApply: ['  ]'],
      },
      {
        id: 'mermaid:checkup:tabs',
        relativeFile: path.join('diagrams', 'authentication_tabs.mmd'),
        content: [
          'flowchart LR',
          '\tA[Inicio] --> B[Fim]',
        ].join('\n'),
        expectedKinds: ['tabs'],
        applyKinds: ['tabs'],
        mustClearKinds: ['tabs'],
        expectedSourceIncludesAfterApply: ['  A[Inicio] --> B[Fim]'],
        forbiddenSourceIncludesAfterApply: ['\t'],
      },
    ],
  },
  dockerfile: {
    id: 'dockerfile',
    sourceExt: '.dockerfile',
    sourceRoot: 'docker',
    registrySampleFile: path.join('docker', 'Dockerfile'),
    workspace: {
      dirs: ['docker', 'tests'],
      files: [],
    },
    matrixCases: [
      {
        id: 'dockerfile:comment_task:workdir',
        relativeFile: path.join('docker', 'Dockerfile'),
        content: '#:: criar workdir /app\n',
        expectedKinds: ['comment_task'],
        expectedSnippetIncludes: ['WORKDIR /app'],
      },
      genericContextCase(
        { id: 'dockerfile', sourceExt: '.dockerfile', sourceRoot: 'docker' },
        path.join('docker', 'context.Dockerfile'),
        '# ** bff para crud de usuario',
      ),
      genericUnitTestCase(
        { id: 'dockerfile' },
        path.join('docker', 'Dockerfile'),
        [
          'FROM node:20',
          'WORKDIR /app',
        ].join('\n'),
        path.join('tests', 'docker', 'Dockerfile_test.sh'),
      ),
    ],
    checkupCases: [
      {
        id: 'dockerfile:checkup:workdir',
        relativeFile: path.join('docker', 'Dockerfile'),
        content: [
          'FROM node:20',
          'COPY . .',
        ].join('\n'),
        expectedKinds: ['dockerfile_workdir'],
        expectedSnippetIncludes: ['WORKDIR /app'],
        applyKinds: ['dockerfile_workdir'],
        mustClearKinds: ['dockerfile_workdir'],
        expectedSourceIncludesAfterApply: ['WORKDIR /app'],
      },
      {
        id: 'dockerfile:checkup:tabs',
        relativeFile: path.join('docker', 'Dockerfile.tabs'),
        content: [
          'FROM node:20',
          'WORKDIR /app',
          '\tCOPY . .',
        ].join('\n'),
        expectedKinds: ['tabs'],
        applyKinds: ['tabs'],
        mustClearKinds: ['tabs'],
        expectedSourceIncludesAfterApply: ['  COPY . .'],
        forbiddenSourceIncludesAfterApply: ['\t'],
      },
    ],
  },
  shell: {
    id: 'shell',
    sourceExt: '.sh',
    sourceRoot: 'scripts',
    registrySampleFile: path.join('scripts', 'sample.sh'),
    workspace: {
      dirs: ['scripts', 'tests'],
      files: [],
    },
    matrixCases: [
      {
        id: 'shell:comment_task:function',
        relativeFile: path.join('scripts', 'soma.sh'),
        content: '#:: criar uma funcao soma\n',
        expectedKinds: ['comment_task'],
        expectedSnippetIncludes: ['soma() {'],
      },
      genericContextCase(
        { id: 'shell', sourceExt: '.sh', sourceRoot: 'scripts' },
        path.join('scripts', 'context.sh'),
        '# ** bff para crud de usuario',
      ),
      genericUnitTestCase(
        { id: 'shell' },
        path.join('scripts', 'soma.sh'),
        [
          'soma() {',
          '  echo "$(($1 + $2))"',
          '}',
        ].join('\n'),
        path.join('tests', 'scripts', 'soma_test.sh'),
      ),
    ],
    checkupCases: [
      {
        id: 'shell:checkup:tabs',
        relativeFile: path.join('scripts', 'run.sh'),
        content: '\techo ok\n',
        expectedKinds: ['tabs'],
        applyKinds: ['tabs'],
        mustClearKinds: ['tabs'],
        expectedSourceIncludesAfterApply: ['  echo ok'],
        forbiddenSourceIncludesAfterApply: ['\t'],
      },
      {
        id: 'shell:checkup:missing_quote',
        relativeFile: path.join('scripts', 'quote.sh'),
        content: 'echo "ok\n',
        expectedKinds: ['syntax_missing_quote'],
        expectedSnippetIncludes: ['echo "ok"'],
        applyKinds: ['syntax_missing_quote'],
        mustClearKinds: ['syntax_missing_quote'],
        expectedSourceIncludesAfterApply: ['echo "ok"'],
      },
    ],
  },
  toml: {
    id: 'toml',
    sourceExt: '.toml',
    sourceRoot: 'config',
    registrySampleFile: path.join('config', 'sample.toml'),
    workspace: {
      dirs: ['config', 'tests'],
      files: [],
    },
    matrixCases: [
      {
        id: 'toml:comment_task:section',
        relativeFile: path.join('config', 'app.toml'),
        content: '#:: criar section server host port\n',
        expectedKinds: ['comment_task'],
        expectedSnippetIncludes: ['[server]'],
      },
      genericContextCase(
        { id: 'toml', sourceExt: '.toml', sourceRoot: 'config' },
        path.join('config', 'context.toml'),
        '# ** bff para crud de usuario',
      ),
      genericUnitTestCase(
        { id: 'toml' },
        path.join('config', 'app.toml'),
        [
          '[server]',
          'host = "localhost"',
        ].join('\n'),
        path.join('tests', 'config', 'app_test.sh'),
      ),
    ],
    checkupCases: [
      {
        id: 'toml:checkup:missing_quote',
        relativeFile: path.join('config', 'app.toml'),
        content: 'host = "localhost\n',
        expectedKinds: ['syntax_missing_quote'],
        expectedSnippetIncludes: ['host = "localhost"'],
        applyKinds: ['syntax_missing_quote'],
        mustClearKinds: ['syntax_missing_quote'],
        expectedSourceIncludesAfterApply: ['host = "localhost"'],
      },
      {
        id: 'toml:checkup:missing_delimiter',
        relativeFile: path.join('config', 'server.toml'),
        content: [
          '[server',
          'host = "localhost"',
        ].join('\n'),
        expectedKinds: ['syntax_missing_delimiter'],
        expectedSnippetIncludes: [']'],
        applyKinds: ['syntax_missing_delimiter'],
        mustClearKinds: ['syntax_missing_delimiter'],
        expectedSourceIncludesAfterApply: [']'],
      },
    ],
  },
});

function genericValidationLanguageIds() {
  return Object.keys(GENERIC_LANGUAGE_VALIDATION_SPECS);
}

function genericValidationSpec(languageId) {
  return GENERIC_LANGUAGE_VALIDATION_SPECS[String(languageId || '').trim().toLowerCase()] || null;
}

module.exports = {
  GENERIC_LANGUAGE_VALIDATION_SPECS,
  genericValidationLanguageIds,
  genericValidationSpec,
};
