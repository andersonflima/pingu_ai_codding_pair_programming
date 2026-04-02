#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeText } = require('../lib/analyzer');

function buildActiveContextDocument(spec, entity, summary) {
  return [
    '<!-- realtime-dev-agent-context -->',
    'architecture: onion',
    'blueprint_type: bff_crud',
    `entity: ${entity}`,
    `language: ${spec.id}`,
    `slug: ${spec.id}-active`,
    `source_ext: ${spec.sourceExt}`,
    `source_root: ${spec.sourceRoot}`,
    `summary: ${summary}`,
    '',
    '# Contexto ativo',
    `- Contexto principal: ${entity}`,
  ].join('\n');
}

function createWorkspace(spec, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const contextsDir = path.join(root, '.realtime-dev-agent', 'contexts');
  const contextFile = path.join(contextsDir, `${spec.id}-active.md`);
  fs.mkdirSync(contextsDir, { recursive: true });

  (spec.workspace && Array.isArray(spec.workspace.dirs) ? spec.workspace.dirs : []).forEach((relativeDir) => {
    fs.mkdirSync(path.join(root, relativeDir), { recursive: true });
  });

  (spec.workspace && Array.isArray(spec.workspace.files) ? spec.workspace.files : []).forEach((entry) => {
    const targetFile = path.join(root, entry.relativePath);
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.writeFileSync(targetFile, entry.content, 'utf8');
  });

  return {
    root,
    contextFile,
  };
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
  if (!normalized) {
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
    const targetedIssue = issues.find((issue) => {
      if (issue.kind !== kind) {
        return false;
      }
      const targetFile = issue.action ? String(issue.action.target_file || '') : '';
      return targetFile.endsWith(expectedSuffix);
    });
    if (targetedIssue) {
      return targetedIssue;
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

function shouldSkipAiConditionalValidation(realAiAvailable, issueKinds, expectationFailures) {
  return !realAiAvailable
    && issueKinds.has('ai_required')
    && expectationFailures.some((entry) => {
      if (Array.isArray(entry)) {
        return entry.length > 0;
      }
      return Boolean(entry);
    });
}

function validateMatrixCase(workspace, testCase, realAiAvailable) {
  const filePath = path.join(workspace.root, testCase.relativeFile);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${testCase.content}\n`, 'utf8');

  const issues = analyzeFile(filePath);
  const issueKinds = new Set(issues.map((issue) => issue.kind));
  const missingKinds = (testCase.expectedKinds || []).filter((kind) => !issueKinds.has(kind));
  const snippets = issues.map((issue) => String(issue.snippet || '')).join('\n---\n');
  const missingSnippets = (testCase.expectedSnippetIncludes || []).filter((fragment) => !snippets.includes(fragment));
  const forbiddenSnippets = (testCase.forbiddenSnippetIncludes || []).filter((fragment) => snippets.includes(fragment));

  const firstExpectedIssue = issues.find((issue) => {
    if (!(testCase.expectedKinds || []).includes(issue.kind)) {
      return false;
    }
    if (!testCase.expectedTargetFileSuffix) {
      return true;
    }
    const targetFile = issue.action ? String(issue.action.target_file || '') : '';
    return targetFile.endsWith(testCase.expectedTargetFileSuffix);
  }) || issues.find((issue) => (testCase.expectedKinds || []).includes(issue.kind));

  const actionOp = firstExpectedIssue && firstExpectedIssue.action ? firstExpectedIssue.action.op : '';
  const targetFile = firstExpectedIssue && firstExpectedIssue.action ? String(firstExpectedIssue.action.target_file || '') : '';
  const actionFailure = testCase.expectedActionOp && actionOp !== testCase.expectedActionOp
    ? `action.op esperado=${testCase.expectedActionOp} atual=${actionOp || 'undefined'}`
    : '';
  const targetFailure = testCase.expectedTargetFileSuffix && !targetFile.endsWith(testCase.expectedTargetFileSuffix)
    ? `target_file esperado com sufixo=${testCase.expectedTargetFileSuffix} atual=${targetFile || 'undefined'}`
    : '';

  if (shouldSkipAiConditionalValidation(realAiAvailable, issueKinds, [
    missingKinds,
    missingSnippets,
    forbiddenSnippets,
    actionFailure,
    targetFailure,
  ])) {
    return {
      id: testCase.id,
      skipped: true,
      actualKinds: Array.from(issueKinds).sort(),
      filePath,
    };
  }

  return {
    id: testCase.id,
    ok: missingKinds.length === 0
      && missingSnippets.length === 0
      && forbiddenSnippets.length === 0
      && !actionFailure
      && !targetFailure,
    missingKinds,
    missingSnippets,
    forbiddenSnippets,
    actionFailure,
    targetFailure,
    actualKinds: Array.from(issueKinds).sort(),
    filePath,
  };
}

function runMatrixValidation(spec, realAiAvailable) {
  const workspace = createWorkspace(spec, `pingu-${spec.id}-matrix-`);
  const results = (spec.matrixCases || []).map((testCase) => validateMatrixCase(workspace, testCase, realAiAvailable));
  const skipped = results.filter((result) => result.skipped);
  const failures = results.filter((result) => !result.ok && !result.skipped);

  const report = {
    ok: failures.length === 0,
    workspace: workspace.root,
    totalCases: results.length,
    skippedCases: skipped.length,
    failedCases: failures.length,
    failures: failures.map((failure) => ({
      id: failure.id,
      file: failure.filePath,
      missingKinds: failure.missingKinds,
      missingSnippets: failure.missingSnippets,
      forbiddenSnippets: failure.forbiddenSnippets,
      actionFailure: failure.actionFailure,
      targetFailure: failure.targetFailure,
      actualKinds: failure.actualKinds,
    })),
    skipped: skipped.map((result) => ({
      id: result.id,
      file: result.filePath,
      actualKinds: result.actualKinds,
    })),
  };

  fs.rmSync(workspace.root, { recursive: true, force: true });
  return report;
}

function validateCheckupCase(workspace, spec, testCase, realAiAvailable) {
  if (testCase.preContext) {
    fs.writeFileSync(
      workspace.contextFile,
      buildActiveContextDocument(spec, testCase.preContext.entity, testCase.preContext.summary),
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

  if (shouldSkipAiConditionalValidation(realAiAvailable, issueKinds, [missingKinds, missingSnippets, forbiddenSnippets])) {
    return {
      id: testCase.id,
      filePath,
      ok: true,
      skipped: true,
      actualKinds: Array.from(issueKinds).sort(),
      remainingKindsAfterApply: Array.from(issueKinds).sort(),
    };
  }

  const applyFailures = [];
  const appliedTargets = {};
  (Array.isArray(testCase.applyKinds) ? testCase.applyKinds : []).forEach((kind) => {
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

function runCheckupValidation(spec, realAiAvailable) {
  const workspace = createWorkspace(spec, `pingu-${spec.id}-checkup-`);
  const results = (spec.checkupCases || []).map((testCase) => validateCheckupCase(workspace, spec, testCase, realAiAvailable));
  const skipped = results.filter((result) => result.skipped);
  const failures = results.filter((result) => !result.ok);

  const report = {
    ok: failures.length === 0,
    workspace: workspace.root,
    totalCases: results.length,
    passedCases: results.length - failures.length - skipped.length,
    skippedCases: skipped.length,
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
    skipped: skipped.map((result) => ({
      id: result.id,
      file: result.filePath,
      actualKinds: result.actualKinds,
    })),
  };

  fs.rmSync(workspace.root, { recursive: true, force: true });
  return report;
}

module.exports = {
  buildActiveContextDocument,
  runCheckupValidation,
  runMatrixValidation,
};
