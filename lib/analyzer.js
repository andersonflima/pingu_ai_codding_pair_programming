'use strict';

const path = require('path');
const { checkCommentTask, checkUnitTestCoverage, checkMissingDependencies, buildLeadingFunctionDocumentation, isJavaScriptLikeExtension, isPythonLikeExtension, isGoExtension, isRustExtension } = require('./generation');
const {
  isStructuredTextKind: resolveStructuredTextKind,
  supportsSlashComments,
  supportsHashComments,
  isElixirExtension,
} = require('./language-profiles');
const { defaultActionForKind } = require('./issue-kinds');
const { snippetModuledoc, snippetLongLine, snippetDebugOutput, snippetTodoFixme, snippetFunctionDoc, snippetFunctionComment, snippetFunctionSpec, snippetFunctionalReassignment, snippetNestedCondition, snippetTrailingWhitespace, snippetTabs, snippetLargeFile, sanitizeAnalysisLine, sanitizeIdentifier, replaceIdentifierOnce, countBlockDelta, countMatches, isReservedToken, escapeRegExp, buildMaintenanceComment, isCommentLine, removeInlineComment, lineIndentation, stripInlineComment } = require('./support');
const DEFAULT_MAX_LINE_LENGTH = 120;

function analyzeText(filePath, text, opts = {}) {
  const lines = text.split(/\r?\n/);
  const maxLineLength = Number.isFinite(opts.maxLineLength) ? opts.maxLineLength : DEFAULT_MAX_LINE_LENGTH;
  const analyzedFile = filePath || 'stdin';
  const analyzedKind = analysisFileKind(analyzedFile);
  const issues = [];

  if (isStructuredTextKind(analyzedKind)) {
    issues.push(
      ...checkStructuredTextIssues(lines, analyzedFile, analyzedKind, maxLineLength),
    );
  } else {
    issues.push(
      ...checkModuledoc(lines, analyzedFile),
      ...checkLongLines(lines, analyzedFile, maxLineLength),
      ...checkDebugOutputs(lines, analyzedFile),
      ...checkTodoFixme(lines, analyzedFile),
      ...checkCommentTask(lines, analyzedFile),
      ...checkSyntaxIssues(lines, analyzedFile, analyzedKind),
      ...checkUnitTestCoverage(lines, analyzedFile),
      ...checkMissingDependencies(lines, analyzedFile),
      ...checkUndefinedVariables(lines, analyzedFile),
      ...checkFunctionalReassignment(lines, analyzedFile),
      ...checkTrailingWhitespace(lines, analyzedFile),
      ...checkTabs(lines, analyzedFile),
      ...checkFunctionDocs(lines, analyzedFile),
      ...checkCrossLanguageFunctionDocs(lines, analyzedFile),
      ...checkFlowMaintenanceComments(lines, analyzedFile),
      ...checkFunctionSpecs(lines, analyzedFile),
      ...checkNestedConditionDepth(lines, analyzedFile),
      ...checkLargeFile(lines, analyzedFile)
    );
  }

  const sortedIssues = issues
    .map((issue) => ({
      ...issue,
      action: issue.action && typeof issue.action === 'object'
        ? issue.action
        : normalizeAction(issue.kind, issue),
    }))
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

  const dedup = [];
  const seen = new Set();
  for (const issue of sortedIssues) {
    const issueKey = `${issue.file}|${issue.line}|${issue.kind}|${issue.message}`;
    if (seen.has(issueKey)) {
      continue;
    }
    seen.add(issueKey);
    dedup.push(issue);
  }

  return dedup;
}
function normalizeAction(kind, issue) {
  const action = defaultActionForKind(kind);
  if (action && action.op) {
    return action;
  }
  if (issue && issue.snippet && issue.snippet.split('\n').length > 1) {
    return { op: 'insert_before' };
  }
  return { op: 'insert_before' };
}
function severityRank(issue) {
  switch (issue.severity) {
    case 'error':
      return 3;
    case 'warning':
      return 2;
    case 'info':
      return 1;
    default:
      return 0;
  }
}
function checkModuledoc(lines, file) {
  const moduleLine = lines.findIndex((line) => /^\s*defmodule\s+/.test(line));
  if (moduleLine < 0) {
    return [];
  }
  const hasDoc = lines.some((line) => /^\s*@moduledoc\b/.test(line));
  if (hasDoc) {
    return [];
  }
  return [
    {
      file,
      line: moduleLine + 1,
      severity: 'warning',
      kind: 'moduledoc',
      message: 'Modulo sem @moduledoc',
      suggestion: 'Acrescente @moduledoc para explicar o contrato do modulo e facilitar manutencao.',
      snippet: snippetModuledoc(),
    },
  ];
}
function checkLongLines(lines, file, maxLineLength) {
  const issues = [];
  lines.forEach((line, idx) => {
    if (line.length > maxLineLength) {
      issues.push({
        file,
        line: idx + 1,
        severity: 'warning',
        kind: 'long_line',
        message: `Linha com ${line.length} caracteres (limite ${maxLineLength})`,
        suggestion: 'Quebre a linha em passos menores para melhorar leitura e review.',
        snippet: snippetLongLine(line),
      });
    }
  });
  return issues;
}
function checkDebugOutputs(lines, file) {
  const issues = [];
  const pattern = /\b(?:IO\.puts|IO\.inspect|dbg)\b/;
  lines.forEach((line, idx) => {
    if (pattern.test(line)) {
      issues.push({
        file,
        line: idx + 1,
        severity: 'error',
        kind: 'debug_output',
        message: 'Saida de debug detectada',
        suggestion: 'Substitua por Logger.debug/1 para rastreamento controlado em producao.',
        snippet: snippetDebugOutput(line),
      });
    }
  });
  return issues;
}
function checkTodoFixme(lines, file) {
  const issues = [];
  const pattern = /\b(TODO|FIXME)\b/i;
  lines.forEach((line, idx) => {
    if (pattern.test(line)) {
      issues.push({
        file,
        line: idx + 1,
        severity: 'info',
        kind: 'todo_fixme',
        message: 'Marcador TODO/FIXME encontrado',
        suggestion: 'Use um ticket ou comentario estruturado (p.ex. TODO(#id): ) para facilitar rastreamento.',
        snippet: snippetTodoFixme(line),
      });
    }
  });
  return issues;
}
function checkUndefinedVariables(lines, file) {
  const ext = path.extname(file).toLowerCase();
  if (isElixirExtension(ext)) {
    return checkElixirUndefinedVariables(lines, file);
  }
  if (supportsBraceScopedUndefinedVariableAnalysis(ext)) {
    return checkBraceScopedUndefinedVariables(lines, file, ext);
  }
  return [];
}
function checkElixirUndefinedVariables(lines, file) {
  const state = {
    inFunction: false,
    depth: 0,
    vars: new Set(),
    allVars: new Set(),
    warned: new Set(),
  };
  const issues = [];

  lines.forEach((rawLine, idx) => {
    const line = sanitizeAnalysisLine(rawLine);
    if (!line) {
      return;
    }

    if (state.inFunction) {
      checkUndefinedLineInScope(rawLine, line, idx + 1, state, file, issues, '.ex');
    } else {
      const declaration = parseFunctionDeclaration(line);
      if (!declaration || declaration.visibility !== 'def' && declaration.visibility !== 'defp') {
        return;
      }
      const params = declaration.params;
      const depth = countBlockDelta(line);
      if (depth <= 0) {
        return;
      }
      state.inFunction = true;
      state.depth = depth;
      state.vars = new Set(params);
      state.allVars = collectFunctionAllVariables(lines, idx, params);
      state.warned = new Set();
    }
  });

  return issues;
}
function supportsBraceScopedUndefinedVariableAnalysis(ext) {
  const lowerExt = String(ext || '').toLowerCase();
  return isJavaScriptLikeExtension(lowerExt)
    || isGoExtension(lowerExt)
    || isRustExtension(lowerExt)
    || lowerExt === '.c';
}
function checkBraceScopedUndefinedVariables(lines, file, ext) {
  const issues = [];
  let state = null;

  lines.forEach((rawLine, idx) => {
    const line = sanitizeScopedAnalysisLine(rawLine, ext);
    if (!line) {
      if (state) {
        state.depth += countCurlyBlockDelta(rawLine);
        if (state.depth <= 0) {
          state = null;
        }
      }
      return;
    }

    if (!state) {
      const declaration = parseBraceScopedFunctionDeclaration(rawLine, ext);
      if (!declaration) {
        return;
      }
      const depth = countCurlyBlockDelta(rawLine);
      if (depth <= 0) {
        return;
      }
      state = {
        depth,
        vars: new Set(declaration.params),
        allVars: collectBraceScopeAllVariables(lines, idx, declaration.params, ext),
        warned: new Set(),
        ext,
      };
      return;
    }

    checkUndefinedLineInBraceScope(rawLine, line, idx + 1, state, file, issues);
    if (state.depth <= 0) {
      state = null;
    }
  });

  return issues;
}
function sanitizeScopedAnalysisLine(line, ext) {
  return stripInlineComment(String(line || ''), ext)
    .replace(/"(?:\\.|[^"\\])*"/g, '')
    .replace(/'(?:\\.|[^'\\])*'/g, '')
    .replace(/`(?:\\.|[^`\\])*`/g, '')
    .trim();
}
function countCurlyBlockDelta(line) {
  const sanitized = sanitizeScopedAnalysisLine(line, '.js');
  return countMatches(/\{/g, sanitized) - countMatches(/\}/g, sanitized);
}
function parseBraceScopedFunctionDeclaration(line, ext) {
  const source = String(line || '');
  const lowerExt = String(ext || '').toLowerCase();
  let match = null;

  if (isJavaScriptLikeExtension(lowerExt)) {
    match = source.match(/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*\{/);
    if (!match) {
      match = source.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*\{/);
    }
  } else if (isGoExtension(lowerExt)) {
    match = source.match(/^\s*func(?:\s*\([^)]*\))?\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:\([^)]*\)\s*)?(?:[A-Za-z_][A-Za-z0-9_\[\]\*\s]*\s*)?\{/);
  } else if (isRustExtension(lowerExt)) {
    match = source.match(/^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:->\s*[^\\{]+)?\{/);
  } else if (lowerExt === '.c') {
    match = source.match(/^\s*(?:[A-Za-z_][A-Za-z0-9_\s\*]*?\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(([^;{}]*)\)\s*\{/);
  }

  if (!match || !match[1]) {
    return null;
  }

  return {
    name: sanitizeIdentifier(match[1]),
    params: parseBraceScopedParams(match[2] || '', lowerExt),
  };
}
function parseBraceScopedParams(rawParams, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  const normalized = String(rawParams || '').trim();
  if (!normalized || normalized === 'void') {
    return [];
  }

  return normalized
    .split(',')
    .map((token) => String(token || '').trim())
    .filter(Boolean)
    .map((token) => {
      if (isGoExtension(lowerExt)) {
        return sanitizeIdentifier(token.split(/\s+/)[0] || '');
      }
      if (isRustExtension(lowerExt)) {
        return sanitizeIdentifier(token.split(':')[0] || '');
      }
      if (lowerExt === '.c') {
        const compact = token.replace(/\s+/g, ' ').trim();
        const match = compact.match(/([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[[^\]]*\])?$/);
        return sanitizeIdentifier(match ? match[1] : compact);
      }
      return sanitizeIdentifier(token.replace(/=.*/, ''));
    })
    .filter(Boolean);
}
function collectBraceScopeAllVariables(lines, startIdx, params, ext) {
  const result = new Set((params || []).map((param) => sanitizeIdentifier(param)).filter(Boolean));
  let depth = 0;

  for (let idx = startIdx; idx < lines.length; idx += 1) {
    const rawLine = lines[idx];
    const line = sanitizeScopedAnalysisLine(rawLine, ext);
    const delta = countCurlyBlockDelta(rawLine);

    if (idx === startIdx) {
      depth = delta;
      if (depth <= 0) {
        break;
      }
    } else {
      depth += delta;
    }

    if (line) {
      extractScopedAssignmentVars(line, ext).forEach((name) => {
        const normalized = sanitizeIdentifier(name);
        if (normalized) {
          result.add(normalized);
        }
      });
    }

    if (depth <= 0) {
      break;
    }
  }

  return result;
}
function extractScopedAssignmentVars(line, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  const source = String(line || '');
  const names = new Set();

  if (isJavaScriptLikeExtension(lowerExt)) {
    [...source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*/g)].forEach((match) => names.add(match[1]));
    [...source.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?![=<>~])/g)].forEach((match) => names.add(match[1]));
    [...source.matchAll(/\b(?:for|for\s+await)\s*\(\s*(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\b/g)].forEach((match) => names.add(match[1]));
    return Array.from(names);
  }

  if (isGoExtension(lowerExt)) {
    [...source.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*:=/g)].forEach((match) => names.add(match[1]));
    [...source.matchAll(/\bvar\s+([A-Za-z_][A-Za-z0-9_]*)\b/g)].forEach((match) => names.add(match[1]));
    [...source.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?![=<>:])/g)].forEach((match) => names.add(match[1]));
    return Array.from(names);
  }

  if (isRustExtension(lowerExt)) {
    [...source.matchAll(/\blet\s+(?:mut\s+)?([A-Za-z_][A-Za-z0-9_]*)\b/g)].forEach((match) => names.add(match[1]));
    [...source.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?![=<>:])/g)].forEach((match) => names.add(match[1]));
    return Array.from(names);
  }

  if (lowerExt === '.c') {
    [...source.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?![=<>:])/g)].forEach((match) => names.add(match[1]));
    const declarationMatch = source.match(/^\s*(?:const\s+)?(?:unsigned\s+|signed\s+|long\s+|short\s+|struct\s+\w+\s+|enum\s+\w+\s+|[A-Za-z_][A-Za-z0-9_]*\s+)+\**\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:=\s*.+)?;?$/);
    if (declarationMatch && declarationMatch[1]) {
      names.add(declarationMatch[1]);
    }
  }

  return Array.from(names);
}
function checkUndefinedLineInBraceScope(rawLine, line, idx, state, file, issues) {
  const assignments = extractScopedAssignmentVars(line, state.ext);
  const assignmentSet = new Set(assignments);
  const candidates = new Set([...state.vars, ...state.allVars]);
  const unknowns = extractUnknownVariables(line, candidates, assignmentSet, state.ext);

  unknowns.forEach((unknown) => {
    const key = `${idx}|${unknown}`;
    if (state.warned.has(key)) {
      return;
    }
    const suggestion = suggestSimilarIdentifier(unknown, Array.from(candidates));
    if (!suggestion) {
      return;
    }
    if (unsafeUndefinedVariableCorrection(rawLine, unknown, suggestion)) {
      return;
    }
    issues.push({
      file,
      line: idx,
      severity: 'error',
      kind: 'undefined_variable',
      message: `Variavel '${unknown}' nao declarada`,
      suggestion: `Substitua por '${suggestion}' para manter coerencia do escopo atual.`,
      snippet: replaceIdentifierOnce(rawLine, unknown, suggestion),
    });
    state.warned.add(key);
  });

  const knownVars = new Set([...state.vars, ...assignmentSet]);
  knownVars.forEach((name) => {
    state.allVars.add(name);
  });
  state.vars = knownVars;
  state.depth += countCurlyBlockDelta(rawLine);
  if (state.depth <= 0) {
    state.depth = 0;
    state.vars = new Set();
    state.allVars = new Set();
    state.warned = new Set();
  }
}
function checkUndefinedLineInScope(rawLine, line, idx, state, file, issues) {
  const assignments = extractAssignmentVars(line);
  const anonymousParams = extractAnonymousFunctionParams(line);
  const assignmentSet = new Set([...assignments, ...anonymousParams]);
  const candidates = new Set([...state.vars, ...state.allVars, ...anonymousParams]);
  const unknowns = extractUnknownVariables(line, candidates, assignmentSet, '.ex');

  unknowns.forEach((unknown) => {
    const key = `${idx}|${unknown}`;
    if (state.warned.has(key)) {
      return;
    }
    const suggestion = suggestSimilarIdentifier(unknown, Array.from(candidates));
    if (!suggestion) {
      return;
    }
    if (unsafeUndefinedVariableCorrection(rawLine, unknown, suggestion)) {
      return;
    }
    issues.push({
      file,
      line: idx,
      severity: 'error',
      kind: 'undefined_variable',
      message: `Variavel '${unknown}' nao declarada`,
      suggestion: `Substitua por '${suggestion}' para manter coerencia do escopo atual.`,
      snippet: replaceIdentifierOnce(rawLine, unknown, suggestion),
    });
    state.warned.add(key);
  });

  const knownVars = new Set([...state.vars, ...assignmentSet]);
  state.vars = knownVars;
  knownVars.forEach((name) => {
    state.allVars.add(name);
  });
  const delta = countBlockDelta(line);
  state.depth += delta;
  if (state.depth <= 0) {
    state.inFunction = false;
    state.depth = 0;
    state.vars = new Set();
    state.allVars = new Set();
    state.warned = new Set();
  }
}
function collectFunctionAllVariables(lines, startIdx, params = []) {
  const result = new Set();
  for (const param of params) {
    const normalized = sanitizeIdentifier(param);
    if (normalized) {
      result.add(normalized);
    }
  }

  let depth = 0;
  for (let idx = startIdx; idx < lines.length; idx += 1) {
    const rawLine = lines[idx];
    const line = sanitizeAnalysisLine(rawLine);
    const delta = countBlockDelta(rawLine);

    if (idx === startIdx) {
      depth = delta;
      if (depth <= 0) {
        break;
      }
    } else {
      depth += delta;
    }

    if (line) {
      extractAssignmentVars(line).forEach((name) => {
        const normalized = sanitizeIdentifier(name);
        if (normalized) {
          result.add(normalized);
        }
      });
    }

    if (depth <= 0) {
      break;
    }
  }

  return result;
}
function parseFunctionDeclaration(line) {
  const match = line.match(
    /^\s*(defp?)\s+([a-z_][a-zA-Z0-9_?!]*)(?:\s*\(([^)]*)\))?(?:\s+(?:do|,\s*do:\s*).*)?$/i,
  );
  if (!match) {
    return null;
  }
  return {
    visibility: match[1],
    name: sanitizeIdentifier(match[2]),
    params: parseFunctionParams(match[3] || ''),
  };
}
function parseFunctionParams(raw) {
  if (!raw || String(raw).trim() === '') {
    return [];
  }
  return String(raw)
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => extractParamName(token))
    .filter((token) => token.length > 0);
}
function extractFunctionParams(matchData) {
  const rawParams = matchData ? matchData[1] : null;
  if (!rawParams) {
    return [];
  }
  return rawParams
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => extractParamName(token))
    .filter((token) => token.length > 0);
}
function extractParamName(token) {
  const match = token.match(/^\s*([a-z_][a-zA-Z0-9_?!]*)(?:\s*=.*)?\s*$/);
  return match ? match[1] : '';
}
function extractAssignmentVars(line) {
  const matches = [...line.matchAll(/\b([a-z_][a-zA-Z0-9_?!]*)\s*=\s*(?![=<>~])/g)];
  return matches.map((match) => match[1]).filter(Boolean).filter((value, index, arr) => arr.indexOf(value) === index);
}
function extractAnonymousFunctionParams(line) {
  const match = String(line || '').match(/\bfn\s+(.+?)\s*->/);
  if (!match || !match[1]) {
    return [];
  }

  return match[1]
    .split(',')
    .map((token) => String(token || '').trim())
    .map((token) => {
      const paramMatch = token.match(/\b([a-z_][a-zA-Z0-9_?!]*)\b/);
      return paramMatch ? paramMatch[1] : '';
    })
    .filter(Boolean);
}
function extractUnknownVariables(line, vars, assignmentSet, ext) {
  const unknowns = [];
  for (const match of line.matchAll(/\b[a-z_][a-zA-Z0-9_?!]*\b/g)) {
    const token = match[0];
    if (tokenShouldIgnore(token, match.index, line, vars, assignmentSet, ext)) {
      continue;
    }
    if (!unknowns.includes(token)) {
      unknowns.push(token);
    }
  }
  return unknowns;
}
function unsafeUndefinedVariableCorrection(line, unknown, suggestion) {
  const sourceLine = String(line || '');
  if (!sourceLine.trim()) {
    return true;
  }

  if (
    /^\s*@/.test(sourceLine)
    || /^\s*defp?\b/.test(sourceLine)
    || /^\s*defmodule\b/.test(sourceLine)
    || /\bfn\b/.test(sourceLine)
    || /->/.test(sourceLine)
  ) {
    return true;
  }

  const updatedLine = replaceIdentifierOnce(sourceLine, unknown, suggestion);
  if (updatedLine === sourceLine) {
    return true;
  }

  return changesStructuralTokens(sourceLine, updatedLine);
}
function changesStructuralTokens(before, after) {
  return countMatches(/\bfn\b/g, before) !== countMatches(/\bfn\b/g, after)
    || countMatches(/->/g, before) !== countMatches(/->/g, after)
    || countMatches(/\bdo\b/g, before) !== countMatches(/\bdo\b/g, after)
    || countMatches(/\bend\b/g, before) !== countMatches(/\bend\b/g, after)
    || countMatches(/[()]/g, before) !== countMatches(/[()]/g, after)
    || countMatches(/[\[\]]/g, before) !== countMatches(/[\[\]]/g, after)
    || countMatches(/[{}]/g, before) !== countMatches(/[{}]/g, after);
}
function tokenShouldIgnore(token, start, line, vars, assignmentSet, ext) {
  const len = token.length;
  const previousChar = start > 0 ? line[start - 1] : '';
  const nextChar = start + len < line.length ? line[start + len] : '';
  if (
    isReservedTokenForExtension(token, ext)
    || /^[A-Z][A-Za-z0-9_?!]*$/.test(token)
    || nextChar === ':'
    || previousChar === '.'
    || vars.has(token)
    || assignmentSet.has(token)
  ) {
    return true;
  }
  if (tokenIsFunctionCall(line, start, len) || tokenIsMemberOrCapture(line, start, len)) {
    return true;
  }
  return false;
}
function isReservedTokenForExtension(token, ext) {
  const normalized = String(token || '').trim();
  if (!normalized) {
    return true;
  }
  if (isReservedToken(normalized)) {
    return true;
  }

  const lowerExt = String(ext || '').toLowerCase();
  const shared = new Set(['true', 'false', 'null', 'undefined']);
  if (shared.has(normalized)) {
    return true;
  }

  if (isJavaScriptLikeExtension(lowerExt)) {
    return new Set([
      'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default',
      'delete', 'else', 'export', 'extends', 'finally', 'for', 'function', 'if', 'import',
      'in', 'instanceof', 'let', 'new', 'of', 'return', 'super', 'switch', 'this', 'throw',
      'try', 'typeof', 'var', 'void', 'while', 'yield',
    ]).has(normalized);
  }

  if (isGoExtension(lowerExt)) {
    return new Set([
      'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough',
      'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range',
      'return', 'select', 'struct', 'switch', 'type', 'var',
    ]).has(normalized);
  }

  if (isRustExtension(lowerExt)) {
    return new Set([
      'as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'else', 'enum', 'fn',
      'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref',
      'return', 'self', 'Self', 'static', 'struct', 'trait', 'type', 'unsafe', 'use', 'where',
      'while',
    ]).has(normalized);
  }

  if (lowerExt === '.c') {
    return new Set([
      'auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double', 'else',
      'enum', 'extern', 'float', 'for', 'goto', 'if', 'inline', 'int', 'long', 'register',
      'restrict', 'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'typedef',
      'union', 'unsigned', 'void', 'volatile', 'while',
    ]).has(normalized);
  }

  return false;
}
function tokenIsFunctionCall(line, start, len) {
  const tail = line.slice(start + len);
  return tail.trimStart().startsWith('(');
}
function tokenIsMemberOrCapture(line, start, len) {
  const tail = line.slice(start + len);
  return tail.trimStart().startsWith('.');
}
function checkFunctionalReassignment(lines, file) {
  const issues = [];
  const ext = path.extname(file).toLowerCase();
  if (!['.ex', '.exs'].includes(ext)) {
    return issues;
  }

  const isNotCodeLine = /(^\s*$|^\s*#|^\s*\/\/|^\s*--)/;

  lines.forEach((line, idx) => {
    if (isNotCodeLine.test(line)) {
      return;
    }
    const match = line.match(/^\s*([a-z_][a-zA-Z0-9_?!]*)\s*=\s*(.+)$/);
    if (!match) {
      return;
    }

    const variable = match[1];
    const rightSide = match[2];
    if (!variable || rightSide.length === 0) {
      return;
    }
    const hasReference = variable !== 'ok' && new RegExp(`\\b${escapeRegExp(variable)}\\b`).test(rightSide);
    if (!hasReference) {
      return;
    }
    if (rightSide.includes(`&${variable}`) || rightSide.includes(`.${variable}`)) {
      return;
    }

    issues.push({
      file,
      line: idx + 1,
      severity: 'info',
      kind: 'functional_reassignment',
      message: `Reatribuicao de '${variable}' detectada`,
      suggestion: 'Considere fluxo funcional: nova variavel por etapa e nomes imutaveis.',
      snippet: snippetFunctionalReassignment(variable, rightSide.trim()),
    });
  });
  return issues;
}
function checkFunctionDocs(lines, file) {
  if (!isElixirExtension(path.extname(file))) {
    return [];
  }

  const issues = [];
  lines.forEach((line, idx) => {
    const declaration = parseFunctionDeclaration(line);
    if (!declaration || declaration.visibility !== 'def') {
      return;
    }
    const hasDoc = hasFunctionDocAbove(lines, idx);
    if (hasDoc) {
      return;
    }
    issues.push({
      file,
      line: idx + 1,
      severity: 'info',
      kind: 'function_doc',
      message: 'Funcao publica sem @doc',
      suggestion: 'Documente pelo menos funcoes de dominio para reduzir ambiguidade do contrato.',
      snippet: snippetFunctionDoc(
        declaration.name,
        declaration.params,
        inferFunctionDocContext(lines, idx, declaration, path.extname(file)),
      ),
    });
  });
  return issues;
}
function checkCrossLanguageFunctionDocs(lines, file) {
  const ext = path.extname(file).toLowerCase();
  if (['.ex', '.exs', '.jsx', '.tsx'].includes(ext)) {
    return [];
  }

  const issues = [];
  lines.forEach((line, idx) => {
    const declaration = parseCrossLanguageFunctionDeclaration(line, ext);
    if (!declaration) {
      return;
    }
    if (hasCrossLanguageFunctionDocumentation(lines, idx, ext)) {
      return;
    }
    issues.push({
      file,
      line: idx + 1,
      severity: 'info',
      kind: 'function_doc',
      message: 'Funcao sem documentacao',
      suggestion: 'Adicione comentario ou documentacao idiomatica para facilitar manutencao.',
      snippet: buildLeadingFunctionDocumentation(
        declaration.name,
        declaration.params,
        declaration.name,
        ext,
        inferCrossLanguageFunctionDocContext(lines, idx, declaration, ext),
      ),
    });
  });
  return issues;
}
function parseCrossLanguageFunctionDeclaration(line, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  let match = null;
  let returnAnnotation = '';

  if (isJavaScriptLikeExtension(lowerExt)) {
    match = String(line).match(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?::\s*([^{]+))?/);
  } else if (isPythonLikeExtension(lowerExt)) {
    match = String(line).match(/^\s*def\s+([a-z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*(?:->\s*([^:]+))?\s*:/);
  } else if (isGoExtension(lowerExt)) {
    match = String(line).match(/^\s*func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:\(([^)]*)\)|([A-Za-z_][A-Za-z0-9_\[\]\*\.]*))?/);
  } else if (isRustExtension(lowerExt)) {
    match = String(line).match(/^\s*(?:pub\s+)?(?:async\s+)?fn\s+([a-z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*(?:->\s*([^{]+))?/);
  } else if (lowerExt === '.rb') {
    match = String(line).match(/^\s*def\s+([a-z_][a-zA-Z0-9_?!]*)(?:\(([^)]*)\))?/);
  } else if (lowerExt === '.vim') {
    match = String(line).match(/^\s*function!?\s+((?:[gswbtlav]:)?[A-Za-z_#][A-Za-z0-9_:#]*)\s*\(([^)]*)\)/);
  } else if (lowerExt === '.lua') {
    match = String(line).match(/^\s*(?:local\s+)?function\s+([a-z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)/);
  }

  if (!match || !match[1]) {
    return null;
  }

  if (isJavaScriptLikeExtension(lowerExt) || isPythonLikeExtension(lowerExt) || isRustExtension(lowerExt)) {
    returnAnnotation = String(match[3] || '').trim();
  } else if (isGoExtension(lowerExt)) {
    returnAnnotation = String(match[3] || match[4] || '').trim();
  }

  const paramDescriptors = parseGenericParamDescriptors(match[2] || '', lowerExt);

  return {
    name: sanitizeIdentifier(match[1]),
    params: paramDescriptors.map((descriptor) => descriptor.name).filter(Boolean),
    paramDescriptors,
    returnAnnotation,
  };
}
function parseGenericParamDescriptors(raw, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  return String(raw || '')
    .split(',')
    .map((token) => String(token).trim())
    .filter(Boolean)
    .map((token) => {
      if (isGoExtension(lowerExt)) {
        const parts = token.split(/\s+/).filter(Boolean);
        return {
          name: sanitizeIdentifier(parts[0] || ''),
          annotation: parts.slice(1).join(' '),
        };
      }
      if (isRustExtension(lowerExt)) {
        const [name, annotation] = token.split(':');
        return {
          name: sanitizeIdentifier(name || ''),
          annotation: String(annotation || '').trim(),
        };
      }
      if (isPythonLikeExtension(lowerExt)) {
        const withoutDefault = token.replace(/=.*/, '').trim();
        const [name, annotation] = withoutDefault.split(':');
        return {
          name: sanitizeIdentifier(name || ''),
          annotation: String(annotation || '').trim(),
        };
      }
      if (isJavaScriptLikeExtension(lowerExt)) {
        const withoutDefault = token.replace(/=.*/, '').trim();
        const [name, annotation] = withoutDefault.split(':');
        return {
          name: sanitizeIdentifier(name || ''),
          annotation: String(annotation || '').trim(),
        };
      }
      return {
        name: sanitizeIdentifier(token),
        annotation: '',
      };
    })
    .filter((descriptor) => descriptor.name);
}
function parseGenericFunctionParams(raw, ext) {
  return String(raw || '')
    .split(',')
    .map((token) => String(token).trim())
    .filter(Boolean)
    .map((token) => {
      if (isGoExtension(ext)) {
        return sanitizeIdentifier(token.split(/\s+/)[0] || '');
      }
      if (isRustExtension(ext)) {
        return sanitizeIdentifier(token.split(':')[0] || '');
      }
      if (isPythonLikeExtension(ext)) {
        return sanitizeIdentifier(token.replace(/=.*/, ''));
      }
      return sanitizeIdentifier(token);
    })
    .filter(Boolean);
}
function inferCrossLanguageFunctionDocContext(lines, startIdx, declaration, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  const bodyLines = collectCrossLanguageFunctionBodyLines(lines, startIdx, ext);
  return {
    paramDescriptors: declaration.paramDescriptors || [],
    returnAnnotation: declaration.returnAnnotation || '',
    returnExpression: inferCrossLanguageReturnExpression(bodyLines, lowerExt),
    bodyLines,
  };
}
function collectCrossLanguageFunctionBodyLines(lines, startIdx, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  if (isPythonLikeExtension(lowerExt)) {
    const declarationLine = String(lines[startIdx] || '');
    const baseIndent = (declarationLine.match(/^\s*/) || [''])[0].length;
    const bodyLines = [];
    for (let index = startIdx + 1; index < lines.length; index += 1) {
      const currentLine = String(lines[index] || '');
      const trimmed = currentLine.trim();
      if (!trimmed) {
        bodyLines.push(currentLine);
        continue;
      }
      const currentIndent = (currentLine.match(/^\s*/) || [''])[0].length;
      if (currentIndent <= baseIndent) {
        break;
      }
      bodyLines.push(currentLine);
    }
    return bodyLines;
  }

  if (isJavaScriptLikeExtension(lowerExt) || isGoExtension(lowerExt) || isRustExtension(lowerExt)) {
    const bodyLines = [];
    let depth = countMatches(/\{/g, String(lines[startIdx] || '')) - countMatches(/\}/g, String(lines[startIdx] || ''));
    for (let index = startIdx + 1; index < lines.length && depth > 0; index += 1) {
      const currentLine = String(lines[index] || '');
      bodyLines.push(currentLine);
      depth += countMatches(/\{/g, currentLine) - countMatches(/\}/g, currentLine);
    }
    return bodyLines;
  }

  return [];
}
function inferCrossLanguageReturnExpression(bodyLines, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  const returnLine = Array.isArray(bodyLines)
    ? bodyLines.find((line) => {
      const normalized = String(line || '').trim();
      if (!normalized) {
        return false;
      }
      if (isPythonLikeExtension(lowerExt)) {
        return /^return\b/.test(normalized);
      }
      return /\breturn\b/.test(normalized);
    })
    : '';
  if (!returnLine) {
    return '';
  }

  if (isPythonLikeExtension(lowerExt)) {
    const match = String(returnLine).match(/^\s*return\s+(.+?)\s*$/);
    return match && match[1] ? match[1].trim() : '';
  }

  const match = String(returnLine).match(/\breturn\s+([^;]+);?/);
  return match && match[1] ? match[1].trim() : '';
}
function hasCrossLanguageFunctionDocumentation(lines, idx, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  if (isPythonLikeExtension(lowerExt) && hasPythonFunctionDocstring(lines, idx)) {
    return true;
  }

  for (let cursor = idx - 1; cursor >= 0; cursor -= 1) {
    const line = String(lines[cursor] || '');
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (/^(?:\/\/|#|--|")\s*:/.test(trimmed)) {
      continue;
    }
    if (
      trimmed.startsWith('/**')
      || trimmed.startsWith('*')
      || trimmed.startsWith('*/')
      || trimmed.startsWith('///')
      || trimmed.startsWith('//')
      || trimmed.startsWith('#')
      || trimmed.startsWith('--')
      || trimmed.startsWith('"')
    ) {
      return true;
    }
    break;
  }

  return false;
}
function hasPythonFunctionDocstring(lines, idx) {
  for (let cursor = idx + 1; cursor < lines.length; cursor += 1) {
    const trimmed = String(lines[cursor] || '').trim();
    if (!trimmed) {
      continue;
    }
    if (/^("""|''')/.test(trimmed)) {
      return true;
    }
    break;
  }
  return false;
}
function checkFlowMaintenanceComments(lines, file) {
  const ext = path.extname(file).toLowerCase();
  const issues = [];

  lines.forEach((line, idx) => {
    const snippet = buildMaintenanceComment(line, ext, lines.slice(idx + 1, idx + 4));
    if (!snippet) {
      return;
    }
    if (hasLeadingFlowComment(lines, idx, ext)) {
      return;
    }
    issues.push({
      file,
      line: idx + 1,
      severity: 'info',
      kind: 'flow_comment',
      message: 'Trecho sem comentario de manutencao',
      suggestion: 'Adicione comentario curto explicando a intencao deste passo antes de editar o corpo.',
      snippet,
    });
  });

  return issues;
}
function hasLeadingFlowComment(lines, idx, ext) {
  for (let cursor = idx - 1; cursor >= 0; cursor -= 1) {
    const currentLine = String(lines[cursor] || '');
    const trimmed = currentLine.trim();
    if (!trimmed) {
      continue;
    }
    if (/^(?:\/\/|#|--|")\s*:/.test(trimmed)) {
      return false;
    }
    return isCommentLine(currentLine, ext);
  }
  return false;
}
function checkFunctionMaintenanceComments(lines, file) {
  const issues = [];
  lines.forEach((line, idx) => {
    const declaration = parseFunctionDeclaration(line);
    if (!declaration) {
      return;
    }
    if (declaration.visibility === 'def' && hasFunctionDocAbove(lines, idx)) {
      return;
    }
    if (hasFunctionCommentAbove(lines, idx)) {
      return;
    }
    issues.push({
      file,
      line: idx + 1,
      severity: 'info',
      kind: 'function_comment',
      message: 'Funcao sem comentario de manutencao',
      suggestion: 'Descreva responsabilidade, entradas e saida esperada dessa funcao.',
      snippet: snippetFunctionComment(declaration.name, declaration.params),
    });
  });
  return issues;
}
function hasFunctionCommentAbove(lines, idx) {
  for (let i = idx - 1; i >= 0; i -= 1) {
    if (isFunctionDeclarationLine(lines[i])) {
      return false;
    }
    const current = String(lines[i]).trim();
    if (!current) {
      continue;
    }
    if (/^\s*#\s*/.test(lines[i]) || /^\s*@doc\b/.test(lines[i]) || /^\s*@moduledoc\b/.test(lines[i])) {
      return true;
    }
    return false;
  }
  return false;
}
function checkFunctionSpecs(lines, file) {
  const ext = path.extname(file);
  if (!isElixirExtension(ext)) {
    return [];
  }

  const issues = [];
  const seen = new Set();
  lines.forEach((line, idx) => {
    const declaration = parseFunctionDeclaration(line);
    if (!declaration || declaration.visibility !== 'def') {
      return;
    }
    if (hasFunctionSpecAbove(lines, idx, declaration.name)) {
      return;
    }

    const key = `${declaration.name}:${idx + 1}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    issues.push({
      file,
      line: idx + 1,
      severity: 'info',
      kind: 'function_spec',
      message: `Especificacao @spec ausente para ${declaration.name}`,
      suggestion: 'Declare @spec para contrato da funcao e facilitar validação de dominio.',
      snippet: snippetFunctionSpec(
        declaration.name,
        declaration.params,
        ext,
        inferFunctionSpecContext(lines, idx, declaration, ext),
      ),
    });
  });
  return issues;
}
function hasFunctionSpecAbove(lines, idx, functionName) {
  const safeName = escapeRegExp(sanitizeIdentifier(functionName));
  if (!safeName) {
    return false;
  }
  const pattern = new RegExp(`^\\s*@spec\\s+${safeName}\\b`);
  for (let i = idx - 1; i >= 0; i -= 1) {
    if (isFunctionDeclarationLine(lines[i])) {
      return false;
    }
    const current = String(lines[i]).trim();
    if (!current) {
      continue;
    }
    if (pattern.test(current)) {
      return true;
    }
    if (/^(?:\s*@doc\b|\s*@moduledoc\b|\s*@spec\b|\s*#)/.test(lines[i])) {
      continue;
    }
    return false;
  }
  return false;
}
function collectFunctionBodyLines(lines, startIdx) {
  const declarationLine = String(lines[startIdx] || '');
  const inlineMatch = declarationLine.match(/\bdo:\s*(.+)$/);
  if (inlineMatch && inlineMatch[1]) {
    return [inlineMatch[1]];
  }

  const bodyLines = [];
  let depth = countBlockDelta(declarationLine);
  if (depth <= 0) {
    return bodyLines;
  }

  for (let index = startIdx + 1; index < lines.length && depth > 0; index += 1) {
    const line = String(lines[index] || '');
    const trimmed = line.trim();
    const delta = countBlockDelta(line);
    const closesCurrentBlock = depth === 1 && delta < 0 && /^end\b/.test(trimmed);
    if (!closesCurrentBlock) {
      bodyLines.push(line);
    }
    depth += delta;
  }

  return bodyLines;
}
function lastMeaningfulBodyLine(bodyLines) {
  for (let index = bodyLines.length - 1; index >= 0; index -= 1) {
    const trimmed = String(bodyLines[index] || '').trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    return trimmed;
  }
  return '';
}
function inferFunctionSpecContext(lines, startIdx, declaration, ext) {
  if (!['.ex', '.exs'].includes(String(ext || '').toLowerCase())) {
    return {};
  }

  const bodyLines = collectFunctionBodyLines(lines, startIdx);
  const bodyText = bodyLines.join('\n');
  return {
    returnType: inferElixirReturnType(bodyText, bodyLines),
    paramTypes: inferElixirParamTypes(bodyText, declaration.params),
  };
}
function inferElixirParamTypes(bodyText, params) {
  const safeParams = Array.isArray(params) ? params : [];
  return safeParams.map((param) => {
    const safeParam = escapeRegExp(String(param || ''));
    if (!safeParam) {
      return 'any()';
    }
    if (new RegExp(`\\b${safeParam}\\b\\s*\\.\\.|\\.\\.\\s*\\b${safeParam}\\b`).test(bodyText)) {
      return 'integer()';
    }
    return 'any()';
  });
}
function inferElixirReturnType(bodyText, bodyLines) {
  const lastLine = lastMeaningfulBodyLine(bodyLines);

  const diceMatch = bodyText.match(/\bEnum\.random\(\s*1\s*\.\.\s*(\d+)\s*\)/);
  if (diceMatch) {
    return 'integer()';
  }
  if (/\bEnum\.map\(/.test(bodyText) || /^\s*\[.*\]\s*$/.test(lastLine)) {
    return 'list(any())';
  }
  if (/^\s*(true|false)\s*$/.test(lastLine)) {
    return 'boolean()';
  }
  if (/^\s*".*"\s*$/.test(lastLine)) {
    return 'String.t()';
  }
  if (/^\s*%{/.test(lastLine)) {
    return 'map()';
  }
  if (/^\s*\{:ok,/.test(lastLine) || /^\s*\{:error,/.test(lastLine)) {
    return '{:ok, any()} | {:error, any()}';
  }
  if (/^\s*\d+\s*$/.test(lastLine)) {
    return 'integer()';
  }
  return 'any()';
}
function inferFunctionDocContext(lines, startIdx, declaration, ext) {
  if (!['.ex', '.exs'].includes(String(ext || '').toLowerCase())) {
    return {};
  }

  const bodyLines = collectFunctionBodyLines(lines, startIdx);
  const bodyText = bodyLines.join('\n');
  const diceMatch = bodyText.match(/\bEnum\.random\(\s*1\s*\.\.\s*(\d+)\s*\)/);
  if (diceMatch) {
    return {
      summary: `Retorna um valor aleatorio entre 1 e ${diceMatch[1]} simulando a rolagem de um dado.`,
      action: 'Gera um valor aleatorio dentro do intervalo configurado para a rolagem.',
      returnDescription: `Retorna um numero inteiro entre 1 e ${diceMatch[1]}.`,
    };
  }

  if (/\bEnum\.map\(/.test(bodyText)) {
    return {
      summary: `Transforma os dados de entrada aplicando a regra principal de ${declaration.name}.`,
      action: 'Percorre a colecao e aplica a transformacao definida para cada elemento.',
      returnDescription: 'Retorna uma lista com os resultados transformados.',
    };
  }

  return {};
}
function hasFunctionDocAbove(lines, idx) {
  for (let i = idx - 1; i >= 0; i -= 1) {
    if (isFunctionDeclarationLine(lines[i])) {
      return false;
    }
    const current = String(lines[i]).trim();
    if (!current) {
      continue;
    }
    if (/^\s*@doc\b/.test(lines[i]) || /^\s*@moduledoc\b/.test(lines[i])) {
      return true;
    }
    return false;
  }
  return false;
}
function isFunctionDeclarationLine(line) {
  const cleaned = String(line || '').trim();
  if (!cleaned) {
    return false;
  }
  return Boolean(parseFunctionDeclaration(line)) || /^defmodule\s+/.test(cleaned) || /^def(?:\b|p\b)/.test(cleaned);
}
function checkNestedConditionDepth(lines, file) {
  const openers = /\b(if|cond|case|with|for|unless)\b/g;
  const closer = /^\s*end\b/;
  let depth = 0;
  let maxDepth = 0;
  const byLine = {};
  lines.forEach((line, idx) => {
    const clean = removeInlineComment(line);
    const opens = countMatches(openers, clean);
    const ends = closer.test(clean) ? 1 : 0;
    const newDepth = depth + opens;
    if (newDepth > maxDepth) {
      maxDepth = newDepth;
    }
    byLine[idx + 1] = newDepth;
    depth = Math.max(newDepth - ends, 0);
  });
  if (maxDepth <= 4) {
    return [];
  }
  const deepLine = Object.entries(byLine).find(([, depthByLine]) => depthByLine === maxDepth);
  return [{
    file,
    line: Number(deepLine ? deepLine[0] : 1),
    severity: 'warning',
    kind: 'nested_condition',
    message: `Aninhamento alto de controle (profundidade ${maxDepth})`,
    suggestion: 'Quebre logica complexa em funcoes pequenas e funcoes auxiliares com nomes de dominio.',
    snippet: snippetNestedCondition(),
  }];
}
function checkTrailingWhitespace(lines, file) {
  const issues = [];
  lines.forEach((line, idx) => {
    if (line.trimEnd() !== line) {
      issues.push({
        file,
        line: idx + 1,
        severity: 'info',
        kind: 'trailing_whitespace',
        message: 'Espaco em branco no final da linha',
        suggestion: 'Remova espaco para reduzir ruido em diff e conflitos em revisoes.',
        snippet: snippetTrailingWhitespace(line),
      });
    }
  });
  return issues;
}
function checkTabs(lines, file) {
  const issues = [];
  lines.forEach((line, idx) => {
    if (line.includes('\t')) {
      issues.push({
        file,
        line: idx + 1,
        severity: 'warning',
        kind: 'tabs',
        message: 'Caracter de tab encontrado',
        suggestion: 'Use somente espacos para manter layout consistente com o formatter.',
        snippet: snippetTabs(line),
      });
    }
  });
  return issues;
}
function checkLargeFile(lines, file) {
  if (lines.length > 300) {
    return [{
      file,
      line: 1,
      severity: 'warning',
      kind: 'large_file',
      message: `Arquivo com ${lines.length} linhas`,
      suggestion: 'Considere separar responsabilidades em modulos menores.',
      snippet: snippetLargeFile(),
    }];
  }
  return [];
}
function suggestSimilarIdentifier(undefinedName, candidates) {
  const normalized = String(undefinedName).trim();
  const normalizedLen = normalized.length;
  const unknown = normalized.toLowerCase();
  const maxDistance = normalizedLen <= 4 ? 2 : normalizedLen <= 7 ? 3 : 4;
  const candidateScores = candidates
    .filter(Boolean)
    .filter((candidate, index, arr) => arr.indexOf(candidate) === index)
    .map((candidate) => {
      const normalizedCandidate = candidate.toLowerCase();
      const distance = levenshteinDistance(unknown, normalizedCandidate);
      const collapsedUnknown = collapseRepeatedChars(unknown);
      const collapsedCandidate = collapseRepeatedChars(normalizedCandidate);
      const collapsedDistance = levenshteinDistance(collapsedUnknown, collapsedCandidate);
      const isSubseq = isSubsequence(normalizedCandidate, unknown) || isSubsequence(unknown, normalizedCandidate);
      const firstCharBonus = !normalizedCandidate || unknown[0] !== normalizedCandidate[0] ? 1 : 0;
      const lengthDelta = Math.abs(normalizedCandidate.length - normalizedLen);
      const isRelevant = distance <= maxDistance || collapsedDistance <= 1 || isSubseq;
      return { candidate, distance, collapsedDistance, firstCharBonus, lengthDelta, isSubseq, isRelevant };
    })
    .filter((entry) => entry.isRelevant && entry.distance > 0);

  const strictCandidates = candidateScores.filter((entry) => entry.firstCharBonus === 0);
  const bestPool = strictCandidates.length > 0 ? strictCandidates : candidateScores;
  const finalPool = bestPool.filter((entry) => entry.lengthDelta <= 3);
  const subseqPool = bestPool.filter((entry) => entry.isSubseq && entry.lengthDelta > 3);
  if (subseqPool.length === 0 && finalPool.length === 0) {
    const firstCharMatch = bestPool.filter((entry) => !entry.firstCharBonus && entry.lengthDelta <= 8);
    if (firstCharMatch.length === 1) {
      return firstCharMatch[0].candidate;
    }
    if (firstCharMatch.length > 1) {
      firstCharMatch.sort((a, b) => a.lengthDelta - b.lengthDelta);
      return firstCharMatch[0].candidate;
    }
  }
  if (subseqPool.length > 0) {
    subseqPool.sort((a, b) => a.lengthDelta - b.lengthDelta);
    return subseqPool[0].candidate;
  }
  if (finalPool.length === 0) {
    return null;
  }
  finalPool.sort((a, b) => {
    const scoreA = (a.distance * 10) + (a.collapsedDistance * 4) + (a.firstCharBonus * 2) + (a.lengthDelta * 2) + (a.isSubseq ? 0 : 3);
    const scoreB = (b.distance * 10) + (b.collapsedDistance * 4) + (b.firstCharBonus * 2) + (b.lengthDelta * 2) + (b.isSubseq ? 0 : 3);
    return scoreA - scoreB;
  });
  return finalPool[0].candidate;
}
function levenshteinDistance(a, b) {
  const aRunes = [...a];
  const bRunes = [...b];
  let previous = Array.from({ length: bRunes.length + 1 }, (_, idx) => idx);
  let current = [];
  for (let i = 0; i < aRunes.length; i += 1) {
    current = [i + 1];
    for (let j = 0; j < bRunes.length; j += 1) {
      const insertion = current[j] + 1;
      const deletion = previous[j + 1] + 1;
      const substitution = previous[j] + (aRunes[i] === bRunes[j] ? 0 : 1);
      current.push(Math.min(insertion, deletion, substitution));
    }
    previous = current;
  }
  return previous[previous.length - 1];
}
function collapseRepeatedChars(value) {
  const chars = String(value || '').toLowerCase();
  if (!chars) {
    return '';
  }
  return chars.split('').filter((char, index, list) => index === 0 || char !== list[index - 1]).join('');
}
function isSubsequence(target, source) {
  if (target.length === 0) {
    return true;
  }
  if (target.length > source.length) {
    return false;
  }
  let i = 0;
  let j = 0;
  while (i < source.length && j < target.length) {
    if (source[i] === target[j]) {
      j += 1;
    }
    i += 1;
  }
  return j === target.length;
}

function analysisFileKind(file) {
  const source = String(file || '');
  const base = path.basename(source).toLowerCase();
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) {
    return '.dockerfile';
  }
  return path.extname(source).toLowerCase();
}
function isStructuredTextKind(kind) {
  return resolveStructuredTextKind(kind);
}
function checkStructuredTextIssues(lines, file, kind, maxLineLength) {
  const issues = [];
  if (kind !== '.md') {
    issues.push(...checkLongLines(lines, file, maxLineLength));
  }
  issues.push(
    ...checkTodoFixme(lines, file),
    ...checkCommentTask(lines, file),
    ...checkSyntaxIssues(lines, file, kind),
    ...checkUnitTestCoverage(lines, file),
    ...checkTrailingWhitespace(lines, file),
    ...checkTabs(lines, file),
  );
  if (kind === '.md') {
    issues.push(...checkMarkdownTitle(lines, file));
  }
  if (kind === '.tf') {
    issues.push(...checkTerraformRequiredVersion(lines, file));
  }
  if (kind === '.dockerfile') {
    issues.push(...checkDockerfileWorkdir(lines, file));
  }
  return issues;
}
function checkMarkdownTitle(lines, file) {
  const firstNonEmpty = lines.findIndex((line) => String(line || '').trim().length > 0);
  if (firstNonEmpty < 0) {
    return [];
  }
  if (/^#\s+\S/.test(String(lines[firstNonEmpty] || '').trim())) {
    return [];
  }
  return [
    {
      file,
      line: firstNonEmpty + 1,
      severity: 'info',
      kind: 'markdown_title',
      message: 'Documento Markdown sem titulo principal',
      suggestion: 'Adicione um H1 para explicitar o objetivo do documento.',
      snippet: '# Titulo do documento',
    },
  ];
}
function checkTerraformRequiredVersion(lines, file) {
  const terraformLine = lines.findIndex((line) => /^\s*terraform\s*{/.test(String(line || '')));
  const hasRequiredVersion = lines.some((line) => /required_version\s*=/.test(String(line || '')));
  const hasTerraformContent = lines.some((line) => /^\s*(resource|data|module|provider|variable|output|locals)\b/.test(String(line || '')));
  if (!hasTerraformContent || hasRequiredVersion) {
    return [];
  }
  if (terraformLine >= 0) {
    return [
      {
        file,
        line: terraformLine + 1,
        severity: 'info',
        kind: 'terraform_required_version',
        message: 'Bloco Terraform sem required_version',
        suggestion: 'Declare a versao minima do Terraform para reduzir drift entre ambientes.',
        snippet: '  required_version = ">= 1.5.0"',
        action: { op: 'insert_after', dedupeLookahead: 6 },
      },
    ];
  }
  return [
    {
      file,
      line: 1,
      severity: 'info',
      kind: 'terraform_required_version',
      message: 'Arquivo Terraform sem bloco de versao declarada',
      suggestion: 'Defina required_version para estabilizar o comportamento entre ambientes.',
      snippet: ['terraform {', '  required_version = ">= 1.5.0"', '}'].join('\n'),
    },
  ];
}
function checkDockerfileWorkdir(lines, file) {
  const fromLine = lines.findIndex((line) => /^\s*FROM\b/i.test(String(line || '')));
  const hasWorkdir = lines.some((line) => /^\s*WORKDIR\b/i.test(String(line || '')));
  if (fromLine < 0 || hasWorkdir) {
    return [];
  }
  return [
    {
      file,
      line: fromLine + 1,
      severity: 'info',
      kind: 'dockerfile_workdir',
      message: 'Dockerfile sem WORKDIR explicito',
      suggestion: 'Defina WORKDIR para estabilizar o contexto de copia e execucao.',
      snippet: 'WORKDIR /app',
      action: { op: 'insert_after', dedupeLookahead: 6 },
    },
  ];
}
function checkSyntaxIssues(lines, file, kind) {
  const syntaxScan = scanSyntaxStructure(lines, kind);
  return [
    ...checkMarkdownFenceIssues(lines, file, kind),
    ...syntaxScan.issues.map((issue) => ({ ...issue, file })),
    ...checkMissingCommaIssues(lines, file, kind, syntaxScan.collectionContexts),
  ];
}
function checkMarkdownFenceIssues(lines, file, kind) {
  if (kind !== '.md') {
    return [];
  }

  let openFence = null;
  lines.forEach((line, index) => {
    const trimmed = String(line || '').trim();
    const match = trimmed.match(/^(```+|~~~+)(.*)$/);
    if (!match) {
      return;
    }
    if (!openFence) {
      openFence = { marker: match[1], line: index + 1 };
      return;
    }
    if (match[1][0] === openFence.marker[0] && match[1].length >= openFence.marker.length) {
      openFence = null;
    }
  });

  if (!openFence) {
    return [];
  }

  return [
    {
      file,
      line: lines.length > 0 ? lines.length : 1,
      severity: 'error',
      kind: 'syntax_missing_delimiter',
      message: 'Bloco Markdown sem fence de fechamento',
      suggestion: `Feche o bloco com ${openFence.marker} para restaurar a estrutura do documento.`,
      snippet: openFence.marker,
      action: { op: 'insert_after', dedupeLookbehind: 4, dedupeLookahead: 4 },
    },
  ];
}
function scanSyntaxStructure(lines, kind) {
  const issues = [];
  const stack = [];
  const collectionContexts = [];
  let inBlockComment = false;
  let tripleQuote = '';
  let tripleQuoteLine = 0;
  const quoteIssuesByLine = new Set();
  const extraDelimiterIssuesByLine = new Set();
  lines.forEach((rawLine, index) => {
    const line = String(rawLine || '');
    let activeCollection = '';
    for (let stackIndex = stack.length - 1; stackIndex >= 0; stackIndex -= 1) {
      const candidate = stack[stackIndex];
      if (candidate.context === 'array' || candidate.context === 'object') {
        activeCollection = candidate.context;
        break;
      }
    }
    collectionContexts[index] = activeCollection;

    let inQuote = '';
    for (let cursor = 0; cursor < line.length; cursor += 1) {
      const current = line[cursor];
      const next = line[cursor + 1] || '';
      const prev = cursor > 0 ? line[cursor - 1] : '';

      if (tripleQuote) {
        if (line.slice(cursor, cursor + 3) === tripleQuote) {
          tripleQuote = '';
          cursor += 2;
        }
        continue;
      }

      if (inBlockComment) {
        if (current === '*' && next === '/') {
          inBlockComment = false;
          cursor += 1;
        }
        continue;
      }

      if (inQuote) {
        if (current === '\\') {
          cursor += 1;
          continue;
        }
        if (current === inQuote && prev !== '\\') {
          inQuote = '';
        }
        continue;
      }

      if ((isPythonLikeExtension(kind) || isElixirExtension(kind)) && (line.slice(cursor, cursor + 3) === '"""' || line.slice(cursor, cursor + 3) === "'''")) {
        tripleQuote = line.slice(cursor, cursor + 3);
        tripleQuoteLine = index + 1;
        cursor += 2;
        continue;
      }

      if (supportsSlashComments(kind) && current === '/' && next === '*') {
        inBlockComment = true;
        cursor += 1;
        continue;
      }
      if (startsInlineComment(line, cursor, kind)) {
        break;
      }

      if (current === '"' || current === '\'') {
        inQuote = current;
        continue;
      }

      if (isOpeningDelimiter(current)) {
        stack.push({
          char: current,
          line: index + 1,
          col: cursor + 1,
          indent: lineIndentation(line),
          context: inferDelimiterContext(line, cursor, kind, current),
        });
        continue;
      }

      if (isClosingDelimiter(current)) {
        if (stack.length > 0 && matchingDelimiter(stack[stack.length - 1].char) === current) {
          stack.pop();
          continue;
        }

        if (!extraDelimiterIssuesByLine.has(index + 1)) {
          issues.push({
            line: index + 1,
            severity: 'error',
            kind: 'syntax_extra_delimiter',
            message: `Delimitador '${current}' sem abertura correspondente`,
            suggestion: `Remova '${current}' para reequilibrar a estrutura do arquivo.`,
            snippet: line.slice(0, cursor) + line.slice(cursor + 1),
            action: { op: 'replace_line' },
          });
          extraDelimiterIssuesByLine.add(index + 1);
        }
      }
    }

    if (inQuote && !quoteIssuesByLine.has(index + 1) && shouldAutoCloseQuote(line, kind)) {
      issues.push({
        line: index + 1,
        severity: 'error',
        kind: 'syntax_missing_quote',
        message: `Aspa '${inQuote}' sem fechamento`,
        suggestion: `Feche a aspa '${inQuote}' para restaurar a sintaxe da linha.`,
        snippet: line + inQuote,
        action: { op: 'replace_line' },
      });
      quoteIssuesByLine.add(index + 1);
    }
  });

  if (tripleQuote) {
    issues.push({
      line: lines.length > 0 ? lines.length : tripleQuoteLine || 1,
      severity: 'error',
      kind: 'syntax_missing_delimiter',
      message: `String multilinha ${tripleQuote} sem fechamento`,
      suggestion: `Feche a string com ${tripleQuote} para restaurar a estrutura do arquivo.`,
      snippet: tripleQuote,
      action: { op: 'insert_after', dedupeLookbehind: 4, dedupeLookahead: 4 },
    });
  }

  if (stack.length > 0) {
    const snippet = stack.slice().reverse().map((entry) => `${entry.indent}${matchingDelimiter(entry.char)}`).join('\n');
    const pending = stack.slice().reverse().map((entry) => matchingDelimiter(entry.char)).join(' ');
    issues.push({
      line: lines.length > 0 ? lines.length : 1,
      severity: 'error',
      kind: 'syntax_missing_delimiter',
      message: `Delimitadores pendentes sem fechamento: ${pending}`,
      suggestion: 'Feche os delimitadores abertos para restaurar a estrutura do arquivo.',
      snippet,
      action: { op: 'insert_after', dedupeLookbehind: 4, dedupeLookahead: 4 },
    });
  }

  return { issues, collectionContexts };
}
function checkMissingCommaIssues(lines, file, kind, collectionContexts) {
  if (!supportsAutomaticCommaFix(kind)) {
    return [];
  }

  const issues = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const context = collectionContexts[index];
    if (context !== 'object' && context !== 'array') {
      continue;
    }

    const currentLine = String(lines[index] || '');
    const currentTrimmed = syntaxRelevantLine(currentLine, kind).trim();
    if (!currentTrimmed || currentTrimmed.endsWith(',')) {
      continue;
    }
    if (/[([{,:\\]$/.test(currentTrimmed) || /(?:=>|->)$/.test(currentTrimmed)) {
      continue;
    }

    const nextCandidate = findNextSyntaxLine(lines, index + 1, kind);
    if (!nextCandidate) {
      continue;
    }

    const nextTrimmed = nextCandidate.trimmed;
    if (!nextTrimmed || /^[\]\})]/.test(nextTrimmed)) {
      continue;
    }

    if (context === 'object') {
      if (!looksLikeObjectEntry(currentTrimmed, kind) || !looksLikeObjectEntry(nextTrimmed, kind)) {
        continue;
      }
    } else if (!looksLikeArrayEntry(currentTrimmed) || !looksLikeArrayEntry(nextTrimmed)) {
      continue;
    }

    issues.push({
      file,
      line: index + 1,
      severity: 'error',
      kind: 'syntax_missing_comma',
      message: 'Virgula ausente entre itens consecutivos',
      suggestion: 'Adicione virgula ao fim da linha para separar os itens corretamente.',
      snippet: `${currentLine},`,
      action: { op: 'replace_line' },
    });
  }

  return issues;
}
function supportsAutomaticCommaFix(kind) {
  return ['.js', '.jsx', '.ts', '.tsx', '.lua', '.py', '.rb', '.rs'].includes(kind);
}
function syntaxRelevantLine(line, kind) {
  return String(stripInlineComment(String(line || ''), kind) || '');
}
function findNextSyntaxLine(lines, startIndex, kind) {
  for (let index = startIndex; index < lines.length; index += 1) {
    const trimmed = syntaxRelevantLine(lines[index], kind).trim();
    if (trimmed) {
      return { index, trimmed };
    }
  }
  return null;
}
function looksLikeObjectEntry(trimmed, kind) {
  if (kind === '.lua') {
    return /^(?:[A-Za-z_][A-Za-z0-9_]*\s*=|\[[^\]]+\]\s*=).+/.test(trimmed);
  }
  return /^(?:[A-Za-z_$][A-Za-z0-9_$-]*|["'][^"']+["']|\[[^\]]+\])\s*:\s*.+$/.test(trimmed);
}
function looksLikeArrayEntry(trimmed) {
  return /^(?:["'{\[]|[+-]?\d|true\b|false\b|null\b|nil\b|[A-Za-z_$][A-Za-z0-9_$.]*(?:\([^)]*\))?)/.test(trimmed);
}
function shouldAutoCloseQuote(line, kind) {
  if (kind === '.md') {
    return false;
  }
  return !String(line || '').trimEnd().endsWith('\\');
}
function startsInlineComment(line, cursor, kind) {
  const current = line[cursor];
  const next = line[cursor + 1] || '';
  const prev = cursor > 0 ? line[cursor - 1] : '';

  if (supportsSlashComments(kind)) {
    return current === '/' && next === '/';
  }
  if (supportsHashComments(kind) || kind === '.tf') {
    return current === '#';
  }
  if (kind === '.lua') {
    return current === '-' && next === '-';
  }
  if (kind === '.vim') {
    return current === '"' && (cursor === 0 || /\s/.test(prev));
  }
  if (kind === '.md') {
    return line.slice(cursor, cursor + 4) === '<!--';
  }
  return false;
}
function isOpeningDelimiter(char) {
  return char === '(' || char === '[' || char === '{';
}
function isClosingDelimiter(char) {
  return char === ')' || char === ']' || char === '}';
}
function matchingDelimiter(char) {
  return {
    '(': ')',
    '[': ']',
    '{': '}',
  }[char] || '';
}
function inferDelimiterContext(line, cursor, kind, delimiter) {
  if (delimiter === '[') {
    return 'array';
  }
  if (delimiter === '(') {
    return 'paren';
  }
  if (delimiter !== '{') {
    return 'block';
  }

  if (['.tf', '.yaml', '.yml'].includes(kind)) {
    return 'object';
  }

  const prefix = String(line || '').slice(0, cursor).trimEnd();
  if (!prefix) {
    return 'object';
  }
  if (/\b(?:if|for|while|switch|catch|else|try|finally|do|fn|function|class|struct|enum|impl)\b[^{]*$/.test(prefix)) {
    return 'block';
  }
  if (/(?:=|:|=>|\(|\[|,|\breturn|\bcase)\s*$/.test(prefix)) {
    return 'object';
  }
  if (/\)\s*$/.test(prefix)) {
    return 'block';
  }
  return 'object';
}
module.exports = {
  analyzeText,
};
