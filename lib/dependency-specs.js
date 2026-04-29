'use strict';

function inferModuleStyle(ext, lines = []) {
  const lowerExt = String(ext || '').toLowerCase();
  if (['.ts', '.tsx', '.mjs'].includes(lowerExt)) {
    return 'esm';
  }
  if (lowerExt === '.cjs') {
    return 'cjs';
  }

  const text = Array.isArray(lines) ? lines.join('\n') : '';
  if (/^\s*import\b/m.test(text) || /^\s*export\b/m.test(text)) {
    return 'esm';
  }
  if (/require\(['"][^'"]+['"]\)/.test(text) || /module\.exports\b/.test(text)) {
    return 'cjs';
  }
  return 'esm';
}

function jsDependencySpec(importKind, symbol, source, style) {
  return {
    language: 'javascript',
    importKind,
    symbol,
    source,
    style,
  };
}

function pythonDependencySpec(importKind, moduleName, symbol = '') {
  return {
    language: 'python',
    importKind,
    moduleName,
    symbol,
  };
}

function goDependencySpec(source, alias = '') {
  return {
    language: 'go',
    importKind: 'import',
    source,
    alias,
  };
}

function rustDependencySpec(source) {
  return {
    language: 'rust',
    importKind: 'use',
    source,
    symbol: String(source).split('::').pop(),
  };
}

function elixirRequireSpec(moduleName) {
  return {
    language: 'elixir',
    importKind: 'require',
    moduleName,
  };
}

function cDependencySpec(header) {
  return {
    language: 'c',
    importKind: 'include',
    source: header,
    symbol: header,
  };
}

function dependencySpecKey(dependency) {
  if (!dependency || typeof dependency !== 'object') {
    return '';
  }
  return [
    dependency.language || '',
    dependency.importKind || '',
    dependency.symbol || '',
    dependency.source || '',
    dependency.moduleName || '',
    dependency.alias || '',
    dependency.style || '',
  ].join('|');
}

function uniqueDependencySpecs(dependencies) {
  const deduped = [];
  const seen = new Set();
  for (const dependency of Array.isArray(dependencies) ? dependencies : []) {
    const key = dependencySpecKey(dependency);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(dependency);
  }
  return deduped;
}

module.exports = {
  cDependencySpec,
  dependencySpecKey,
  elixirRequireSpec,
  goDependencySpec,
  inferModuleStyle,
  jsDependencySpec,
  pythonDependencySpec,
  rustDependencySpec,
  uniqueDependencySpecs,
};
