'use strict';

const fs = require('fs');
const path = require('path');
const { resolveProjectRoot, toPosixPath } = require('./project-paths');

const DEFAULT_MAX_LIBRARIES = 6;
const DEFAULT_MAX_API_LINES = 24;
const DEFAULT_MAX_ENTRY_BYTES = 128 * 1024;
const NODE_BUILTIN_MODULES = new Set([
  'assert',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'crypto',
  'dns',
  'events',
  'fs',
  'http',
  'https',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'querystring',
  'readline',
  'stream',
  'string_decoder',
  'timers',
  'tls',
  'tty',
  'url',
  'util',
  'vm',
  'worker_threads',
  'zlib',
]);

function buildInstalledLibraryContext(request = {}) {
  const sourceFile = String(request.sourceFile || request.file || '');
  const lines = Array.isArray(request.lines)
    ? request.lines
    : String(request.content || '').replace(/\r\n/g, '\n').split('\n');
  const ext = String(request.ext || path.extname(sourceFile)).toLowerCase();
  if (!isJavaScriptLikeExtension(ext)) {
    return emptyInstalledLibraryContext(sourceFile);
  }

  const projectRoot = resolveProjectRoot(sourceFile || path.join(process.cwd(), 'index.js'));
  const imports = collectExternalJavaScriptImports(lines.join('\n'));
  if (imports.length === 0) {
    return emptyInstalledLibraryContext(sourceFile, projectRoot);
  }

  const dependencyRanges = readRootDependencyRanges(projectRoot);
  const libraries = imports
    .slice(0, Number.isFinite(request.maxLibraries) ? request.maxLibraries : DEFAULT_MAX_LIBRARIES)
    .map((importUsage) => buildLibrarySummary(projectRoot, dependencyRanges, importUsage, request))
    .filter((library) => library && library.installed);

  return {
    policy: 'installed_libraries_imported_by_current_buffer',
    projectRoot: toPosixPath(projectRoot),
    libraries,
  };
}

function emptyInstalledLibraryContext(sourceFile, projectRoot = '') {
  return {
    policy: 'installed_libraries_imported_by_current_buffer',
    projectRoot: projectRoot ? toPosixPath(projectRoot) : '',
    libraries: [],
  };
}

function isJavaScriptLikeExtension(ext) {
  return ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(String(ext || '').toLowerCase());
}

function collectExternalJavaScriptImports(sourceText) {
  const text = String(sourceText || '');
  const sourceOrder = [];
  const sourceMap = new Map();

  [
    /\bimport\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:type\s+)?[^'";]+?\s+from\s+['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ].forEach((pattern) => {
    let match = pattern.exec(text);
    while (match) {
      const specifier = String(match[1] || '').trim();
      const packageName = normalizePackageName(specifier);
      if (packageName && !sourceMap.has(specifier)) {
        sourceOrder.push(specifier);
        sourceMap.set(specifier, {
          specifier,
          packageName,
          importedSymbols: collectImportedSymbolsForSpecifier(text, specifier),
        });
      }
      match = pattern.exec(text);
    }
  });

  return sourceOrder
    .map((specifier) => sourceMap.get(specifier))
    .filter(Boolean);
}

function normalizePackageName(specifier) {
  const normalized = String(specifier || '').trim();
  if (!normalized || normalized.startsWith('.') || normalized.startsWith('/') || normalized.startsWith('#')) {
    return '';
  }

  const withoutNodeProtocol = normalized.replace(/^node:/, '');
  if (NODE_BUILTIN_MODULES.has(withoutNodeProtocol)) {
    return '';
  }

  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) {
    return '';
  }
  if (parts[0].startsWith('@') && parts.length >= 2) {
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0];
}

