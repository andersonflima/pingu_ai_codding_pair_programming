'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeAiResolutionMode,
  readAiFeatureMode,
  resolveAiFeaturePolicy,
} = require('../lib/ai-resolution-policy');

test('normalizeAiResolutionMode understands prefer, force and off aliases', () => {
  assert.equal(normalizeAiResolutionMode('auto'), 'prefer');
  assert.equal(normalizeAiResolutionMode('required'), 'force');
  assert.equal(normalizeAiResolutionMode('disabled'), 'off');
});

test('readAiFeatureMode defaults to prefer for action comments and unit tests', () => {
  assert.equal(readAiFeatureMode('comment_task', {}), 'prefer');
  assert.equal(readAiFeatureMode('context_file', {}), 'prefer');
  assert.equal(readAiFeatureMode('unit_test', {}), 'prefer');
  assert.equal(readAiFeatureMode('automatic_fix', {}), 'off');
});

test('readAiFeatureMode respects direct and legacy environment overrides', () => {
  assert.equal(
    readAiFeatureMode('comment_task', { PINGU_AI_COMMENT_TASK_MODE: 'off' }),
    'off',
  );
  assert.equal(
    readAiFeatureMode('unit_test', { PINGU_FORCE_AI_UNIT_TEST: '1' }),
    'force',
  );
  assert.equal(
    readAiFeatureMode('automatic_fix', { PINGU_AUTOMATIC_AI_RESOLUTION: 'true' }),
    'prefer',
  );
});

test('resolveAiFeaturePolicy only uses AI in prefer mode when configuration exists', () => {
  const withoutKey = resolveAiFeaturePolicy('comment_task', {}, { hasOpenAiConfiguration: false });
  const withKey = resolveAiFeaturePolicy('comment_task', {}, { hasOpenAiConfiguration: true });
  const forced = resolveAiFeaturePolicy(
    'comment_task',
    { PINGU_AI_COMMENT_TASK_MODE: 'force' },
    { hasOpenAiConfiguration: false },
  );

  assert.equal(withoutKey.mode, 'prefer');
  assert.equal(withoutKey.shouldUseAi, false);
  assert.equal(withKey.shouldUseAi, true);
  assert.equal(forced.mustUseAi, true);
  assert.equal(forced.canFallBack, false);
});
