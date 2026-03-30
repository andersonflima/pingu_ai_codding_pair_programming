#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  fixtureCases,
  repoRoot,
  snippetExpectations,
} = require('./validate_agent_matrix');

const defaultTargetDir = path.join(os.homedir(), 'snippets', 'agent_test');
const actionableKinds = new Set([
  'comment_task',
  'context_file',
  'terminal_task',
  'unit_test',
]);

function parseCliArguments(argv) {
  return argv.reduce((state, argument, index, items) => {
    if (argument === '--target-dir' && items[index + 1]) {
      return {
        ...state,
        targetDir: items[index + 1],
      };
    }

    if (argument.startsWith('--target-dir=')) {
      return {
        ...state,
        targetDir: argument.slice('--target-dir='.length),
      };
    }

    return state;
  }, {
    targetDir: defaultTargetDir,
  });
}

function externalRelativePath(relativeFile) {
  return String(relativeFile || '').replace(/^anget_test\//, '');
}

function buildEntry(relativeFile, expectedKinds) {
  const relativePath = externalRelativePath(relativeFile);
  const expectedSnippetIncludes = snippetExpectations[relativeFile] || [];
  const relevantKinds = expectedKinds.filter((kind) => actionableKinds.has(kind));
  const project = relativePath.split('/')[0] || '';

  return {
    relativeFile,
    relativePath,
    project,
    expectedKinds,
    actionableKinds: relevantKinds,
    expectedSnippetIncludes,
  };
}

function groupEntriesByProject(entries) {
  return entries.reduce((groups, entry) => {
    const key = entry.project || 'root';
    const previous = groups[key] || [];
    return {
      ...groups,
      [key]: previous.concat(entry),
    };
  }, {});
}

function buildManifest(targetDir) {
  const entries = fixtureCases.map(([relativeFile, expectedKinds]) => buildEntry(relativeFile, expectedKinds));
  const actionableEntries = entries.filter((entry) => entry.actionableKinds.length > 0);
  const grouped = groupEntriesByProject(actionableEntries);
  const languageSummaries = Object.keys(grouped).sort().map((project) => ({
    project,
    files: grouped[project].map((entry) => ({
      relativePath: entry.relativePath,
      actionableKinds: entry.actionableKinds,
    })),
    totalFiles: grouped[project].length,
  }));

  return {
    generatedAt: new Date().toISOString(),
    sourceDir: path.join(repoRoot, 'anget_test'),
    targetDir,
    totalFiles: entries.length,
    actionableFiles: actionableEntries.length,
    projects: languageSummaries,
    editorCases: actionableEntries,
    defaultVsCodeFiles: actionableEntries.map((entry) => entry.relativePath),
  };
}

function buildWorkspacePayload() {
  return {
    folders: [
      {
        name: 'agent_test',
        path: '.',
      },
    ],
    settings: {
      'workbench.editor.enablePreview': false,
    },
  };
}

function writeJsonFile(targetFile, payload) {
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.writeFileSync(targetFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function buildExternalSuite(targetDir = defaultTargetDir) {
  const sourceDir = path.join(repoRoot, 'anget_test');
  const absoluteTargetDir = path.resolve(targetDir);

  fs.rmSync(absoluteTargetDir, {
    recursive: true,
    force: true,
  });
  fs.mkdirSync(path.dirname(absoluteTargetDir), { recursive: true });
  fs.cpSync(sourceDir, absoluteTargetDir, { recursive: true });

  const manifest = buildManifest(absoluteTargetDir);
  const workspaceFile = path.join(absoluteTargetDir, 'realtime-dev-agent-validation.code-workspace');
  const manifestFile = path.join(absoluteTargetDir, 'agent-suite-manifest.json');

  writeJsonFile(workspaceFile, buildWorkspacePayload());
  writeJsonFile(manifestFile, manifest);

  return {
    targetDir: absoluteTargetDir,
    workspaceFile,
    manifestFile,
    manifest,
  };
}

function loadExternalManifest(targetDir = defaultTargetDir) {
  const manifestFile = path.join(path.resolve(targetDir), 'agent-suite-manifest.json');
  return JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
}

function main() {
  const cli = parseCliArguments(process.argv.slice(2));
  const summary = buildExternalSuite(cli.targetDir);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    targetDir: summary.targetDir,
    workspaceFile: summary.workspaceFile,
    manifestFile: summary.manifestFile,
    actionableFiles: summary.manifest.actionableFiles,
    projects: summary.manifest.projects.map((item) => ({
      project: item.project,
      totalFiles: item.totalFiles,
    })),
  }, null, 2)}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  actionableKinds,
  buildExternalSuite,
  defaultTargetDir,
  externalRelativePath,
  loadExternalManifest,
};
