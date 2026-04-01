#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeText } = require('../lib/analyzer');

const repoRoot = path.resolve(__dirname, '..');
const mockAiCommand = `${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(repoRoot, 'scripts', 'mock_comment_task_ai.js'))}`;

const temporaryProjects = [];
const intentContractCases = [
  {
    id: 'precision:elixir:minimal-module',
    sourcePath: path.join(repoRoot, '__intent_contract__', 'elixir', 'module_main.ex'),
    content: '#:: criar um module main elixir\n',
    expectedKind: 'structure',
    expectedToken: 'module',
    expectedSupported: true,
    requiredSnippetIncludes: ['defmodule Main do', 'end'],
    forbiddenSnippetIncludes: ['@moduledoc', '@spec', 'def listar('],
  },
  {
    id: 'precision:elixir:refactor-nested-condition',
    sourcePath: path.join(repoRoot, '__intent_contract__', 'elixir', 'nested_refactor.exs'),
    content: [
      '# corrigir nested condition',
      '#: refatorar nested condition mantendo regra de negocio',
      'defmodule CorrecaoNestedCondition do',
      '  defp classificar_idade(idade) do',
      '    if idade >= 0 do',
      '      if idade < 13 do',
      '        :crianca',
      '      else',
      '        if idade < 18 do',
      '          :adolescente',
      '        else',
      '          :adulto',
      '        end',
      '      end',
      '    else',
      '      :invalida',
      '    end',
      '  end',
      'end',
      '',
    ].join('\n'),
    expectedKind: 'generic',
    expectedToken: 'function',
    expectedSupported: true,
    expectedActionOp: 'write_file',
    requiredSnippetIncludes: ['cond do', 'idade < 0 -> :invalida', 'true -> :adulto'],
    forbiddenSnippetIncludes: ['# TODO:', '#: refatorar nested condition mantendo regra de negocio'],
  },
  {
    id: 'precision:elixir:crud-from-active-context',
    sourcePath: createTemporaryElixirProject('intent-contract-crud', {
      relativeFile: path.join('lib', 'crud_from_context.ex'),
      activeContext: buildActiveContextDocument('fatura', 'crud de faturamento'),
    }),
    content: '#:: criar crud completo\n',
    expectedKind: 'crud',
    expectedToken: 'crud',
    expectedSupported: true,
    requiredSnippetIncludes: ['def listar_faturas(faturas), do: faturas', 'def criar_fatura(faturas, payload) do'],
    forbiddenSnippetIncludes: ['implementar:', 'NotImplementedError'],
  },
];

function createTemporaryElixirProject(label, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pingu-${label}-`));
  temporaryProjects.push(root);
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
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

  return path.join(root, options.relativeFile || path.join('lib', 'sample.ex'));
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

function withTemporaryEnvironment(overrides, callback) {
  const entries = Object.entries(overrides || {});
  const previousValues = new Map(entries.map(([key]) => [key, process.env[key]]));
  entries.forEach(([key, value]) => {
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

function validateCase(contractCase) {
  const issues = withTemporaryEnvironment({
    PINGU_COMMENT_TASK_AI_CMD: mockAiCommand,
    PINGU_COMMENT_TASK_AI_TIMEOUT_MS: '4000',
  }, () => analyzeText(contractCase.sourcePath, contractCase.content, { maxLineLength: 120 }));

  const commentTaskIssue = issues.find((issue) => issue.kind === 'comment_task');
  if (!commentTaskIssue) {
    return {
      ok: false,
      id: contractCase.id,
      reason: 'comment_task ausente',
      details: { issueKinds: issues.map((issue) => issue.kind) },
    };
  }

  const failures = [];
  const intent = commentTaskIssue.intent || null;
  const intentIR = commentTaskIssue.intentIR || null;
  const snippet = String(commentTaskIssue.snippet || '');

  if (!intent) {
    failures.push('intent ausente');
  } else {
    if (intent.kind !== contractCase.expectedKind) {
      failures.push(`intent.kind esperado=${contractCase.expectedKind} atual=${intent.kind}`);
    }
    if (intent.token !== contractCase.expectedToken) {
      failures.push(`intent.token esperado=${contractCase.expectedToken} atual=${intent.token}`);
    }
    if (intent.supported !== contractCase.expectedSupported) {
      failures.push(`intent.supported esperado=${contractCase.expectedSupported} atual=${intent.supported}`);
    }
  }

  if (!intentIR) {
    failures.push('intentIR ausente');
  } else {
    if (intentIR.mode !== 'comment_task') {
      failures.push(`intentIR.mode esperado=comment_task atual=${intentIR.mode}`);
    }
    if (!intentIR.constraints || intentIR.constraints.preferFunctional !== true) {
      failures.push('intentIR.constraints.preferFunctional deveria ser true');
    }
    if (!intentIR.constraints || intentIR.constraints.useActiveContext !== true) {
      failures.push('intentIR.constraints.useActiveContext deveria ser true');
    }
  }

  if (contractCase.expectedActionOp) {
    const actionOp = commentTaskIssue.action && commentTaskIssue.action.op
      ? commentTaskIssue.action.op
      : '';
    if (actionOp !== contractCase.expectedActionOp) {
      failures.push(`action.op esperado=${contractCase.expectedActionOp} atual=${actionOp || 'undefined'}`);
    }
  }

  (contractCase.requiredSnippetIncludes || []).forEach((fragment) => {
    if (!snippet.includes(fragment)) {
      failures.push(`snippet sem trecho esperado: ${fragment}`);
    }
  });

  (contractCase.forbiddenSnippetIncludes || []).forEach((fragment) => {
    if (snippet.includes(fragment)) {
      failures.push(`snippet contem trecho proibido: ${fragment}`);
    }
  });

  return {
    ok: failures.length === 0,
    id: contractCase.id,
    reason: failures.join('; '),
  };
}

function cleanupTemporaryProjects() {
  temporaryProjects.forEach((projectRoot) => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });
}

function main() {
  const results = intentContractCases.map(validateCase);
  const failures = results.filter((result) => !result.ok);

  cleanupTemporaryProjects();

  if (failures.length === 0) {
    console.log(`intent contract ok: ${results.length} casos validados`);
    return;
  }

  console.error(`intent contract falhou: ${failures.length} de ${results.length} casos`);
  failures.forEach((failure) => {
    console.error(`- ${failure.id}: ${failure.reason}`);
  });
  process.exitCode = 1;
}

main();
