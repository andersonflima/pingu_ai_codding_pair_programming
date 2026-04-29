'use strict';

const assert = require('assert/strict');
const test = require('node:test');
const {
  dependencySpecKey,
  goDependencySpec,
  inferModuleStyle,
  jsDependencySpec,
  rustDependencySpec,
  uniqueDependencySpecs,
} = require('../lib/dependency-specs');

test('dependency specs normalize module style and dedupe imports', () => {
  assert.equal(inferModuleStyle('.mjs', []), 'esm');
  assert.equal(inferModuleStyle('.cjs', []), 'cjs');
  assert.equal(inferModuleStyle('.js', ['const fs = require("fs")']), 'cjs');
  assert.equal(inferModuleStyle('.js', ['export const value = 1']), 'esm');

  const reactImport = jsDependencySpec('named', 'useState', 'react', 'esm');
  const duplicateReactImport = jsDependencySpec('named', 'useState', 'react', 'esm');
  const goImport = goDependencySpec('context');
  const rustImport = rustDependencySpec('sqlx::PgPool');

  assert.equal(dependencySpecKey(reactImport), 'javascript|named|useState|react|||esm');
  assert.deepEqual(uniqueDependencySpecs([reactImport, duplicateReactImport, goImport, rustImport]), [
    reactImport,
    goImport,
    rustImport,
  ]);
});
