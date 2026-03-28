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
  const defaultAutoFixKinds = [
    'moduledoc',
    'function_spec',
    'function_doc',
    'missing_dependency',
    'functional_reassignment',
    'trailing_whitespace',
    'tabs',
    'undefined_variable',
    'debug_output',
    'comment_task',
    'context_file',
    'unit_test',
    'syntax_missing_quote',
    'syntax_extra_delimiter',
    'syntax_missing_delimiter',
    'syntax_missing_comma',
    'markdown_title',
    'terraform_required_version',
    'dockerfile_workdir',
  ];
  const fixPriority = [
    'syntax_missing_quote',
    'syntax_extra_delimiter',
    'syntax_missing_delimiter',
    'syntax_missing_comma',
    'undefined_variable',
    'comment_task',
    'moduledoc',
    'function_spec',
    'function_doc',
    'functional_reassignment',
    'debug_output',
    'missing_dependency',
    'context_file',
    'unit_test',
    'trailing_whitespace',
    'tabs',
    'todo_fixme',
    'nested_condition',
    'long_line',
    'large_file',
  ];
  const issueDefaultActions = {
    moduledoc: { op: 'insert_before' },
    debug_output: { op: 'replace_line' },
    todo_fixme: { op: 'insert_before' },
    comment_task: { op: 'replace_line' },
    context_file: { op: 'write_file' },
    terminal_task: { op: 'run_command' },
    unit_test: { op: 'write_file' },
    syntax_missing_quote: { op: 'replace_line' },
    syntax_extra_delimiter: { op: 'replace_line' },
    syntax_missing_delimiter: { op: 'insert_after' },
    syntax_missing_comma: { op: 'replace_line' },
    markdown_title: { op: 'insert_before' },
    terraform_required_version: { op: 'insert_before' },
    dockerfile_workdir: { op: 'insert_after' },
    missing_dependency: { op: 'insert_before' },
    undefined_variable: { op: 'replace_line' },
    trailing_whitespace: { op: 'replace_line' },
    function_doc: { op: 'insert_before' },
    flow_comment: { op: 'insert_before' },
    function_spec: { op: 'insert_before' },
    functional_reassignment: { op: 'insert_before' },
    long_line: { op: 'insert_before' },
    nested_condition: { op: 'insert_before' },
    large_file: { op: 'insert_before' },
    tabs: { op: 'replace_line' },
  };

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
    const configured = configuration(uri).get('autoFixKinds', defaultAutoFixKinds);
    if (!Array.isArray(configured) || configured.length === 0) {
      return defaultAutoFixKinds;
    }
    return configured.map((item) => String(item || '').trim()).filter((item) => item !== '');
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
      const autoFixApplied = await applyAutoFixes(document, issues);
      if (autoFixApplied) {
        return;
      }

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
      diagnostics.delete(document.uri);
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

  function issueDefaultAction(kind) {
    return issueDefaultActions[String(kind || '')] || { op: 'insert_before' };
  }

  function issueEffectiveAction(issue) {
    if (issue && issue.action && typeof issue.action === 'object' && issue.action.op) {
      return issue.action;
    }
    return issueDefaultAction(issue && issue.kind);
  }

  function issueKey(document, issue) {
    return [
      document.uri.toString(),
      Number(issue.line || 1),
      issue.kind || '',
      issue.message || '',
      issueActionIdentity(issue),
    ].join('|');
  }

  function issueActionIdentity(issue) {
    const action = issueEffectiveAction(issue);
    if (action.op === 'write_file') {
      return String(action.target_file || '');
    }
    if (action.op === 'run_command') {
      return String(action.command || '');
    }
    return String(issue && issue.snippet || '');
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

  async function removeTriggerResidue(document, triggerText) {
    if (!triggerText) {
      return false;
    }

    const liveDocument = await vscode.workspace.openTextDocument(document.uri);
    for (let index = 0; index < liveDocument.lineCount; index += 1) {
      if (liveDocument.lineAt(index).text !== triggerText) {
        continue;
      }
      const edit = new vscode.WorkspaceEdit();
      edit.delete(liveDocument.uri, lineDeleteRange(liveDocument, index));
      return vscode.workspace.applyEdit(edit);
    }

    return false;
  }

  function splitSnippetLines(snippet) {
    return String(snippet || '').replace(/\r\n/g, '\n').split('\n');
  }

  function detectIndent(text) {
    const match = /^\s*/.exec(String(text || ''));
    return match ? match[0] : '';
  }

  function commonIndentLength(lines) {
    const nonEmpty = lines.filter((line) => String(line || '').trim() !== '');
    if (nonEmpty.length === 0) {
      return 0;
    }

    return nonEmpty.reduce((smallest, line) => {
      const indentLength = detectIndent(line).length;
      return smallest === null ? indentLength : Math.min(smallest, indentLength);
    }, null) || 0;
  }

  function normalizeSnippetLines(snippetLines, indent) {
    const normalized = Array.isArray(snippetLines) ? [...snippetLines] : [String(snippetLines || '')];
    const commonIndent = commonIndentLength(normalized);
    return normalized.map((line) => {
      const value = String(line || '');
      if (value === '') {
        return '';
      }
      const withoutCommonIndent = commonIndent > 0 ? value.slice(commonIndent) : value;
      return `${indent}${withoutCommonIndent}`;
    });
  }

  function documentBlockEquals(document, startLine, snippetLines) {
    if (startLine < 0 || startLine + snippetLines.length > document.lineCount) {
      return false;
    }

    for (let offset = 0; offset < snippetLines.length; offset += 1) {
      if (document.lineAt(startLine + offset).text !== snippetLines[offset]) {
        return false;
      }
    }

    return true;
  }

  function snippetExistsNearby(document, lineIndex, snippetLines, action, op) {
    if (!snippetLines.length || document.lineCount === 0) {
      return false;
    }

    const insertionLine = op === 'insert_after' ? lineIndex + 1 : lineIndex;
    const lookahead = Math.max(
      0,
      Number(action.lookahead ?? action.dedupeLookahead ?? (snippetLines.length + 4)) || 0,
    );
    const lookbehind = Math.max(
      0,
      Number(action.lookbehind ?? action.dedupeLookbehind ?? (snippetLines.length + 4)) || 0,
    );
    const startLine = Math.max(0, insertionLine - lookbehind);
    const endLine = Math.min(document.lineCount - snippetLines.length, insertionLine + lookahead);

    for (let cursor = startLine; cursor <= endLine; cursor += 1) {
      if (documentBlockEquals(document, cursor, snippetLines)) {
        return true;
      }
    }

    return false;
  }

  async function applyWriteFileIssue(document, issue, snippetLines) {
    const action = issueEffectiveAction(issue);
    const targetFile = String(action.target_file || '').trim();
    if (!targetFile) {
      return false;
    }

    const targetDir = path.dirname(targetFile);
    if (action.mkdir_p) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    fs.writeFileSync(targetFile, snippetLines.join('\n'), 'utf8');

    if (action.remove_trigger) {
      const triggerText = issueTriggerText(document, issue);
      await removeTriggerLine(document, issue, triggerText);
    }

    return true;
  }

  async function applySnippetIssue(document, issue) {
    const liveDocument = await vscode.workspace.openTextDocument(document.uri);
    const action = issueEffectiveAction(issue);
    const op = String(action.op || '');
    const kind = String(issue.kind || '');
    const lineIndex = issueLineIndex(issue);
    const boundedLineIndex = Math.max(0, Math.min(lineIndex, Math.max(liveDocument.lineCount - 1, 0)));
    const triggerText = issueTriggerText(liveDocument, issue);

    if (op === 'write_file') {
      const snippetLines = splitSnippetLines(issue.snippet || '');
      return applyWriteFileIssue(liveDocument, issue, snippetLines);
    }

    if (op === 'run_command') {
      return false;
    }

    if (liveDocument.lineCount === 0) {
      return false;
    }

    const currentLine = liveDocument.lineAt(boundedLineIndex).text;
    const indent = String(action.indent || detectIndent(currentLine));
    const snippetRaw = kind === 'trailing_whitespace' || kind === 'syntax_extra_delimiter'
      ? ''
      : String(issue.snippet || '');
    const rawSnippetLines = splitSnippetLines(snippetRaw);
    const snippetLines = normalizeSnippetLines(rawSnippetLines, indent);
    const snippetText = snippetLines.join('\n');

    if (op === 'replace_line') {
      if (snippetLines.length === 1 && currentLine === snippetLines[0]) {
        return false;
      }

      const edit = new vscode.WorkspaceEdit();
      edit.replace(liveDocument.uri, lineDeleteRange(liveDocument, boundedLineIndex), snippetText);
      const applied = await vscode.workspace.applyEdit(edit);
      if (applied && kind === 'comment_task') {
        await removeTriggerResidue(liveDocument, triggerText);
      }
      return applied;
    }

    if (snippetExistsNearby(liveDocument, boundedLineIndex, snippetLines, action, op)) {
      return false;
    }

    const edit = new vscode.WorkspaceEdit();
    if (op === 'insert_after') {
      const insertionPosition = boundedLineIndex >= liveDocument.lineCount - 1
        ? new vscode.Position(boundedLineIndex, liveDocument.lineAt(boundedLineIndex).text.length)
        : new vscode.Position(boundedLineIndex + 1, 0);
      const insertionText = boundedLineIndex >= liveDocument.lineCount - 1
        ? `\n${snippetText}`
        : `${snippetText}\n`;
      edit.insert(liveDocument.uri, insertionPosition, insertionText);
    } else {
      edit.insert(liveDocument.uri, new vscode.Position(boundedLineIndex, 0), `${snippetText}\n`);
    }
    return vscode.workspace.applyEdit(edit);
  }

  function compareFixCandidates(left, right) {
    const leftKind = String(left.kind || '');
    const rightKind = String(right.kind || '');
    const leftIndex = fixPriority.indexOf(leftKind);
    const rightIndex = fixPriority.indexOf(rightKind);
    const normalizedLeftIndex = leftIndex === -1 ? fixPriority.length : leftIndex;
    const normalizedRightIndex = rightIndex === -1 ? fixPriority.length : rightIndex;

    if (normalizedLeftIndex !== normalizedRightIndex) {
      return normalizedLeftIndex - normalizedRightIndex;
    }

    const leftLine = Number(left.line || 1);
    const rightLine = Number(right.line || 1);
    if (leftLine !== rightLine) {
      return leftLine - rightLine;
    }

    return issueActionIdentity(left).localeCompare(issueActionIdentity(right));
  }

  async function applyAutoFixes(document, issues) {
    if (!isAutoFixEnabled(document.uri)) {
      return false;
    }

    const allowedKinds = new Set(configuredAutoFixKinds(document.uri));
    const seen = new Set();
    const candidates = issues.filter((issue) => {
      const action = issueEffectiveAction(issue);
      const kind = String(issue.kind || '');
      if (action.op === 'run_command') {
        return false;
      }
      if (!allowedKinds.has(kind)) {
        return false;
      }
      if (!issue.snippet && action.op !== 'write_file' && kind !== 'trailing_whitespace' && kind !== 'syntax_extra_delimiter') {
        return false;
      }

      const identity = issueKey(document, issue);
      if (seen.has(identity)) {
        return false;
      }
      seen.add(identity);
      return true;
    });

    if (candidates.length === 0) {
      return false;
    }

    candidates.sort(compareFixCandidates);

    let applied = false;
    for (const issue of candidates) {
      const changed = await applySnippetIssue(document, issue);
      if (changed) {
        applied = true;
      }
    }

    if (!applied) {
      return false;
    }

    const refreshedDocument = await vscode.workspace.openTextDocument(document.uri);
    await analyzeDocument(refreshedDocument, 'autofix');
    return true;
  }

  function terminalStatusFile() {
    return path.join(
      os.tmpdir(),
      `realtime-dev-agent-terminal-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`,
    );
  }

  function terminalInnerCommand(command, cwd, statusFile) {
    const parts = ['{'];
    if (cwd) {
      parts.push(`cd ${shellEscape(cwd)} &&`);
    }
    parts.push(`${command};`);
    parts.push('}');

    if (statusFile) {
      parts.push(';');
      parts.push('rda_status=$?;');
      parts.push(`printf "%s" "$rda_status" > ${shellEscape(statusFile)};`);
      parts.push('exit $rda_status');
    }

    return parts.join(' ');
  }

  function terminalWrappedCommand(command, cwd, statusFile) {
    const inner = terminalInnerCommand(command, cwd, statusFile);
    return `/bin/sh -lc ${shellEscape(inner)}`;
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
