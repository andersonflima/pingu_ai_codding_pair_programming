'use strict';

function normalizeActionCommentMarker(rawMarker) {
  const marker = String(rawMarker || '').trim();
  if (marker === '::') {
    return ':';
  }
  if (marker === ':::') {
    return '**';
  }
  return marker;
}

function resolveActionCommentFeature(marker) {
  const normalizedMarker = normalizeActionCommentMarker(marker);
  if (normalizedMarker === '**') {
    return 'context_file';
  }
  if (normalizedMarker === '*') {
    return 'terminal_task';
  }
  return 'comment_task';
}

function resolveActionCommentRole(marker) {
  const normalizedMarker = normalizeActionCommentMarker(marker);
  if (normalizedMarker === '**') {
    return 'context_blueprint';
  }
  if (normalizedMarker === '*') {
    return 'terminal_action';
  }
  return 'code_generation';
}

function buildBufferFocusWindow(lines = [], lineIndex = -1, radius = 6) {
  const safeLines = Array.isArray(lines) ? lines : [];
  const safeLineIndex = Number.isInteger(lineIndex) ? lineIndex : -1;
  if (safeLineIndex < 0 || safeLineIndex >= safeLines.length) {
    return {
      startLine: 0,
      endLine: 0,
      lines: [],
    };
  }

  const safeRadius = Math.max(0, Number.parseInt(String(radius || 0), 10) || 0);
  const startIndex = Math.max(0, safeLineIndex - safeRadius);
  const endIndex = Math.min(safeLines.length, safeLineIndex + safeRadius + 1);

  return {
    startLine: startIndex + 1,
    endLine: endIndex,
    lines: safeLines.slice(startIndex, endIndex).map((text, index) => ({
      line: startIndex + index + 1,
      text: String(text || ''),
    })),
  };
}

function buildActionCommentContext(options = {}) {
  const lines = Array.isArray(options.lines) ? options.lines : [];
  const lineIndex = Number.isInteger(options.lineIndex) ? options.lineIndex : -1;
  const rawMarker = String(options.rawMarker || options.marker || '').trim();
  const marker = normalizeActionCommentMarker(rawMarker);
  const focusWindow = buildBufferFocusWindow(lines, lineIndex, Number.parseInt(String(options.radius || 6), 10) || 6);

  return {
    rawMarker,
    marker,
    feature: resolveActionCommentFeature(marker),
    role: resolveActionCommentRole(marker),
    instruction: String(options.instruction || '').trim(),
    triggerLine: lineIndex >= 0 ? lineIndex + 1 : 0,
    triggerText: lineIndex >= 0 && lineIndex < lines.length ? String(lines[lineIndex] || '') : '',
    focusWindow,
  };
}

module.exports = {
  buildActionCommentContext,
  buildBufferFocusWindow,
  normalizeActionCommentMarker,
  resolveActionCommentFeature,
  resolveActionCommentRole,
};
