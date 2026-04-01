#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeText } = require('../lib/analyzer');

const repoRoot = path.resolve(__dirname, '..');
const mockAiCommand = `${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(repoRoot, 'scripts', 'mock_comment_task_ai.js'))}`;
const workspaceRoot = path.join(os.homedir(), 'snippets', 'pingu', 'elixir');
const contextsDir = path.join(workspaceRoot, '.realtime-dev-agent', 'contexts');

const cases = [
  {
    id: 'comment_task:module_main',
    file: 'criar_module_main.exs',
    content: '#:: criar um module main elixir\n',
    expectedKinds: ['comment_task'],
    expectedSnippetIncludes: ['defmodule Main do', 'end'],
    forbiddenSnippetIncludes: ['@moduledoc', '@spec', 'def listar('],
  },
  {
    id: 'comment_task:graph',
    file: 'criar_grafo_direcionado.exs',
    content: '#:: criar grafo direcionado com add_node add_edge bfs dfs\n',
    expectedKinds: ['comment_task'],
    expectedSnippetIncludes: ['defmodule GrafoDirecionado do', 'def add_node(%__MODULE__', 'def bfs(%__MODULE__'],
    forbiddenSnippetIncludes: ['implementar:', 'NotImplementedError'],
  },
  {
    id: 'context_file:merge',
    file: 'contexto_merge.ex',
    preContext: {
      entity: 'usuario',
      summary: 'contexto inicial de usuarios',
    },
    content: '# ** bff para crud de usuario\n',
    expectedKinds: ['context_file'],
    expectedSnippetIncludes: ['entity: usuario', 'Politica aplicada: merge'],
    expectedActionOp: 'write_file',
    expectedTargetFileSuffix: path.join('.realtime-dev-agent', 'contexts', 'elixir-active.md'),
  },
  {
    id: 'context_file:overwrite',
    file: 'contexto_overwrite.ex',
    preContext: {
      entity: 'usuario',
      summary: 'contexto inicial de usuarios',
    },
    content: '# ** bff para crud de fatura\n',
    expectedKinds: ['context_file'],
    expectedSnippetIncludes: ['entity: fatura', 'Politica aplicada: overwrite'],
    expectedActionOp: 'write_file',
    expectedTargetFileSuffix: path.join('.realtime-dev-agent', 'contexts', 'elixir-active.md'),
  },
  {
    id: 'auto:public_contracts',
    file: 'contratos_publicos.ex',
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
    id: 'auto:undefined_variable',
    file: 'corrigir_variavel_indefinida.ex',
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
    id: 'auto:functional_reassignment',
    file: 'corrigir_reatribuicao_funcional.ex',
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
    id: 'auto:debug_output',
    file: 'corrigir_debug_output.ex',
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
    id: 'auto:nested_condition',
    file: 'corrigir_nested_condition.ex',
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
    id: 'auto:todo_fixme',
    file: 'corrigir_todo_fixme.ex',
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
    id: 'auto:unit_test',
    file: 'cobertura_unit_test.ex',
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
    expectedTargetFileSuffix: path.join('tests', 'cobertura_unit_test_test.exs'),
  },
];

function normalizePathForDisplay(absolutePath) {
  return absolutePath.replace(os.homedir(), '~');
}

function ensureWorkspace() {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, 'mix.exs'), [
    'defmodule PinguWorkspace.MixProject do',
    '  use Mix.Project',
    '  def project, do: [app: :pingu_workspace, version: "0.1.0"]',
    'end',
    '',
  ].join('\n'));
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

function resetContextFile() {
  fs.mkdirSync(contextsDir, { recursive: true });
  const contextFile = path.join(contextsDir, 'elixir-active.md');
  fs.rmSync(contextFile, { force: true });
}

function applyPreContext(preContext) {
  fs.mkdirSync(contextsDir, { recursive: true });
  fs.writeFileSync(
    path.join(contextsDir, 'elixir-active.md'),
    buildActiveContextDocument(preContext.entity, preContext.summary),
    'utf8',
  );
}

