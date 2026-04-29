'use strict';

const { analysisExtension } = require('./language-capabilities');

const MAX_SYMBOLS = 80;

function collectSourceSymbols(source, fileOrExt = '') {
  const ext = analysisExtension(fileOrExt);
  const lines = Array.isArray(source)
    ? source.map((line) => String(line || ''))
    : String(source || '').replace(/\r\n/g, '\n').split('\n');

  return lines
    .flatMap((line, index) => collectLineSymbols(line, index + 1, ext))
    .slice(0, MAX_SYMBOLS);
}

function sourceSummary(source, fileOrExt = '') {
  const symbols = collectSourceSymbols(source, fileOrExt);
  const lines = normalizeSourceLines(source);
  return {
    lineCount: lines.length,
    symbols,
    symbolNames: Array.from(new Set(symbols.map((symbol) => symbol.name).filter(Boolean))).sort(),
  };
}

function normalizeSourceLines(source) {
  const lines = Array.isArray(source)
    ? source
    : String(source || '').replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    return lines.slice(0, -1);
  }
  return lines;
}

function hasSourceSymbol(source, fileOrExt, name) {
  const normalizedName = normalizeName(name);
  if (!normalizedName) {
    return false;
  }

  return collectSourceSymbols(source, fileOrExt)
    .some((symbol) => normalizeName(symbol.name) === normalizedName);
}

function collectLineSymbols(line, lineNumber, ext) {
  const text = String(line || '');
  const trimmed = text.trim();
  if (!trimmed || isCommentOnly(trimmed, ext)) {
    return [];
  }

  if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(ext)) {
    return collectJavaScriptSymbols(trimmed, lineNumber);
  }
  if (ext === '.py') {
    return collectRegexSymbols(trimmed, lineNumber, [
      [/^(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/, 'function'],
      [/^class\s+([A-Za-z_][A-Za-z0-9_]*)\b/, 'class'],
    ]);
  }
  if (['.go'].includes(ext)) {
    return collectRegexSymbols(trimmed, lineNumber, [
      [/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/, 'function'],
      [/^type\s+([A-Za-z_][A-Za-z0-9_]*)\b/, 'type'],
    ]);
  }
  if (['.rs'].includes(ext)) {
    return collectRegexSymbols(trimmed, lineNumber, [
      [/^(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\b/, 'function'],
      [/^(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_][A-Za-z0-9_]*)\b/, 'type'],
    ]);
  }
  if (['.rb'].includes(ext)) {
    return collectRegexSymbols(trimmed, lineNumber, [
      [/^def\s+(?:self\.)?([A-Za-z_][A-Za-z0-9_?!]*)\b/, 'function'],
      [/^class\s+([A-Za-z_][A-Za-z0-9_:]*)\b/, 'class'],
      [/^module\s+([A-Za-z_][A-Za-z0-9_:]*)\b/, 'module'],
    ]);
  }
  if (['.ex', '.exs'].includes(ext)) {
    return collectRegexSymbols(trimmed, lineNumber, [
      [/^defmodule\s+([A-Za-z_][A-Za-z0-9_.]*)\b/, 'module'],
      [/^defp?\s+([A-Za-z_][A-Za-z0-9_?!]*)\b/, 'function'],
    ]);
  }
  if (ext === '.lua') {
    return collectRegexSymbols(trimmed, lineNumber, [
      [/^(?:local\s+)?function\s+([A-Za-z_][A-Za-z0-9_:.\-]*)\s*\(/, 'function'],
      [/^local\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*function\s*\(/, 'function'],
    ]);
  }
  if (ext === '.vim') {
    return collectRegexSymbols(trimmed, lineNumber, [
      [/^function!?\s+((?:[gswbtlav]:)?[A-Za-z_#][A-Za-z0-9_:#]*)\s*\(/, 'function'],
    ]);
  }
  if (['.sh', '.bash', '.zsh'].includes(ext)) {
    return collectRegexSymbols(trimmed, lineNumber, [
      [/^([A-Za-z_][A-Za-z0-9_]*)\s*\(\)\s*\{/, 'function'],
      [/^function\s+([A-Za-z_][A-Za-z0-9_]*)\b/, 'function'],
    ]);
  }
  if (['.c', '.cpp', '.h', '.hpp'].includes(ext)) {
    return collectRegexSymbols(trimmed, lineNumber, [
      [/\b(?:struct|enum|class)\s+([A-Za-z_][A-Za-z0-9_]*)\b/, 'type'],
      [/^(?:[A-Za-z_][A-Za-z0-9_:<>\s*&]*\s+)+([A-Za-z_][A-Za-z0-9_]*)\s*\([^;]*\)\s*\{?$/, 'function'],
    ]);
  }

  return [];
}

function collectJavaScriptSymbols(trimmed, lineNumber) {
  return collectRegexSymbols(trimmed, lineNumber, [
    [/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/, 'function'],
    [/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][A-Za-z0-9_$]*\s*=>)/, 'function'],
    [/^(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/, 'class'],
    [/^(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/, 'type'],
    [/^(?:(?:public|private|protected|static|async|get|set|override|readonly|abstract|declare)\s+)*(#?[A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*\{?$/, 'method'],
    [/^(?:(?:public|private|protected|static|readonly|override|abstract|declare)\s+)*(#?[A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)\s*=>|[A-Za-z_$][A-Za-z0-9_$]*\s*=>)/, 'method'],
  ]);
}

function collectRegexSymbols(trimmed, lineNumber, specs) {
  return specs.flatMap(([regex, kind]) => {
    const match = trimmed.match(regex);
    if (!match) {
      return [];
    }
    return [{
      kind,
      name: String(match[1] || '').trim(),
      line: lineNumber,
      signature: trimmed,
    }];
  }).filter((symbol) => symbol.name && !isReservedSymbolName(symbol.name));
}

function isCommentOnly(trimmed, ext) {
  if (ext === '.md') {
    return /^<!--/.test(trimmed);
  }
  return /^(?:\/\/|#|--|"|\/\*|\*|<!--|%%)/.test(trimmed);
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function isReservedSymbolName(value) {
  return new Set([
    'case',
    'catch',
    'do',
    'else',
    'for',
    'if',
    'switch',
    'try',
    'while',
  ]).has(normalizeName(value));
}

module.exports = {
  collectSourceSymbols,
  hasSourceSymbol,
  sourceSummary,
};
