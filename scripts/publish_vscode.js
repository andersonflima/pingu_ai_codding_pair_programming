#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const { createVscodeStageDir, removeStageDir } = require('./vscode_stage');

const marketplaceToken = String(
  process.env.VSCE_PAT || process.env.VISUAL_STUDIO_MARKETPLACE_TOKEN || ''
).trim();

if (!marketplaceToken) {
  console.error(
    'Defina VSCE_PAT ou VISUAL_STUDIO_MARKETPLACE_TOKEN com um Personal Access Token do Marketplace.'
  );
  process.exit(1);
}

const stageRoot = createVscodeStageDir();
const result = spawnSync('npx', ['@vscode/vsce', 'publish', '-p', marketplaceToken], {
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
