#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createEditRuntime } = require('../vscode/edits');
const { mustClearKindsForIssue } = require('../lib/issue-kinds');

class Position {
  constructor(line, character) {
    this.line = Number(line || 0);
    this.character = Number(character || 0);
  }
}

class Range {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}

class WorkspaceEdit {
  constructor() {
    this.operations = [];
  }

  insert(uri, position, text) {
    this.operations.push({ kind: 'insert', uri, position, text: String(text || '') });
  }

  replace(uri, range, text) {
    this.operations.push({ kind: 'replace', uri, range, text: String(text || '') });
  }

  delete(uri, range) {
    this.operations.push({ kind: 'delete', uri, range });
  }
}

function createUri(fsPath) {
  return {
    fsPath,
    toString() {
      return `file://${fsPath}`;
    },
  };
}

function readLines(fsPath) {
  return fs.readFileSync(fsPath, 'utf8').replace(/\r\n/g, '\n').split('\n');
}

function writeLines(fsPath, lines) {
  fs.writeFileSync(fsPath, (Array.isArray(lines) ? lines : []).join('\n'), 'utf8');
}

function createDocument(uri) {
  return {
    uri,
    isClosed: false,
    getText() {
      return fs.readFileSync(uri.fsPath, 'utf8');
    },
    get lineCount() {
      return readLines(uri.fsPath).length;
    },
    lineAt(index) {
      const lines = readLines(uri.fsPath);
      const bounded = Math.max(0, Math.min(Number(index || 0), Math.max(0, lines.length - 1)));
      const text = String(lines[bounded] || '');
      return {
        text,
        range: new Range(new Position(bounded, 0), new Position(bounded, text.length)),
      };
    },
  };
}

function applyRangeChange(lines, range, replacement) {
  const sourceLines = Array.isArray(lines) ? [...lines] : [];
  const safeRange = range || new Range(new Position(0, 0), new Position(0, 0));
  const startLine = Math.max(0, Number(safeRange.start && safeRange.start.line || 0));
  const startCharacter = Math.max(0, Number(safeRange.start && safeRange.start.character || 0));
  const endLine = Math.max(startLine, Number(safeRange.end && safeRange.end.line || startLine));
  const endCharacter = Math.max(0, Number(safeRange.end && safeRange.end.character || 0));
  const replacementText = String(replacement || '');
  const replacementLines = replacementText.split('\n');

  const prefix = String(sourceLines[startLine] || '').slice(0, startCharacter);
  const suffix = String(sourceLines[endLine] || '').slice(endCharacter);
  const before = sourceLines.slice(0, startLine);
  const after = sourceLines.slice(endLine + 1);

  let middle = replacementLines;
  if (middle.length === 0) {
    middle = [''];
  }
  middle[0] = `${prefix}${middle[0]}`;
  middle[middle.length - 1] = `${middle[middle.length - 1]}${suffix}`;

  return [...before, ...middle, ...after];
}

function createMockVscode() {
  return {
    Position,
    Range,
    WorkspaceEdit,
    workspace: {
      async openTextDocument(uri) {
        const resolvedUri = typeof uri === 'string' ? createUri(uri) : uri;
        return createDocument(resolvedUri);
      },
      async applyEdit(edit) {
        const operations = Array.isArray(edit && edit.operations) ? edit.operations : [];
        operations.forEach((operation) => {
          const targetPath = operation && operation.uri && operation.uri.fsPath;
          if (!targetPath || !fs.existsSync(targetPath)) {
            return;
          }
          let lines = readLines(targetPath);
          if (operation.kind === 'insert') {
            const line = Number(operation.position && operation.position.line || 0);
            const character = Number(operation.position && operation.position.character || 0);
            const range = new Range(new Position(line, character), new Position(line, character));
            lines = applyRangeChange(lines, range, operation.text);
          } else if (operation.kind === 'replace') {
            lines = applyRangeChange(lines, operation.range, operation.text);
          } else if (operation.kind === 'delete') {
            lines = applyRangeChange(lines, operation.range, '');
          }
          writeLines(targetPath, lines);
        });
        return true;
      },
    },
  };
}

function createRuntime(options = {}) {
  const vscode = createMockVscode();
  const analyzeCalls = [];
  const collectIssuesPlan = Array.isArray(options.collectIssuesPlan) ? [...options.collectIssuesPlan] : [];
  const runtime = createEditRuntime({
    fs,
    path,
    vscode,
    analyzeDocument: async (_document, trigger) => {
      analyzeCalls.push(String(trigger || 'unknown'));
      return [];
    },
    collectIssues: async () => {
      if (collectIssuesPlan.length === 0) {
        return [];
      }
      const next = collectIssuesPlan.shift();
      return Array.isArray(next) ? next : [];
    },
    configuredAutoFixKinds: () => ['undefined_variable'],
    fixPriorityForKind: () => 1,
    isAutoFixEnabled: () => true,
    mustClearKindsForIssue,
    resolveIssueAction: (issue) => (issue && issue.action ? issue.action : { op: 'insert_before' }),
  });

  return {
    runtime,
    vscode,
    analyzeCalls,
  };
}

function buildIssue(targetFile, rewrittenContent) {
  return {
    file: targetFile,
    line: 2,
    kind: 'undefined_variable',
    message: "Variavel 'numeroo' nao declarada",
    suggestion: "Substitua por 'numero'",
    snippet: String(rewrittenContent || ''),
    action: {
      op: 'write_file',
      target_file: targetFile,
      mkdir_p: true,
    },
  };
}

