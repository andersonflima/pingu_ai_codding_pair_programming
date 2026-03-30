#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const workspaceFile = path.join(
  repoRoot,
  'anget_test',
  'realtime-dev-agent-validation.code-workspace',
);
const defaultFixtureFiles = [
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
  return argv.reduce((state, argument) => {
    if (argument === '--dry-run') {
      return { ...state, dryRun: true };
    }

    return {
      ...state,
      files: state.files.concat(argument),
    };
  }, { dryRun: false, files: [] });
}

function resolveFixtureFiles(fileArguments) {
  const selectedFiles = fileArguments.length > 0 ? fileArguments : defaultFixtureFiles;
  return unique(selectedFiles.map(normalizeFilePath));
}

function buildVsCodeOpenArguments(fileArguments) {
  return ['--reuse-window', workspaceFile].concat(resolveFixtureFiles(fileArguments));
}

function printDryRun(bin, args) {
  const payload = {
    bin,
    args,
    workspaceFile,
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
  const args = buildVsCodeOpenArguments(cli.files);

  if (cli.dryRun) {
    printDryRun(vscodeBin, args);
    return;
  }

  runVsCode(vscodeBin, args);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildVsCodeOpenArguments,
  defaultFixtureFiles,
  repoRoot,
  resolveFixtureFiles,
  workspaceFile,
};
