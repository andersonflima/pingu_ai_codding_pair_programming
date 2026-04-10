'use strict';

const { analysisExtension } = require('./language-capabilities');

function createGenerationOutputValidator() {
  function readSnippet(generatedTask) {
    if (!generatedTask) {
      return '';
    }
    if (typeof generatedTask === 'string') {
      return generatedTask.trim();
    }
    return String(generatedTask.snippet || '').trim();
  }

  function hasPlaceholderTokens(snippet) {
    const text = String(snippet || '').toLowerCase();
    return /\b(lorem ipsum|your code here|replace me|fill me|fixme)\b/.test(text);
  }

  function hasFunctionLikeShape(snippet, ext) {
    const extension = analysisExtension(ext);
    const text = String(snippet || '');

    if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(extension)) {
      return /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/m.test(text)
        || /^\s*(?:export\s+)?(?:const|let|var)\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/m.test(text)
        || /^\s*(?:(?:public|private|protected|readonly|static|abstract|override)\s+)*[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/m.test(text)
        || /^\s*(?:(?:public|private|protected|readonly|static|abstract|override)\s+)*(?:async\s+)?(?:(?:get|set)\s+)?[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)\s*\{/m.test(text)
        || /\bclass\s+[A-Za-z_][A-Za-z0-9_]*/.test(text);
    }
    if (extension === '.py') {
      return /^\s*(?:async\s+)?(?:def|class)\s+[A-Za-z_][A-Za-z0-9_]*\b/m.test(text);
    }
    if (['.ex', '.exs'].includes(extension)) {
      return /^\s*(?:defp?|defmodule)\s+[A-Za-z_][A-Za-z0-9_?!]*\b/m.test(text);
    }
    if (extension === '.go') {
      return /^\s*func\s+(?:\([^)]*\)\s+)?[A-Za-z_][A-Za-z0-9_]*\s*\(/m.test(text)
        || /^\s*type\s+[A-Za-z_][A-Za-z0-9_]*\b/m.test(text);
    }
    if (extension === '.rs') {
      return /^\s*(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?fn\s+[A-Za-z_][A-Za-z0-9_]*\b/m.test(text)
        || /^\s*pub\s+struct\s+[A-Za-z_][A-Za-z0-9_]*\b/m.test(text);
    }
    if (extension === '.rb') {
      return /^\s*(?:def\s+(?:self\.)?|class\s+)[A-Za-z_][A-Za-z0-9_?!]*\b/m.test(text);
    }
    if (extension === '.lua') {
      return /^\s*(local\s+function|function)\s+[A-Za-z_][A-Za-z0-9_:.\-]*\s*\(/m.test(text);
    }
    if (extension === '.vim') {
      return /^\s*function!?\s+(?:[gswbtlav]:)?[A-Za-z_#][A-Za-z0-9_:#]*\s*\(/m.test(text);
    }
    if (['.sh', '.bash', '.zsh'].includes(extension)) {
      return /^\s*[A-Za-z_][A-Za-z0-9_]*\s*\(\)\s*\{/m.test(text);
    }
    if (['.c', '.cpp', '.h', '.hpp'].includes(extension)) {
      return /\btypedef\s+(?:struct|enum)\b|[A-Za-z_][A-Za-z0-9_\s\*]+\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)\s*\{/.test(text);
    }
    return text.length > 0;
  }

  function hasTestLikeShape(snippet, ext) {
    const extension = analysisExtension(ext);
    const text = String(snippet || '');

    if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(extension)) {
      return /\b(test|it)\s*\(/.test(text);
    }
    if (extension === '.py') {
      return /^\s*def\s+test_[A-Za-z_][A-Za-z0-9_]*\s*\(/m.test(text);
    }
    if (['.ex', '.exs'].includes(extension)) {
      return /^\s*test\s+["'][^"']+["']\s+do/m.test(text);
    }
    if (extension === '.go') {
      return /^\s*func\s+Test[A-Za-z0-9_]*\s*\(/m.test(text);
    }
    if (extension === '.rs') {
      return /#\[test\]/.test(text) && /^\s*fn\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/m.test(text);
    }
    if (extension === '.rb') {
      return /^\s*def\s+test_[A-Za-z_][A-Za-z0-9_]*\b/m.test(text);
    }
    if (extension === '.lua') {
      return /^\s*local\s+function\s+test_[A-Za-z_][A-Za-z0-9_]*\s*\(/m.test(text);
    }
    if (extension === '.vim') {
      return /^\s*function!?\s+Test_[A-Za-z_][A-Za-z0-9_]*\s*\(/m.test(text);
    }
    if (['.sh', '.bash', '.zsh'].includes(extension)) {
      return /^\s*test_[A-Za-z_][A-Za-z0-9_]*\s*\(\)\s*\{/m.test(text);
    }
    if (['.c', '.cpp', '.h', '.hpp'].includes(extension)) {
      return /\btest_[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(text);
    }
    return text.length > 0;
  }

  function hasStructuredIdentity(snippet, semanticIntent) {
    const expectedName = semanticIntent
      && semanticIntent.hints
      && semanticIntent.hints.requestedSymbolName
      ? String(semanticIntent.hints.requestedSymbolName).trim()
      : '';
    if (!expectedName) {
      return String(snippet || '').trim().length > 0;
    }
    return new RegExp(`\\b${escapeRegExp(expectedName)}\\b`, 'i').test(String(snippet || ''));
  }

  function validateGeneratedTaskResult(options = {}) {
    const snippet = readSnippet(options.generatedTask);
    const ext = options.ext || '';
    const semanticIntent = options.semanticIntent || null;
    const strict = Boolean(options.strict);
    const reasons = [];

    if (!snippet) {
      reasons.push('empty_snippet');
    }

    if (strict && hasPlaceholderTokens(snippet) && (!semanticIntent || semanticIntent.kind !== 'comment')) {
      reasons.push('placeholder_content');
    }

    if (strict && semanticIntent && semanticIntent.kind === 'function' && !hasFunctionLikeShape(snippet, ext)) {
      reasons.push('missing_function_shape');
    }

    if (strict && semanticIntent && semanticIntent.kind === 'test' && !hasTestLikeShape(snippet, ext)) {
      reasons.push('missing_test_shape');
    }

    if (strict && semanticIntent && semanticIntent.kind === 'structure' && !hasStructuredIdentity(snippet, semanticIntent)) {
      reasons.push('missing_structured_identity');
    }

    return {
      ok: reasons.length === 0,
      reasons,
    };
  }

  return {
    validateGeneratedTaskResult,
  };
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  createGenerationOutputValidator,
};
