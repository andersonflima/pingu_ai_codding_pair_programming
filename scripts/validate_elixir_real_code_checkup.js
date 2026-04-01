#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeText } = require('../lib/analyzer');

const repoRoot = path.resolve(__dirname, '..');
const mockAiCommand = `${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(repoRoot, 'scripts', 'mock_comment_task_ai.js'))}`;

const cases = [
  {
    id: 'existing:public_contracts',
    relativeFile: path.join('lib', 'billing_contracts.ex'),
    content: [
      'defmodule BillingContracts do',
      '  def soma(numero) do',
      '    numero + 1',
      '  end',
      'end',
    ].join('\n'),
    expectedKinds: ['moduledoc', 'function_doc', 'function_spec'],
    expectedSnippetIncludes: ['@moduledoc', '@doc', '@spec soma(any()) :: any()'],
    applyKinds: ['moduledoc', 'function_spec', 'function_doc'],
    mustClearKinds: ['moduledoc', 'function_doc', 'function_spec'],
    expectedSourceIncludesAfterApply: ['@moduledoc', '@doc', '@spec soma(any()) :: any()'],
  },
  {
    id: 'existing:undefined_variable:param_typo',
    relativeFile: path.join('lib', 'billing_param_typo.ex'),
    content: [
      'defmodule BillingParamTypo do',
      '  def soma(a, b) do',
      '    aa + b',
      '  end',
      'end',
    ].join('\n'),
    expectedKinds: ['undefined_variable'],
    expectedSnippetIncludes: ['pingu - correction : corrigido nome da variavel aa para a', 'a + b'],
    applyKinds: ['undefined_variable'],
    mustClearKinds: ['undefined_variable'],
    expectedSourceIncludesAfterApply: ['a + b'],
  },
  {
    id: 'existing:undefined_variable:map_reference',
    relativeFile: path.join('lib', 'billing_map_reference.ex'),
    content: [
      'defmodule BillingMapReference do',
      '  def formatar_usuario(usuario_mapa) do',
      '    nome = Map.get(usuario_map, :nome)',
      '    "#{nome} <#{usuario_mapa[:email]}>"',
      '  end',
      'end',
    ].join('\n'),
    expectedKinds: ['undefined_variable'],
    expectedSnippetIncludes: ['pingu - correction : corrigido nome da variavel usuario_map para usuario_mapa'],
    applyKinds: ['undefined_variable'],
    mustClearKinds: ['undefined_variable'],
    expectedSourceIncludesAfterApply: ['Map.get(usuario_mapa, :nome)'],
  },
  {
    id: 'existing:undefined_variable:enum_scope',
    relativeFile: path.join('lib', 'billing_enum_scope.ex'),
    content: [
      'defmodule BillingEnumScope do',
      '  def normalizar(itens) do',
      '    Enum.map(itens, fn item ->',
      '      i + 1',
      '    end)',
      '  end',
      'end',
    ].join('\n'),
    expectedKinds: ['undefined_variable'],
    expectedSnippetIncludes: ['pingu - correction : corrigido nome da variavel i para item'],
    applyKinds: ['undefined_variable'],
    mustClearKinds: ['undefined_variable'],
    expectedSourceIncludesAfterApply: ['item + 1'],
  },
  {
    id: 'existing:functional_reassignment',
    relativeFile: path.join('lib', 'billing_reassignment.ex'),
    content: [
      'defmodule BillingReassignment do',
      '  def soma(valor) do',
      '    valor = valor + 1',
      '  end',
      'end',
    ].join('\n'),
    expectedKinds: ['functional_reassignment'],
    expectedSnippetIncludes: ['pingu - correction : corrigida reatribuicao de valor para novo_valor'],
    applyKinds: ['functional_reassignment'],
    mustClearKinds: ['functional_reassignment'],
    expectedSourceIncludesAfterApply: ['novo_valor = valor + 1'],
  },
  {
    id: 'existing:debug_output',
    relativeFile: path.join('lib', 'billing_debug_output.ex'),
    content: [
      'defmodule BillingDebugOutput do',
      '  def soma(numero) do',
      '    IO.inspect(numero)',
      '  end',
      'end',
    ].join('\n'),
    expectedKinds: ['debug_output'],
    applyKinds: ['debug_output'],
    mustClearKinds: ['debug_output'],
    forbiddenSourceIncludesAfterApply: ['IO.inspect', 'IO.puts'],
  },
  {
    id: 'existing:nested_condition',
    relativeFile: path.join('lib', 'billing_nested_condition.ex'),
    content: [
      'defmodule BillingNestedCondition do',
      '  def valida(a, b, c, d, e, f) do',
      '    if a do',
      '      if b do',
      '        if c do',
      '          if d do',
      '            if e do',
      '              if f do',
      '                :ok',
      '              end',
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
    applyKinds: ['nested_condition'],
    mustClearKinds: ['nested_condition'],
    expectedSourceIncludesAfterApply: ['cond do', 'true -> :adulto'],
  },
  {
    id: 'existing:todo_fixme',
    relativeFile: path.join('lib', 'billing_todo_fixme.ex'),
    content: [
      'defmodule BillingTodoFixme do',
      '  def processa(payload) do',
      '    # TODO: remover ajuste temporario',
      '    payload',
      '  end',
      'end',
    ].join('\n'),
    expectedKinds: ['todo_fixme'],
    applyKinds: ['todo_fixme'],
    mustClearKinds: ['todo_fixme'],
    forbiddenSourceIncludesAfterApply: ['TODO', 'FIXME'],
  },
  {
    id: 'existing:context_contract:calculator_return',
    relativeFile: path.join('lib', 'calculadora_context_contract.ex'),
    preContext: {
      entity: 'calculadora',
      summary: 'projeto de calculadora com retorno numerico para o cliente',
    },
    content: [
      'defmodule CalculadoraContextContract do',
      '  def resultado(a, b) do',
      '    total = a + b',
      '    true',
      '  end',
      'end',
    ].join('\n'),
    expectedKinds: ['context_contract'],
    expectedSnippetIncludes: ['total = a + b', '    total'],
    applyKinds: ['context_contract'],
    mustClearKinds: ['context_contract'],
    expectedSourceIncludesAfterApply: ['total = a + b', '    total'],
    forbiddenSourceIncludesAfterApply: ['    true', '    false'],
  },
  {
    id: 'existing:unit_test',
    relativeFile: path.join('lib', 'billing_unit_test.ex'),
    content: [
      'defmodule BillingUnitTest do',
      '  def soma(numero), do: numero + 1',
      '',
      '  def listar(itens), do: itens',
      'end',
    ].join('\n'),
    expectedKinds: ['unit_test'],
    expectedSnippetIncludes: ['ExUnit.start()', 'describe "soma/1"', 'describe "listar/1"'],
    applyKinds: ['unit_test'],
    mustClearKinds: ['unit_test'],
    expectedTargetIncludesAfterApply: ['describe "soma/1"', 'describe "listar/1"'],
    expectedTargetFileSuffix: path.join('tests', 'billing_unit_test_test.exs'),
  },
];

function createWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-elixir-real-checkup-'));
  const contextsDir = path.join(root, '.realtime-dev-agent', 'contexts');
  const contextFile = path.join(contextsDir, 'elixir-active.md');
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.mkdirSync(contextsDir, { recursive: true });
  fs.writeFileSync(path.join(root, 'mix.exs'), [
    'defmodule PinguRealCheckup.MixProject do',
    '  use Mix.Project',
    '  def project, do: [app: :pingu_real_checkup, version: "0.1.0"]',
    'end',
    '',
  ].join('\n'));
  return {
    root,
    contextsDir,
    contextFile,
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

function analyzeFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return withAiEnvironment(() => analyzeText(filePath, content, { maxLineLength: 120 }));
}

function readFileLines(targetFile) {
  return fs.readFileSync(targetFile, 'utf8').replace(/\r\n/g, '\n').split('\n');
}

function writeFileLines(targetFile, lines) {
  fs.writeFileSync(targetFile, lines.join('\n'), 'utf8');
}

function snippetLines(snippet) {
  const normalized = String(snippet || '').replace(/\r\n/g, '\n');
  if (normalized.length === 0) {
    return [];
  }
  return normalized.split('\n');
}

function boundedLineIndex(line, lines) {
  const numeric = Number(line || 1);
  if (!Number.isFinite(numeric) || numeric <= 1) {
    return 0;
  }
  return Math.min(Math.max(0, numeric - 1), Math.max(0, lines.length - 1));
}

function findIssueForKind(issues, kind, testCase) {
  const expectedSuffix = testCase.expectedTargetFileSuffix || '';
  if (expectedSuffix) {
    const withTarget = issues.find((issue) => {
      if (issue.kind !== kind) {
        return false;
      }
      const targetFile = issue.action ? String(issue.action.target_file || '') : '';
      return targetFile.endsWith(expectedSuffix);
    });
    if (withTarget) {
      return withTarget;
    }
  }
  return issues.find((issue) => issue.kind === kind) || null;
}

function applyIssueAction(sourceFile, issue) {
  const action = issue && issue.action && typeof issue.action === 'object'
    ? issue.action
    : { op: 'insert_before' };
  const op = String(action.op || 'insert_before');
  const renderedSnippetLines = snippetLines(issue && issue.snippet);

  if (op === 'write_file') {
    const targetFile = String(action.target_file || sourceFile);
    if (action.mkdir_p) {
      fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    }
    fs.writeFileSync(targetFile, renderedSnippetLines.join('\n'), 'utf8');
    return targetFile;
  }

  const lines = readFileLines(sourceFile);
  const index = boundedLineIndex(issue.line, lines);

  if (op === 'replace_line') {
    lines.splice(index, 1, ...renderedSnippetLines);
    writeFileLines(sourceFile, lines);
    return sourceFile;
  }

  if (op === 'insert_after') {
    lines.splice(index + 1, 0, ...renderedSnippetLines);
    writeFileLines(sourceFile, lines);
    return sourceFile;
  }

  lines.splice(index, 0, ...renderedSnippetLines);
  writeFileLines(sourceFile, lines);
  return sourceFile;
}

function validateCase(workspace, testCase) {
  if (testCase.preContext) {
    fs.writeFileSync(
      workspace.contextFile,
      buildActiveContextDocument(testCase.preContext.entity, testCase.preContext.summary),
      'utf8',
    );
  } else {
    fs.rmSync(workspace.contextFile, { force: true });
  }

  const filePath = path.join(workspace.root, testCase.relativeFile);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${testCase.content}\n`, 'utf8');

  let currentIssues = analyzeFile(filePath);
  const issueKinds = new Set(currentIssues.map((issue) => issue.kind));
  const missingKinds = (testCase.expectedKinds || []).filter((kind) => !issueKinds.has(kind));
  const snippetPayload = currentIssues.map((issue) => String(issue.snippet || '')).join('\n---\n');
  const missingSnippets = (testCase.expectedSnippetIncludes || []).filter((fragment) => !snippetPayload.includes(fragment));
  const forbiddenSnippets = (testCase.forbiddenSnippetIncludes || []).filter((fragment) => snippetPayload.includes(fragment));

  const applyFailures = [];
  const appliedTargets = {};
  const applyKinds = Array.isArray(testCase.applyKinds) ? testCase.applyKinds : [];

  applyKinds.forEach((kind) => {
    const issue = findIssueForKind(currentIssues, kind, testCase);
    if (!issue) {
      applyFailures.push(`issue ausente para aplicar kind=${kind}`);
      return;
    }
    const target = applyIssueAction(filePath, issue);
    appliedTargets[kind] = target;
    currentIssues = analyzeFile(filePath);
  });

  (testCase.mustClearKinds || []).forEach((kind) => {
    if (currentIssues.some((issue) => issue.kind === kind)) {
      applyFailures.push(`kind ${kind} permaneceu apos aplicacao`);
    }
  });

  const sourceExpectationFailures = [];
  const sourceAfterApply = fs.readFileSync(filePath, 'utf8');
  (testCase.expectedSourceIncludesAfterApply || []).forEach((fragment) => {
    if (!sourceAfterApply.includes(fragment)) {
      sourceExpectationFailures.push(`fonte sem trecho esperado apos aplicar: ${fragment}`);
    }
  });
  (testCase.forbiddenSourceIncludesAfterApply || []).forEach((fragment) => {
    if (sourceAfterApply.includes(fragment)) {
      sourceExpectationFailures.push(`fonte contem trecho proibido apos aplicar: ${fragment}`);
    }
  });

  const targetExpectationFailures = [];
  if ((testCase.expectedTargetIncludesAfterApply || []).length > 0) {
    const targetPath = appliedTargets.unit_test || appliedTargets.context_file || '';
    if (!targetPath || !fs.existsSync(targetPath)) {
      targetExpectationFailures.push('arquivo alvo esperado nao foi criado');
    } else {
      const targetContent = fs.readFileSync(targetPath, 'utf8');
      (testCase.expectedTargetIncludesAfterApply || []).forEach((fragment) => {
        if (!targetContent.includes(fragment)) {
          targetExpectationFailures.push(`alvo sem trecho esperado apos aplicar: ${fragment}`);
        }
      });
    }
  }

  return {
    id: testCase.id,
    filePath,
    ok: missingKinds.length === 0
      && missingSnippets.length === 0
      && forbiddenSnippets.length === 0
      && applyFailures.length === 0
      && sourceExpectationFailures.length === 0
      && targetExpectationFailures.length === 0,
    missingKinds,
    missingSnippets,
    forbiddenSnippets,
    applyFailures,
    sourceExpectationFailures,
    targetExpectationFailures,
    actualKinds: Array.from(issueKinds).sort(),
    remainingKindsAfterApply: Array.from(new Set(currentIssues.map((issue) => issue.kind))).sort(),
  };
}

function main() {
  const workspace = createWorkspace();
  const results = cases.map((testCase) => validateCase(workspace, testCase));
  const failures = results.filter((result) => !result.ok);

  const report = {
    ok: failures.length === 0,
    workspace: workspace.root,
    totalCases: results.length,
    passedCases: results.length - failures.length,
    failedCases: failures.length,
    failures: failures.map((failure) => ({
      id: failure.id,
      file: failure.filePath,
      missingKinds: failure.missingKinds,
      missingSnippets: failure.missingSnippets,
      forbiddenSnippets: failure.forbiddenSnippets,
      applyFailures: failure.applyFailures,
      sourceExpectationFailures: failure.sourceExpectationFailures,
      targetExpectationFailures: failure.targetExpectationFailures,
      actualKinds: failure.actualKinds,
      remainingKindsAfterApply: failure.remainingKindsAfterApply,
    })),
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  fs.rmSync(workspace.root, { recursive: true, force: true });
  process.exitCode = report.ok ? 0 : 1;
}

main();
