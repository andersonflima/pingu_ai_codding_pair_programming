'use strict';

const fs = require('fs');
const path = require('path');

function createUnitTestCoverageChecker(helpers = {}) {
  const {
    sanitizeIdentifier,
    sanitizeNaturalIdentifier,
    escapeRegExp,
    isJavaScriptLikeExtension,
    isPythonLikeExtension,
    isGoExtension,
    isRustExtension,
    isRubyExtension,
    resolveProjectRoot,
    findUpwards,
    pathExists,
    toPosixPath,
    toImportPath,
    upwardDepth,
    upperFirst,
  } = helpers;

  function checkUnitTestCoverage(lines, file) {
    const ext = path.extname(file).toLowerCase();
    if (shouldSkipUnitTestCoverage(file, ext)) {
      return [];
    }

    const candidates = extractTestCandidates(lines, file);
    if (!candidates.length) {
      return [];
    }

    const targetFile = resolveUnitTestTargetFile(file, ext);
    if (!targetFile) {
      return [];
    }

    const uncoveredCandidates = findUntestedUnitTestCandidates(file, ext, targetFile, candidates);
    if (!uncoveredCandidates.length) {
      return [];
    }

    if (!fs.existsSync(targetFile)) {
      const snippet = buildUnitTestSnippet(lines, file, targetFile, uncoveredCandidates, ext);
      if (!snippet) {
        return [];
      }
      return [
        buildUnitTestIssue(
          file,
          uncoveredCandidates[0].line || 1,
          targetFile,
          'Cobertura basica de testes unitarios ausente',
          'Crie testes unitarios em tests/ para validar o contrato publico do codigo.',
          snippet,
        ),
      ];
    }

    const issues = [];
    for (const candidate of uncoveredCandidates) {
      const candidateTargetFile = resolveSupplementalUnitTestTargetFile(file, ext, candidate.name);
      if (!candidateTargetFile || fs.existsSync(candidateTargetFile)) {
        continue;
      }

      const snippet = buildUnitTestSnippet(lines, file, candidateTargetFile, [candidate], ext);
      if (!snippet) {
        continue;
      }

      issues.push(buildUnitTestIssue(
        file,
        candidate.line || 1,
        candidateTargetFile,
        `Cobertura basica de teste unitario ausente para ${candidate.name}`,
        `Crie um teste em tests/ para validar o contrato publico de ${candidate.name}.`,
        snippet,
      ));
    }

    return issues;
  }

  function buildUnitTestIssue(file, line, targetFile, message, suggestion, snippet) {
    return {
      file,
      line,
      severity: 'info',
      kind: 'unit_test',
      message,
      suggestion,
      snippet,
      action: {
        op: 'write_file',
        target_file: targetFile,
        mkdir_p: true,
      },
    };
  }

  function shouldSkipUnitTestCoverage(file, ext) {
    const normalized = toPosixPath(file).toLowerCase();
    if (
      normalized.includes('/tests/')
      || normalized.endsWith('_test.go')
      || normalized.endsWith('_test.py')
      || normalized.endsWith('_test.exs')
      || normalized.endsWith('_spec.lua')
      || normalized.endsWith('_test.vim')
      || normalized.endsWith('.test.js')
      || normalized.endsWith('.test.jsx')
      || normalized.endsWith('.test.ts')
      || normalized.endsWith('.test.tsx')
      || normalized.endsWith('.test.mjs')
      || normalized.endsWith('.test.cjs')
      || normalized.endsWith('.spec.js')
      || normalized.endsWith('.spec.jsx')
      || normalized.endsWith('.spec.ts')
      || normalized.endsWith('.spec.tsx')
      || normalized.endsWith('.spec.mjs')
      || normalized.endsWith('.spec.cjs')
      || normalized.endsWith('_test.rs')
      || normalized.endsWith('_test.rb')
    ) {
      return true;
    }

    return !supportedUnitTestExtensions().includes(ext);
  }

  function supportedUnitTestExtensions() {
    return ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.ex', '.exs', '.go', '.rs', '.rb', '.lua', '.vim'];
  }

  function findUntestedUnitTestCandidates(file, ext, targetFile, candidates) {
    const relatedFiles = resolveRelatedUnitTestFiles(file, ext, targetFile);
    if (!relatedFiles.length) {
      return candidates;
    }

    const relatedContents = relatedFiles
      .filter((relatedFile) => pathExists(relatedFile))
      .map((relatedFile) => fs.readFileSync(relatedFile, 'utf8'));

    if (!relatedContents.length) {
      return candidates;
    }

    return candidates.filter((candidate) =>
      !relatedContents.some((content) => unitTestCandidateCovered(candidate, content, ext)));
  }

  function resolveRelatedUnitTestFiles(file, ext, targetFile) {
    const testsDir = path.dirname(targetFile);
    if (!pathExists(testsDir) || !fs.statSync(testsDir).isDirectory()) {
      return [];
    }

    const baseName = path.parse(file).name;
    const relatedPattern = resolveRelatedUnitTestPattern(baseName, ext);
    if (!relatedPattern) {
      return [];
    }

    return fs.readdirSync(testsDir)
      .filter((entry) => relatedPattern.test(entry))
      .map((entry) => path.join(testsDir, entry));
  }

  function resolveRelatedUnitTestPattern(baseName, ext) {
    const safeBaseName = escapeRegExp(baseName);
    const lowerExt = String(ext || '').toLowerCase();

    if (isJavaScriptLikeExtension(lowerExt)) {
      return new RegExp(`^${safeBaseName}(?:\\.[a-z0-9_]+)?\\.(?:test|spec)${escapeRegExp(lowerExt)}$`, 'i');
    }
    if (isPythonLikeExtension(lowerExt)) {
      return new RegExp(`^test_${safeBaseName}(?:_[a-z0-9_]+)?\\.py$`, 'i');
    }
    if (['.ex', '.exs'].includes(lowerExt)) {
      return new RegExp(`^${safeBaseName}(?:_[a-z0-9_]+)?_test\\.exs$`, 'i');
    }
    if (isGoExtension(lowerExt)) {
      return new RegExp(`^${safeBaseName}(?:_[a-z0-9_]+)?_test\\.go$`, 'i');
    }
    if (isRustExtension(lowerExt)) {
      return new RegExp(`^${safeBaseName}(?:_[a-z0-9_]+)?_test\\.rs$`, 'i');
    }
    if (isRubyExtension(lowerExt)) {
      return new RegExp(`^${safeBaseName}(?:_[a-z0-9_]+)?_test\\.rb$`, 'i');
    }
    if (lowerExt === '.lua') {
      return new RegExp(`^${safeBaseName}(?:_[a-z0-9_]+)?_spec\\.lua$`, 'i');
    }
    if (lowerExt === '.vim') {
      return new RegExp(`^${safeBaseName}(?:_[a-z0-9_]+)?_test\\.vim$`, 'i');
    }

    return null;
  }

  function unitTestCandidateCovered(candidate, content, ext) {
    const lowerExt = String(ext || '').toLowerCase();
    const candidateName = escapeRegExp(candidate.name);
    const testName = escapeRegExp(String(candidate.name || '').replace(/[^A-Za-z0-9]+/g, '_'));
    const patterns = [];

    if (isJavaScriptLikeExtension(lowerExt)) {
      patterns.push(new RegExp(`\\bsubject\\.${candidateName}\\b`));
      patterns.push(new RegExp(`${candidateName} permanece disponivel`));
    } else if (isPythonLikeExtension(lowerExt)) {
      patterns.push(new RegExp(`test_${candidateName}_continua_disponivel`));
      patterns.push(new RegExp(`module_under_test\\.${candidateName}\\b`));
    } else if (['.ex', '.exs'].includes(lowerExt)) {
      patterns.push(new RegExp(`${candidateName}\\/${candidate.arity}`));
      patterns.push(new RegExp(`:${candidateName},\\s*${candidate.arity}`));
    } else if (isGoExtension(lowerExt)) {
      patterns.push(new RegExp(`Test${candidateName}IsAvailable`));
      patterns.push(new RegExp(`subject\\.${candidateName}\\b`));
    } else if (isRustExtension(lowerExt)) {
      patterns.push(new RegExp(`fn\\s+${candidateName}_is_available\\b`));
      patterns.push(new RegExp(`::${candidateName}\\s*;`));
    } else if (isRubyExtension(lowerExt)) {
      patterns.push(new RegExp(`def\\s+test_${candidateName}_continua_disponivel\\b`));
      patterns.push(new RegExp(`(?:private_)?method_defined\\?\\(:${candidateName}\\)`));
    } else if (lowerExt === '.lua') {
      patterns.push(new RegExp(`${candidateName}_ref\\b`));
      patterns.push(new RegExp(`\\[["']${candidateName}["']\\]`));
    } else if (lowerExt === '.vim') {
      patterns.push(new RegExp(`function!?\\s+Test_${testName}_exists\\b`));
      patterns.push(new RegExp(`exists\\('\\*'\\s*\\.\\s*["']${candidateName}["']\\)`));
    }

    patterns.push(new RegExp(`\\b${candidateName}\\b`));
    return patterns.some((pattern) => pattern.test(String(content || '')));
  }

  function resolveUnitTestTargetFile(file, ext) {
    const projectRoot = resolveProjectRoot(file);
    const testsRoot = path.join(projectRoot, 'tests');
    if (!fs.existsSync(testsRoot) || !fs.statSync(testsRoot).isDirectory()) {
      return '';
    }

    const relativeSource = path.relative(projectRoot, file);
    if (!relativeSource || relativeSource.startsWith('..')) {
      return '';
    }

    const parsed = path.parse(relativeSource);
    const sourceDir = parsed.dir && parsed.dir !== '.' ? parsed.dir : '';
    const baseName = parsed.name;
    const lowerExt = String(ext || '').toLowerCase();

    if (isJavaScriptLikeExtension(lowerExt)) {
      return path.join(projectRoot, 'tests', sourceDir, `${baseName}.test${lowerExt}`);
    }
    if (isPythonLikeExtension(lowerExt)) {
      return path.join(projectRoot, 'tests', sourceDir, `test_${baseName}.py`);
    }
    if (['.ex', '.exs'].includes(lowerExt)) {
      return path.join(projectRoot, 'tests', sourceDir, `${baseName}_test.exs`);
    }
    if (isGoExtension(lowerExt)) {
      return path.join(projectRoot, 'tests', sourceDir, `${baseName}_test.go`);
    }
    if (isRustExtension(lowerExt)) {
      return path.join(projectRoot, 'tests', sourceDir, `${baseName}_test.rs`);
    }
    if (isRubyExtension(lowerExt)) {
      return path.join(projectRoot, 'tests', sourceDir, `${baseName}_test.rb`);
    }
    if (lowerExt === '.lua') {
      return path.join(projectRoot, 'tests', sourceDir, `${baseName}_spec.lua`);
    }
    if (lowerExt === '.vim') {
      return path.join(projectRoot, 'tests', sourceDir, `${baseName}_test.vim`);
    }

    return '';
  }

  function resolveSupplementalUnitTestTargetFile(file, ext, candidateName) {
    const projectRoot = resolveProjectRoot(file);
    const testsRoot = path.join(projectRoot, 'tests');
    if (!fs.existsSync(testsRoot) || !fs.statSync(testsRoot).isDirectory()) {
      return '';
    }

    const relativeSource = path.relative(projectRoot, file);
    if (!relativeSource || relativeSource.startsWith('..')) {
      return '';
    }

    const parsed = path.parse(relativeSource);
    const sourceDir = parsed.dir && parsed.dir !== '.' ? parsed.dir : '';
    const baseName = parsed.name;
    const safeCandidateName = sanitizeNaturalIdentifier(candidateName);
    const lowerExt = String(ext || '').toLowerCase();

    if (isJavaScriptLikeExtension(lowerExt)) {
      return path.join(projectRoot, 'tests', sourceDir, `${baseName}.${safeCandidateName}.test${lowerExt}`);
    }
    if (isPythonLikeExtension(lowerExt)) {
      return path.join(projectRoot, 'tests', sourceDir, `test_${baseName}_${safeCandidateName}.py`);
    }
    if (['.ex', '.exs'].includes(lowerExt)) {
      return path.join(projectRoot, 'tests', sourceDir, `${baseName}_${safeCandidateName}_test.exs`);
    }
    if (isGoExtension(lowerExt)) {
      return path.join(projectRoot, 'tests', sourceDir, `${baseName}_${safeCandidateName}_test.go`);
    }
    if (isRustExtension(lowerExt)) {
      return path.join(projectRoot, 'tests', sourceDir, `${baseName}_${safeCandidateName}_test.rs`);
    }
    if (isRubyExtension(lowerExt)) {
      return path.join(projectRoot, 'tests', sourceDir, `${baseName}_${safeCandidateName}_test.rb`);
    }
    if (lowerExt === '.lua') {
      return path.join(projectRoot, 'tests', sourceDir, `${baseName}_${safeCandidateName}_spec.lua`);
    }
    if (lowerExt === '.vim') {
      return path.join(projectRoot, 'tests', sourceDir, `${baseName}_${safeCandidateName}_test.vim`);
    }

    return '';
  }

  function extractTestCandidates(lines, file) {
    const ext = path.extname(file).toLowerCase();
    if (isJavaScriptLikeExtension(ext)) {
      return extractJavaScriptTestCandidates(lines);
    }
    if (isPythonLikeExtension(ext)) {
      return extractPythonTestCandidates(lines);
    }
    if (['.ex', '.exs'].includes(ext)) {
      return extractElixirTestCandidates(lines);
    }
    if (isGoExtension(ext)) {
      return extractGoTestCandidates(lines);
    }
    if (isRustExtension(ext)) {
      return extractRustTestCandidates(lines);
    }
    if (isRubyExtension(ext)) {
      return extractRubyTestCandidates(lines);
    }
    if (ext === '.lua') {
      return extractLuaTestCandidates(lines);
    }
    if (ext === '.vim') {
      return extractVimTestCandidates(lines);
    }
    return [];
  }

  function extractJavaScriptTestCandidates(lines) {
    const candidates = [];
    const seen = new Set();
    const patterns = [
      /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/,
      /^\s*(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/,
      /^\s*export\s+const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/,
      /^\s*const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/,
    ];

    lines.forEach((line, index) => {
      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (!match) {
          continue;
        }

        const name = sanitizeIdentifier(match[1]);
        if (!name || seen.has(name)) {
          break;
        }

        seen.add(name);
        candidates.push({ name, arity: countParams(match[2]), line: index + 1 });
        break;
      }
    });

    return candidates;
  }

  function extractPythonTestCandidates(lines) {
    const candidates = [];
    const seen = new Set();

    lines.forEach((line, index) => {
      const match = line.match(/^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*:/);
      if (!match) {
        return;
      }

      const name = sanitizeIdentifier(match[1]);
      if (!name || name.startsWith('__') || seen.has(name)) {
        return;
      }

      seen.add(name);
      candidates.push({ name, arity: countParams(match[2]), line: index + 1 });
    });

    return candidates;
  }

  function extractElixirTestCandidates(lines) {
    const candidates = [];
    const seen = new Set();
    const moduleName = extractElixirModuleName(lines);

    lines.forEach((line, index) => {
      let match = line.match(/^\s*def\s+([a-z_][a-zA-Z0-9_?!]*)\s*\(([^)]*)\)/);
      if (!match) {
        match = line.match(/^\s*def\s+([a-z_][a-zA-Z0-9_?!]*)\s*do\b/);
      }
      if (!match) {
        return;
      }

      const name = sanitizeIdentifier(match[1]);
      if (!name || seen.has(name)) {
        return;
      }

      seen.add(name);
      candidates.push({ name, arity: countParams(match[2] || ''), line: index + 1, moduleName });
    });

    return candidates.filter((candidate) => candidate.moduleName);
  }

  function extractGoTestCandidates(lines) {
    const candidates = [];
    const seen = new Set();

    lines.forEach((line, index) => {
      const match = line.match(/^\s*func(?:\s*\([^)]*\))?\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/);
      if (!match) {
        return;
      }

      const name = sanitizeIdentifier(match[1]);
      if (!name || !/^[A-Z]/.test(name) || seen.has(name)) {
        return;
      }

      seen.add(name);
      candidates.push({ name, arity: countParams(match[2]), line: index + 1 });
    });

    return candidates;
  }

  function extractRustTestCandidates(lines) {
    const candidates = [];
    const seen = new Set();

    lines.forEach((line, index) => {
      const match = line.match(/^\s*pub\s+fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/);
      if (!match) {
        return;
      }

      const name = sanitizeIdentifier(match[1]);
      if (!name || seen.has(name)) {
        return;
      }

      seen.add(name);
      candidates.push({ name, arity: countParams(match[2]), line: index + 1 });
    });

    return candidates;
  }

  function extractRubyTestCandidates(lines) {
    const candidates = [];
    const seen = new Set();

    lines.forEach((line, index) => {
      const match = line.match(/^\s*def\s+([a-z_][a-zA-Z0-9_?!]*)(?:\(([^)]*)\))?/);
      if (!match) {
        return;
      }

      const name = sanitizeIdentifier(match[1]);
      if (!name || name === 'initialize' || seen.has(name)) {
        return;
      }

      seen.add(name);
      candidates.push({ name, arity: countParams(match[2] || ''), line: index + 1 });
    });

    return candidates;
  }

  function extractLuaTestCandidates(lines) {
    const candidates = [];
    const seen = new Set();
    const patterns = [
      /^\s*local\s+function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/,
      /^\s*function\s+([A-Za-z_][A-Za-z0-9_.:]*)\s*\(([^)]*)\)/,
    ];

    lines.forEach((line, index) => {
      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (!match) {
          continue;
        }

        const rawName = String(match[1] || '').split(/[.:]/).pop();
        const name = sanitizeIdentifier(rawName);
        if (!name || seen.has(name)) {
          break;
        }

        seen.add(name);
        candidates.push({ name, arity: countParams(match[2]), line: index + 1 });
        break;
      }
    });

    return candidates;
  }

  function extractVimTestCandidates(lines) {
    const candidates = [];
    const seen = new Set();

    lines.forEach((line, index) => {
      const match = line.match(/^\s*function!?\s+((?:[gswbtlav]:)?[A-Za-z_#][A-Za-z0-9_:#]*)\s*\(([^)]*)\)/);
      if (!match) {
        return;
      }

      const rawName = String(match[1] || '').trim();
      if (!rawName || /^s:/.test(rawName) || seen.has(rawName)) {
        return;
      }

      seen.add(rawName);
      candidates.push({ name: rawName, arity: countParams(match[2]), line: index + 1 });
    });

    return candidates;
  }

  function extractElixirModuleName(lines) {
    for (const line of lines) {
      const match = String(line || '').match(/^\s*defmodule\s+([A-Za-z0-9_.]+)\s+do/);
      if (match && match[1]) {
        return match[1];
      }
    }
    return '';
  }

  function countParams(paramsText) {
    const normalized = String(paramsText || '').trim();
    if (!normalized) {
      return 0;
    }
    return normalized.split(',').map((part) => part.trim()).filter(Boolean).length;
  }

  function buildUnitTestSnippet(lines, file, targetFile, candidates, ext) {
    const lowerExt = String(ext || '').toLowerCase();
    if (isJavaScriptLikeExtension(lowerExt)) {
      return buildJavaScriptUnitTestSnippet(file, targetFile, candidates, lowerExt);
    }
    if (isPythonLikeExtension(lowerExt)) {
      return buildPythonUnitTestSnippet(file, targetFile, candidates);
    }
    if (['.ex', '.exs'].includes(lowerExt)) {
      return buildElixirUnitTestSnippet(file, targetFile, candidates);
    }
    if (isGoExtension(lowerExt)) {
      return buildGoUnitTestSnippet(file, candidates);
    }
    if (isRustExtension(lowerExt)) {
      return buildRustUnitTestSnippet(file, candidates);
    }
    if (isRubyExtension(lowerExt)) {
      return buildRubyUnitTestSnippet(file, targetFile, candidates);
    }
    if (lowerExt === '.lua') {
      return buildLuaUnitTestSnippet(file, targetFile, candidates);
    }
    if (lowerExt === '.vim') {
      return buildVimUnitTestSnippet(file, targetFile, candidates);
    }
    return '';
  }

  function buildJavaScriptUnitTestSnippet(file, targetFile, candidates, ext) {
    const importPath = toImportPath(path.relative(path.dirname(targetFile), file));
    const moduleStyle = detectNodeModuleStyle(file, ext);
    const lines = [];

    if (moduleStyle === 'require') {
      lines.push('// Valida o contrato publico do modulo sem acoplar o teste aos detalhes internos.');
      lines.push("const test = require('node:test');");
      lines.push("const assert = require('node:assert/strict');");
      lines.push(`const subject = require(${JSON.stringify(importPath)});`);
    } else {
      lines.push('// Valida o contrato publico do modulo sem acoplar o teste aos detalhes internos.');
      lines.push("import test from 'node:test';");
      lines.push("import assert from 'node:assert/strict';");
      lines.push(`import * as subject from ${JSON.stringify(importPath)};`);
    }

    lines.push('');
    candidates.forEach((candidate, index) => {
      if (index > 0) {
        lines.push('');
      }
      lines.push(`// Garante que ${candidate.name} continua exposta como parte do contrato em foco.`);
      lines.push(`test(${JSON.stringify(`${candidate.name} permanece disponivel`)}, () => {`);
      lines.push(`  assert.equal(typeof subject.${candidate.name}, 'function');`);
      lines.push('});');
    });

    return lines.join('\n');
  }

  function detectNodeModuleStyle(file, ext) {
    if (ext === '.cjs') {
      return 'require';
    }
    if (ext === '.mjs') {
      return 'import';
    }
    if (['.ts', '.tsx'].includes(ext)) {
      return 'import';
    }

    const packageDir = findUpwards(path.dirname(path.resolve(file)), (currentDir) => pathExists(path.join(currentDir, 'package.json')));
    if (!packageDir) {
      return ext === '.js' ? 'require' : 'import';
    }

    const packageJsonPath = path.join(packageDir, 'package.json');
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      return packageJson.type === 'module' ? 'import' : 'require';
    } catch (_error) {
      return ext === '.js' ? 'require' : 'import';
    }
  }

  function buildPythonUnitTestSnippet(file, targetFile, candidates) {
    const projectRoot = resolveProjectRoot(file);
    const rootDepth = upwardDepth(path.dirname(targetFile), projectRoot);
    const sourceRelative = toPosixPath(path.relative(projectRoot, file));
    const lines = [
      '"""Valida o contrato publico do modulo em foco sem acoplar o teste ao detalhe interno."""',
      '',
      'import importlib.util',
      'import unittest',
      'from pathlib import Path',
      '',
      `SOURCE_FILE = Path(__file__).resolve().parents[${rootDepth}] / ${JSON.stringify(sourceRelative)}`,
      'SPEC = importlib.util.spec_from_file_location("module_under_test", SOURCE_FILE)',
      'assert SPEC and SPEC.loader is not None',
      'module_under_test = importlib.util.module_from_spec(SPEC)',
      'SPEC.loader.exec_module(module_under_test)',
      '',
      'class ModuleContractTest(unittest.TestCase):',
      '    """Confirma que as entradas publicas continuam disponiveis para manutencao."""',
    ];

    candidates.forEach((candidate) => {
      lines.push('');
      lines.push(`    def test_${candidate.name}_continua_disponivel(self):`);
      lines.push(`        """Garante que ${candidate.name} permanece acessivel como funcao publica."""`);
      lines.push(`        self.assertTrue(callable(module_under_test.${candidate.name}))`);
    });

    lines.push('');
    lines.push('if __name__ == "__main__":');
    lines.push('    unittest.main()');
    return lines.join('\n');
  }

  function buildElixirUnitTestSnippet(file, targetFile, candidates) {
    const moduleName = candidates[0] && candidates[0].moduleName ? candidates[0].moduleName : '';
    if (!moduleName) {
      return '';
    }

    const sourceRelative = toPosixPath(path.relative(path.dirname(targetFile), file));
    const testModuleName = `${moduleName}Test`;
    const lines = [
      'ExUnit.start()',
      '',
      '# Carrega o modulo em foco para validar o contrato publico sem acoplamento ao restante da aplicacao.',
      `Code.require_file(Path.expand(${JSON.stringify(sourceRelative)}, __DIR__))`,
      '',
      `defmodule ${testModuleName} do`,
      '  use ExUnit.Case, async: true',
      '',
      '  @moduletag :unit',
    ];

    candidates.forEach((candidate) => {
      lines.push('');
      lines.push(`  test ${JSON.stringify(`${candidate.name}/${candidate.arity} permanece disponivel`)} do`);
      lines.push(`    assert function_exported?(${moduleName}, :${candidate.name}, ${candidate.arity})`);
      lines.push('  end');
    });

    lines.push('end');
    return lines.join('\n');
  }

  function buildGoUnitTestSnippet(file, candidates) {
    const importPath = resolveGoImportPath(file);
    if (!importPath) {
      return '';
    }

    const lines = [
      'package tests',
      '',
      'import (',
      '    "reflect"',
      '    "testing"',
      '',
      `    subject ${JSON.stringify(importPath)}`,
      ')',
    ];

    candidates.forEach((candidate) => {
      lines.push('');
      lines.push(`// Test${candidate.name}IsAvailable garante que ${candidate.name} continua exposta para o fluxo publico.`);
      lines.push(`func Test${candidate.name}IsAvailable(t *testing.T) {`);
      lines.push(`    if reflect.ValueOf(subject.${candidate.name}).Kind() != reflect.Func {`);
      lines.push(`        t.Fatalf(${JSON.stringify(`${candidate.name} deve continuar disponivel como funcao exportada`)})`);
      lines.push('    }');
      lines.push('}');
    });

    return lines.join('\n');
  }

  function resolveGoImportPath(file) {
    const moduleRoot = findUpwards(path.dirname(path.resolve(file)), (currentDir) => pathExists(path.join(currentDir, 'go.mod')));
    if (!moduleRoot) {
      return '';
    }

    const goModPath = path.join(moduleRoot, 'go.mod');
    const goModContent = fs.readFileSync(goModPath, 'utf8');
    const moduleMatch = goModContent.match(/^module\s+(.+)$/m);
    if (!moduleMatch || !moduleMatch[1]) {
      return '';
    }

    const relativeDir = toPosixPath(path.dirname(path.relative(moduleRoot, file)));
    if (!relativeDir || relativeDir === '.') {
      return moduleMatch[1].trim();
    }

    return `${moduleMatch[1].trim()}/${relativeDir}`;
  }

  function buildRustUnitTestSnippet(file, candidates) {
    const crateName = resolveCargoPackageName(file);
    if (!crateName) {
      return '';
    }

    const sourcePath = path.resolve(file);
    const cargoRoot = findUpwards(path.dirname(sourcePath), (currentDir) => pathExists(path.join(currentDir, 'Cargo.toml')));
    if (!cargoRoot) {
      return '';
    }

    const relativeSource = toPosixPath(path.relative(path.join(cargoRoot, 'src'), sourcePath));
    if (!relativeSource || relativeSource.startsWith('..') || relativeSource === 'main.rs') {
      return '';
    }

    const moduleSegments = relativeSource.replace(/\.rs$/, '').split('/').filter(Boolean);
    if (moduleSegments[moduleSegments.length - 1] === 'mod') {
      moduleSegments.pop();
    }

    const lines = ['// Valida o contrato publico do modulo em foco sem acoplamento ao detalhe interno.'];
    candidates.forEach((candidate, index) => {
      const importPath = [crateName, ...moduleSegments, candidate.name].join('::');
      lines.push(`use ${importPath};`);
      if (index === candidates.length - 1) {
        lines.push('');
      }
    });

    candidates.forEach((candidate, index) => {
      if (index > 0) {
        lines.push('');
      }
      lines.push(`// Garante que ${candidate.name} permanece disponivel no contrato publico.`);
      lines.push('#[test]');
      lines.push(`fn ${candidate.name}_is_available() {`);
      lines.push(`    let function_reference = ${candidate.name};`);
      lines.push('    let _ = function_reference;');
      lines.push('}');
    });

    return lines.join('\n');
  }

  function buildRubyUnitTestSnippet(file, targetFile, candidates) {
    const relativeSource = toPosixPath(path.relative(path.dirname(targetFile), file)).replace(/\.rb$/i, '');
    const suiteName = `${upperFirst(sanitizeNaturalIdentifier(path.parse(file).name) || 'Source')}ContractTest`;
    const lines = [
      '# Valida o contrato publico do arquivo em foco sem acoplamento ao detalhe interno.',
      "require 'minitest/autorun'",
      `require_relative ${JSON.stringify(relativeSource)}`,
      '',
      `class ${suiteName} < Minitest::Test`,
    ];

    candidates.forEach((candidate) => {
      lines.push('');
      lines.push(`  def test_${candidate.name}_continua_disponivel`);
      lines.push(`    assert(Object.method_defined?(:${candidate.name}) || Object.private_method_defined?(:${candidate.name}), ${JSON.stringify(`${candidate.name} deve continuar disponivel como funcao`)})`);
      lines.push('  end');
    });

    lines.push('end');
    return lines.join('\n');
  }

  function resolveCargoPackageName(file) {
    const cargoRoot = findUpwards(path.dirname(path.resolve(file)), (currentDir) => pathExists(path.join(currentDir, 'Cargo.toml')));
    if (!cargoRoot) {
      return '';
    }

    const cargoToml = fs.readFileSync(path.join(cargoRoot, 'Cargo.toml'), 'utf8');
    const packageMatch = cargoToml.match(/^name\s*=\s*"([^"]+)"/m);
    if (!packageMatch || !packageMatch[1]) {
      return '';
    }

    return packageMatch[1].replace(/-/g, '_');
  }

  function buildLuaUnitTestSnippet(file, targetFile, candidates) {
    const relativeSource = toPosixPath(path.relative(path.dirname(targetFile), file));
    const lines = [
      '-- Valida o contrato publico do modulo em foco sem acoplamento aos detalhes internos.',
      'local current_dir = debug.getinfo(1, "S").source:sub(2):match("(.*/)") or "./"',
      `local module_under_test = dofile(current_dir .. ${JSON.stringify(relativeSource)})`,
    ];

    candidates.forEach((candidate) => {
      lines.push('');
      lines.push(`-- Garante que ${candidate.name} continua disponivel para consumo do restante da base.`);
      lines.push(`local ${candidate.name}_ref = _G[${JSON.stringify(candidate.name)}]`);
      lines.push(`if type(${candidate.name}_ref) ~= 'function' and type(module_under_test) == 'table' then`);
      lines.push(`  ${candidate.name}_ref = module_under_test[${JSON.stringify(candidate.name)}]`);
      lines.push('end');
      lines.push(`assert(type(${candidate.name}_ref) == 'function', ${JSON.stringify(`${candidate.name} deve continuar disponivel como funcao`)})`);
    });

    return lines.join('\n');
  }

  function buildVimUnitTestSnippet(file, targetFile, candidates) {
    const relativeSource = toPosixPath(path.relative(path.dirname(targetFile), file));
    const lines = [
      `let s:test_dir = fnamemodify(expand(${JSON.stringify('<sfile>:p')}), ${JSON.stringify(':h')})`,
      `execute ${JSON.stringify('source ')} . fnameescape(fnamemodify(s:test_dir . ${JSON.stringify('/' + relativeSource)}, ${JSON.stringify(':p')}))`,
      '',
    ];

    candidates.forEach((candidate, index) => {
      const testName = candidate.name.replace(/[^A-Za-z0-9]+/g, '_');
      lines.push('" Garante que a funcao continua disponivel para o contrato publico.');
      lines.push(`function! Test_${testName}_exists() abort`);
      lines.push(`  call assert_true(exists('*' . ${JSON.stringify(candidate.name)}))`);
      lines.push('endfunction');
      if (index !== candidates.length - 1) {
        lines.push('');
      }
    });

    return lines.join('\n');
  }

  return checkUnitTestCoverage;
}

module.exports = {
  createUnitTestCoverageChecker,
};
