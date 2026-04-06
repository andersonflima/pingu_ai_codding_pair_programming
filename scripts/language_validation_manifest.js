#!/usr/bin/env node
'use strict';

const {
  genericValidationLanguageIds,
  genericValidationSpec,
} = require('./language_validation_specs');

const SHARED_EDITOR_SMOKE = 'validate:editors(shared_runtime)';
const SPECIALIZED_VALIDATION_LANGUAGE_IDS = Object.freeze([
  'elixir',
  'javascript',
  'python',
]);
const REPRESENTATIVE_EDITOR_SMOKE_LANGUAGES = Object.freeze([
  ...SPECIALIZED_VALIDATION_LANGUAGE_IDS,
  ...genericValidationLanguageIds(),
]);

function hasRepresentativeEditorSmoke(languageId) {
  return REPRESENTATIVE_EDITOR_SMOKE_LANGUAGES.includes(String(languageId || '').trim().toLowerCase());
}

function buildValidationMetadata({
  languageId,
  matrixCases,
  checkupCases,
  aiOptionalMatrixCases = 0,
  representativeEditorSmoke = false,
}) {
  const offlineCheckupCases = Math.max(0, Number(checkupCases || 0));
  const offlineSignalKinds = offlineCheckupCases >= 3
    ? 'strong'
    : offlineCheckupCases >= 2
      ? 'intermediate'
      : 'basic';
  const maturity = representativeEditorSmoke && offlineCheckupCases >= 2
    ? 'strong'
    : offlineCheckupCases >= 2
      ? 'intermediate'
      : 'basic';
  const stackQuality = {
    maxFalsePositiveRate: representativeEditorSmoke ? 0.12 : 0.18,
    maxRollbackRegressions: 0,
    maxRealtimeLatencyMs: representativeEditorSmoke ? 180 : 220,
    minCheckupCases: representativeEditorSmoke ? Math.max(2, Math.min(offlineCheckupCases, 3)) : Math.max(1, Math.min(offlineCheckupCases, 2)),
    requiresRepresentativeEditorSmoke: representativeEditorSmoke,
  };

  return {
    languageId,
    matrixCases,
    checkupCases,
    offlineCheckupCases,
    aiOptionalMatrixCases,
    representativeEditorSmoke,
    offlineSignalKinds,
    maturity,
    stackQuality,
  };
}

const specializedManifest = Object.freeze({
  javascript: {
    matrix: 'scripts/validate_node_matrix.js',
    checkup: 'scripts/validate_node_real_code_checkup.js',
    qualityGate: 'validate:quality-gate:javascript',
    editorSmoke: SHARED_EDITOR_SMOKE,
    metadata: buildValidationMetadata({
      languageId: 'javascript',
      matrixCases: 3,
      checkupCases: 4,
      aiOptionalMatrixCases: 2,
      representativeEditorSmoke: true,
    }),
  },
  python: {
    matrix: 'scripts/validate_python_matrix.js',
    checkup: 'scripts/validate_python_real_code_checkup.js',
    qualityGate: 'validate:quality-gate:python',
    editorSmoke: SHARED_EDITOR_SMOKE,
    metadata: buildValidationMetadata({
      languageId: 'python',
      matrixCases: 3,
      checkupCases: 5,
      aiOptionalMatrixCases: 2,
      representativeEditorSmoke: true,
    }),
  },
  elixir: {
    matrix: 'scripts/validate_agent_matrix.js',
    checkup: 'scripts/validate_elixir_real_code_checkup.js',
    qualityGate: 'validate:quality-gate:elixir',
    editorSmoke: SHARED_EDITOR_SMOKE,
    metadata: buildValidationMetadata({
      languageId: 'elixir',
      matrixCases: 3,
      checkupCases: 4,
      aiOptionalMatrixCases: 2,
      representativeEditorSmoke: true,
    }),
  },
});

const genericManifest = genericValidationLanguageIds().reduce((accumulator, languageId) => {
  const spec = genericValidationSpec(languageId);
  const representativeEditorSmoke = hasRepresentativeEditorSmoke(languageId);

  return {
    ...accumulator,
    [languageId]: {
      matrix: `scripts/validate_generic_language_matrix.js --language ${languageId}`,
      checkup: `scripts/validate_generic_language_real_code_checkup.js --language ${languageId}`,
      qualityGate: `validate:quality-gate:${languageId}`,
      editorSmoke: SHARED_EDITOR_SMOKE,
      metadata: buildValidationMetadata({
        languageId,
        matrixCases: Array.isArray(spec && spec.matrixCases) ? spec.matrixCases.length : 0,
        checkupCases: Array.isArray(spec && spec.checkupCases) ? spec.checkupCases.length : 0,
        aiOptionalMatrixCases: 2,
        representativeEditorSmoke,
      }),
    },
  };
}, {});

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
  REPRESENTATIVE_EDITOR_SMOKE_LANGUAGES,
  SHARED_EDITOR_SMOKE,
  buildValidationMetadata,
  hasRepresentativeEditorSmoke,
  languageValidationManifest,
  qualityGateScriptsByLanguage,
  validationManifestEntry,
};
