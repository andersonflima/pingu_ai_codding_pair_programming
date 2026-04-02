#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeText } = require('../lib/analyzer');
const { hasLiveOpenAiValidation } = require('./require_real_ai_command');

const workspaceRoot = path.resolve(
  process.env.PINGU_ELIXIR_SNIPPETS_WORKSPACE_ROOT
    || path.join(os.tmpdir(), 'pingu-snippets-elixir-workspace'),
);
const contextsDir = path.join(workspaceRoot, '.realtime-dev-agent', 'contexts');
const contextFile = path.join(contextsDir, 'elixir-active.md');
const realAiAvailable = hasLiveOpenAiValidation();

const cases = [
  {
    id: 'comment_task:module_main',
    file: 'criar_module_main.exs',
    content: '#:: criar um module main elixir\n',
    expectedKinds: ['comment_task'],
    expectedSnippetIncludes: ['defmodule Main do', 'end'],
    forbiddenSnippetIncludes: ['@moduledoc', '@spec', 'def listar('],
    applyKinds: ['comment_task'],
    mustClearKinds: ['comment_task'],
  },
  {
    id: 'comment_task:graph',
    file: 'criar_grafo_direcionado.exs',
    content: '#:: criar grafo direcionado com add_node add_edge bfs dfs\n',
    expectedKinds: ['comment_task'],
    expectedSnippetIncludes: ['defmodule GrafoDirecionado do', 'def add_node(%__MODULE__', 'def bfs(%__MODULE__'],
    forbiddenSnippetIncludes: ['implementar:', 'NotImplementedError'],
    applyKinds: ['comment_task'],
    mustClearKinds: ['comment_task'],
  },
  {
    id: 'comment_task:crud_from_context',
    file: 'criar_crud_contexto.ex',
    preContext: {
      entity: 'fatura',
      summary: 'contexto ativo de faturamento',
    },
    content: '#:: criar crud completo\n',
    expectedKinds: ['comment_task'],
    expectedSnippetIncludes: ['def listar_faturas(faturas), do: faturas', 'def criar_fatura(faturas, payload) do'],
    applyKinds: ['comment_task'],
    mustClearKinds: ['comment_task'],
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
    applyKinds: ['context_file'],
    mustClearKinds: ['context_file'],
    expectedTargetIncludesAfterApply: ['entity: usuario', 'Politica aplicada: merge'],
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
    applyKinds: ['context_file'],
    mustClearKinds: ['context_file'],
    expectedTargetIncludesAfterApply: ['entity: fatura', 'Politica aplicada: overwrite'],
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
    applyKinds: ['moduledoc', 'function_spec', 'function_doc'],
    mustClearKinds: ['moduledoc', 'function_doc', 'function_spec'],
    expectedSourceIncludesAfterApply: ['@moduledoc', '@doc', '@spec soma(any()) :: any()'],
  },
  {
    id: 'auto:undefined_variable:simple',
    file: 'corrigir_variavel_indefinida.ex',
    content: [
      'defmodule Billing do',
      '  def soma(numero) do',
      '    numeroo + 1',
      '  end',
      'end',
    ].join('\n'),
    expectedKinds: ['undefined_variable'],
    expectedSnippetIncludes: ['numero + 1'],
    forbiddenSnippetIncludes: ['pingu - correction'],
    expectedActionOp: 'write_file',
    applyKinds: ['undefined_variable'],
    mustClearKinds: ['undefined_variable'],
    expectedSourceIncludesAfterApply: ['numero + 1'],
  },
  {
    id: 'auto:undefined_variable:param_name',
    file: 'corrigir_parametro_nome_errado.ex',
    content: [
      'defmodule Billing do',
      '  def soma(a, b) do',
      '    aa + b',
      '  end',
      'end',
    ].join('\n'),
    expectedKinds: ['undefined_variable'],
    expectedSnippetIncludes: ['a + b'],
    forbiddenSnippetIncludes: ['pingu - correction'],
    expectedActionOp: 'write_file',
    applyKinds: ['undefined_variable'],
    mustClearKinds: ['undefined_variable'],
    expectedSourceIncludesAfterApply: ['a + b'],
  },
  {
    id: 'auto:undefined_variable:map_reference',
    file: 'corrigir_referencia_mapa_errada.ex',
    content: [
      'defmodule Billing do',
      '  def formatar_usuario(usuario_mapa) do',
      '    nome = Map.get(usuario_map, :nome)',
      '    "#{nome} <#{usuario_mapa[:email]}>"',
      '  end',
      'end',
    ].join('\n'),
    expectedKinds: ['undefined_variable'],
    expectedSnippetIncludes: ['Map.get(usuario_mapa, :nome)'],
    forbiddenSnippetIncludes: ['pingu - correction'],
    expectedActionOp: 'write_file',
    applyKinds: ['undefined_variable'],
    mustClearKinds: ['undefined_variable'],
    expectedSourceIncludesAfterApply: ['Map.get(usuario_mapa, :nome)'],
  },
  {
    id: 'auto:undefined_variable:enum_scope',
    file: 'corrigir_variavel_escopo_enum.ex',
    content: [
      'defmodule Billing do',
      '  def normalizar(itens) do',
      '    Enum.map(itens, fn item ->',
      '      i + 1',
      '    end)',
      '  end',
      'end',
    ].join('\n'),
    expectedKinds: ['undefined_variable'],
    expectedSnippetIncludes: ['item + 1'],
    forbiddenSnippetIncludes: ['pingu - correction'],
    expectedActionOp: 'write_file',
    applyKinds: ['undefined_variable'],
    mustClearKinds: ['undefined_variable'],
    expectedSourceIncludesAfterApply: ['item + 1'],
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
    expectedSnippetIncludes: ['novo_valor = valor + 1'],
    forbiddenSnippetIncludes: ['pingu - correction'],
    expectedActionOp: 'write_file',
    applyKinds: ['functional_reassignment'],
    mustClearKinds: ['functional_reassignment'],
    expectedSourceIncludesAfterApply: ['novo_valor = valor + 1'],
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
    applyKinds: ['debug_output'],
    mustClearKinds: ['debug_output'],
    forbiddenSourceIncludesAfterApply: ['IO.inspect', 'IO.puts'],
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
    applyKinds: ['nested_condition'],
    mustClearKinds: ['nested_condition'],
    expectedSourceIncludesAfterApply: ['cond do', 'true -> :adulto'],
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
    applyKinds: ['todo_fixme'],
    mustClearKinds: ['todo_fixme'],
    forbiddenSourceIncludesAfterApply: ['TODO', 'FIXME'],
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
    applyKinds: ['unit_test'],
    mustClearKinds: ['unit_test'],
    expectedTargetIncludesAfterApply: ['describe "soma/1"', 'describe "listar/1"'],
  },
  {
    id: 'auto:context_contract:calculator_return',
    file: 'corrigir_contexto_calculadora_resultado.ex',
    preContext: {
      entity: 'calculadora',
      summary: 'projeto de calculadora com retorno numerico para o cliente',
    },
    content: [
      'defmodule Calculadora do',
      '  def resultado(a, b) do',
      '    total = a + b',
      '    true',
      '  end',
      'end',
    ].join('\n'),
    expectedKinds: ['context_contract'],
    expectedSnippetIncludes: ['total = a + b', '    total'],
    expectedActionOp: 'write_file',
    applyKinds: ['context_contract'],
    mustClearKinds: ['context_contract'],
    expectedSourceIncludesAfterApply: ['total = a + b', '    total'],
    forbiddenSourceIncludesAfterApply: ['    true', '    false'],
  },
];

