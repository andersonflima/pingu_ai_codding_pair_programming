#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const {
  defaultTargetDir,
  loadExternalManifest,
} = require('./rebuild_external_agent_test');

const repoRoot = path.resolve(__dirname, '..');
const internalWorkspaceFile = path.join(
  repoRoot,
  'anget_test',
  'realtime-dev-agent-validation.code-workspace',
);
const internalDefaultFixtureFiles = [
  'anget_test/javascript/src/01_comment_simple.js',
  'anget_test/javascript/src/03_terminal_task.js',
  'anget_test/javascript/src/04_context_blueprint.js',
  'anget_test/javascript/src/06_unit_contract.js',
  'anget_test/react/src/01_d20_prompt.tsx',
  'anget_test/ruby/lib/01_d20_prompt.rb',
  'anget_test/shell/01_comment_prompt.sh',
  'anget_test/toml/config.toml',
  'anget_test/terraform/main.tf',
];

function unique(items) {
  return Array.from(new Set(items));
}

function normalizeFilePath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
}

function parseCliArguments(argv) {
  const state = {
    dryRun: false,
    files: [],
    suiteDir: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') {
      state.dryRun = true;
      continue;
    }

    if (argument === '--suite-dir' && argv[index + 1]) {
      state.suiteDir = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument.startsWith('--suite-dir=')) {
      state.suiteDir = argument.slice('--suite-dir='.length);
      continue;
    }

    state.files.push(argument);
  }

  return state;
}

function resolveExternalWorkspaceFile(suiteDir) {
  return path.join(path.resolve(suiteDir || defaultTargetDir), 'realtime-dev-agent-validation.code-workspace');
}

function resolveExternalFixtureFiles(suiteDir) {
  const manifest = loadExternalManifest(suiteDir || defaultTargetDir);
  return unique(
    (manifest.defaultVsCodeFiles || []).map((relativePath) => path.join(path.resolve(suiteDir || defaultTargetDir), relativePath)),
  );
}

function resolveFixtureFiles(fileArguments, suiteDir) {
  const selectedFiles = fileArguments.length > 0
    ? fileArguments
    : (suiteDir ? resolveExternalFixtureFiles(suiteDir) : internalDefaultFixtureFiles);
  return unique(selectedFiles.map((filePath) => (suiteDir ? path.resolve(filePath) : normalizeFilePath(filePath))));
}

function resolveWorkspaceFile(suiteDir) {
  return suiteDir ? resolveExternalWorkspaceFile(suiteDir) : internalWorkspaceFile;
}

function buildVsCodeOpenArguments(fileArguments, suiteDir) {
  const workspaceFile = resolveWorkspaceFile(suiteDir);
  return ['--reuse-window', workspaceFile].concat(resolveFixtureFiles(fileArguments, suiteDir));
}

function printDryRun(bin, args, suiteDir) {
  const payload = {
    bin,
    args,
    workspaceFile: resolveWorkspaceFile(suiteDir),
    files: args.slice(2),
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function runVsCode(bin, args) {
  const result = spawnSync(bin, args, {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      process.stderr.write(
        `[RealtimeDevAgent] nao foi possivel encontrar o executavel "${bin}". ` +
        'Instale o comando `code` no PATH ou defina `PINGU_VSCODE_BIN`.\n',
      );
      process.exit(1);
    }

    throw result.error;
  }

  process.exit(typeof result.status === 'number' ? result.status : 1);
}

function main() {
  const cli = parseCliArguments(process.argv.slice(2));
  const vscodeBin = process.env.PINGU_VSCODE_BIN || 'code';
  const args = buildVsCodeOpenArguments(cli.files, cli.suiteDir);

  if (cli.dryRun) {
    printDryRun(vscodeBin, args, cli.suiteDir);
    return;
  }

  runVsCode(vscodeBin, args);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildVsCodeOpenArguments,
  defaultFixtureFiles: internalDefaultFixtureFiles,
  defaultTargetDir,
  repoRoot,
  resolveFixtureFiles,
  resolveWorkspaceFile,
  workspaceFile: internalWorkspaceFile,
};
