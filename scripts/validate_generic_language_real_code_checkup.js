#!/usr/bin/env node
'use strict';

const { hasLiveOpenAiValidation } = require('./require_real_ai_command');
const { genericValidationSpec } = require('./language_validation_specs');
const { runCheckupValidation } = require('./language_validation_runtime');

function readLanguageId() {
  const languageFlagIndex = process.argv.indexOf('--language');
  if (languageFlagIndex < 0 || !process.argv[languageFlagIndex + 1]) {
    throw new Error('Informe --language <id> para validar o checkup generico.');
  }
  return String(process.argv[languageFlagIndex + 1] || '').trim().toLowerCase();
}

function main() {
  const languageId = readLanguageId();
  const spec = genericValidationSpec(languageId);
  if (!spec) {
    throw new Error(`Linguagem generica nao suportada: ${languageId}`);
  }

  const report = runCheckupValidation(spec, hasLiveOpenAiValidation());
  process.stdout.write(`${JSON.stringify({
    languageId,
    ...report,
  }, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}

main();
