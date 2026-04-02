#!/usr/bin/env node
'use strict';

const { genericValidationLanguageIds } = require('./language_validation_specs');

const SHARED_EDITOR_SMOKE = 'validate:editors(shared_runtime)';

const specializedManifest = Object.freeze({
  javascript: {
    matrix: 'scripts/validate_node_matrix.js',
    checkup: 'scripts/validate_node_real_code_checkup.js',
    qualityGate: 'validate:quality-gate:javascript',
    editorSmoke: SHARED_EDITOR_SMOKE,
  },
  python: {
    matrix: 'scripts/validate_python_matrix.js',
    checkup: 'scripts/validate_python_real_code_checkup.js',
    qualityGate: 'validate:quality-gate:python',
    editorSmoke: SHARED_EDITOR_SMOKE,
  },
  elixir: {
    matrix: 'scripts/validate_agent_matrix.js',
    checkup: 'scripts/validate_elixir_real_code_checkup.js',
    qualityGate: 'validate:quality-gate:elixir',
    editorSmoke: SHARED_EDITOR_SMOKE,
  },
});

const genericManifest = genericValidationLanguageIds().reduce((accumulator, languageId) => ({
  ...accumulator,
  [languageId]: {
    matrix: `scripts/validate_generic_language_matrix.js --language ${languageId}`,
    checkup: `scripts/validate_generic_language_real_code_checkup.js --language ${languageId}`,
    qualityGate: `validate:quality-gate:${languageId}`,
    editorSmoke: SHARED_EDITOR_SMOKE,
  },
}), {});

const LANGUAGE_VALIDATION_MANIFEST = Object.freeze({
  ...genericManifest,
  ...specializedManifest,
});

function languageValidationManifest() {
  return { ...LANGUAGE_VALIDATION_MANIFEST };
}

function validationManifestEntry(languageId) {
  return LANGUAGE_VALIDATION_MANIFEST[String(languageId || '').trim().toLowerCase()] || null;
}

function qualityGateScriptsByLanguage() {
  return Object.entries(LANGUAGE_VALIDATION_MANIFEST).reduce((accumulator, [languageId, entry]) => ({
    ...accumulator,
    [languageId]: entry.qualityGate,
  }), {});
}

module.exports = {
  SHARED_EDITOR_SMOKE,
  languageValidationManifest,
  qualityGateScriptsByLanguage,
  validationManifestEntry,
};
