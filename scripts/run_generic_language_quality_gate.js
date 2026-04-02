#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');

function readLanguageId() {
  const languageFlagIndex = process.argv.indexOf('--language');
  if (languageFlagIndex < 0 || !process.argv[languageFlagIndex + 1]) {
    throw new Error('Informe --language <id> para executar o quality gate generico.');
  }
  return String(process.argv[languageFlagIndex + 1] || '').trim().toLowerCase();
}

function runNodeScript(scriptFile, args, languageId) {
  return spawnSync('node', [scriptFile, ...args], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PINGU_ACTIVE_LANGUAGE_IDS: languageId,
    },
  });
}

function main() {
  const languageId = readLanguageId();
  const commands = [
    ['scripts/validate_generic_language_matrix.js', ['--language', languageId]],
    ['scripts/validate_generic_language_real_code_checkup.js', ['--language', languageId]],
  ];

  commands.forEach(([scriptFile, args]) => {
    const result = runNodeScript(scriptFile, args, languageId);
    if (result.status !== 0) {
      process.exitCode = result.status || 1;
      throw new Error(`Falha ao validar ${languageId} em ${scriptFile}`);
    }
  });
}

main();
