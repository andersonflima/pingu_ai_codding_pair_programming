'use strict';

function trimmedLine(value) {
  return String(value || '').trim();
}

function firstNonEmptyLine(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((line) => String(line || ''))
    .find((line) => trimmedLine(line) !== '') || '';
}

function isImportLikeLine(line) {
  const trimmed = trimmedLine(line);
  if (!trimmed) {
    return false;
  }

  return (
    /^import\b/.test(trimmed)
    || /^from\b.+\bimport\b/.test(trimmed)
    || /^use\b/.test(trimmed)
    || /^alias\b/.test(trimmed)
    || /^require(?:_relative)?\b/.test(trimmed)
    || /^#include\b/.test(trimmed)
    || /^const\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*require\(/.test(trimmed)
  );
}

function snippetStartsWithImports(snippetLines) {
  return isImportLikeLine(firstNonEmptyLine(snippetLines));
}

function findPreferredImportBoundary(lines, maxLineIndex) {
  const normalizedLines = Array.isArray(lines) ? lines : [];
  const boundedMax = Math.max(0, Math.min(Number(maxLineIndex || 0), normalizedLines.length - 1));
  let packageLineIndex = -1;
  let shebangLineIndex = trimmedLine(normalizedLines[0] || '').startsWith('#!') ? 0 : -1;
  let importBlockStart = -1;
  let importBlockEnd = -1;
  let insideGoImportBlock = false;

  for (let index = 0; index <= boundedMax; index += 1) {
    const currentLine = String(normalizedLines[index] || '');
    const trimmed = trimmedLine(currentLine);

    if (packageLineIndex < 0 && /^package\b/.test(trimmed)) {
      packageLineIndex = index;
    }

    if (isImportLikeLine(trimmed)) {
      if (importBlockStart < 0) {
        importBlockStart = index;
      }
      importBlockEnd = index;
      if (/^import\s*\($/.test(trimmed)) {
        insideGoImportBlock = true;
      }
      continue;
    }

    if (insideGoImportBlock) {
      if (trimmed === ')' || trimmed === '') {
        importBlockEnd = index;
        if (trimmed === ')') {
          insideGoImportBlock = false;
        }
        continue;
      }
      importBlockEnd = index;
      continue;
    }

    if (importBlockStart >= 0 && trimmed !== '') {
      break;
    }

    if (importBlockStart >= 0 && trimmed === '') {
      importBlockEnd = index;
    }
  }

  if (importBlockEnd >= 0) {
    return importBlockEnd + 1;
  }
  if (packageLineIndex >= 0) {
    return packageLineIndex + 1;
  }
  if (shebangLineIndex >= 0) {
    return shebangLineIndex + 1;
  }
  return 0;
}

function resolvePreferredInsertBeforeLine(lines, defaultLineIndex, snippetLines) {
  const boundedDefault = Math.max(0, Number(defaultLineIndex || 0));
  if (!snippetStartsWithImports(snippetLines)) {
    return boundedDefault;
  }

  const preferredLineIndex = findPreferredImportBoundary(lines, boundedDefault);
  if (preferredLineIndex >= 0 && preferredLineIndex < boundedDefault) {
    return preferredLineIndex;
  }
  return boundedDefault;
}

module.exports = {
  findPreferredImportBoundary,
  isImportLikeLine,
  resolvePreferredInsertBeforeLine,
  snippetStartsWithImports,
};
