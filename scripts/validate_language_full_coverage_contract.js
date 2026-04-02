#!/usr/bin/env node
'use strict';

const {
  LANGUAGE_CAPABILITY_REGISTRY,
  activeLanguageIds,
} = require('../lib/language-capabilities');
const {
  languageValidationManifest,
  validationManifestEntry,
} = require('./language_validation_manifest');

function buildLanguageCoverageRow(languageId, registryIds) {
  const manifestEntry = validationManifestEntry(languageId);
  const row = {
    languageId,
    registry: registryIds.has(languageId),
    matrix: Boolean(manifestEntry && manifestEntry.matrix),
    checkup: Boolean(manifestEntry && manifestEntry.checkup),
    editorSmoke: Boolean(manifestEntry && manifestEntry.editorSmoke),
    qualityGate: Boolean(manifestEntry && manifestEntry.qualityGate),
  };

  return {
    ...row,
    closed: row.registry && row.matrix && row.checkup && row.editorSmoke && row.qualityGate,
  };
}

function main() {
  const activeIds = activeLanguageIds().sort();
  const registryIds = new Set(
    LANGUAGE_CAPABILITY_REGISTRY
      .map((entry) => entry.id)
      .filter((languageId) => languageId && languageId !== 'default'),
  );
  const manifest = languageValidationManifest();
  const coverage = activeIds.map((languageId) => buildLanguageCoverageRow(languageId, registryIds));
  const uncovered = coverage.filter((entry) => !entry.closed);

  process.stdout.write(`${JSON.stringify({
    ok: uncovered.length === 0,
    activeLanguages: activeIds,
    sharedEditorSmoke: Object.values(manifest)[0] ? Object.values(manifest)[0].editorSmoke : '',
    coverage,
    uncovered,
    ruler: ['registry', 'matrix', 'checkup', 'editorSmoke', 'qualityGate'],
  }, null, 2)}\n`);

  if (uncovered.length > 0) {
    process.exitCode = 1;
  }
}

main();
