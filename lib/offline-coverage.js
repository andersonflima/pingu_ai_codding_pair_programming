'use strict';

const {
  activeLanguageIds,
  languageCapabilityRegistry,
  requiresAiForFeature,
} = require('./language-capabilities');

const REQUIRED_OFFLINE_FEATURES = Object.freeze([
  'comment_task',
  'context_file',
  'unit_test',
  'terminal_task',
]);

function offlineCoverageReport() {
  const activeIds = new Set(activeLanguageIds());
  const languages = languageCapabilityRegistry()
    .filter((entry) => entry.id !== 'default' && activeIds.has(entry.id))
    .map((entry) => {
      const features = REQUIRED_OFFLINE_FEATURES.map((feature) => {
        const representativeExtension = entry.extensions[0] || '';
        const supported = Array.isArray(entry.editorFeatures) && entry.editorFeatures.includes(feature);
        const requiresAi = supported ? requiresAiForFeature(representativeExtension, feature) : true;
        return {
          feature,
          supported,
          offline: supported && !requiresAi,
        };
      });
      return {
        id: entry.id,
        extensions: entry.extensions,
        offlineCapabilities: entry.offlineCapabilities,
        features,
        ok: features.every((feature) => feature.offline),
      };
    });
  const featureCount = languages.reduce((total, language) => total + language.features.length, 0);
  const offlineFeatureCount = languages.reduce(
    (total, language) => total + language.features.filter((feature) => feature.offline).length,
    0,
  );
  const percent = featureCount > 0
    ? Math.round((offlineFeatureCount / featureCount) * 100)
    : 100;

  return {
    ok: languages.every((language) => language.ok),
    percent,
    featureCount,
    offlineFeatureCount,
    requiredFeatures: [...REQUIRED_OFFLINE_FEATURES],
    languages,
  };
}

module.exports = {
  REQUIRED_OFFLINE_FEATURES,
  offlineCoverageReport,
};
