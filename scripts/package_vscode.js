#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');
const {
  canonicalVsixFileName,
  canonicalVsixPath,
  legacyVsixFileName,
  legacyVsixPath,
} = require('./vscode_package_meta');
const { createVscodeStageDir, removeStageDir } = require('./vscode_stage');

function removeIfExists(filePath) {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
}

removeIfExists(canonicalVsixPath);
removeIfExists(legacyVsixPath);

const stageRoot = createVscodeStageDir();
const result = spawnSync('npx', ['@vscode/vsce', 'package', '--out', canonicalVsixPath], {
  cwd: stageRoot,
  encoding: 'utf8',
});

if (result.stdout) {
  process.stdout.write(result.stdout);
}

if (result.stderr) {
  process.stderr.write(result.stderr);
}

removeStageDir(stageRoot);

if (result.status !== 0) {
  process.exit(result.status || 1);
}

if (!fs.existsSync(canonicalVsixPath)) {
  console.error(`VSIX nao gerada em ${canonicalVsixPath}`);
  process.exit(1);
}

if (fs.existsSync(legacyVsixPath)) {
  removeIfExists(legacyVsixPath);
  console.error(`Arquivo legado ${legacyVsixFileName} nao deve ser recriado.`);
  process.exit(1);
}
