'use strict';

const {
  LANGUAGE_CAPABILITY_REGISTRY,
  analysisExtension,
  declaredCommentTaskIntentsFor,
  declaredEditorFeaturesFor,
  getCapabilityProfile,
  languageCapabilityRegistry,
  supportsCommentTaskIntent,
} = require('./language-capabilities');

const LANGUAGE_PROFILES = Object.freeze(
  LANGUAGE_CAPABILITY_REGISTRY.map((entry) => ({
    id: entry.id,
    extensions: [...entry.extensions],
    commentPrefix: entry.commentPrefix,
    unitTestStyle: entry.unitTestStyle,
    structured: Boolean(entry.structured),
    offlineCapabilities: [...entry.offlineCapabilities],
    bestPractices: [...entry.bestPractices],
  })),
);

function getLanguageProfile(fileOrExt) {
  const profile = getCapabilityProfile(fileOrExt);
  return LANGUAGE_PROFILES.find((entry) => entry.id === profile.id) || LANGUAGE_PROFILES[LANGUAGE_PROFILES.length - 1];
}

function hasExtension(fileOrExt, extensions) {
  const extension = analysisExtension(fileOrExt);
  return Array.isArray(extensions) && extensions.includes(extension);
}

function isJavaScriptLikeExtension(fileOrExt) {
  return hasExtension(fileOrExt, ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
}

function isReactLikeExtension(fileOrExt) {
  return hasExtension(fileOrExt, ['.jsx', '.tsx']);
}

function isPythonLikeExtension(fileOrExt) {
  return hasExtension(fileOrExt, ['.py']);
}

function isRubyExtension(fileOrExt) {
  return hasExtension(fileOrExt, ['.rb']);
}

function isGoExtension(fileOrExt) {
  return hasExtension(fileOrExt, ['.go']);
}

function isRustExtension(fileOrExt) {
  return hasExtension(fileOrExt, ['.rs']);
}

function isElixirExtension(fileOrExt) {
  return hasExtension(fileOrExt, ['.ex', '.exs']);
}

function isMermaidExtension(fileOrExt) {
  return hasExtension(fileOrExt, ['.mmd', '.mermaid']);
}

function isStructuredTextKind(fileOrExt) {
  return Boolean(getLanguageProfile(fileOrExt).structured);
}

function supportsSlashComments(fileOrExt) {
  return ['javascript', 'go', 'rust', 'c'].includes(getLanguageProfile(fileOrExt).id);
}

function supportsHashComments(fileOrExt) {
  return ['python', 'elixir', 'ruby', 'terraform', 'yaml', 'dockerfile', 'shell', 'toml'].includes(getLanguageProfile(fileOrExt).id);
}

function commentPrefix(fileOrExt) {
  return getLanguageProfile(fileOrExt).commentPrefix || '#';
}

function unitTestStyle(fileOrExt) {
  return getLanguageProfile(fileOrExt).unitTestStyle || 'none';
}

function bestPracticesFor(fileOrExt) {
  return [...(getLanguageProfile(fileOrExt).bestPractices || [])];
}

function offlineCapabilitiesFor(fileOrExt) {
  return [...(getLanguageProfile(fileOrExt).offlineCapabilities || [])];
}

module.exports = {
  LANGUAGE_PROFILES,
  analysisExtension,
  bestPracticesFor,
  commentPrefix,
  declaredCommentTaskIntentsFor,
  declaredEditorFeaturesFor,
  getLanguageProfile,
  isElixirExtension,
  isGoExtension,
  isJavaScriptLikeExtension,
  isMermaidExtension,
  isPythonLikeExtension,
  isReactLikeExtension,
  isRubyExtension,
  isRustExtension,
  isStructuredTextKind,
  languageCapabilityRegistry,
  offlineCapabilitiesFor,
  supportsCommentTaskIntent,
  supportsHashComments,
  supportsSlashComments,
  unitTestStyle,
};
