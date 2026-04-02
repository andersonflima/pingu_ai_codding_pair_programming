#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const { activeLanguageIds } = require('../lib/language-capabilities');

const QUALITY_GATE_BY_LANGUAGE = Object.freeze({
  elixir: 'validate:quality-gate:elixir',
  javascript: 'validate:quality-gate:javascript',
  python: 'validate:quality-gate:python',
});

function buildReport(activeLanguages) {
  const missingLanguages = activeLanguages.filter((languageId) => !QUALITY_GATE_BY_LANGUAGE[languageId]);
  return {
    activeLanguages,
    missingLanguages,
    mappedGates: activeLanguages.reduce((accumulator, languageId) => ({
      ...accumulator,
      [languageId]: QUALITY_GATE_BY_LANGUAGE[languageId] || null,
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

  if (report.missingLanguages.length > 0) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      ...report,
    }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  if (!shouldRun) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      ...report,
    }, null, 2)}\n`);
    return;
  }

  for (const languageId of activeLanguages) {
    const scriptName = QUALITY_GATE_BY_LANGUAGE[languageId];
    const result = runQualityGate(scriptName);
    if (result.status !== 0) {
      process.exitCode = result.status || 1;
      return;
    }
  }
}

main();
