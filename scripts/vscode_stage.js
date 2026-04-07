#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { repoRoot } = require('./vscode_package_meta');

const vscodeStageEntries = [
  'assets',
  'config',
  'lib',
  'LICENSE',
  'README.md',
  'realtime_dev_agent.js',
  'vscode',
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyEntry(relativePath, stageRoot) {
  const sourcePath = path.join(repoRoot, relativePath);
  const targetPath = path.join(stageRoot, relativePath);

  ensureDir(path.dirname(targetPath));
  fs.cpSync(sourcePath, targetPath, {
    force: true,
    recursive: true,
  });
}

function buildStagePackageJson(stageRoot) {
  const sourceManifestPath = path.join(repoRoot, 'package.json');
  const stageManifestPath = path.join(stageRoot, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(sourceManifestPath, 'utf8'));

  manifest.files = vscodeStageEntries.slice();
  delete manifest.scripts;

  fs.writeFileSync(stageManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function createVscodeStageDir() {
  const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-vscode-stage-'));

  for (const relativePath of vscodeStageEntries) {
    copyEntry(relativePath, stageRoot);
  }

  buildStagePackageJson(stageRoot);
  return stageRoot;
}

function removeStageDir(stageRoot) {
  if (!stageRoot || !fs.existsSync(stageRoot)) {
    return;
  }

  fs.rmSync(stageRoot, {
    force: true,
    recursive: true,
  });
}

module.exports = {
  createVscodeStageDir,
  removeStageDir,
};
