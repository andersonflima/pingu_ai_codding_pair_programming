#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeText } = require('../lib/analyzer');
const {
  activeLanguageIds,
  getCapabilityProfile,
  languageCapabilityRegistry,
  requiresAiForFeature,
} = require('../lib/language-capabilities');

const repoRoot = path.resolve(__dirname, '..');
const mockAiCommand = `${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(repoRoot, 'scripts', 'mock_comment_task_ai.js'))}`;
const temporaryProjects = [];
const fixtureCases = [];
const snippetExpectations = {};

function createTemporaryElixirProject(label, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pingu-${label}-`));
  temporaryProjects.push(root);
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'mix.exs'), [
    'defmodule Validation.MixProject do',
    '  use Mix.Project',
    '  def project, do: [app: :validation, version: "0.1.0"]',
    'end',
    '',
  ].join('\n'));

  if (options.activeContext) {
    const contextDir = path.join(root, '.realtime-dev-agent', 'contexts');
    fs.mkdirSync(contextDir, { recursive: true });
    fs.writeFileSync(path.join(contextDir, 'elixir-active.md'), options.activeContext);
  }

  return {
    root,
    sourcePath: path.join(root, options.relativeFile || path.join('lib', 'sample.ex')),
  };
}

function buildActiveContextDocument(entity, summary) {
  return [
    '<!-- realtime-dev-agent-context -->',
    'architecture: onion',
    'blueprint_type: bff_crud',
    `entity: ${entity}`,
    'language: elixir',
    'slug: elixir-active',
    'source_ext: .ex',
    'source_root: lib',
    `summary: ${summary}`,
    '',
    '# Contexto ativo',
    `- Contexto principal: ${entity}`,
  ].join('\n');
}

const crudProject = createTemporaryElixirProject('matrix-crud', {
  relativeFile: path.join('lib', 'crud_from_context.ex'),
  activeContext: buildActiveContextDocument('fatura', 'crud de faturamento'),
});

const contextMergeProject = createTemporaryElixirProject('matrix-context-merge', {
  relativeFile: path.join('lib', 'context_merge.ex'),
  activeContext: buildActiveContextDocument('usuario', 'contexto inicial de usuarios'),
});

const contextOverwriteProject = createTemporaryElixirProject('matrix-context-overwrite', {
  relativeFile: path.join('lib', 'context_overwrite.ex'),
  activeContext: buildActiveContextDocument('usuario', 'contexto inicial de usuarios'),
});

const unitTestProject = createTemporaryElixirProject('matrix-unit-test', {
  relativeFile: path.join('lib', 'billing.ex'),
});

const syntheticCases = [
  {
    id: 'elixir:comment_task:minimal-module',
    sourcePath: path.join(repoRoot, '__synthetic__', 'elixir', 'module_main.ex'),
    content: '#:: criar um module main elixir\n',
    expectedKinds: ['comment_task'],
    expectedSnippetIncludes: ['defmodule Main do', 'end'],
    forbiddenSnippetIncludes: ['@moduledoc', 'def listar('],
  },
  {
    id: 'elixir:comment_task:directed-graph',
    sourcePath: path.join(repoRoot, '__synthetic__', 'elixir', 'directed_graph.exs'),
    content: '#:: criar grafo direcionado com add_node add_edge bfs dfs\n',
    expectedKinds: ['comment_task'],
    expectedSnippetIncludes: ['defmodule GrafoDirecionado do', 'def add_node(%__MODULE__', 'def bfs(%__MODULE__'],
    forbiddenSnippetIncludes: ['implementar:', 'NotImplementedError'],
  },
  {
    id: 'elixir:comment_task:crud-from-context',
    sourcePath: crudProject.sourcePath,
    content: '#:: criar crud completo\n',
    expectedKinds: ['comment_task'],
    expectedSnippetIncludes: ['def listar_faturas(faturas), do: faturas', 'def criar_fatura(faturas, payload) do'],
  },
  {
    id: 'elixir:context_file:create',
    sourcePath: path.join(repoRoot, '__synthetic__', 'elixir', 'context_create.ex'),
    content: '# ** bff para crud de usuario\n',
    expectedKinds: ['context_file'],
    expectedSnippetIncludes: ['<!-- realtime-dev-agent-context -->', 'entity: usuario', 'slug: elixir-active'],
  },
  {
    id: 'elixir:context_file:merge',
    sourcePath: contextMergeProject.sourcePath,
    content: '# ** bff para crud de usuario\n',
    expectedKinds: ['context_file'],
    expectedSnippetIncludes: ['entity: usuario', 'Politica aplicada: merge'],
    expectedActionOp: 'write_file',
    expectedTargetFileSuffix: path.join('.realtime-dev-agent', 'contexts', 'elixir-active.md'),
  },
  {
    id: 'elixir:context_file:overwrite',
    sourcePath: contextOverwriteProject.sourcePath,
    content: '# ** bff para crud de fatura\n',
    expectedKinds: ['context_file'],
    expectedSnippetIncludes: ['entity: fatura', 'Politica aplicada: overwrite'],
    expectedActionOp: 'write_file',
    expectedTargetFileSuffix: path.join('.realtime-dev-agent', 'contexts', 'elixir-active.md'),
  },
  {
    id: 'elixir:auto:public-contracts',
    sourcePath: path.join(repoRoot, '__synthetic__', 'elixir', 'public_contracts.ex'),
    content: [
      'defmodule Billing do',
      '  def soma(numero) do',
      '    numero + 1',
      '  end',
      'end',
    ].join('\n'),
    expectedKinds: ['moduledoc', 'function_doc', 'function_spec'],
    expectedSnippetIncludes: ['@moduledoc', '@doc', '@spec soma(any()) :: any()'],
  },
  {
    id: 'elixir:auto:undefined-variable',
    sourcePath: path.join(repoRoot, '__synthetic__', 'elixir', 'undefined_variable.ex'),
    content: [
      'defmodule Billing do',
      '  def soma(numero) do',
      '    numeroo + 1',
      '  end',
      'end',
    ].join('\n'),
    expectedKinds: ['undefined_variable'],
    expectedSnippetIncludes: ['pingu - correction : corrigido nome da variavel numeroo para numero', 'numero + 1'],
    expectedActionOp: 'write_file',
  },
  {
    id: 'elixir:auto:debug-output',
    sourcePath: path.join(repoRoot, '__synthetic__', 'elixir', 'debug_output.ex'),
    content: [
      'defmodule Billing do',
      '  def soma(numero) do',
      '    IO.inspect(numero)',
      '  end',
      'end',
    ].join('\n'),
    expectedKinds: ['debug_output'],
    forbiddenSnippetIncludes: ['IO.inspect', 'IO.puts'],
    expectedActionOp: 'write_file',
  },
  {
    id: 'elixir:auto:functional-reassignment',
    sourcePath: path.join(repoRoot, '__synthetic__', 'elixir', 'functional_reassignment.ex'),
    content: [
      'defmodule Billing do',
      '  def soma(valor) do',
      '    valor = valor + 1',
      '  end',
      'end',
    ].join('\n'),
    expectedKinds: ['functional_reassignment'],
    expectedSnippetIncludes: ['pingu - correction : corrigida reatribuicao de valor para novo_valor', 'novo_valor = valor + 1'],
    expectedActionOp: 'write_file',
  },
  {
    id: 'elixir:auto:nested-condition',
    sourcePath: path.join(repoRoot, '__synthetic__', 'elixir', 'nested_condition.ex'),
    content: [
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
    expectedKinds: ['nested_condition'],
    expectedSnippetIncludes: ['cond do', 'true -> :adulto'],
    expectedActionOp: 'write_file',
  },
  {
    id: 'elixir:auto:todo-fixme',
    sourcePath: path.join(repoRoot, '__synthetic__', 'elixir', 'todo_fixme.ex'),
    content: [
      'defmodule Billing do',
      '  def processa(payload) do',
      '    # TODO: remover ajuste temporario',
      '    payload',
      '  end',
      'end',
    ].join('\n'),
    expectedKinds: ['todo_fixme'],
    forbiddenSnippetIncludes: ['TODO', 'FIXME'],
    expectedActionOp: 'write_file',
  },
  {
    id: 'elixir:auto:unit-test',
    sourcePath: unitTestProject.sourcePath,
    content: [
      'defmodule Billing do',
      '  def soma(numero), do: numero + 1',
      '',
      '  def listar(itens), do: itens',
      'end',
    ].join('\n'),
    expectedKinds: ['unit_test'],
    expectedSnippetIncludes: ['ExUnit.start()', 'describe "soma/1"', 'assert Billing.soma(1) == 2', 'describe "listar/1"'],
    expectedActionOp: 'write_file',
    expectedTargetFileSuffix: path.join('tests', 'lib', 'billing_test.exs'),
  },
];

function withTemporaryEnvironment(overrides, callback) {
  const previousValues = new Map(Object.keys(overrides).map((key) => [key, process.env[key]]));
  Object.entries(overrides).forEach(([key, value]) => {
    process.env[key] = value;
  });
  try {
    return callback();
  } finally {
    previousValues.forEach((value, key) => {
      if (typeof value === 'undefined') {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  }
}

function analyzeFixture(fixture) {
  return withTemporaryEnvironment({
    PINGU_COMMENT_TASK_AI_CMD: mockAiCommand,
    PINGU_COMMENT_TASK_AI_TIMEOUT_MS: '4000',
  }, () => analyzeText(fixture.sourcePath, fixture.content, { maxLineLength: 120 }));
}

function validateFixtureMatrix() {
  const failures = [];

  syntheticCases.forEach((fixture) => {
    const issues = analyzeFixture(fixture);
    const kinds = new Set(issues.map((issue) => issue.kind));
    const missingKinds = fixture.expectedKinds.filter((kind) => !kinds.has(kind));
    const snippets = issues.map((issue) => String(issue.snippet || '')).join('\n---\n');
    const missingSnippets = (fixture.expectedSnippetIncludes || []).filter((fragment) => !snippets.includes(fragment));
    const forbiddenSnippets = (fixture.forbiddenSnippetIncludes || []).filter((fragment) => snippets.includes(fragment));

    const firstExpectedIssue = issues.find((issue) => {
      if (!fixture.expectedKinds.includes(issue.kind)) {
        return false;
      }
      if (!fixture.expectedTargetFileSuffix) {
        return true;
      }
      const targetFile = issue.action ? String(issue.action.target_file || '') : '';
      return targetFile.endsWith(fixture.expectedTargetFileSuffix);
    }) || issues.find((issue) => fixture.expectedKinds.includes(issue.kind));
    const actionOp = firstExpectedIssue && firstExpectedIssue.action ? firstExpectedIssue.action.op : '';
    const targetFile = firstExpectedIssue && firstExpectedIssue.action ? String(firstExpectedIssue.action.target_file || '') : '';

    const actionFailure = fixture.expectedActionOp && actionOp !== fixture.expectedActionOp
      ? `action.op esperado=${fixture.expectedActionOp} atual=${actionOp || 'undefined'}`
      : '';
    const targetFailure = fixture.expectedTargetFileSuffix && !targetFile.endsWith(fixture.expectedTargetFileSuffix)
      ? `target_file esperado com sufixo=${fixture.expectedTargetFileSuffix} atual=${targetFile || 'undefined'}`
      : '';

    if (missingKinds.length === 0 && missingSnippets.length === 0 && forbiddenSnippets.length === 0 && !actionFailure && !targetFailure) {
      return;
    }

    failures.push({
      id: fixture.id,
      missingKinds,
      missingSnippets,
      forbiddenSnippets,
      actionFailure,
      targetFailure,
      actualKinds: Array.from(kinds).sort(),
    });
  });

  return {
    ok: failures.length === 0,
    total: syntheticCases.length,
    failures,
  };
}

function validateCapabilityRegistry() {
  const registry = languageCapabilityRegistry();
  const failures = [];

  const activeIds = activeLanguageIds().sort();
  if (activeIds.join(',') !== 'elixir') {
    failures.push(`activeLanguageIds esperado=elixir atual=${activeIds.join(',') || 'vazio'}`);
  }

  const ids = registry.map((entry) => entry.id).sort();
  if (ids.join(',') !== 'default,elixir') {
    failures.push(`registry ids esperados=default,elixir atuais=${ids.join(',')}`);
  }

  const elixirProfile = getCapabilityProfile(path.join(repoRoot, 'lib', 'sample.ex'));
  ['comment_task', 'context_file', 'unit_test', 'terminal_task'].forEach((feature) => {
    if (!elixirProfile.editorFeatures.includes(feature)) {
      failures.push(`feature ${feature} ausente no profile elixir`);
    }
  });

  ['comment_task', 'context_file', 'unit_test'].forEach((feature) => {
    if (!requiresAiForFeature(path.join(repoRoot, 'lib', 'sample.ex'), feature)) {
      failures.push(`requiresAiForFeature deveria ser true para ${feature} em elixir`);
    }
  });

  return {
    ok: failures.length === 0,
    total: registry.length,
    failures,
  };
}

function cleanupTemporaryProjects() {
  temporaryProjects.forEach((projectRoot) => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });
}

function main() {
  const matrix = validateFixtureMatrix();
  const registry = validateCapabilityRegistry();

  cleanupTemporaryProjects();

  if (matrix.ok && registry.ok) {
    console.log(JSON.stringify({
      ok: true,
      matrixTotal: matrix.total,
      registryTotal: registry.total,
      activeLanguageIds: activeLanguageIds(),
    }));
    return;
  }

  console.error(JSON.stringify({
    ok: false,
    matrix,
    registry,
  }, null, 2));
  process.exitCode = 1;
}

if (require.main === module) {
  main();
}

module.exports = {
  fixtureCases,
  repoRoot,
  snippetExpectations,
  validateCapabilityRegistry,
  validateFixtureMatrix,
};