function normalizePathForDisplay(absolutePath) {
  return absolutePath.replace(os.homedir(), '~');
}

function ensureWorkspace() {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, 'tests'), { recursive: true });
  fs.mkdirSync(contextsDir, { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, 'mix.exs'), [
    'defmodule PinguWorkspace.MixProject do',
    '  use Mix.Project',
    '  def project, do: [app: :pingu_workspace, version: "0.1.0"]',
    'end',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(workspaceRoot, '.gitignore'), '.realtime-dev-agent/\n');
  fs.rmSync(contextFile, { force: true });
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
  fs.rmSync(contextFile, { force: true });
}

function applyPreContext(preContext) {
  fs.mkdirSync(contextsDir, { recursive: true });
  fs.writeFileSync(
    contextFile,
    buildActiveContextDocument(preContext.entity, preContext.summary),
    'utf8',
  );
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

    if (action.remove_trigger && path.resolve(targetFile) !== path.resolve(sourceFile) && fs.existsSync(sourceFile)) {
      const lines = readFileLines(sourceFile);
      const index = boundedLineIndex(issue.line, lines);
      lines.splice(index, 1);
      writeFileLines(sourceFile, lines);
    }

    return targetFile;
  }

  if (!fs.existsSync(sourceFile)) {
    return sourceFile;
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

function analyzeFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return analyzeText(filePath, content, { maxLineLength: 120 });
}

