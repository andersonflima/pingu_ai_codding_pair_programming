'use strict';

const taxonomy = require('../config/developer-error-taxonomy.json');

function developerErrorFamilies() {
  return (Array.isArray(taxonomy.families) ? taxonomy.families : []).map((family) => ({
    ...family,
    mappedIssueKinds: Array.isArray(family.mappedIssueKinds) ? [...family.mappedIssueKinds] : [],
    languages: Array.isArray(family.languages) ? [...family.languages] : [],
  }));
}

function developerErrorKinds() {
  return Array.from(new Set(developerErrorFamilies().flatMap((family) => family.mappedIssueKinds))).sort();
}

function developerErrorFamiliesForLanguage(languageId) {
  const normalizedLanguage = String(languageId || '').trim().toLowerCase();
  return developerErrorFamilies().filter((family) => family.languages.includes(normalizedLanguage));
}

module.exports = {
  developerErrorFamilies,
  developerErrorFamiliesForLanguage,
  developerErrorKinds,
};
