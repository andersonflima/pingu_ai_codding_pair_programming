#!/usr/bin/env node
'use strict';

process.env.PINGU_ACTIVE_LANGUAGE_IDS = process.env.PINGU_ACTIVE_LANGUAGE_IDS || 'elixir,javascript';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeText } = require('../lib/analyzer');
const { requireRealAiCommand } = require('./require_real_ai_command');

const cases = [
  {
    id: 'existing:function_doc',
    relativeFile: path.join('src', 'billing_docs.js'),
    content: [
      'function soma(a, b) {',
      '  return a + b;',
      '}',
      '',
      'function listar(itens) {',
      '  return itens;',
      '}',
      '',
      'module.exports = { soma, listar };',
    ].join('\n'),
    expectedKinds: ['function_doc'],
    expectedSnippetIncludes: ['Orquestra o comportamento principal de soma'],
    applyKinds: ['function_doc', 'function_doc'],
    mustClearKinds: ['function_doc'],
    expectedSourceIncludesAfterApply: ['/**', 'function soma(a, b)', 'function listar(itens)'],
  },
  {
    id: 'existing:undefined_variable:param_typo',
    relativeFile: path.join('src', 'billing_param_typo.js'),
    content: [
      'function soma(a, b) {',
      '  return aa + b;',
      '}',
      '',
      'module.exports = { soma };',
    ].join('\n'),
    expectedKinds: ['undefined_variable'],
    expectedSnippetIncludes: ['pingu - correction : corrigido nome da variavel aa para a'],
    applyKinds: ['undefined_variable'],
    mustClearKinds: ['undefined_variable'],
    expectedSourceIncludesAfterApply: ['return a + b;'],
  },
  {
    id: 'existing:undefined_variable:map_reference',
    relativeFile: path.join('src', 'billing_map_reference.js'),
    content: [
      'function formatarUsuario(usuarioMapa) {',
      '  const nome = usuarioMap.nome;',
      '  return `${nome} <${usuarioMapa.email}>`;',
      '}',
      '',
      'module.exports = { formatarUsuario };',
    ].join('\n'),
    expectedKinds: ['undefined_variable'],
    expectedSnippetIncludes: ['pingu - correction : corrigido nome da variavel usuarioMap para usuarioMapa'],
    applyKinds: ['undefined_variable'],
    mustClearKinds: ['undefined_variable'],
    expectedSourceIncludesAfterApply: ['const nome = usuarioMapa.nome;'],
  },
  {
    id: 'existing:undefined_variable:callback_scope',
    relativeFile: path.join('src', 'billing_callback_scope.js'),
    content: [
      'function normalizar(itens) {',
      '  return itens.map((item) => i + 1);',
      '}',
      '',
      'module.exports = { normalizar };',
    ].join('\n'),
    expectedKinds: ['undefined_variable'],
    expectedSnippetIncludes: ['pingu - correction : corrigido nome da variavel i para item'],
    applyKinds: ['undefined_variable'],
    mustClearKinds: ['undefined_variable'],
    expectedSourceIncludesAfterApply: ['return itens.map((item) => item + 1);'],
  },
  {
    id: 'existing:debug_output',
    relativeFile: path.join('src', 'billing_debug_output.js'),
    content: [
      'function calcularTotal(a, b) {',
      '  const total = a + b;',
      '  console.log(total);',
      '}',
      '',
      'module.exports = { calcularTotal };',
    ].join('\n'),
    expectedKinds: ['debug_output'],
    applyKinds: ['debug_output'],
    mustClearKinds: ['debug_output'],
    forbiddenSourceIncludesAfterApply: ['console.log', 'console.debug', 'console.info', 'console.warn', 'console.error'],
  },
  {
    id: 'existing:todo_fixme',
    relativeFile: path.join('src', 'billing_todo_fixme.js'),
    content: [
      'function processar(payload) {',
      '  // TODO: remover ajuste temporario',
      '  return payload;',
      '}',
      '',
      'module.exports = { processar };',
    ].join('\n'),
    expectedKinds: ['todo_fixme'],
    applyKinds: ['todo_fixme'],
    mustClearKinds: ['todo_fixme'],
    forbiddenSourceIncludesAfterApply: ['TODO', 'FIXME'],
  },
  {
    id: 'existing:context_contract:calculator_return',
    relativeFile: path.join('src', 'calculadora_context_contract.js'),
    preContext: {
      entity: 'calculadora',
      summary: 'projeto de calculadora com retorno numerico para o cliente',
    },
    content: [
      'function resultado(a, b) {',
      '  const total = a + b;',
      '  return true;',
      '}',
      '',
      'module.exports = { resultado };',
    ].join('\n'),
    expectedKinds: ['context_contract'],
    applyKinds: ['context_contract'],
    mustClearKinds: ['context_contract'],
    expectedSourceIncludesAfterApply: ['const total = a + b;', 'return total;'],
    forbiddenSourceIncludesAfterApply: ['return true;', 'return false;'],
  },
  {
    id: 'existing:unit_test',
    relativeFile: path.join('src', 'billing_unit_test.js'),
    content: [
      'function soma(a, b) {',
      '  return a + b;',
      '}',
      '',
      'function listar(itens) {',
      '  return itens;',
      '}',
      '',
      'module.exports = { soma, listar };',
    ].join('\n'),
    expectedKinds: ['unit_test'],
    expectedSnippetIncludes: ['const test = require(\'node:test\');', 'subject.soma(1, 2)', 'subject.listar([1, 2])'],
    applyKinds: ['unit_test'],
    mustClearKinds: ['unit_test'],
    expectedTargetFileSuffix: path.join('tests', 'src', 'billing_unit_test.test.js'),
    expectedTargetIncludesAfterApply: ['subject.soma(1, 2)', 'subject.listar([1, 2])'],
  },
];

function createWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-node-real-checkup-'));
  const contextsDir = path.join(root, '.realtime-dev-agent', 'contexts');
  const contextFile = path.join(contextsDir, 'javascript-active.md');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.mkdirSync(contextsDir, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'pingu-node-real-checkup',
    version: '0.1.0',
    type: 'commonjs',
  }, null, 2));
  return {
    root,
    contextFile,
  };
}

function buildActiveContextDocument(entity, summary) {
  return [
    '<!-- realtime-dev-agent-context -->',
    'architecture: onion',
    'blueprint_type: bff_crud',
    `entity: ${entity}`,
    'language: javascript',
    'slug: javascript-active',
    'source_ext: .js',
    'source_root: src',
    `summary: ${summary}`,
    '',
    '# Contexto ativo',
    `- Contexto principal: ${entity}`,
  ].join('\n');
}

function analyzeFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return analyzeText(filePath, content, { maxLineLength: 120 });
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
  requireRealAiCommand('validate:checkup:node');
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