function withAiEnvironment(callback) {
  const previousCommand = process.env.PINGU_COMMENT_TASK_AI_CMD;
  const previousTimeout = process.env.PINGU_COMMENT_TASK_AI_TIMEOUT_MS;
  process.env.PINGU_COMMENT_TASK_AI_CMD = mockAiCommand;
  process.env.PINGU_COMMENT_TASK_AI_TIMEOUT_MS = '4000';
  try {
    return callback();
  } finally {
    if (typeof previousCommand === 'undefined') {
      delete process.env.PINGU_COMMENT_TASK_AI_CMD;
    } else {
      process.env.PINGU_COMMENT_TASK_AI_CMD = previousCommand;
    }
    if (typeof previousTimeout === 'undefined') {
      delete process.env.PINGU_COMMENT_TASK_AI_TIMEOUT_MS;
    } else {
      process.env.PINGU_COMMENT_TASK_AI_TIMEOUT_MS = previousTimeout;
    }
  }
}

function findPrimaryIssue(issues, testCase) {
  const expectedKindsSet = new Set(testCase.expectedKinds || []);
  const direct = issues.find((issue) => {
    if (!expectedKindsSet.has(issue.kind)) {
      return false;
    }
    if (!testCase.expectedTargetFileSuffix) {
      return true;
    }
    const targetFile = issue.action ? String(issue.action.target_file || '') : '';
    return targetFile.endsWith(testCase.expectedTargetFileSuffix);
  });
  if (direct) {
    return direct;
  }
  return issues.find((issue) => expectedKindsSet.has(issue.kind)) || null;
}

function validateCase(testCase) {
  if (testCase.preContext) {
    applyPreContext(testCase.preContext);
  } else {
    resetContextFile();
  }

  const filePath = path.join(workspaceRoot, testCase.file);
  fs.writeFileSync(filePath, `${testCase.content}\n`, 'utf8');

  const issues = withAiEnvironment(() => analyzeText(filePath, `${testCase.content}\n`, { maxLineLength: 120 }));
  const issueKinds = new Set(issues.map((issue) => issue.kind));
  const missingKinds = (testCase.expectedKinds || []).filter((kind) => !issueKinds.has(kind));
  const snippetPayload = issues.map((issue) => String(issue.snippet || '')).join('\n---\n');
  const missingSnippets = (testCase.expectedSnippetIncludes || []).filter((fragment) => !snippetPayload.includes(fragment));
  const forbiddenSnippets = (testCase.forbiddenSnippetIncludes || []).filter((fragment) => snippetPayload.includes(fragment));
  const primaryIssue = findPrimaryIssue(issues, testCase);
  const actionOp = primaryIssue && primaryIssue.action ? primaryIssue.action.op : '';
  const targetFile = primaryIssue && primaryIssue.action ? String(primaryIssue.action.target_file || '') : '';
  const actionFailure = testCase.expectedActionOp && actionOp !== testCase.expectedActionOp
    ? `action.op esperado=${testCase.expectedActionOp} atual=${actionOp || 'undefined'}`
    : '';
  const targetFailure = testCase.expectedTargetFileSuffix && !targetFile.endsWith(testCase.expectedTargetFileSuffix)
    ? `target_file esperado com sufixo=${testCase.expectedTargetFileSuffix} atual=${targetFile || 'undefined'}`
    : '';

  return {
    id: testCase.id,
    filePath,
    ok: missingKinds.length === 0 && missingSnippets.length === 0 && forbiddenSnippets.length === 0 && !actionFailure && !targetFailure,
    missingKinds,
    missingSnippets,
    forbiddenSnippets,
    actionFailure,
    targetFailure,
    actualKinds: Array.from(issueKinds).sort(),
  };
}

function main() {
  ensureWorkspace();
  const results = cases.map(validateCase);
  const failures = results.filter((result) => !result.ok);

  const report = {
    ok: failures.length === 0,
    workspace: normalizePathForDisplay(workspaceRoot),
    totalCases: results.length,
    passedCases: results.length - failures.length,
    failedCases: failures.length,
    failures: failures.map((failure) => ({
      id: failure.id,
      file: normalizePathForDisplay(failure.filePath),
      missingKinds: failure.missingKinds,
      missingSnippets: failure.missingSnippets,
      forbiddenSnippets: failure.forbiddenSnippets,
      actionFailure: failure.actionFailure,
      targetFailure: failure.targetFailure,
      actualKinds: failure.actualKinds,
    })),
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}

main();
