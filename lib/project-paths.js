'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_MARKERS = Object.freeze([
  '.git',
  'package.json',
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'requirements.txt',
  'Pipfile',
  'mix.exs',
  'go.mod',
  'Cargo.toml',
  'Gemfile',
  'CMakeLists.txt',
  'Makefile',
  'makefile',
  'GNUmakefile',
]);

const SOURCE_DIRS = Object.freeze(['src', 'app', 'lib', 'pkg', 'internal', 'lua', 'autoload', 'scripts']);
const TEST_DIRS = Object.freeze(['test', 'tests']);

function pathExists(targetPath) {
  try {
    fs.accessSync(targetPath);
    return true;
  } catch (_error) {
    return false;
  }
}

function safeReadDir(targetPath) {
  try {
    return fs.readdirSync(targetPath);
  } catch (_error) {
    return [];
  }
}

function hasStrongProjectMarker(currentDir, markers = PROJECT_MARKERS) {
  return Array.isArray(markers) && markers.some((marker) => pathExists(path.join(currentDir, marker)));
}

function isLikelyProjectLayoutRoot(currentDir) {
  const sourceDirs = new Set(SOURCE_DIRS);
  const testDirs = new Set(TEST_DIRS);
  const baseName = path.basename(currentDir);
  const childNames = safeReadDir(currentDir);
  const hasSourceChild = childNames.some((name) => sourceDirs.has(name));
  const hasTestChild = childNames.some((name) => testDirs.has(name));
  const isNestedSourceDir = sourceDirs.has(baseName);
  const isNestedTestDir = testDirs.has(baseName);

  if (isNestedTestDir) {
    return false;
  }
  if (hasSourceChild && hasTestChild) {
    return true;
  }
  if (isNestedSourceDir && hasTestChild) {
    return true;
  }
  return !isNestedSourceDir && (hasSourceChild || hasTestChild);
}

function resolveProjectRoot(file) {
  const startDir = path.dirname(path.resolve(String(file || '.')));
  let currentDir = path.resolve(startDir);

  while (true) {
    if (hasStrongProjectMarker(currentDir)) {
      return currentDir;
    }
    if (isLikelyProjectLayoutRoot(currentDir)) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return startDir;
    }
    currentDir = parentDir;
  }
}

function findUpwards(startDir, matcher) {
  let currentDir = path.resolve(startDir);
  while (true) {
    if (matcher(currentDir)) {
      return currentDir;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return '';
    }
    currentDir = parentDir;
  }
}

function upwardDepth(fromDir, toDir) {
  const relative = path.relative(path.resolve(fromDir), path.resolve(toDir));
  if (!relative) {
    return 0;
  }

  return relative.split(path.sep).filter(Boolean).length;
}

function toImportPath(relativePath) {
  const normalized = toPosixPath(relativePath);
  if (!normalized) {
    return './';
  }
  if (normalized.startsWith('.')) {
    return normalized;
  }

  return `./${normalized}`;
}

function toPosixPath(value) {
  return String(value || '').split(path.sep).join('/');
}

module.exports = {
  PROJECT_MARKERS,
  findUpwards,
  hasStrongProjectMarker,
  isLikelyProjectLayoutRoot,
  pathExists,
  resolveProjectRoot,
  safeReadDir,
  toImportPath,
  toPosixPath,
  upwardDepth,
};
