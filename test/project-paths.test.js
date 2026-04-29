'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const {
  findUpwards,
  resolveProjectRoot,
  toImportPath,
  toPosixPath,
  upwardDepth,
} = require('../lib/project-paths');

function createTempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-project-paths-'));
  fs.mkdirSync(path.join(root, 'src', 'domain'), { recursive: true });
  fs.mkdirSync(path.join(root, 'test'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}\n');
  const sourceFile = path.join(root, 'src', 'domain', 'user.js');
  fs.writeFileSync(sourceFile, 'export const user = {}\n');
  return {
    root,
    sourceFile,
  };
}

test('project path helpers resolve roots and import paths consistently', () => {
  const project = createTempProject();

  assert.equal(resolveProjectRoot(project.sourceFile), project.root);
  assert.equal(findUpwards(path.dirname(project.sourceFile), (currentDir) => fs.existsSync(path.join(currentDir, 'package.json'))), project.root);
  assert.equal(toPosixPath(path.join('src', 'domain', 'user.js')), 'src/domain/user.js');
  assert.equal(toImportPath(path.join('domain', 'user.js')), './domain/user.js');
  assert.equal(upwardDepth(path.join(project.root, 'test'), project.root), 1);
});
