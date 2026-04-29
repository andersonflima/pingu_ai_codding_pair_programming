'use strict';

const assert = require('assert/strict');
const test = require('node:test');
const { createBoundedEntryCache } = require('../lib/lru-cache');

test('bounded entry cache evicts the least recently used entry', () => {
  const cache = createBoundedEntryCache(2);

  cache.set('a', 1);
  cache.set('b', 2);
  assert.equal(cache.get('a'), 1);
  cache.set('c', 3);

  assert.equal(cache.has('a'), true);
  assert.equal(cache.has('b'), false);
  assert.equal(cache.has('c'), true);
  assert.equal(cache.size(), 2);
});
