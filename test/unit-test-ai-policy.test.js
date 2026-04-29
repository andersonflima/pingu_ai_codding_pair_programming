'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { createUnitTestCoverageChecker } = require('../lib/generation-unit-tests');

function sanitizeIdentifier(value) {
  return String(value || '')
    .replace(/[^A-Za-z0-9_]/g, '')
    .trim();
}

function sanitizeNaturalIdentifier(value) {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createJavaScriptUnitTestChecker(projectRoot, resolveAiGeneratedUnitTests) {
  return createUnitTestCoverageChecker({
    hasOpenAiConfiguration: () => true,
    loadActiveBlueprintContext: () => null,
    resolveAiGeneratedUnitTests,
    sanitizeIdentifier,
    sanitizeNaturalIdentifier,
    escapeRegExp,
    isJavaScriptLikeExtension: (ext) => ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(String(ext || '').toLowerCase()),
    isPythonLikeExtension: () => false,
    isGoExtension: () => false,
    isRustExtension: () => false,
    isRubyExtension: () => false,
    resolveProjectRoot: () => projectRoot,
    findUpwards: () => '',
    pathExists: fs.existsSync,
    requiresAiForFeature: () => false,
    resolveAiFeaturePolicy: () => ({
      feature: 'unit_test',
      mode: 'prefer',
      hasOpenAiConfiguration: true,
      mustUseAi: false,
      shouldUseAi: true,
      canFallBack: true,
    }),
    toPosixPath: (value) => String(value || '').split(path.sep).join('/'),
    toImportPath: (value) => value,
    upwardDepth: () => 0,
    upperFirst: (value) => String(value || '').charAt(0).toUpperCase() + String(value || '').slice(1),
  });
}

test('unit test coverage prefers AI output when the AI policy is enabled', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-unit-test-policy-'));
  const sourceFile = path.join(projectRoot, 'src', 'sum.js');
  fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
  fs.writeFileSync(sourceFile, 'export function sum(a, b) { return a + b; }\n');

  const requests = [];
  const checkUnitTestCoverage = createJavaScriptUnitTestChecker(
    projectRoot,
    (request) => {
      requests.push(request);
      return {
        snippet: 'test("sum", () => { expect(subject.sum(1, 2)).toBe(3); });',
        action: {
          op: 'write_file',
          target_file: path.join(projectRoot, 'test', 'sum.test.js'),
          mkdir_p: true,
        },
      };
    },
  );

  const issues = checkUnitTestCoverage(
    ['export function sum(a, b) { return a + b; }'],
    sourceFile,
  );

  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'unit_test');
  assert.match(issues[0].snippet, /expect\(subject\.sum\(1, 2\)\)\.toBe\(3\)/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].focusLine, 1);
  assert.equal(requests[0].targetFile, path.join(projectRoot, 'test', 'src', 'sum.test.js'));
});

test('unit test coverage normalizes AI action with empty op to write_file', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-unit-test-action-'));
  const sourceFile = path.join(projectRoot, 'src', 'sum.js');
  const aiTargetFile = path.join(projectRoot, 'test', 'sum.ai.test.js');
  fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
  fs.writeFileSync(sourceFile, 'export function sum(a, b) { return a + b; }\n');

  const checkUnitTestCoverage = createJavaScriptUnitTestChecker(
    projectRoot,
    () => ({
      snippet: 'test("sum", () => { expect(subject.sum(1, 2)).toBe(3); });',
      action: {
        op: '',
        target_file: aiTargetFile,
        mkdir_p: true,
      },
    }),
  );

  const issues = checkUnitTestCoverage(
    ['export function sum(a, b) { return a + b; }'],
    sourceFile,
  );

  assert.equal(issues.length, 1);
  assert.equal(issues[0].action.op, 'write_file');
  assert.equal(issues[0].action.target_file, aiTargetFile);
  assert.equal(issues[0].action.mkdir_p, true);
});

test('unit test coverage falls back offline when preferred AI returns no snippet', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-unit-test-offline-fallback-'));
  const sourceFile = path.join(projectRoot, 'src', 'sum.js');
  fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
  fs.writeFileSync(sourceFile, 'export function sum(a, b) { return a + b; }\n');

  const checkUnitTestCoverage = createJavaScriptUnitTestChecker(projectRoot, () => null);

  const issues = checkUnitTestCoverage(
    ['export function sum(a, b) { return a + b; }'],
    sourceFile,
  );

  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'unit_test');
  assert.equal(issues[0].action.op, 'write_file');
  assert.equal(issues[0].action.target_file, path.join(projectRoot, 'test', 'src', 'sum.test.js'));
  assert.notEqual(issues[0].kind, 'ai_required');
});
