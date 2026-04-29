'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildActionCommentContext,
  normalizeActionCommentMarker,
  resolveActionCommentFeature,
  resolveActionCommentRole,
} = require('../lib/action-comment-context');

test('normalizeActionCommentMarker collapses legacy expanded markers', () => {
  assert.equal(normalizeActionCommentMarker('::'), ':');
  assert.equal(normalizeActionCommentMarker(':::'), '**');
  assert.equal(normalizeActionCommentMarker('*'), '*');
});

test('resolveActionCommentFeature and role preserve marker semantics', () => {
  assert.equal(resolveActionCommentFeature(':'), 'comment_task');
  assert.equal(resolveActionCommentFeature(':::'), 'context_file');
  assert.equal(resolveActionCommentRole(':::'), 'context_blueprint');
  assert.equal(resolveActionCommentRole('*'), 'terminal_action');
});

test('buildActionCommentContext anchors the triggering line and nearby buffer window', () => {
  const context = buildActionCommentContext({
    marker: '::',
    instruction: 'criar funcao soma',
    lineIndex: 1,
    lines: [
      'const base = 1;',
      '//:: criar funcao soma',
      'export const total = base + 1;',
    ],
  });

  assert.equal(context.marker, ':');
  assert.equal(context.feature, 'comment_task');
  assert.equal(context.role, 'code_generation');
  assert.equal(context.triggerLine, 2);
  assert.equal(context.triggerText, '//:: criar funcao soma');
  assert.deepEqual(
    context.focusWindow.lines.map((entry) => entry.line),
    [1, 2, 3],
  );
});
