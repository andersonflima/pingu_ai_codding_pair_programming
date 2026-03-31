'use strict';

const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const canonicalVsixFileName = 'pingu-dev-agent.vsix';
const legacyVsixFileName = 'realtime-dev-agent.vsix';
const canonicalVsixPath = path.join(repoRoot, canonicalVsixFileName);
const legacyVsixPath = path.join(repoRoot, legacyVsixFileName);

module.exports = {
  repoRoot,
  canonicalVsixFileName,
  legacyVsixFileName,
  canonicalVsixPath,
  legacyVsixPath,
};
