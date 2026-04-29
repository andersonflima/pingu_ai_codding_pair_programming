'use strict';

const assert = require('assert/strict');
const test = require('node:test');
const {
  checkCommonDeveloperErrors,
  rewriteCodeSegments,
} = require('../lib/analyzer-developer-errors');

test('developer error rewrites protect strings and inline comments', () => {
  const rewritten = rewriteCodeSegments('if (total == expected) return "a == b" // keep == here', '.js', (code) =>
    code.replace(/==/g, '==='));

  assert.equal(rewritten, 'if (total === expected) return "a == b" // keep == here');
});

test('developer error checker emits deterministic language fixes', () => {
  const jsIssue = checkCommonDeveloperErrors(['if (total == expected) {'], '/tmp/sample.js', '.js')[0];
  const pythonIssue = checkCommonDeveloperErrors(['if value == None:'], '/tmp/sample.py', '.py')[0];

  assert.equal(jsIssue.kind, 'loose_equality');
  assert.equal(jsIssue.snippet, 'if (total === expected) {');
  assert.equal(pythonIssue.kind, 'none_comparison');
  assert.equal(pythonIssue.snippet, 'if value is None:');
});
