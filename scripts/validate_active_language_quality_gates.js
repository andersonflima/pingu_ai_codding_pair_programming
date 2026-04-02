#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const { activeLanguageIds } = require('../lib/language-capabilities');
const { qualityGateScriptsByLanguage } = require('./language_validation_manifest');

const QUALITY_GATE_BY_LANGUAGE = Object.freeze(qualityGateScriptsByLanguage());

function buildReport(activeLanguages) {
  const gatedLanguages = activeLanguages.filter((languageId) => Boolean(QUALITY_GATE_BY_LANGUAGE[languageId]));
  const uncoveredLanguages = activeLanguages.filter((languageId) => !QUALITY_GATE_BY_LANGUAGE[languageId]);
  return {
    activeLanguages,
    gatedLanguages,
    uncoveredLanguages,
    mappedGates: gatedLanguages.reduce((accumulator, languageId) => ({
      ...accumulator,
      [languageId]: QUALITY_GATE_BY_LANGUAGE[languageId],
    }), {}),
  };
}

function runQualityGate(scriptName) {
  return spawnSync('npm', ['run', scriptName], {
    stdio: 'inherit',
    env: process.env,
  });
}

function main() {
  const shouldRun = process.argv.includes('--run');
  const activeLanguages = activeLanguageIds();
  const report = buildReport(activeLanguages);

  if (!shouldRun) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      ...report,
    }, null, 2)}\n`);
    return;
  }

  for (const languageId of report.gatedLanguages) {
    const scriptName = QUALITY_GATE_BY_LANGUAGE[languageId];
    const result = runQualityGate(scriptName);
    if (result.status !== 0) {
      process.exitCode = result.status || 1;
      return;
    }
  }
}

main();
