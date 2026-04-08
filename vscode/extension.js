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
const {
  autoFixNoOpReason,
  semanticPriorityForIssue,
} = require('../lib/issue-confidence');
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
  const analysisCache = new Map();
  const analysisRequestIds = new Map();

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

  function uriKey(uri) {
    return uri ? uri.toString() : '';
  }

  function documentVersion(document) {
    return Number.isFinite(document && document.version) ? Number(document.version) : null;
  }

  function resolveLiveDocument(uri) {
    if (!uri) {
      return null;
    }

    return vscode.workspace.textDocuments.find((document) => supportsDocument(document) && uriKey(document.uri) === uriKey(uri)) || null;
  }

  function clearPending(uri) {
    const key = uriKey(uri);
    const timer = pendingTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      pendingTimers.delete(key);
    }
  }

  function invalidateAnalysis(uri) {
    analysisCache.delete(uriKey(uri));
  }

  function nextAnalysisRequestId(uri) {
    const key = uriKey(uri);
    const nextId = Number(analysisRequestIds.get(key) || 0) + 1;
    analysisRequestIds.set(key, nextId);
    return nextId;
  }

  function isLatestAnalysisRequest(uri, requestId) {
    return Number(analysisRequestIds.get(uriKey(uri)) || 0) === Number(requestId || 0);
  }

  function configuredRealtimeAutoFixMaxPerPass(uri) {
    const configured = Number(configuration(uri).get('realtimeAutoFixMaxPerPass', 2));
    if (!Number.isFinite(configured)) {
      return 2;
    }
    return Math.max(0, Math.trunc(configured));
  }

  function analysisModeForTrigger(uri, trigger) {
    const normalizedTrigger = String(trigger || '').trim();
    if (['change', 'focus', 'open', 'startup'].includes(normalizedTrigger)) {
      const configured = String(configuration(uri).get('realtimeAnalysisMode', 'light') || '').trim().toLowerCase();
      return configured === 'full' ? 'full' : 'light';
    }
    return 'full';
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
    const openAiModel = String(config.get('openAiModel', 'gpt-5-codex') || '').trim();
    const openAiTimeoutMs = Number(config.get('openAiTimeoutMs', 30000));
    return {
      ...process.env,
      ...(openAiModel ? { PINGU_OPENAI_MODEL: openAiModel } : {}),
      PINGU_OPENAI_TIMEOUT_MS: String(Number.isFinite(openAiTimeoutMs) && openAiTimeoutMs > 0 ? openAiTimeoutMs : 30000),
    };
  }

  let editRuntime;
  let terminalRuntime;
  let codeActionRuntime;

  async function collectIssues(document, options = {}) {
    if (!supportsDocument(document)) {
      return [];
    }

    const key = uriKey(document.uri);
    const version = documentVersion(document);
    const analysisMode = String(options.analysisMode || 'full').trim().toLowerCase() === 'light' ? 'light' : 'full';
    const cached = analysisCache.get(key);
    if (cached && cached.version === version) {
      const canReuseCached = cached.mode === 'full' || cached.mode === analysisMode;
      if (canReuseCached && Array.isArray(cached.issues)) {
        return cached.issues;
      }
      if (canReuseCached && cached.promise) {
        return cached.promise;
      }
    }

    const config = configuration(document.uri);
    const nodePath = config.get('nodePath', 'node');
    const scriptPath = resolveScriptPath(document.uri);
    const maxLineLength = Number(config.get('maxLineLength', 120));
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const cwd = workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(document.fileName);

    const promise = runAgent({
      spawn,
      nodePath,
      scriptPath,
      sourcePath: document.fileName,
      text: document.getText(),
      maxLineLength,
      analysisMode,
      cwd,
      env: resolveAgentEnvironment(document.uri),
    }).then((issues) => {
      const current = analysisCache.get(key);
      if (current && current.promise === promise) {
        analysisCache.set(key, {
          version,
          mode: analysisMode,
          issues,
          promise: null,
        });
      }
      return issues;
    }).catch((error) => {
      const current = analysisCache.get(key);
      if (current && current.promise === promise) {
        analysisCache.delete(key);
      }
      throw error;
    });
    analysisCache.set(key, {
      version,
      mode: analysisMode,
      issues: null,
      promise,
    });
    return promise;
  }

  async function analyzeDocument(document, trigger, options = {}) {
    if (!supportsDocument(document)) {
      return;
    }

    const requestId = nextAnalysisRequestId(document.uri);
    const requestedVersion = documentVersion(document);

    try {
      const analysisMode = analysisModeForTrigger(document.uri, trigger);
      const issues = Array.isArray(options.issues)
        ? options.issues
        : await collectIssues(document, { analysisMode });
      const liveDocument = resolveLiveDocument(document.uri) || document;
      if (!supportsDocument(liveDocument)) {
        return;
      }
      if (!isLatestAnalysisRequest(liveDocument.uri, requestId)) {
        return;
      }
      if (documentVersion(liveDocument) !== requestedVersion) {
        return;
      }

      const autoFixApplied = options.skipAutoFix
        ? false
        : await editRuntime.applyAutoFixes(liveDocument, issues, {
          trigger,
        });
      if (autoFixApplied) {
        return;
      }

      publishDiagnostics(vscode, diagnostics, issuesByUri, liveDocument, issues);
      const terminalTaskApplied = options.skipTerminalTasks
        ? false
        : await terminalRuntime.applyTerminalTasks(liveDocument, issues);
      if (terminalTaskApplied) {
        return;
      }
      if (trigger === 'manual') {
        output.appendLine(`[RealtimeDevAgent] ${issues.length} item(ns) em ${liveDocument.fileName}`);
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

  function scheduleAnalysis(document, trigger = 'change') {
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
      pendingTimers.delete(uriKey(document.uri));
      const liveDocument = resolveLiveDocument(document.uri);
      if (!supportsDocument(liveDocument) || !isEnabled(liveDocument.uri)) {
        return;
      }
      analyzeDocument(liveDocument, trigger);
    }, delay);
    pendingTimers.set(uriKey(document.uri), timer);
  }

  editRuntime = createEditRuntime({
    fs,
    path,
    vscode,
    analyzeDocument,
    collectIssues,
    configuredAutoFixKinds,
    fixPriorityForKind,
    autoFixNoOpReason,
    configuredRealtimeAutoFixMaxPerPass,
    isAutoFixEnabled,
    mustClearKindsForIssue,
    resolveIssueAction,
    semanticPriorityForIssue,
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
      clearPending(editor.document.uri);
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
        scheduleAnalysis(vscode.window.activeTextEditor.document, 'focus');
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('realtimeDevAgent')) {
        return;
      }
      refreshStatusBar();
      if (vscode.window.activeTextEditor && isEnabled(vscode.window.activeTextEditor.document.uri)) {
        scheduleAnalysis(vscode.window.activeTextEditor.document, 'focus');
      }
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (!supportsDocument(document) || !isEnabled(document.uri)) {
        return;
      }
      if (!configuration(document.uri).get('realtimeOnSave', true)) {
        return;
      }
      clearPending(document.uri);
      analyzeDocument(document, 'save');
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (!supportsDocument(event.document) || !isEnabled(event.document.uri)) {
        return;
      }
      terminalRuntime.clearTerminalAttempts(event.document.uri);
      scheduleAnalysis(event.document, 'change');
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (!supportsDocument(document) || !isEnabled(document.uri)) {
        return;
      }
      scheduleAnalysis(document, 'open');
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!editor || !supportsDocument(editor.document) || !isEnabled(editor.document.uri)) {
        return;
      }
      scheduleAnalysis(editor.document, 'focus');
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      clearPending(document.uri);
      invalidateAnalysis(document.uri);
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
    scheduleAnalysis(document, 'startup');
  });
}

function deactivate() {
  return undefined;
}

module.exports = {
  activate,
  deactivate,
};