async function runRollbackScenario() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-vscode-guard-rollback-'));
  const targetFile = path.join(tempRoot, 'sample.ex');
  const originalContent = [
    'defmodule Billing do',
    '  def soma(numero) do',
    '    numero + 1',
    '  end',
    'end',
    '',
  ].join('\n');
  const rewrittenContent = [
    'defmodule Billing do',
    '  def soma(numero) do',
    '    numeroo + 1',
    '  end',
    'end',
    '',
  ].join('\n');
  fs.writeFileSync(targetFile, originalContent, 'utf8');

  const { runtime, vscode, analyzeCalls } = createRuntime({
    collectIssuesPlan: [[{ kind: 'undefined_variable' }]],
  });
  const document = await vscode.workspace.openTextDocument(createUri(targetFile));
  const applied = await runtime.applyAutoFixes(document, [buildIssue(targetFile, rewrittenContent)]);
  const finalContent = fs.readFileSync(targetFile, 'utf8');

  fs.rmSync(tempRoot, { recursive: true, force: true });

  return {
    id: 'rollback_when_kind_not_cleared',
    ok: applied === false && finalContent === originalContent && analyzeCalls.length === 0,
    details: {
      applied,
      analyzeCalls,
      restored: finalContent === originalContent,
    },
  };
}

async function runSuccessScenario() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-vscode-guard-success-'));
  const targetFile = path.join(tempRoot, 'sample.ex');
  const originalContent = [
    'defmodule Billing do',
    '  def soma(numero) do',
    '    numeroo + 1',
    '  end',
    'end',
    '',
  ].join('\n');
  const rewrittenContent = [
    'defmodule Billing do',
    '  def soma(numero) do',
    '    numero + 1',
    '  end',
    'end',
    '',
  ].join('\n');
  fs.writeFileSync(targetFile, originalContent, 'utf8');

  const { runtime, vscode, analyzeCalls } = createRuntime({
    collectIssuesPlan: [[]],
  });
  const document = await vscode.workspace.openTextDocument(createUri(targetFile));
  const applied = await runtime.applyAutoFixes(document, [buildIssue(targetFile, rewrittenContent)]);
  const finalContent = fs.readFileSync(targetFile, 'utf8');

  fs.rmSync(tempRoot, { recursive: true, force: true });

  return {
    id: 'commit_when_kind_cleared',
    ok: applied === true && finalContent === rewrittenContent && analyzeCalls.includes('autofix'),
    details: {
      applied,
      analyzeCalls,
      committed: finalContent === rewrittenContent,
    },
  };
}

async function runRuntimeValidationRollbackScenario() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-vscode-guard-runtime-rollback-'));
  const targetFile = path.join(tempRoot, 'sample.py');
  const originalContent = [
    'def soma(numero):',
    '    return numero + 1',
    '',
  ].join('\n');
  const rewrittenContent = [
    'def soma(numero)',
    '    return numero + 1',
    '',
  ].join('\n');
  fs.writeFileSync(targetFile, originalContent, 'utf8');

  const { runtime, vscode, analyzeCalls } = createRuntime({
    collectIssuesPlan: [[]],
  });
  const document = await vscode.workspace.openTextDocument(createUri(targetFile));
  const applied = await runtime.applyAutoFixes(document, [buildIssue(targetFile, rewrittenContent)]);
  const finalContent = fs.readFileSync(targetFile, 'utf8');

  fs.rmSync(tempRoot, { recursive: true, force: true });

  return {
    id: 'rollback_when_language_validation_fails',
    ok: applied === false && finalContent === originalContent && analyzeCalls.length === 0,
    details: {
      applied,
      analyzeCalls,
      restored: finalContent === originalContent,
    },
  };
}

async function runRangeReplacementScenario() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-vscode-guard-range-'));
  const targetFile = path.join(tempRoot, 'sample.js');
  const originalContent = [
    'function soma(numero) {',
    '  return numeroo + numeroo;',
    '}',
    '',
  ].join('\n');
  const expectedContent = [
    'function soma(numero) {',
    '  return numero + numeroo;',
    '}',
    '',
  ].join('\n');
  fs.writeFileSync(targetFile, originalContent, 'utf8');

  const { runtime, vscode, analyzeCalls } = createRuntime({
    collectIssuesPlan: [[]],
  });
  const document = await vscode.workspace.openTextDocument(createUri(targetFile));
  const applied = await runtime.applyAutoFixes(document, [{
    file: targetFile,
    line: 2,
    kind: 'undefined_variable',
    message: "Variavel 'numeroo' nao declarada",
    suggestion: "Substitua por 'numero'",
    snippet: '  return numero + numeroo;',
    action: {
      op: 'replace_line',
      range: {
        start: { line: 1, character: 9 },
        end: { line: 1, character: 16 },
      },
      text: 'numero',
    },
  }]);
  const finalContent = fs.readFileSync(targetFile, 'utf8');

  fs.rmSync(tempRoot, { recursive: true, force: true });

  return {
    id: 'replace_only_target_identifier_when_range_is_present',
    ok: applied === true && finalContent === expectedContent && analyzeCalls.includes('autofix'),
    details: {
      applied,
      analyzeCalls,
      committed: finalContent === expectedContent,
    },
  };
}

async function main() {
  const checks = [
    await runRollbackScenario(),
    await runSuccessScenario(),
    await runRuntimeValidationRollbackScenario(),
    await runRangeReplacementScenario(),
  ];
  const failures = checks.filter((check) => !check.ok);

  const report = {
    ok: failures.length === 0,
    totalChecks: checks.length,
    passedChecks: checks.length - failures.length,
    failedChecks: failures.length,
    failures,
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}

main().catch((error) => {
  process.stderr.write(`${error && (error.stack || error.message) || String(error)}\n`);
  process.exitCode = 1;
});
