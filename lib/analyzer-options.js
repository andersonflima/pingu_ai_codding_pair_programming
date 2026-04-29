'use strict';

const DEFAULT_FLOW_COMMENT_MAX_LINES = 260;
const DEFAULT_DOCUMENTATION_MAX_LINES = 420;
const DEFAULT_LIGHT_ANALYSIS_DEEP_PASS_MAX_LINES = 260;
const ANALYSIS_MODE_FULL = 'full';
const ANALYSIS_MODE_LIGHT = 'light';

function readBoundedInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || fallback), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed <= 0 ? 0 : parsed;
}

function readFlowCommentMaxLines(env = process.env) {
  return readBoundedInteger(env.PINGU_FLOW_COMMENT_MAX_LINES, DEFAULT_FLOW_COMMENT_MAX_LINES);
}

function shouldAnalyzeFlowComments(lines, env = process.env) {
  const maxLines = readFlowCommentMaxLines(env);
  if (maxLines === 0) {
    return true;
  }
  return Array.isArray(lines) && lines.length <= maxLines;
}

function readDocumentationMaxLines(env = process.env) {
  return readBoundedInteger(env.PINGU_DOCUMENTATION_MAX_LINES, DEFAULT_DOCUMENTATION_MAX_LINES);
}

function shouldAnalyzeDocumentationIssues(lines, env = process.env) {
  const maxLines = readDocumentationMaxLines(env);
  if (maxLines === 0) {
    return true;
  }
  return Array.isArray(lines) && lines.length <= maxLines;
}

function normalizeAnalysisMode(rawMode) {
  const normalized = String(rawMode || '').trim().toLowerCase();
  if (normalized === ANALYSIS_MODE_LIGHT) {
    return ANALYSIS_MODE_LIGHT;
  }
  return ANALYSIS_MODE_FULL;
}

function isLightAnalysisMode(mode) {
  return normalizeAnalysisMode(mode) === ANALYSIS_MODE_LIGHT;
}

function readLightAnalysisDeepPassMaxLines(env = process.env) {
  return readBoundedInteger(env.PINGU_LIGHT_ANALYSIS_DEEP_PASS_MAX_LINES, DEFAULT_LIGHT_ANALYSIS_DEEP_PASS_MAX_LINES);
}

function shouldRunLightAnalysisDeepPass(lines, analysisMode, env = process.env) {
  if (!isLightAnalysisMode(analysisMode)) {
    return true;
  }
  const maxLines = readLightAnalysisDeepPassMaxLines(env);
  if (maxLines === 0) {
    return true;
  }
  return Array.isArray(lines) && lines.length <= maxLines;
}

function normalizeFocusedLineRange(opts = {}, lineCount = 0) {
  const start = Number.parseInt(String(opts.focusStartLine || 0), 10);
  const end = Number.parseInt(String(opts.focusEndLine || 0), 10);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0 || end < start) {
    return null;
  }
  const boundedStart = Math.max(1, Math.min(start, Math.max(1, lineCount)));
  const boundedEnd = Math.max(boundedStart, Math.min(end, Math.max(1, lineCount)));
  return {
    start: boundedStart,
    end: boundedEnd,
  };
}

function isLineInsideFocusRange(focusRange, lineNumber) {
  if (!focusRange) {
    return true;
  }
  const normalizedLine = Number.isFinite(lineNumber) ? lineNumber : Number.parseInt(String(lineNumber || 0), 10);
  return normalizedLine >= focusRange.start && normalizedLine <= focusRange.end;
}

function intersectsFocusRange(focusRange, startLine, endLine = startLine) {
  if (!focusRange) {
    return true;
  }
  const normalizedStart = Number.isFinite(startLine) ? startLine : Number.parseInt(String(startLine || 0), 10);
  const normalizedEnd = Number.isFinite(endLine) ? endLine : Number.parseInt(String(endLine || 0), 10);
  if (!Number.isFinite(normalizedStart) || !Number.isFinite(normalizedEnd)) {
    return false;
  }
  return normalizedEnd >= focusRange.start && normalizedStart <= focusRange.end;
}

function filterIssuesByFocusRange(issues, focusRange) {
  if (!focusRange) {
    return Array.isArray(issues) ? issues : [];
  }
  return (Array.isArray(issues) ? issues : []).filter((issue) =>
    isLineInsideFocusRange(focusRange, Number(issue && issue.line || 0)));
}

module.exports = {
  ANALYSIS_MODE_FULL,
  ANALYSIS_MODE_LIGHT,
  DEFAULT_DOCUMENTATION_MAX_LINES,
  DEFAULT_FLOW_COMMENT_MAX_LINES,
  DEFAULT_LIGHT_ANALYSIS_DEEP_PASS_MAX_LINES,
  filterIssuesByFocusRange,
  intersectsFocusRange,
  isLightAnalysisMode,
  isLineInsideFocusRange,
  normalizeAnalysisMode,
  normalizeFocusedLineRange,
  readDocumentationMaxLines,
  readFlowCommentMaxLines,
  readLightAnalysisDeepPassMaxLines,
  shouldAnalyzeDocumentationIssues,
  shouldAnalyzeFlowComments,
  shouldRunLightAnalysisDeepPass,
};