function collectImportedSymbolsForSpecifier(sourceText, specifier) {
  const text = String(sourceText || '');
  const sourcePattern = escapeRegExp(specifier);
  return uniqueValues([
    ...collectRegexGroupMatches(text, new RegExp(`\\bimport\\s+(?:type\\s+)?\\{([^}]+)\\}\\s+from\\s+['"]${sourcePattern}['"]`, 'g'), 1)
      .flatMap(parseNamedImportSymbols),
    ...collectRegexGroupMatches(text, new RegExp(`\\bimport\\s+([A-Za-z_$][A-Za-z0-9_$]*)\\s*,\\s*\\{([^}]+)\\}\\s+from\\s+['"]${sourcePattern}['"]`, 'g'), 1),
    ...collectRegexGroupMatches(text, new RegExp(`\\bimport\\s+[A-Za-z_$][A-Za-z0-9_$]*\\s*,\\s*\\{([^}]+)\\}\\s+from\\s+['"]${sourcePattern}['"]`, 'g'), 1)
      .flatMap(parseNamedImportSymbols),
    ...collectRegexGroupMatches(text, new RegExp(`\\bimport\\s+\\*\\s+as\\s+([A-Za-z_$][A-Za-z0-9_$]*)\\s+from\\s+['"]${sourcePattern}['"]`, 'g'), 1),
    ...collectRegexGroupMatches(text, new RegExp(`\\bimport\\s+([A-Za-z_$][A-Za-z0-9_$]*)\\s+from\\s+['"]${sourcePattern}['"]`, 'g'), 1),
    ...collectRegexGroupMatches(text, new RegExp(`\\b(?:const|let|var)\\s*\\{([^}]+)\\}\\s*=\\s*require\\(\\s*['"]${sourcePattern}['"]\\s*\\)`, 'g'), 1)
      .flatMap(parseNamedRequireSymbols),
  ]);
}

function collectRegexGroupMatches(text, pattern, groupIndex) {
  const matches = [];
  let match = pattern.exec(text);
  while (match) {
    if (match[groupIndex]) {
      matches.push(String(match[groupIndex]));
    }
    match = pattern.exec(text);
  }
  return matches;
}

function parseNamedImportSymbols(raw) {
  return String(raw || '')
    .split(',')
    .map((token) => String(token || '').trim().replace(/^type\s+/i, '').replace(/\s+as\s+.+$/i, ''))
    .filter((name) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name));
}

function parseNamedRequireSymbols(raw) {
  return String(raw || '')
    .split(',')
    .map((token) => String(token || '').trim().split(':')[0].trim())
    .filter((name) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name));
}

function buildLibrarySummary(projectRoot, dependencyRanges, importUsage, request) {
  const packageRoot = resolveInstalledPackageRoot(projectRoot, importUsage.packageName);
  if (!packageRoot) {
    return {
      specifier: importUsage.specifier,
      packageName: importUsage.packageName,
      installed: false,
      importedSymbols: importUsage.importedSymbols,
    };
  }

  const manifest = readPackageManifest(packageRoot);
  const entryFiles = resolveLibraryEntryFiles(packageRoot, manifest, importUsage.specifier);
  const expandedEntryFiles = expandReExportEntryFiles(entryFiles, importUsage.importedSymbols);
  const apiLines = collectLibraryApiLines(entryFiles, importUsage.importedSymbols, {
    maxApiLines: Number.isFinite(request.maxApiLines) ? request.maxApiLines : DEFAULT_MAX_API_LINES,
    maxEntryBytes: Number.isFinite(request.maxEntryBytes) ? request.maxEntryBytes : DEFAULT_MAX_ENTRY_BYTES,
  });

  return {
    specifier: importUsage.specifier,
    packageName: importUsage.packageName,
    installed: true,
    version: String(manifest.version || ''),
    range: dependencyRanges.get(importUsage.packageName) || '',
    description: String(manifest.description || '').slice(0, 180),
    moduleType: String(manifest.type || ''),
    entrypoints: expandedEntryFiles.map((filePath) => toPosixPath(path.relative(packageRoot, filePath))),
    importedSymbols: importUsage.importedSymbols,
    publicApi: apiLines,
  };
}

function readRootDependencyRanges(projectRoot) {
  const manifest = readJsonFile(path.join(projectRoot, 'package.json'));
  return new Map([
    ...Object.entries(manifest.dependencies || {}),
    ...Object.entries(manifest.devDependencies || {}),
    ...Object.entries(manifest.peerDependencies || {}),
    ...Object.entries(manifest.optionalDependencies || {}),
  ].map(([name, range]) => [name, String(range || '')]));
}

