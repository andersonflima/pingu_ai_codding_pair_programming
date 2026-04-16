'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createCommentTaskAiTools } = require('../lib/comment-task-ai');

function buildAiTools(overrides = {}) {
  return createCommentTaskAiTools({
    analysisExtension: (value) => value,
    bestPracticesFor: () => [],
    getCapabilityProfile: () => null,
    ...overrides,
  });
}

test('hasOpenAiConfiguration uses process env directly without shell fallback', () => {
  const calls = [];
  const tools = buildAiTools({
    spawnSync: (...args) => {
      calls.push(args);
      return { stdout: '', status: 0 };
    },
  });

  const result = tools.hasOpenAiConfiguration({
    OPENAI_API_KEY: 'sk-direct',
    SHELL: '/bin/zsh',
  });

  assert.equal(result, true);
  assert.equal(calls.length, 0);
});

test('hasOpenAiConfiguration falls back to login shell and caches the lookup', () => {
  const calls = [];
  const tools = buildAiTools({
    spawnSync: (...args) => {
      calls.push(args);
      return {
        stdout: '__PINGU_ENV_BEGIN__sk-shell__PINGU_ENV_END__',
        status: 0,
      };
    },
  });

  const env = {
    SHELL: '/bin/zsh',
    HOME: '/tmp/pingu-home',
    USER: 'pingu',
  };

  assert.equal(tools.hasOpenAiConfiguration(env), true);
  assert.equal(tools.hasOpenAiConfiguration(env), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/bin/zsh');
  assert.deepEqual(calls[0][1], [
    '-lc',
    'command printf \'__PINGU_ENV_BEGIN__%s__PINGU_ENV_END__\' "$OPENAI_API_KEY"',
  ]);
});
