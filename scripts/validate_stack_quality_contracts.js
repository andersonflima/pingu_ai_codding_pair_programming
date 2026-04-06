#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { activeLanguageIds } = require('../lib/language-capabilities');
const { languageValidationManifest } = require('./language_validation_manifest');

const repoRoot = path.resolve(__dirname, '..');

function assert(condition, message, details = {}) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function validateStackQuality(languageId, entry) {
  const metadata = entry && entry.metadata && typeof entry.metadata === 'object'
    ? entry.metadata
    : {};
  const stackQuality = metadata.stackQuality && typeof metadata.stackQuality === 'object'
    ? metadata.stackQuality
    : null;

  assert(Boolean(stackQuality), 'stack-contract: metadata.stackQuality ausente', {
    languageId,
    metadata,
  });
  assert(Number(stackQuality.maxRollbackRegressions) === 0, 'stack-contract: rollback deve permanecer zero por stack', {
    languageId,
    stackQuality,
  });
  assert(Number(stackQuality.maxFalsePositiveRate) > 0 && Number(stackQuality.maxFalsePositiveRate) <= 0.2, 'stack-contract: taxa maxima de falso positivo fora do intervalo aceito', {
    languageId,
    stackQuality,
  });
  assert(Number(stackQuality.maxRealtimeLatencyMs) > 0 && Number(stackQuality.maxRealtimeLatencyMs) <= 250, 'stack-contract: latencia maxima realtime precisa ser objetiva e conservadora', {
    languageId,
    stackQuality,
  });
  assert(Number(stackQuality.minCheckupCases) <= Number(metadata.checkupCases || 0), 'stack-contract: minCheckupCases nao pode ultrapassar a cobertura real da stack', {
    languageId,
    stackQuality,
    checkupCases: metadata.checkupCases,
  });
  if (metadata.representativeEditorSmoke) {
    assert(stackQuality.requiresRepresentativeEditorSmoke === true, 'stack-contract: stack com smoke representativo precisa declarar esse requisito', {
      languageId,
      stackQuality,
      representativeEditorSmoke: metadata.representativeEditorSmoke,
    });
  }

  return {
    languageId,
    stackQuality,
    checkupCases: Number(metadata.checkupCases || 0),
    representativeEditorSmoke: Boolean(metadata.representativeEditorSmoke),
  };
}

function validateRuntimeKnobs() {
  const analyzerSource = readRepoFile(path.join('lib', 'analyzer.js'));
  const vimPluginSource = readRepoFile(path.join('vim', 'plugin', 'realtime_dev_agent.vim'));
  const vscodeEditsSource = readRepoFile(path.join('vscode', 'edits.js'));

  assert(analyzerSource.includes('PINGU_DOCUMENTATION_MAX_LINES'), 'stack-contract: analyzer precisa expor corte de documentacao por tamanho de arquivo');
  assert(vimPluginSource.includes('realtime_dev_agent_auto_fix_large_file_line_threshold'), 'stack-contract: LazyVim precisa expor knobs de arquivo grande');
  assert(vimPluginSource.includes('realtime_dev_agent_auto_fix_doc_max_per_check_large_file'), 'stack-contract: LazyVim precisa limitar lote documental em arquivo grande');
  assert(vscodeEditsSource.includes('PINGU_AUTOFIX_LARGE_FILE_LINE_THRESHOLD'), 'stack-contract: VS Code precisa expor threshold de arquivo grande');
  assert(vscodeEditsSource.includes('PINGU_AUTOFIX_DOC_MAX_PER_PASS_LARGE_FILE'), 'stack-contract: VS Code precisa limitar lote documental em arquivo grande');

  return {
    analyzerDocumentationThreshold: true,
    lazyVimLargeFileKnobs: true,
    vscodeLargeFileKnobs: true,
  };
}

function main() {
  const manifest = languageValidationManifest();
  const activeLanguages = activeLanguageIds().sort();
  const results = activeLanguages.map((languageId) => validateStackQuality(languageId, manifest[languageId]));
  const runtimeKnobs = validateRuntimeKnobs();

  process.stdout.write(`${JSON.stringify({
    ok: true,
    activeLanguages,
    runtimeKnobs,
    stacks: results,
  }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    error: error.message || String(error),
    details: error.details || {},
  }, null, 2)}\n`);
  process.exitCode = 1;
}