function resolveInstalledPackageRoot(projectRoot, packageName) {
  let currentDir = path.resolve(projectRoot || process.cwd());
  while (true) {
    const candidate = path.join(currentDir, 'node_modules', packageName);
    if (pathExists(path.join(candidate, 'package.json'))) {
      return candidate;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return '';
    }
    currentDir = parentDir;
  }
}

function readPackageManifest(packageRoot) {
  return readJsonFile(path.join(packageRoot, 'package.json'));
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return {};
  }
}

function resolveLibraryEntryFiles(packageRoot, manifest, specifier) {
  const manifestEntryFiles = [
    manifest.types,
    manifest.typings,
    ...extractExportEntrypoints(manifest.exports),
    manifest.module,
    manifest.main,
    'index.d.ts',
    'index.ts',
    'index.js',
  ];
  const subpathEntryFiles = resolveSpecifierSubpathEntryFiles(packageRoot, manifest.name, specifier);

  return uniqueValues([...subpathEntryFiles, ...manifestEntryFiles])
    .map((entry) => path.resolve(packageRoot, String(entry || '').replace(/^\.\//, '')))
    .filter((entryPath) => isInsideDirectory(packageRoot, entryPath))
    .filter((entryPath) => pathExists(entryPath))
    .filter((entryPath) => isReadableApiFile(entryPath))
    .slice(0, 4);
}

function resolveSpecifierSubpathEntryFiles(packageRoot, packageName, specifier) {
  const normalizedPackageName = String(packageName || '').trim();
  const normalizedSpecifier = String(specifier || '').trim();
  if (!normalizedPackageName || normalizedSpecifier === normalizedPackageName) {
    return [];
  }

  const subpath = normalizedSpecifier.startsWith(`${normalizedPackageName}/`)
    ? normalizedSpecifier.slice(normalizedPackageName.length + 1)
    : '';
  if (!subpath) {
    return [];
  }

  return [
    `${subpath}.d.ts`,
    `${subpath}.ts`,
    `${subpath}.js`,
    path.join(subpath, 'index.d.ts'),
    path.join(subpath, 'index.ts'),
    path.join(subpath, 'index.js'),
  ].filter((entry) => isInsideDirectory(packageRoot, path.resolve(packageRoot, entry)));
}

function extractExportEntrypoints(exportsField) {
  if (!exportsField) {
    return [];
  }
  if (typeof exportsField === 'string') {
    return [exportsField];
  }
  if (Array.isArray(exportsField)) {
    return exportsField.flatMap(extractExportEntrypoints);
  }
  if (typeof exportsField !== 'object') {
    return [];
  }

  return Object.entries(exportsField).flatMap(([key, value]) => {
    if (typeof value === 'string' && /\.(?:d\.ts|mjs|cjs|js|ts)$/i.test(value)) {
      return [value];
    }
    if (['types', 'typings', 'import', 'require', 'default', '.'].includes(key)) {
      return extractExportEntrypoints(value);
    }
    return [];
  });
}

function isReadableApiFile(filePath) {
  return /\.(?:d\.ts|ts|tsx|js|jsx|mjs|cjs)$/i.test(filePath);
}

function expandReExportEntryFiles(entryFiles, importedSymbols) {
  const reExportFiles = entryFiles.flatMap((entryFile) => resolveReExportFiles(entryFile, importedSymbols));
  return uniqueValues([...entryFiles, ...reExportFiles]).slice(0, 6);
}

function resolveReExportFiles(entryFile, importedSymbols) {
  const content = safeReadFileSlice(entryFile, DEFAULT_MAX_ENTRY_BYTES);
  if (!content) {
    return [];
  }

  const packageRoot = resolvePackageRootFromFile(entryFile);
  const symbols = (Array.isArray(importedSymbols) ? importedSymbols : []).filter(Boolean);
  return content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => String(line || '').trim())
    .filter((line) => isRelevantReExportLine(line, symbols))
    .map(readReExportSource)
    .filter(Boolean)
    .flatMap((specifier) => resolveRelativeApiFile(entryFile, specifier))
    .filter((filePath) => !packageRoot || isInsideDirectory(packageRoot, filePath))
    .filter((filePath) => pathExists(filePath))
    .filter(isReadableApiFile)
    .slice(0, 4);
}

function resolvePackageRootFromFile(filePath) {
  let currentDir = path.dirname(path.resolve(String(filePath || '')));
  while (true) {
    if (pathExists(path.join(currentDir, 'package.json'))) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return '';
    }
    currentDir = parentDir;
  }
}

function isRelevantReExportLine(line, symbols) {
  if (!/^export\s+(?:type\s+)?(?:\*|\{)/.test(line)) {
    return false;
  }
  if (symbols.length === 0 || /^export\s+(?:type\s+)?\*/.test(line)) {
    return true;
  }
  return symbols.some((symbol) => new RegExp(`\\b${escapeRegExp(symbol)}\\b`).test(line));
}

function readReExportSource(line) {
  const match = String(line || '').match(/\bfrom\s+['"]([^'"]+)['"]/);
  return match && match[1] ? String(match[1]).trim() : '';
}

function resolveRelativeApiFile(entryFile, specifier) {
  const normalizedSpecifier = String(specifier || '').trim();
  if (!normalizedSpecifier.startsWith('.')) {
    return [];
  }

  const basePath = path.resolve(path.dirname(entryFile), normalizedSpecifier);
  const explicitExtension = path.extname(basePath);
  if (explicitExtension) {
    return [basePath];
  }

  return [
    `${basePath}.d.ts`,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    path.join(basePath, 'index.d.ts'),
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.js'),
  ];
}

function collectLibraryApiLines(entryFiles, importedSymbols, options) {
  const expandedEntryFiles = expandReExportEntryFiles(entryFiles, importedSymbols);
  const symbolLines = expandedEntryFiles.flatMap((entryFile) =>
    collectApiLinesFromFile(entryFile, importedSymbols, options));
  if (symbolLines.length > 0) {
    return uniqueValues(symbolLines).slice(0, options.maxApiLines);
  }

  return uniqueValues(expandedEntryFiles.flatMap((entryFile) =>
    collectApiLinesFromFile(entryFile, [], options))).slice(0, options.maxApiLines);
}

function collectApiLinesFromFile(filePath, importedSymbols, options) {
  const content = safeReadFileSlice(filePath, options.maxEntryBytes);
  if (!content) {
    return [];
  }

  const lines = content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => String(line || '').trim())
    .filter(Boolean);
  const symbols = (Array.isArray(importedSymbols) ? importedSymbols : []).filter(Boolean);
  const selectedLines = symbols.length > 0
    ? lines.filter((line) => symbols.some((symbol) => isApiLineForSymbol(line, symbol)))
    : lines.filter(isPublicApiLine);

  return selectedLines
    .filter(isPublicApiLine)
    .map((line) => line.slice(0, 240));
}

function safeReadFileSlice(filePath, maxBytes) {
  try {
    const descriptor = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(Math.max(0, maxBytes));
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
      return buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      fs.closeSync(descriptor);
    }
  } catch (_error) {
    return '';
  }
}

function isApiLineForSymbol(line, symbol) {
  const symbolPattern = escapeRegExp(symbol);
  return new RegExp(`\\b${symbolPattern}\\b`).test(line)
    && (/^(?:export\s+)?(?:declare\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|enum|namespace)\b/.test(line)
      || /^export\s*\{/.test(line)
      || /^export\s+default\b/.test(line));
}

function isPublicApiLine(line) {
  return /^(?:export\s+)?(?:declare\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|enum|namespace)\b/.test(line)
    || /^export\s*\{/.test(line)
    || /^export\s+default\b/.test(line);
}

function pathExists(targetPath) {
  try {
    fs.accessSync(targetPath);
    return true;
  } catch (_error) {
    return false;
  }
}

function uniqueValues(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value) => {
      if (seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    });
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isInsideDirectory(parentDir, candidatePath) {
  const relativePath = path.relative(path.resolve(parentDir), path.resolve(candidatePath));
  return Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

module.exports = {
  buildInstalledLibraryContext,
  collectExternalJavaScriptImports,
  normalizePackageName,
};
