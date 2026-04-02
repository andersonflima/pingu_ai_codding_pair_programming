#!/usr/bin/env node
'use strict';

process.env.PINGU_ACTIVE_LANGUAGE_IDS = process.env.PINGU_ACTIVE_LANGUAGE_IDS || 'elixir,javascript,python';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeText } = require('../lib/analyzer');
const { hasLiveOpenAiValidation } = require('./require_real_ai_command');
const {
  activeLanguageIds,
  getCapabilityProfile,
  languageCapabilityRegistry,
  requiresAiForFeature,
} = require('../lib/language-capabilities');

const repoRoot = path.resolve(__dirname, '..');
const temporaryProjects = [];
const realAiAvailable = hasLiveOpenAiValidation();

function createTemporaryPythonProject(label, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pingu-python-${label}-`));
  temporaryProjects.push(root);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'pyproject.toml'), [
    '[project]',
    `name = "pingu-${label}"`,
    'version = "0.1.0"',
    '',
  ].join('\n'));

  if (options.activeContext) {
    const contextDir = path.join(root, '.realtime-dev-agent', 'contexts');
    fs.mkdirSync(contextDir, { recursive: true });
    fs.writeFileSync(path.join(contextDir, 'python-active.md'), options.activeContext);
  }

  return {
    root,
    sourcePath: path.join(root, options.relativeFile || path.join('src', 'sample.py')),
  };
}

function buildActivePythonContextDocument(entity, summary) {
  return [
    '<!-- realtime-dev-agent-context -->',
    'architecture: onion',
    'blueprint_type: bff_crud',
    `entity: ${entity}`,
    'language: python',
    'slug: python-active',
    'source_ext: .py',
    'source_root: src',
    `summary: ${summary}`,
    '',
    '# Contexto ativo',
    `- Contexto principal: ${entity}`,
  ].join('\n');
}

const crudProject = createTemporaryPythonProject('matrix-crud', {
  relativeFile: path.join('src', 'crud_from_context.py'),
  activeContext: buildActivePythonContextDocument('fatura', 'crud de faturamento'),
});

const unitTestProject = createTemporaryPythonProject('matrix-unit-test', {
  relativeFile: path.join('src', 'billing.py'),
});

const syntheticCases = [
  {
    id: 'python:comment_task:minimal-class',
    sourcePath: path.join(repoRoot, '__synthetic__', 'python', 'class_main.py'),
    content: '#:: criar uma class main python\n',
    expectedKinds: ['comment_task'],
    expectedSnippetIncludes: ['class Main:', 'pass'],
    forbiddenSnippetIncludes: ['defmodule', 'module.exports'],
  },
  {
    id: 'python:comment_task:directed-graph',
    sourcePath: path.join(repoRoot, '__synthetic__', 'python', 'directed_graph.py'),
    content: '#:: criar grafo direcionado com add_node add_edge bfs dfs\n',
    expectedKinds: ['comment_task'],
    expectedSnippetIncludes: ['class GrafoDirecionado:', 'def add_node(self, no):', 'def bfs(self, inicio):', 'def dfs(self, inicio):'],
    forbiddenSnippetIncludes: ['implementar:', 'NotImplementedError'],
  },
  {
    id: 'python:comment_task:crud-from-context',
    sourcePath: crudProject.sourcePath,
    content: '#:: criar crud completo\n',
    expectedKinds: ['comment_task'],
    expectedSnippetIncludes: ['def listar_faturas(faturas):', 'def criar_fatura(faturas, payload):'],
  },
  {
    id: 'python:context_file:create',
    sourcePath: path.join(repoRoot, '__synthetic__', 'python', 'context_create.py'),
    content: '# ** bff para crud de usuario\n',
    expectedKinds: ['context_file'],
    expectedSnippetIncludes: ['language: python', 'source_ext: .py'],
    expectedActionOp: 'write_file',
    expectedTargetFileSuffix: path.join('.realtime-dev-agent', 'contexts', 'bff-crud-usuario.md'),
  },
  {
    id: 'python:auto:unit_test',
    sourcePath: unitTestProject.sourcePath,
    content: [
      'def soma(a, b):',
      '    return a + b',
      '',
      'def listar(itens):',
      '    return itens',
    ].join('\n'),
    expectedKinds: ['unit_test'],
    expectedSnippetIncludes: ['from src.billing import *', 'assert soma(1, 2) == 3', 'assert listar([1, 2]) == [1, 2]'],
    expectedActionOp: 'write_file',
    expectedTargetFileSuffix: path.join('tests', 'src', 'test_billing.py'),
  },
];

function analyzeFixture(fixture) {
  return analyzeText(fixture.sourcePath, fixture.content, { maxLineLength: 120 });
}

function validateFixtureMatrix() {
  const failures = [];
  const skipped = [];

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

    if (
      !realAiAvailable
      && kinds.has('ai_required')
      && (missingKinds.length > 0 || missingSnippets.length > 0 || forbiddenSnippets.length > 0 || actionFailure || targetFailure)
    ) {
      skipped.push({
        id: fixture.id,
        actualKinds: Array.from(kinds).sort(),
      });
      return;
    }

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
    skipped,
    failures,
  };
}

function validateCapabilityRegistry() {
  const registry = languageCapabilityRegistry();
  const failures = [];

  const activeIds = activeLanguageIds().sort();
  if (activeIds.join(',') !== 'elixir,javascript,python') {
    failures.push(`activeLanguageIds esperado=elixir,javascript,python atual=${activeIds.join(',') || 'vazio'}`);
  }

  const ids = registry.map((entry) => entry.id).sort();
  if (ids.join(',') !== 'default,elixir,javascript,python') {
    failures.push(`registry ids esperados=default,elixir,javascript,python atuais=${ids.join(',')}`);
  }

  const pythonProfile = getCapabilityProfile(path.join(repoRoot, 'src', 'sample.py'));
  ['comment_task', 'context_file', 'unit_test', 'terminal_task'].forEach((feature) => {
    if (!pythonProfile.editorFeatures.includes(feature)) {
      failures.push(`feature ${feature} ausente no profile python`);
    }
  });

  ['comment_task', 'context_file', 'unit_test'].forEach((feature) => {
    if (!requiresAiForFeature(path.join(repoRoot, 'src', 'sample.py'), feature)) {
      failures.push(`requiresAiForFeature deveria ser true para ${feature} em python`);
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
      matrixSkipped: matrix.skipped.length,
      registryTotal: registry.total,
      realAiAvailable,
      activeLanguageIds: activeLanguageIds().sort(),
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
  validateCapabilityRegistry,
  validateFixtureMatrix,
};
