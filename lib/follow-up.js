'use strict';

const { safeComment } = require('./support');
const { analysisExtension, commentPrefix } = require('./language-profiles');

function normalizeFollowUpText(text) {
  return safeComment(text || '');
}

function normalizedIssueAction(issue) {
  if (issue && issue.action && typeof issue.action === 'object') {
    return issue.action;
  }
  return {};
}

function isBlueprintContextTarget(targetFile) {
  const normalized = String(targetFile || '').replace(/\\/g, '/');
  return normalized.includes('/.realtime-dev-agent/contexts/');
}

function followUpMarker(issue) {
  const action = normalizedIssueAction(issue);
  if (String(action.op || '') === 'run_command') {
    return '*';
  }
  if (String(action.op || '') === 'write_file' && isBlueprintContextTarget(action.target_file)) {
    return '**';
  }
  return ':';
}

function followUpCommentPrefix(file, marker) {
  if (analysisExtension(file) === '.md') {
    return `<!-- ${marker} `;
  }
  return `${commentPrefix(file)} ${marker} `;
}

function extractUndefinedVariableName(message) {
  const match = String(message || '').match(/Variavel '([^']+)' nao declarada/);
  return match ? match[1] : '';
}

function extractUndefinedVariableSuggestion(suggestion) {
  const match = String(suggestion || '').match(/Substitua por '([^']+)'/);
  return match ? match[1] : '';
}

function buildFollowUpInstruction(issue) {
  const message = normalizeFollowUpText(issue && issue.message);
  const suggestion = normalizeFollowUpText(issue && issue.suggestion);
  const kind = String(issue && issue.kind || '');

  if (kind === 'undefined_variable') {
    const unknown = extractUndefinedVariableName(message);
    const replacement = extractUndefinedVariableSuggestion(suggestion);
    if (unknown && replacement) {
      return `substitua ${unknown} por ${replacement}`;
    }
  }

  if (suggestion) {
    return suggestion;
  }

  return message;
}

function buildFollowUpComment(file, issue) {
  const instruction = buildFollowUpInstruction(issue);
  if (!instruction) {
    return '';
  }

  const marker = followUpMarker(issue);
  const prefix = followUpCommentPrefix(file, marker);
  if (analysisExtension(file) === '.md') {
    return `${prefix}${instruction} -->`;
  }
  return `${prefix}${instruction}`;
}

module.exports = {
  buildFollowUpComment,
  buildFollowUpInstruction,
  followUpCommentPrefix,
  followUpMarker,
};