function validateCase(testCase) {
  if (testCase.preContext) {
    applyPreContext(testCase.preContext);
  } else {
    resetContextFile();
  }

  const filePath = path.join(workspaceRoot, testCase.file);
  fs.writeFileSync(filePath, `${testCase.content}\n`, 'utf8');

  const initialIssues = analyzeFile(filePath);
  const issueKinds = new Set(initialIssues.map((issue) => issue.kind));
  const missingKinds = (testCase.expectedKinds || []).filter((kind) => !issueKinds.has(kind));
  const snippetPayload = initialIssues.map((issue) => String(issue.snippet || '')).join('\n---\n');
  const missingSnippets = (testCase.expectedSnippetIncludes || []).filter((fragment) => !snippetPayload.includes(fragment));
  const forbiddenSnippets = (testCase.forbiddenSnippetIncludes || []).filter((fragment) => snippetPayload.includes(fragment));

  const primaryIssue = findIssueForKind(initialIssues, (testCase.expectedKinds || [])[0], testCase);
  const actionOp = primaryIssue && primaryIssue.action ? primaryIssue.action.op : '';
  const targetFile = primaryIssue && primaryIssue.action ? String(primaryIssue.action.target_file || '') : '';
  const actionFailure = testCase.expectedActionOp && actionOp !== testCase.expectedActionOp
    ? `action.op esperado=${testCase.expectedActionOp} atual=${actionOp || 'undefined'}`
    : '';
  const targetFailure = testCase.expectedTargetFileSuffix && !targetFile.endsWith(testCase.expectedTargetFileSuffix)
    ? `target_file esperado com sufixo=${testCase.expectedTargetFileSuffix} atual=${targetFile || 'undefined'}`
    : '';

  if (
    !realAiAvailable
    && issueKinds.has('ai_required')
    && (missingKinds.length > 0 || missingSnippets.length > 0 || forbiddenSnippets.length > 0 || !!actionFailure || !!targetFailure)
  ) {
    return {
      id: testCase.id,
      filePath,
      ok: true,
      skipped: true,
      missingKinds,
      missingSnippets,
      forbiddenSnippets,
      actionFailure,
      targetFailure,
      applyFailures: [],
      sourceExpectationFailures: [],
      targetExpectationFailures: [],
      actualKinds: Array.from(issueKinds).sort(),
      remainingKindsAfterApply: Array.from(issueKinds).sort(),
    };
  }

  const applyKinds = Array.isArray(testCase.applyKinds) && testCase.applyKinds.length > 0
    ? testCase.applyKinds
    : [];
  const applyFailures = [];
  const appliedTargets = {};
  let currentIssues = initialIssues;

  applyKinds.forEach((kind) => {
    const issue = findIssueForKind(currentIssues, kind, testCase);
    if (!issue) {
      applyFailures.push(`issue ausente para aplicar kind=${kind}`);
      return;
    }
    const affectedFile = applyIssueAction(filePath, issue);
    appliedTargets[kind] = affectedFile;
    currentIssues = analyzeFile(filePath);
  });

  const clearKinds = Array.isArray(testCase.mustClearKinds) && testCase.mustClearKinds.length > 0
    ? testCase.mustClearKinds
    : [];
  clearKinds.forEach((kind) => {
    if (currentIssues.some((issue) => issue.kind === kind)) {
      applyFailures.push(`kind ${kind} permaneceu apos aplicacao`);
    }
  });

  const sourceAfterApply = fs.readFileSync(filePath, 'utf8');
  const sourceExpectationFailures = [];
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
    const targetPath = appliedTargets.context_file || appliedTargets.unit_test || targetFile;
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
      && !actionFailure
      && !targetFailure
      && applyFailures.length === 0
      && sourceExpectationFailures.length === 0
      && targetExpectationFailures.length === 0,
    missingKinds,
    missingSnippets,
    forbiddenSnippets,
    actionFailure,
    targetFailure,
    applyFailures,
    sourceExpectationFailures,
    targetExpectationFailures,
    actualKinds: Array.from(issueKinds).sort(),
    remainingKindsAfterApply: Array.from(new Set(currentIssues.map((issue) => issue.kind))).sort(),
  };
}

function main() {
  ensureWorkspace();
  const results = cases.map(validateCase);
  const skipped = results.filter((result) => result.skipped);
  const failures = results.filter((result) => !result.ok);

  const report = {
    ok: failures.length === 0,
    workspace: normalizePathForDisplay(workspaceRoot),
    totalCases: results.length,
    passedCases: results.length - failures.length - skipped.length,
    skippedCases: skipped.length,
    failedCases: failures.length,
    realAiAvailable,
    failures: failures.map((failure) => ({
      id: failure.id,
      file: normalizePathForDisplay(failure.filePath),
      missingKinds: failure.missingKinds,
      missingSnippets: failure.missingSnippets,
      forbiddenSnippets: failure.forbiddenSnippets,
      actionFailure: failure.actionFailure,
      targetFailure: failure.targetFailure,
      applyFailures: failure.applyFailures,
      sourceExpectationFailures: failure.sourceExpectationFailures,
      targetExpectationFailures: failure.targetExpectationFailures,
      actualKinds: failure.actualKinds,
      remainingKindsAfterApply: failure.remainingKindsAfterApply,
    })),
    skipped: skipped.map((result) => ({
      id: result.id,
      file: normalizePathForDisplay(result.filePath),
      actualKinds: result.actualKinds,
    })),
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}

main();
