#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { analyzeText } = require('../lib/analyzer');

const repoRoot = path.resolve(__dirname, '..');

const fixtureCases = [
  ['anget_test/javascript/src/01_comment_simple.js', ['comment_task']],
  ['anget_test/javascript/src/02_comment_advanced.js', ['comment_task']],
  ['anget_test/javascript/src/03_terminal_task.js', ['terminal_task']],
  ['anget_test/javascript/src/04_context_blueprint.js', ['context_file']],
  ['anget_test/javascript/src/05_escaped_marker.js', ['comment_task']],
  ['anget_test/javascript/src/06_unit_contract.js', ['unit_test']],
  ['anget_test/typescript/src/01_comment_simple.ts', ['comment_task']],
  ['anget_test/typescript/src/02_comment_advanced.ts', ['comment_task']],
  ['anget_test/typescript/src/03_unit_contract.ts', ['unit_test']],
  ['anget_test/react/src/01_d20_prompt.tsx', ['comment_task']],
  ['anget_test/react/src/02_component_contract.tsx', ['unit_test']],
  ['anget_test/python/app/01_d20_prompt.py', ['comment_task']],
  ['anget_test/python/app/02_unit_contract.py', ['unit_test']],
  ['anget_test/elixir/lib/01_d20_prompt.ex', ['comment_task']],
  ['anget_test/elixir/lib/03_terminal_task.exs', ['terminal_task']],
  ['anget_test/go/pkg/01_comment_prompt.go', ['comment_task']],
  ['anget_test/go/pkg/02_unit_contract.go', ['unit_test']],
  ['anget_test/rust/src/01_comment_prompt.rs', ['comment_task']],
  ['anget_test/rust/src/math.rs', ['unit_test']],
  ['anget_test/c/src/01_comment_prompt.c', ['comment_task']],
  ['anget_test/lua/lua/01_comment_simple.lua', ['comment_task']],
  ['anget_test/lua/lua/02_comment_advanced.lua', ['comment_task']],
  ['anget_test/lua/lua/03_unit_contract.lua', ['unit_test']],
  ['anget_test/vim/autoload/01_comment_prompt.vim', ['comment_task']],
  ['anget_test/docker/Dockerfile.prompt', ['comment_task', 'unit_test']],
  ['anget_test/docker/Dockerfile', ['unit_test']],
  ['anget_test/compose/docker-compose.yml', ['unit_test']],
  ['anget_test/markdown/prompt.md', ['comment_task']],
  ['anget_test/markdown/README.md', ['unit_test']],
  ['anget_test/mermaid/prompt.mmd', ['comment_task']],
  ['anget_test/mermaid/diagram.mmd', ['unit_test']],
  ['anget_test/terraform/prompt.tf', ['comment_task']],
  ['anget_test/terraform/main.tf', ['terraform_required_version']],
  ['anget_test/yaml/config.yaml', ['unit_test']],
  ['anget_test/syntax/javascript_extra_delimiter.js', ['syntax_extra_delimiter']],
  ['anget_test/syntax/javascript_missing_comma.js', ['syntax_missing_comma']],
  ['anget_test/syntax/lua_missing_quote.lua', ['syntax_missing_quote']],
  ['anget_test/syntax/markdown_unclosed_fence.md', ['syntax_missing_delimiter']],
];

function readFile(relativeFile) {
  return fs.readFileSync(path.join(repoRoot, relativeFile), 'utf8');
}

function analyzeFixture(relativeFile) {
  const absoluteFile = path.join(repoRoot, relativeFile);
  return analyzeText(absoluteFile, readFile(relativeFile), { maxLineLength: 120 });
}

function runFixtureMatrix() {
  const failures = fixtureCases.reduce((accumulator, [relativeFile, expectedKinds]) => {
    const kinds = new Set(analyzeFixture(relativeFile).map((issue) => issue.kind));
    const missingKinds = expectedKinds.filter((kind) => !kinds.has(kind));
    if (missingKinds.length === 0) {
      return accumulator;
    }

    return accumulator.concat({
      relativeFile,
      expectedKinds,
      actualKinds: Array.from(kinds).sort(),
      missingKinds,
    });
  }, []);

  return {
    ok: failures.length === 0,
    total: fixtureCases.length,
    failures,
  };
}

function findTerminalIssue(relativeFile) {
  return analyzeFixture(relativeFile).find((issue) => issue.kind === 'terminal_task');
}

function runCommand(command, cwd) {
  return spawnSync('/bin/sh', ['-lc', command], {
    cwd,
    encoding: 'utf8',
  });
}

function runExternalChecks(externalFixturesDir) {
  const externalRoot = path.resolve(externalFixturesDir);
  const checks = [];

  const cTerminalIssue = findTerminalIssue('anget_test/c/src/01_comment_prompt.c');
  const cRoot = path.join(externalRoot, 'c');
  if (cTerminalIssue && fs.existsSync(cRoot)) {
    const cResult = runCommand(cTerminalIssue.action.command, cRoot);
    checks.push({
      name: 'external-c-terminal-task',
      ok: cResult.status === 0,
      status: cResult.status,
      stdout: cResult.stdout,
      stderr: cResult.stderr,
    });
  }

  const elixirRoot = path.join(externalRoot, 'elixir');
  if (fs.existsSync(elixirRoot)) {
    const elixirResult = spawnSync('mix', ['test'], {
      cwd: elixirRoot,
      encoding: 'utf8',
    });
    const sandboxPubSubDenied = String(elixirResult.stderr || '').includes('Mix.PubSub')
      && String(elixirResult.stderr || '').includes(':eperm');
    checks.push({
      name: 'external-elixir-mix-test',
      ok: elixirResult.status === 0 || sandboxPubSubDenied,
      skipped: sandboxPubSubDenied,
      status: elixirResult.status,
      stdout: elixirResult.stdout,
      stderr: elixirResult.stderr,
    });
  }

  return checks;
}

function parseExternalDir(argv) {
  const explicitIndex = argv.indexOf('--external-dir');
  if (explicitIndex !== -1 && argv[explicitIndex + 1]) {
    return argv[explicitIndex + 1];
  }
  return process.env.PINGU_EXTERNAL_FIXTURES_DIR || '';
}

function main() {
  const summary = {
    matrix: runFixtureMatrix(),
    external: [],
  };

  const externalDir = parseExternalDir(process.argv.slice(2));
  if (externalDir) {
    summary.external = runExternalChecks(externalDir);
  }

  const failingExternal = summary.external.filter((item) => !item.ok);
  const ok = summary.matrix.ok && failingExternal.length === 0;

  console.log(JSON.stringify({
    ok,
    matrix: {
      ok: summary.matrix.ok,
      total: summary.matrix.total,
      failures: summary.matrix.failures,
    },
    external: summary.external,
  }, null, 2));

  process.exit(ok ? 0 : 1);
}

main();
