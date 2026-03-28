'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const vscode = require('vscode');

function activate(context) {
  const diagnostics = vscode.languages.createDiagnosticCollection('realtime-dev-agent');
  const output = vscode.window.createOutputChannel('Realtime Dev Agent');
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  const pendingTimers = new Map();
  const pendingTerminalTasks = new Map();

  function configuration(uri) {
    return vscode.workspace.getConfiguration('realtimeDevAgent', uri);
  }

  function isEnabled(uri) {
    return configuration(uri).get('enabled', true);
  }

  function refreshStatusBar() {
    const enabled = isEnabled();
    statusBar.text = enabled ? '$(pulse) Realtime Agent' : '$(circle-slash) Realtime Agent';
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

  function createDiagnostic(document, issue) {
    const lineIndex = Math.max(0, Math.min(document.lineCount - 1, Number(issue.line || 1) - 1));
    const line = document.lineAt(lineIndex);
    const range = new vscode.Range(lineIndex, 0, lineIndex, line.text.length);
    const severity = mapSeverity(issue.severity);
    const suffix = issue.suggestion ? ` | ${issue.suggestion}` : '';
    const diagnostic = new vscode.Diagnostic(
      range,
      `${issue.kind}: ${issue.message}${suffix}`,
      severity,
    );
    diagnostic.source = 'realtime-dev-agent';
    diagnostic.code = issue.kind;
    return diagnostic;
  }

  function publishDiagnostics(document, issues) {
    diagnostics.set(document.uri, issues.map((issue) => createDiagnostic(document, issue)));
  }

  async function analyzeDocument(document, trigger) {
    if (!supportsDocument(document)) {
      return;
    }

    const config = configuration(document.uri);
    const nodePath = config.get('nodePath', 'node');
    const scriptPath = resolveScriptPath(document.uri);
    const maxLineLength = Number(config.get('maxLineLength', 120));
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const cwd = workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(document.fileName);

    try {
      const issues = await runAgent({
        nodePath,
        scriptPath,
        sourcePath: document.fileName,
        text: document.getText(),
        maxLineLength,
        cwd,
      });
      publishDiagnostics(document, issues);
      const terminalTaskApplied = await applyTerminalTasks(document, issues);
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

  context.subscriptions.push(
    diagnostics,
    output,
    statusBar,
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
      scheduleAnalysis(event.document);
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      clearPending(document.uri);
      diagnostics.delete(document.uri);
    }),
  );

  refreshStatusBar();
  if (vscode.window.activeTextEditor && isEnabled(vscode.window.activeTextEditor.document.uri)) {
    scheduleAnalysis(vscode.window.activeTextEditor.document);
  }

  function isTerminalIssue(issue) {
    return Boolean(
      issue
      && issue.kind === 'terminal_task'
      && issue.action
      && issue.action.op === 'run_command'
      && typeof issue.action.command === 'string'
      && issue.action.command.trim() !== ''
    );
  }

  function isTerminalActionsEnabled(uri) {
    return configuration(uri).get('terminalActionsEnabled', true);
  }

  function issueKey(document, issue) {
    return [
      document.uri.toString(),
      Number(issue.line || 1),
      issue.kind || '',
      issue.message || '',
      issue.action && issue.action.command || '',
    ].join('|');
  }

  function issueLineIndex(issue) {
    return Math.max(0, Number(issue.line || 1) - 1);
  }

  function issueTriggerText(document, issue) {
    const lineIndex = issueLineIndex(issue);
    if (lineIndex >= document.lineCount) {
      return '';
    }
    return document.lineAt(lineIndex).text;
  }

  function lineDeleteRange(document, lineIndex) {
    const start = new vscode.Position(lineIndex, 0);
    if (lineIndex < document.lineCount - 1) {
      return new vscode.Range(start, new vscode.Position(lineIndex + 1, 0));
    }
    return new vscode.Range(start, new vscode.Position(lineIndex, document.lineAt(lineIndex).text.length));
  }

  function resolveTriggerDeleteRange(document, issue, triggerText) {
    const lineIndex = issueLineIndex(issue);
    if (lineIndex < document.lineCount && document.lineAt(lineIndex).text === triggerText) {
      return lineDeleteRange(document, lineIndex);
    }

    if (!triggerText) {
      return undefined;
    }

    const targetIndex = Array.from({ length: document.lineCount }, (_, index) => index)
      .find((index) => document.lineAt(index).text === triggerText);
    if (typeof targetIndex !== 'number') {
      return undefined;
    }

    return lineDeleteRange(document, targetIndex);
  }

  async function removeTriggerLine(document, issue, triggerText) {
    const liveDocument = await vscode.workspace.openTextDocument(document.uri);
    const range = resolveTriggerDeleteRange(liveDocument, issue, triggerText);
    if (!range) {
      return false;
    }

    const edit = new vscode.WorkspaceEdit();
    edit.delete(liveDocument.uri, range);
    return vscode.workspace.applyEdit(edit);
  }

  function terminalStatusFile() {
    return path.join(
      os.tmpdir(),
      `realtime-dev-agent-terminal-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`,
    );
  }

  function terminalWrappedCommand(command, cwd, statusFile) {
    const prefix = cwd ? `cd ${shellEscape(cwd)} && ` : '';
    return `{ ${prefix}${command}; }; rda_status=$?; printf "%s" "$rda_status" > ${shellEscape(statusFile)}; exit $rda_status`;
  }

  function shellEscape(value) {
    return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
  }

  async function waitForTerminalExit(statusFile, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (fs.existsSync(statusFile)) {
        const raw = fs.readFileSync(statusFile, 'utf8').trim();
        fs.rmSync(statusFile, { force: true });
        return Number(raw || 1);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
  }

  async function applyTerminalTask(document, issue) {
    const key = issueKey(document, issue);
    if (pendingTerminalTasks.has(key)) {
      return false;
    }

    const action = issue.action || {};
    const command = String(action.command || '').trim();
    if (!command) {
      return false;
    }

    const cwd = String(action.cwd || '').trim()
      || (vscode.workspace.getWorkspaceFolder(document.uri)
        ? vscode.workspace.getWorkspaceFolder(document.uri).uri.fsPath
        : path.dirname(document.fileName));
    const triggerText = issueTriggerText(document, issue);
    const statusFile = terminalStatusFile();
    const terminal = vscode.window.createTerminal({
      name: 'Realtime Dev Agent',
      cwd,
    });

    pendingTerminalTasks.set(key, true);
    terminal.show(true);
    terminal.sendText(terminalWrappedCommand(command, cwd, statusFile), true);
    output.appendLine(`[RealtimeDevAgent] Executando no terminal do VS Code: ${command}`);

    try {
      const exitCode = await waitForTerminalExit(statusFile, 10 * 60 * 1000);
      if (exitCode === null) {
        output.appendLine('[RealtimeDevAgent] Timeout ao aguardar a acao de terminal no VS Code');
        output.show(true);
        return true;
      }

      if (exitCode !== 0) {
        output.appendLine(`[RealtimeDevAgent] Acao de terminal falhou com codigo ${exitCode}`);
        output.show(true);
        return true;
      }

      const removed = await removeTriggerLine(document, issue, triggerText);
      if (removed) {
        const refreshedDocument = await vscode.workspace.openTextDocument(document.uri);
        await analyzeDocument(refreshedDocument, 'terminal');
      }
      return true;
    } finally {
      pendingTerminalTasks.delete(key);
      if (fs.existsSync(statusFile)) {
        fs.rmSync(statusFile, { force: true });
      }
    }
  }

  async function applyTerminalTasks(document, issues) {
    if (!isTerminalActionsEnabled(document.uri)) {
      return false;
    }

    const terminalIssue = issues.find((issue) => isTerminalIssue(issue));
    if (!terminalIssue) {
      return false;
    }

    return applyTerminalTask(document, terminalIssue);
  }
}

function deactivate() {
  return undefined;
}

function mapSeverity(severity) {
  switch (severity) {
    case 'error':
      return vscode.DiagnosticSeverity.Error;
    case 'warning':
      return vscode.DiagnosticSeverity.Warning;
    default:
      return vscode.DiagnosticSeverity.Information;
  }
}

function runAgent({ nodePath, scriptPath, sourcePath, text, maxLineLength, cwd }) {
  return new Promise((resolve, reject) => {
    const args = [
      scriptPath,
      '--stdin',
      '--source-path',
      sourcePath,
      '--format',
      'json',
      '--max-line-length',
      String(maxLineLength),
    ];
    const child = spawn(nodePath, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      reject(error);
    });
    child.on('close', (code) => {
      const payload = stdout.trim();
      if (!payload) {
        if (code === 0) {
          resolve([]);
          return;
        }
        reject(new Error(stderr || `Realtime Dev Agent terminou com codigo ${code}`));
        return;
      }

      try {
        const issues = JSON.parse(payload);
        resolve(Array.isArray(issues) ? issues : []);
      } catch (error) {
        reject(new Error(stderr || error.message || 'Falha ao interpretar a resposta do agente'));
      }
    });

    child.stdin.end(text);
  });
}

module.exports = {
  activate,
  deactivate,
};
