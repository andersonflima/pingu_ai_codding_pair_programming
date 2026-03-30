#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeText } = require('../lib/analyzer');
const {
  buildExternalSuite,
  defaultTargetDir,
  loadExternalManifest,
} = require('./rebuild_external_agent_test');
const {
  MockRange,
  createMockVscode,
  installMockVscode,
} = require('./vscode_extension_smoke');
const { runNvimForFile } = require('./nvim_functional_smoke');

const repoRoot = path.resolve(__dirname, '..');
const actionableKinds = new Set([
  'comment_task',
  'context_file',
  'terminal_task',
  'unit_test',
]);

function parseCliArguments(argv) {
  const state = {
    editor: 'all',
    rebuild: true,
    targetDir: defaultTargetDir,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--no-rebuild') {
      state.rebuild = false;
      continue;
    }

    if (argument === '--target-dir' && argv[index + 1]) {
      state.targetDir = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument.startsWith('--target-dir=')) {
      state.targetDir = argument.slice('--target-dir='.length);
      continue;
    }

    if (argument === '--editor' && argv[index + 1]) {
      state.editor = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument.startsWith('--editor=')) {
      state.editor = argument.slice('--editor='.length);
    }
  }

  return state;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function unique(values) {
  return Array.from(new Set(values.filter((value) => value)));
}

function splitLines(text) {
  return String(text || '').replace(/\r\n/g, '\n').split('\n');
}

function lineAt(content, lineNumber) {
  const lines = splitLines(content);
  const index = Math.max(0, Number(lineNumber || 1) - 1);
  return lines[index] || '';
}

function firstNonEmptySnippetLine(snippet) {
  return splitLines(snippet)
    .map((line) => String(line || '').trim())
    .find((line) => line !== '') || '';
}

