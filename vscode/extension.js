'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const vscode = require('vscode');
const { buildFollowUpComment } = require('../lib/follow-up');
const {
  defaultAutoFixKinds,
  fixPriorityForKind,
  mustClearKindsForIssue,
  resolveIssueAction,
  supportsFollowUp,
} = require('../lib/issue-kinds');
const { runAgent } = require('./agent-process');
const { publishDiagnostics } = require('./diagnostics');
const { createCodeActionRuntime } = require('./code-actions');
const { createEditRuntime } = require('./edits');
const { createTerminalRuntime } = require('./terminal');

function activate(context) {
  const diagnostics = vscode.languages.createDiagnosticCollection('realtime-dev-agent');
  const output = vscode.window.createOutputChannel('Pingu - Dev Agent');
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  const issuesByUri = new Map();
  const pendingTimers = new Map();

  function configuration(uri) {
    return vscode.workspace.getConfiguration('realtimeDevAgent', uri);
  }

  function isEnabled(uri) {
    return configuration(uri).get('enabled', true);
  }

  function isAutoFixEnabled(uri) {
    return configuration(uri).get('autoFixEnabled', true);
  }

  function configuredAutoFixKinds(uri) {
    const defaults = defaultAutoFixKinds().filter((kind) => resolveIssueAction({ kind }).op !== 'run_command');
    const configured = configuration(uri).get('autoFixKinds', defaults);
    if (!Array.isArray(configured) || configured.length === 0) {
      return defaults;
    }
    return configured.map((item) => String(item || '').trim()).filter((item) => item !== '');
  }

  function isTerminalActionsEnabled(uri) {
    return configuration(uri).get('terminalActionsEnabled', true);
  }

  function terminalRiskMode(uri) {
    return configuration(uri).get('terminalRiskMode', 'workspace_write');
  }

  function refreshStatusBar() {
    const enabled = isEnabled();
    statusBar.text = enabled ? '$(pulse) Pingu Agent' : '$(circle-slash) Pingu Agent';
    statusBar.tooltip = enabled
      ? 'Analise em tempo real ativa'
      : 'Analise em tempo real desativada';
    statusBar.command = 'realtimeDevAgent.toggleRealtime';
    statusBar.show();
  }

  function supportsDocument(document) {
    return Boolean(document) && document.uri.scheme === 'file' && !document.isClosed;
  }

  function clearPending(uri) {
    const key = uri.toString();
    const timer = pendingTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      pendingTimers.delete(key);
    }
  }

  function resolveScriptPath(uri) {
    const configured = configuration(uri).get('scriptPath', '').trim();
    if (!configured) {
      return path.join(context.extensionPath, 'realtime_dev_agent.js');
    }
    return path.isAbsolute(configured)
      ? configured
      : path.join(context.extensionPath, configured);
  }

  function resolveAgentEnvironment(uri) {
    const config = configuration(uri);
    const aiCommand = String(config.get('commentTaskAiCommand', '') || '').trim();
    const aiTimeoutMs = Number(config.get('commentTaskAiTimeoutMs', 4000));
    return {
      ...process.env,
      ...(aiCommand ? { PINGU_COMMENT_TASK_AI_CMD: aiCommand } : {}),
      PINGU_COMMENT_TASK_AI_TIMEOUT_MS: String(Number.isFinite(aiTimeoutMs) && aiTimeoutMs > 0 ? aiTimeoutMs : 4000),
    };
  }

  let editRuntime;
  let terminalRuntime;
  let codeActionRuntime;

  async function collectIssues(document) {
    if (!supportsDocument(document)) {
      return [];
    }

    const config = configuration(document.uri);
    const nodePath = config.get('nodePath', 'node');
    const scriptPath = resolveScriptPath(document.uri);
    const maxLineLength = Number(config.get('maxLineLength', 120));
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const cwd = workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(document.fileName);

    return runAgent({
      spawn,
      nodePath,
      scriptPath,
      sourcePath: document.fileName,
      text: document.getText(),
      maxLineLength,
      cwd,
      env: resolveAgentEnvironment(document.uri),
    });
  }

  async function analyzeDocument(document, trigger) {
    if (!supportsDocument(document)) {
      return;
    }

    try {
      const issues = await collectIssues(document);
      const autoFixApplied = await editRuntime.applyAutoFixes(document, issues);
      if (autoFixApplied) {
        return;
      }

      publishDiagnostics(vscode, diagnostics, issuesByUri, document, issues);
      const terminalTaskApplied = await terminalRuntime.applyTerminalTasks(document, issues);
      if (terminalTaskApplied) {
        return;
      }
      if (trigger === 'manual') {
        output.appendLine(`[RealtimeDevAgent] ${issues.length} item(ns) em ${document.fileName}`);
        if (issues.length > 0) {
          output.show(true);
        }
      }
    } catch (error) {
      issuesByUri.delete(document.uri.toString());
      diagnostics.delete(document.uri);
      output.appendLine(`[RealtimeDevAgent] Falha ao analisar ${document.fileName}`);
      output.appendLine(String(error && (error.stack || error.message) || error));
      output.show(true);
    }
  }

  function scheduleAnalysis(document) {
    if (!supportsDocument(document) || !isEnabled(document.uri)) {
      return;
    }

    const config = configuration(document.uri);
    if (!config.get('realtimeOnChange', true)) {
      return;
    }

    clearPending(document.uri);
    const delay = Math.max(150, Number(config.get('changeDebounceMs', 1200)));
    const timer = setTimeout(() => {
      pendingTimers.delete(document.uri.toString());
      analyzeDocument(document, 'change');
    }, delay);
    pendingTimers.set(document.uri.toString(), timer);
  }

  editRuntime = createEditRuntime({
    fs,
    path,
    vscode,
    analyzeDocument,
    collectIssues,
    configuredAutoFixKinds,
    fixPriorityForKind,
    isAutoFixEnabled,
    mustClearKindsForIssue,
    resolveIssueAction,
  });

  terminalRuntime = createTerminalRuntime({
    path,
    spawn,
    vscode,
    analyzeDocument,
    getTerminalRiskMode: terminalRiskMode,
    isTerminalActionsEnabled,
    issueActionIdentity: editRuntime.issueActionIdentity,
    issueKey: editRuntime.issueKey,
    issueLineIndex: editRuntime.issueLineIndex,
    issueTriggerText: editRuntime.issueTriggerText,
    output,
    removeTriggerLine: editRuntime.removeTriggerLine,
    resolveIssueAction,
  });

  codeActionRuntime = createCodeActionRuntime({
    buildFollowUpComment,
    issueIntersectsRange: editRuntime.issueIntersectsRange,
    issueLineIndex: editRuntime.issueLineIndex,
    isEnabled,
    issuesByUri,
    supportsDocument,
    supportsFollowUp,
    vscode,
  });

  context.subscriptions.push(
    diagnostics,
    output,
    statusBar,
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file' },
      {
        provideCodeActions(document, range) {
          return codeActionRuntime.provideCodeActions(document, range);
        },
      },
    ),
    vscode.commands.registerCommand('realtimeDevAgent.analyzeCurrentFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      await analyzeDocument(editor.document, 'manual');
    }),
    vscode.commands.registerCommand('realtimeDevAgent.toggleRealtime', async () => {
      const enabled = isEnabled();
      await vscode.workspace.getConfiguration('realtimeDevAgent').update(
        'enabled',
        !enabled,
        vscode.ConfigurationTarget.Global,
      );
      refreshStatusBar();
      if (!enabled && vscode.window.activeTextEditor) {
        scheduleAnalysis(vscode.window.activeTextEditor.document);
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('realtimeDevAgent')) {
        return;
      }
      refreshStatusBar();
      if (vscode.window.activeTextEditor && isEnabled(vscode.window.activeTextEditor.document.uri)) {
        scheduleAnalysis(vscode.window.activeTextEditor.document);
      }
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (!supportsDocument(document) || !isEnabled(document.uri)) {
        return;
      }
      if (!configuration(document.uri).get('realtimeOnSave', true)) {
        return;
      }
      analyzeDocument(document, 'save');
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (!supportsDocument(event.document) || !isEnabled(event.document.uri)) {
        return;
      }
      terminalRuntime.clearTerminalAttempts(event.document.uri);
      scheduleAnalysis(event.document);
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (!supportsDocument(document) || !isEnabled(document.uri)) {
        return;
      }
      scheduleAnalysis(document);
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!editor || !supportsDocument(editor.document) || !isEnabled(editor.document.uri)) {
        return;
      }
      scheduleAnalysis(editor.document);
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      clearPending(document.uri);
      terminalRuntime.clearTerminalAttempts(document.uri);
      issuesByUri.delete(document.uri.toString());
      diagnostics.delete(document.uri);
    }),
    vscode.window.onDidCloseTerminal((terminal) => {
      terminalRuntime.handleTerminalClosed(terminal);
    }),
  );

  refreshStatusBar();
  const startupDocuments = new Map();
  vscode.window.visibleTextEditors.forEach((editor) => {
    if (!supportsDocument(editor.document) || !isEnabled(editor.document.uri)) {
      return;
    }
    startupDocuments.set(editor.document.uri.toString(), editor.document);
  });
  startupDocuments.forEach((document) => {
    scheduleAnalysis(document);
  });
}

function deactivate() {
  return undefined;
}

module.exports = {
  activate,
  deactivate,
};
