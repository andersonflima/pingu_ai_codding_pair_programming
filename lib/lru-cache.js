'use strict';

function createBoundedEntryCache(maxEntries) {
  const values = new Map();
  const order = [];
  const limit = Number.isFinite(maxEntries) && maxEntries > 0 ? maxEntries : 128;

  function touch(key) {
    const index = order.indexOf(key);
    if (index >= 0) {
      order.splice(index, 1);
    }
    order.push(key);
  }

  function prune() {
    while (order.length > limit) {
      const staleKey = order.shift();
      values.delete(staleKey);
    }
  }

  function has(key) {
    return values.has(key);
  }

  function get(key) {
    if (!values.has(key)) {
      return undefined;
    }
    touch(key);
    return values.get(key);
  }

  function set(key, value) {
    values.set(key, value);
    touch(key);
    prune();
    return value;
  }

  function size() {
    return values.size;
  }

  return {
    get,
    has,
    set,
    size,
  };
}

module.exports = {
  createBoundedEntryCache,
};
