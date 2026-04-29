'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { checkCommentTask } = require('../lib/generation');
const { collectSourceSymbols, sourceSummary } = require('../lib/source-symbols');

test('source symbols collect functions, classes and arrow function names', () => {
  const symbols = collectSourceSymbols([
    'export class UserService {}',
    'const normalizeUser = (user) => user;',
    'async function loadUser(id) { return id; }',
  ], '.ts');

  assert.deepEqual(
    symbols.map((symbol) => [symbol.kind, symbol.name]),
    [
      ['class', 'UserService'],
      ['function', 'normalizeUser'],
      ['function', 'loadUser'],
    ],
  );
});

test('source summary exposes symbol names for AI context payloads', () => {
  const summary = sourceSummary('def normalize_user(user):\n    return user\n', '.py');

  assert.equal(summary.lineCount, 2);
  assert.deepEqual(summary.symbolNames, ['normalize_user']);
});

test('comment prompts do not propose a duplicate symbol that already exists', () => {
  const previousMode = process.env.PINGU_AI_MODE;
  process.env.PINGU_AI_MODE = 'off';
  try {
    const issues = checkCommentTask([
      'const soma = (a, b) => a + b;',
      '//:: funcao soma',
    ], '/tmp/example.js');

    assert.equal(issues.some((issue) => issue.kind === 'comment_task'), false);
  } finally {
    if (previousMode === undefined) {
      delete process.env.PINGU_AI_MODE;
    } else {
      process.env.PINGU_AI_MODE = previousMode;
    }
  }
});