function createTempWorkspace(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function copyProjectFixture(targetDir, project) {
  const workspaceRoot = createTempWorkspace(`realtime-dev-agent-external-${project}-`);
  const sourceProject = path.join(targetDir, project);
  const targetProject = path.join(workspaceRoot, project);
  fs.cpSync(sourceProject, targetProject, { recursive: true });
  return {
    projectRoot: targetProject,
    workspaceRoot,
  };
}

function actionableIssuesForFile(targetFile) {
  return analyzeText(targetFile, fs.readFileSync(targetFile, 'utf8'), { maxLineLength: 120 })
    .filter((issue) => actionableKinds.has(String(issue.kind || '')));
}

function collectTriggerLines(beforeContent, issues, kind) {
  return unique(
    issues
      .filter((issue) => issue.kind === kind)
      .map((issue) => lineAt(beforeContent, issue.line))
      .map((line) => line.trim()),
  );
}

function verifyRemovedTriggerLines(afterContent, triggerLines, label) {
  triggerLines.forEach((triggerLine) => {
    if (!triggerLine) {
      return;
    }
    assert(!afterContent.includes(triggerLine), `${label}: gatilho ainda presente: ${triggerLine}`);
  });
}

function verifyWriteTargets(issues, label) {
  issues.forEach((issue) => {
    const action = issue.action || {};
    const targetFile = String(action.target_file || '').trim();
    if (!targetFile) {
      return;
    }

    assert(fs.existsSync(targetFile), `${label}: arquivo esperado nao foi criado: ${targetFile}`);

    const firstSnippetLine = firstNonEmptySnippetLine(issue.snippet || '');
    if (!firstSnippetLine) {
      return;
    }

    const targetContents = fs.readFileSync(targetFile, 'utf8');
    assert(
      targetContents.includes(firstSnippetLine),
      `${label}: arquivo criado nao contem o trecho esperado: ${targetFile}`,
    );
  });
}

function verifyCommentTask(caseEntry, beforeContent, afterContent, issues) {
  const commentIssues = issues.filter((issue) => issue.kind === 'comment_task');
  if (commentIssues.length === 0) {
    return null;
  }

  verifyRemovedTriggerLines(
    afterContent,
    collectTriggerLines(beforeContent, commentIssues, 'comment_task'),
    `${caseEntry.relativePath} comment_task`,
  );

  const expectedSnippets = caseEntry.expectedSnippetIncludes.length > 0
    ? caseEntry.expectedSnippetIncludes
    : unique(commentIssues.map((issue) => firstNonEmptySnippetLine(issue.snippet || '')));

  expectedSnippets.forEach((snippet) => {
    assert(
      afterContent.includes(snippet),
      `${caseEntry.relativePath} comment_task: snippet esperado nao encontrado: ${snippet}`,
    );
  });

  return {
    kind: 'comment_task',
    expectedSnippets: expectedSnippets.length,
    issues: commentIssues.length,
  };
}

function verifyContextFile(caseEntry, beforeContent, afterContent, issues) {
  const contextIssues = issues.filter((issue) => issue.kind === 'context_file');
  if (contextIssues.length === 0) {
    return null;
  }

  verifyRemovedTriggerLines(
    afterContent,
    collectTriggerLines(beforeContent, contextIssues, 'context_file'),
    `${caseEntry.relativePath} context_file`,
  );
  verifyWriteTargets(contextIssues, `${caseEntry.relativePath} context_file`);

  return {
    kind: 'context_file',
    generatedFiles: contextIssues.length,
  };
}

function verifyUnitTest(caseEntry, issues) {
  const unitIssues = issues.filter((issue) => issue.kind === 'unit_test');
  if (unitIssues.length === 0) {
    return null;
  }

  verifyWriteTargets(unitIssues, `${caseEntry.relativePath} unit_test`);

  return {
    kind: 'unit_test',
    generatedFiles: unitIssues.length,
  };
}

function verifyTerminalTask(caseEntry, beforeContent, afterContent, issues, terminalOutput) {
  const terminalIssues = issues.filter((issue) => issue.kind === 'terminal_task');
  if (terminalIssues.length === 0) {
    return null;
  }

  verifyRemovedTriggerLines(
    afterContent,
    collectTriggerLines(beforeContent, terminalIssues, 'terminal_task'),
    `${caseEntry.relativePath} terminal_task`,
  );

  if (typeof terminalOutput === 'string') {
    assert(
      terminalOutput.includes('[RealtimeDevAgent] exit code: 0'),
      `${caseEntry.relativePath} terminal_task: o VS Code nao registrou sucesso do comando.`,
    );
  }

  return {
    kind: 'terminal_task',
    commands: terminalIssues.length,
  };
}

function verifyCase(caseEntry, beforeContent, afterContent, issues, extra = {}) {
  const verifiers = [
    verifyCommentTask(caseEntry, beforeContent, afterContent, issues),
    verifyContextFile(caseEntry, beforeContent, afterContent, issues),
    verifyUnitTest(caseEntry, issues),
    verifyTerminalTask(caseEntry, beforeContent, afterContent, issues, extra.terminalOutput),
  ].filter(Boolean);

  return {
    case: caseEntry.relativePath,
    kinds: verifiers.map((item) => item.kind),
    details: verifiers,
  };
}

function clearVsCodeExtensionCache() {
  Object.keys(require.cache).forEach((cacheKey) => {
    if (cacheKey.startsWith(path.join(repoRoot, 'vscode'))) {
      delete require.cache[cacheKey];
    }
  });
}

function loadFreshVsCodeExtension() {
  clearVsCodeExtensionCache();
  return require(path.join(repoRoot, 'vscode', 'extension.js'));
}

function prepareCaseWorkspace(targetDir, caseEntry) {
  const project = String(caseEntry.project || '').trim();
  const copied = copyProjectFixture(targetDir, project);
  return {
    ...copied,
    targetFile: path.join(copied.workspaceRoot, caseEntry.relativePath),
  };
}

async function runVsCodeCase(targetDir, caseEntry) {
  const prepared = prepareCaseWorkspace(targetDir, caseEntry);
  const beforeContent = fs.readFileSync(prepared.targetFile, 'utf8');
  const issues = actionableIssuesForFile(prepared.targetFile);
  const vscode = createMockVscode(prepared.projectRoot);
  const restoreLoad = installMockVscode(vscode);

  try {
    const extension = loadFreshVsCodeExtension();
    extension.activate({
      extensionPath: repoRoot,
      subscriptions: [],
    });

    const document = await vscode.__mock.openFile(prepared.targetFile);
    vscode.__mock.setActiveDocument(document);
    await vscode.__mock.commands.get('realtimeDevAgent.analyzeCurrentFile')();

    const afterContent = fs.readFileSync(prepared.targetFile, 'utf8');
    const terminalOutput = vscode.__mock.terminals.map((terminal) => terminal.output).join('\n');

    return {
      ok: true,
      ...verifyCase(caseEntry, beforeContent, afterContent, issues, { terminalOutput }),
    };
  } catch (error) {
    return {
      ok: false,
      case: caseEntry.relativePath,
      error: error.stack || error.message || String(error),
    };
  } finally {
    restoreLoad();
    clearVsCodeExtensionCache();
  }
}

function runNvimCase(targetDir, caseEntry) {
  const prepared = prepareCaseWorkspace(targetDir, caseEntry);
  const beforeContent = fs.readFileSync(prepared.targetFile, 'utf8');
  const issues = actionableIssuesForFile(prepared.targetFile);
  const result = runNvimForFile(prepared.projectRoot, prepared.targetFile);

  if (result.status !== 0) {
    return {
      ok: false,
      case: caseEntry.relativePath,
      error: `${result.stderr || result.stdout || `nvim retornou ${result.status}`}`,
    };
  }

  try {
    const afterContent = fs.readFileSync(prepared.targetFile, 'utf8');
    return {
      ok: true,
      ...verifyCase(caseEntry, beforeContent, afterContent, issues),
    };
  } catch (error) {
    return {
      ok: false,
      case: caseEntry.relativePath,
      error: error.stack || error.message || String(error),
    };
  }
}

async function runVsCodeFollowUp(targetDir) {
  const prepared = copyProjectFixture(targetDir, 'javascript');
  const targetFile = path.join(prepared.projectRoot, 'src', '09_follow_up.js');

  fs.writeFileSync(targetFile, [
    'function revisarPedido() {',
    '  // TODO: revisar fluxo principal',
    '  return true;',
    '}',
    '',
  ].join('\n'), 'utf8');

  const vscode = createMockVscode(prepared.projectRoot);
  const restoreLoad = installMockVscode(vscode);

  try {
    const extension = loadFreshVsCodeExtension();
    extension.activate({
      extensionPath: repoRoot,
      subscriptions: [],
    });

    await vscode.workspace.getConfiguration().update('autoFixEnabled', false);
    const document = await vscode.__mock.openFile(targetFile);
    vscode.__mock.setActiveDocument(document);
    await vscode.__mock.commands.get('realtimeDevAgent.analyzeCurrentFile')();

    const diagnostics = vscode.__mock.diagnostics.get(document.uri.toString()) || [];
    const provider = vscode.__mock.codeActionProviders[0] && vscode.__mock.codeActionProviders[0].provider;
    const actions = await Promise.resolve(provider.provideCodeActions(
      document,
      new MockRange(1, 0, 1, 40),
      { diagnostics },
    ));
    const followUpAction = Array.isArray(actions)
      ? actions.find((action) => action && action.title === 'Pingu - Dev Agent: Insert actionable follow-up')
      : null;

    if (followUpAction && followUpAction.edit) {
      await vscode.workspace.applyEdit(followUpAction.edit);
    }

    const afterContent = fs.readFileSync(targetFile, 'utf8');
    assert(diagnostics.length > 0, 'follow_up: nenhum diagnostico elegivel foi publicado.');
    assert(Boolean(followUpAction), 'follow_up: code action do VS Code nao foi exposta.');
    assert(afterContent.includes('// : Use um ticket ou comentario estruturado'), 'follow_up: comentario acionavel nao foi inserido.');

    return {
      ok: true,
      case: 'javascript/src/09_follow_up.js',
      kinds: ['follow_up'],
      details: [{
        kind: 'follow_up',
        diagnostics: diagnostics.length,
      }],
    };
  } catch (error) {
    return {
      ok: false,
      case: 'javascript/src/09_follow_up.js',
      error: error.stack || error.message || String(error),
    };
  } finally {
    restoreLoad();
    clearVsCodeExtensionCache();
  }
}

function loadEditorCases(targetDir) {
  const manifest = loadExternalManifest(targetDir);
  return Array.isArray(manifest.editorCases) ? manifest.editorCases : [];
}

async function runVsCodeSuite(targetDir, cases) {
  const results = [];
  for (let index = 0; index < cases.length; index += 1) {
    const caseEntry = cases[index];
    process.stderr.write(`[validate:external-editors][vscode] ${index + 1}/${cases.length} ${caseEntry.relativePath}\n`);
    results.push(await runVsCodeCase(targetDir, caseEntry));
  }
  process.stderr.write(`[validate:external-editors][vscode] follow-up javascript/src/09_follow_up.js\n`);
  results.push(await runVsCodeFollowUp(targetDir));
  return results;
}

function runNvimSuite(targetDir, cases) {
  return cases.map((caseEntry, index) => {
    process.stderr.write(`[validate:external-editors][nvim] ${index + 1}/${cases.length} ${caseEntry.relativePath}\n`);
    return runNvimCase(targetDir, caseEntry);
  });
}

function summarizeResults(results) {
  return {
    ok: results.every((item) => item.ok),
    total: results.length,
    passed: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok),
  };
}

function writeReport(targetDir, report) {
  const reportFile = path.join(targetDir, 'editor-validation-report.json');
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return reportFile;
}

async function main() {
  const cli = parseCliArguments(process.argv.slice(2));
  const suite = cli.rebuild ? buildExternalSuite(cli.targetDir) : {
    targetDir: path.resolve(cli.targetDir),
    manifest: loadExternalManifest(cli.targetDir),
  };
  const cases = loadEditorCases(suite.targetDir);

  const report = {
    ok: true,
    targetDir: suite.targetDir,
    editors: {},
  };

  if (cli.editor === 'all' || cli.editor === 'nvim') {
    report.editors.nvim = summarizeResults(runNvimSuite(suite.targetDir, cases));
    report.ok = report.ok && report.editors.nvim.ok;
  }

  if (cli.editor === 'all' || cli.editor === 'vscode') {
    report.editors.vscode = summarizeResults(await runVsCodeSuite(suite.targetDir, cases));
    report.ok = report.ok && report.editors.vscode.ok;
  }

  report.reportFile = writeReport(suite.targetDir, report);

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message || String(error)}\n`);
  process.exit(1);
});
