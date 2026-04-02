#!/usr/bin/env node
'use strict';

const path = require('path');
const { hasLiveOpenAiValidation } = require('./require_real_ai_command');
const {
  activeLanguageIds,
  getCapabilityProfile,
  languageCapabilityRegistry,
  requiresAiForFeature,
} = require('../lib/language-capabilities');
const { genericValidationSpec } = require('./language_validation_specs');
const { runMatrixValidation } = require('./language_validation_runtime');

function readLanguageId() {
  const languageFlagIndex = process.argv.indexOf('--language');
  if (languageFlagIndex < 0 || !process.argv[languageFlagIndex + 1]) {
    throw new Error('Informe --language <id> para validar a matriz generica.');
  }
  return String(process.argv[languageFlagIndex + 1] || '').trim().toLowerCase();
}

function validateCapabilityRegistry(spec, repoRoot) {
  const registry = languageCapabilityRegistry();
  const failures = [];
  const activeIds = activeLanguageIds().sort();
  const expectedActiveIds = [spec.id];
  const expectedRegistryIds = ['default', spec.id].sort();

  if (activeIds.join(',') !== expectedActiveIds.join(',')) {
    failures.push(`activeLanguageIds esperado=${expectedActiveIds.join(',')} atual=${activeIds.join(',') || 'vazio'}`);
  }

  const ids = registry.map((entry) => entry.id).sort();
  if (ids.join(',') !== expectedRegistryIds.join(',')) {
    failures.push(`registry ids esperados=${expectedRegistryIds.join(',')} atuais=${ids.join(',')}`);
  }

  const profile = getCapabilityProfile(path.join(repoRoot, spec.registrySampleFile));
  ['comment_task', 'context_file', 'unit_test', 'terminal_task'].forEach((feature) => {
    if (!profile.editorFeatures.includes(feature)) {
      failures.push(`feature ${feature} ausente no profile ${spec.id}`);
    }
  });

  ['comment_task', 'context_file', 'unit_test'].forEach((feature) => {
    if (!requiresAiForFeature(path.join(repoRoot, spec.registrySampleFile), feature)) {
      failures.push(`requiresAiForFeature deveria ser true para ${feature} em ${spec.id}`);
    }
  });

  return {
    ok: failures.length === 0,
    total: registry.length,
    failures,
  };
}

function main() {
  const languageId = readLanguageId();
  const spec = genericValidationSpec(languageId);
  if (!spec) {
    throw new Error(`Linguagem generica nao suportada: ${languageId}`);
  }

  const repoRoot = path.resolve(__dirname, '..');
  const realAiAvailable = hasLiveOpenAiValidation();
  const matrix = runMatrixValidation(spec, realAiAvailable);
  const registry = validateCapabilityRegistry(spec, repoRoot);

  if (matrix.ok && registry.ok) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      languageId,
      matrixTotal: matrix.totalCases,
      matrixSkipped: matrix.skippedCases,
      registryTotal: registry.total,
      realAiAvailable,
      activeLanguageIds: activeLanguageIds().sort(),
    })}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify({
    ok: false,
    languageId,
    matrix,
    registry,
  }, null, 2)}\n`);
  process.exitCode = 1;
}

main();
