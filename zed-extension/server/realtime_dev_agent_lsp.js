#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { fileURLToPath, pathToFileURL } = require('url');
const { analyzeText } = require('../../lib/analyzer');
const { evaluateAutofixGuard } = require('../../lib/autofix-guard');
const { buildFollowUpComment } = require('../../lib/follow-up');
const { createRuntimeAgentClient } = require('../../lib/runtime-agent-client');
const {
  mustClearKindsForIssue,
  resolveIssueAction,
  supportsFollowUp,
  supportsQuickFix,
} = require('../../lib/issue-kinds');
const { resolvePreferredInsertBeforeLine } = require('../../lib/snippet-placement');
const {
  isTerminalRiskAllowed,
  normalizeTerminalRiskMode,
  resolveTerminalRisk,
  terminalRiskBlockMessage,
} = require('../../lib/terminal-risk');

const documents = new Map();
const issuesByUri = new Map();
const pendingClientRequests = new Map();
const activeTerminalTasks = new Map();
const pendingAnalysisTimers = new Map();
const analysisCache = new Map();
const publishedAnalysisCache = new Map();
const automaticIssueAttempts = new Map();
const analysisRequestIds = new Map();

let messageBuffer = Buffer.alloc(0);
let shutdownRequested = false;
let nextClientRequestId = 1;
let runtimeAgentClient = null;

const DEFAULT_ZED_OPEN_DEBOUNCE_MS = 150;
const DEFAULT_ZED_CHANGE_DEBOUNCE_MS = 700;
const DEFAULT_ZED_SAVE_DEBOUNCE_MS = 0;
const DEFAULT_ZED_REALTIME_ANALYSIS_MODE = 'light';

process.stdin.on('data', (chunk) => {
  messageBuffer = Buffer.concat([messageBuffer, chunk]);
  flushMessages();
});

process.stdin.on('end', () => {
  disposeRuntimeAgentClient();
  process.exit(0);
});

process.on('exit', () => {
  disposeRuntimeAgentClient();
});

function flushMessages() {
  while (true) {
    const headerEnd = messageBuffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) {
      return;
    }

    const header = messageBuffer.slice(0, headerEnd).toString('utf8');
    const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
    if (!lengthMatch) {
      messageBuffer = Buffer.alloc(0);
      return;
    }

    const contentLength = Number(lengthMatch[1]);
    const messageStart = headerEnd + 4;
    const messageEnd = messageStart + contentLength;
    if (messageBuffer.length < messageEnd) {
      return;
    }

    const body = messageBuffer.slice(messageStart, messageEnd).toString('utf8');
    messageBuffer = messageBuffer.slice(messageEnd);

    try {
      handleMessage(JSON.parse(body));
    } catch (error) {
      sendNotification('window/logMessage', {
        type: 1,
        message: `[RealtimeDevAgent/Zed] Falha ao interpretar mensagem: ${String(error && error.message || error)}`,
      });
    }
  }
}

function handleMessage(message) {
  if (!message || typeof message !== 'object') {
    return;
  }

  if (!message.method && Object.prototype.hasOwnProperty.call(message, 'id')) {
    handleClientResponse(message);
    return;
  }

  if (message.method === 'initialize') {
    sendResponse(message.id, {
      capabilities: {
        textDocumentSync: 1,
        codeActionProvider: true,
        executeCommandProvider: {
          commands: ['realtimeDevAgent.runTerminalTask', 'realtimeDevAgent.applyIssueFix'],
        },
      },
      serverInfo: {
        name: 'realtime-dev-agent-lsp',
        version: '0.1.0',
      },
    });
    return;
  }

  if (message.method === 'initialized') {
    return;
  }

  if (message.method === 'shutdown') {
    shutdownRequested = true;
    disposeRuntimeAgentClient();
    sendResponse(message.id, null);
    return;
  }

  if (message.method === 'exit') {
    disposeRuntimeAgentClient();
    process.exit(shutdownRequested ? 0 : 1);
  }

  if (message.method === 'textDocument/didOpen') {
    const document = message.params && message.params.textDocument;
    if (!document) {
      return;
    }
    upsertDocument(document.uri, document.text, document.version);
    scheduleAnalyzeAndPublish(document.uri, 'open');
    return;
  }

  if (message.method === 'textDocument/didChange') {
    const params = message.params || {};
    const document = params.textDocument || {};
    const contentChanges = Array.isArray(params.contentChanges) ? params.contentChanges : [];
    const lastChange = contentChanges[contentChanges.length - 1];
    if (!document.uri || !lastChange || typeof lastChange.text !== 'string') {
      return;
    }
    upsertDocument(document.uri, lastChange.text, document.version);
    scheduleAnalyzeAndPublish(document.uri, 'change');
    return;
  }

  if (message.method === 'textDocument/didSave') {
    const document = message.params && message.params.textDocument;
    if (!document || !document.uri) {
      return;
    }
    scheduleAnalyzeAndPublish(document.uri, 'save');
    return;
  }

  if (message.method === 'textDocument/didClose') {
    const document = message.params && message.params.textDocument;
    if (!document || !document.uri) {
      return;
    }
    clearPendingAnalysis(document.uri);
    invalidateAnalysis(document.uri);
    automaticIssueAttempts.delete(String(document.uri || ''));
    documents.delete(document.uri);
    issuesByUri.delete(document.uri);
    publishDiagnostics(document.uri, []);
    return;
  }

  if (message.method === 'textDocument/codeAction') {
    sendResponse(message.id, buildCodeActions(message.params || {}));
    return;
  }

  if (message.method === 'workspace/executeCommand') {
    const params = message.params || {};
    if (params.command === 'realtimeDevAgent.runTerminalTask') {
      executeTerminalTask(Array.isArray(params.arguments) ? params.arguments[0] : null);
      sendResponse(message.id, null);
      return;
    }
    if (params.command === 'realtimeDevAgent.applyIssueFix') {
      executeIssueFix(Array.isArray(params.arguments) ? params.arguments[0] : null);
      sendResponse(message.id, null);
      return;
    }
  }

  if (typeof message.id !== 'undefined') {
    sendResponse(message.id, null);
  }
}

function handleClientResponse(message) {
  const callback = pendingClientRequests.get(message.id);
  if (!callback) {
    return;
  }
  pendingClientRequests.delete(message.id);
  callback(message);
}

function upsertDocument(uri, text, version) {
  invalidateAnalysis(uri);
  automaticIssueAttempts.delete(String(uri || ''));
  documents.set(uri, {
    uri,
    text: String(text || ''),
    version: Number.isFinite(version) ? version : null,
  });
}

function readDelayEnv(name, fallback) {
  const parsed = Number.parseInt(String(process.env[name] || fallback), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, parsed);
}

function analysisDelayForTrigger(trigger) {
  const normalizedTrigger = String(trigger || '').trim();
  if (normalizedTrigger === 'open') {
    return readDelayEnv('PINGU_ZED_OPEN_DEBOUNCE_MS', DEFAULT_ZED_OPEN_DEBOUNCE_MS);
  }
  if (normalizedTrigger === 'save' || normalizedTrigger === 'autofix') {
    return readDelayEnv('PINGU_ZED_SAVE_DEBOUNCE_MS', DEFAULT_ZED_SAVE_DEBOUNCE_MS);
  }
  return readDelayEnv('PINGU_ZED_CHANGE_DEBOUNCE_MS', DEFAULT_ZED_CHANGE_DEBOUNCE_MS);
}

function normalizeAnalysisMode(rawMode) {
  return String(rawMode || '').trim().toLowerCase() === 'full' ? 'full' : 'light';
}

function analysisModeForTrigger(trigger) {
  const normalizedTrigger = String(trigger || '').trim();
  if (normalizedTrigger === 'save' || normalizedTrigger === 'autofix' || normalizedTrigger === 'manual') {
    return 'full';
  }
  return normalizeAnalysisMode(process.env.PINGU_ZED_REALTIME_ANALYSIS_MODE || DEFAULT_ZED_REALTIME_ANALYSIS_MODE);
}

function documentVersion(document) {
  return Number.isFinite(document && document.version) ? Number(document.version) : null;
}

function clearPendingAnalysis(uri) {
  const timer = pendingAnalysisTimers.get(uri);
  if (!timer) {
    return;
  }
  clearTimeout(timer);
  pendingAnalysisTimers.delete(uri);
}

function invalidateAnalysis(uri) {
  const normalizedUri = String(uri || '');
  analysisCache.delete(normalizedUri);
  publishedAnalysisCache.delete(normalizedUri);
  analysisRequestIds.delete(normalizedUri);
}

function nextAnalysisRequestId(uri) {
  const normalizedUri = String(uri || '');
  const nextId = Number(analysisRequestIds.get(normalizedUri) || 0) + 1;
  analysisRequestIds.set(normalizedUri, nextId);
  return nextId;
}

function isLatestAnalysisRequest(uri, requestId) {
  return Number(analysisRequestIds.get(String(uri || '')) || 0) === Number(requestId || 0);
}

function runtimeScriptPath() {
  return path.resolve(__dirname, '..', '..', 'realtime_dev_agent.js');
}

function getRuntimeAgentClient() {
  if (runtimeAgentClient) {
    return runtimeAgentClient;
  }

  runtimeAgentClient = createRuntimeAgentClient({
    spawn,
    nodePath: process.execPath,
    scriptPath: runtimeScriptPath(),
    cwd: path.resolve(__dirname, '..', '..'),
    env: process.env,
    onStderr(message) {
      const normalized = String(message || '').trim();
      if (!normalized) {
        return;
      }
      sendNotification('window/logMessage', {
        type: 4,
        message: `[RealtimeDevAgent/Zed/runtime] ${normalized}`,
      });
    },
  });
  return runtimeAgentClient;
}

function disposeRuntimeAgentClient() {
  if (!runtimeAgentClient) {
    return;
  }
  runtimeAgentClient.dispose();
  runtimeAgentClient = null;
}

async function collectPublishedIssuesForDocument(document, options = {}) {
  if (!document) {
    return [];
  }

  const uri = String(document.uri || '');
  const version = documentVersion(document);
  const analysisMode = normalizeAnalysisMode(options.analysisMode || analysisModeForTrigger(options.trigger));
  const cached = publishedAnalysisCache.get(uri);
  if (!options.force && cached && cached.version === version && (cached.mode === 'full' || cached.mode === analysisMode)) {
    if (Array.isArray(cached.issues)) {
      return cached.issues;
    }
    if (cached.promise) {
      return cached.promise;
    }
  }

  const filePath = uriToFilePath(uri);
  const promise = getRuntimeAgentClient().requestAnalysis({
    sourcePath: filePath,
    text: document.text,
    maxLineLength: 120,
    analysisMode,
  }).catch((_error) => analyzeIssuesForDocument(document, {
    ...options,
    analysisMode,
    force: true,
  })).then((issues) => {
    const current = publishedAnalysisCache.get(uri);
    if (current && current.promise === promise) {
      publishedAnalysisCache.set(uri, {
        version,
        mode: analysisMode,
        issues,
        promise: null,
      });
    }
    return issues;
  }).catch((error) => {
    const current = publishedAnalysisCache.get(uri);
    if (current && current.promise === promise) {
      publishedAnalysisCache.delete(uri);
    }
    throw error;
  });

  publishedAnalysisCache.set(uri, {
    version,
    mode: analysisMode,
    issues: null,
    promise,
  });
  return promise;
}

function analyzeIssuesForDocument(document, options = {}) {
  if (!document) {
    return [];
  }

  const uri = String(document.uri || '');
  const version = documentVersion(document);
  const analysisMode = normalizeAnalysisMode(options.analysisMode || analysisModeForTrigger(options.trigger));
  const cached = analysisCache.get(uri);
  if (!options.force && cached && cached.version === version && (cached.mode === 'full' || cached.mode === analysisMode)) {
    return cached.issues;
  }

  const filePath = uriToFilePath(uri);
  const issues = analyzeText(filePath, document.text, {
    maxLineLength: 120,
    analysisMode,
  });
  analysisCache.set(uri, {
    version,
    mode: analysisMode,
    issues,
  });
  return issues;
}

function scheduleAnalyzeAndPublish(uri, trigger = 'change') {
  const document = documents.get(uri);
  if (!document) {
    return;
  }

  clearPendingAnalysis(uri);
  const expectedVersion = documentVersion(document);
  const delay = analysisDelayForTrigger(trigger);
  if (delay <= 0) {
    void analyzeAndPublish(uri, { expectedVersion, force: trigger === 'save' || trigger === 'autofix', trigger });
    return;
  }

  const timer = setTimeout(() => {
    pendingAnalysisTimers.delete(uri);
    void analyzeAndPublish(uri, { expectedVersion, force: false, trigger });
  }, delay);
  pendingAnalysisTimers.set(uri, timer);
}

async function analyzeAndPublish(uri, options = {}) {
  try {
    const document = documents.get(uri);
    if (!document) {
      return;
    }

    const requestId = nextAnalysisRequestId(uri);
    if (options.expectedVersion !== undefined && documentVersion(document) !== options.expectedVersion) {
      return;
    }

    const issues = await collectPublishedIssuesForDocument(document, options);
    const liveDocument = documents.get(uri);
    if (!liveDocument) {
      return;
    }
    if (!isLatestAnalysisRequest(uri, requestId)) {
      return;
    }
    if (options.expectedVersion !== undefined && documentVersion(liveDocument) !== options.expectedVersion) {
      return;
    }

    issuesByUri.set(uri, issues);
    publishDiagnostics(uri, issues.map((issue) => issueToDiagnostic(liveDocument, issue)));
    if (shouldRunAutomaticIssueFix(options.trigger)) {
      await maybeAutoApplyIssues(liveDocument, issues, options);
    }
  } catch (error) {
    sendNotification('window/logMessage', {
      type: 1,
      message: `[RealtimeDevAgent/Zed] Falha ao analisar ${uri}: ${String(error && (error.stack || error.message) || error)}`,
    });
  }
}

function publishDiagnostics(uri, diagnostics) {
  sendNotification('textDocument/publishDiagnostics', {
    uri,
    diagnostics,
  });
}

function issueToDiagnostic(document, issue) {
  const lineIndex = issueLineIndex(issue);
  const lines = splitDocumentLines(document.text);
  const boundedLineIndex = Math.max(0, Math.min(lineIndex, Math.max(lines.length - 1, 0)));
  const lineText = lines[boundedLineIndex] || '';
  return {
    range: {
      start: { line: boundedLineIndex, character: 0 },
      end: { line: boundedLineIndex, character: lineText.length },
    },
    severity: diagnosticSeverity(issue.severity),
    source: 'realtime-dev-agent',
    code: issue.kind,
    message: `${issue.kind}: ${issue.message}${issue.suggestion ? ` | ${issue.suggestion}` : ''}`,
  };
}

function buildCodeActions(params) {
  const document = params.textDocument || {};
  const uri = document.uri;
  if (!uri || !documents.has(uri)) {
    return [];
  }

  const liveDocument = documents.get(uri);
  const issues = issuesByUri.get(uri) || [];
  const range = params.range || null;

  return issues
    .filter((issue) => issueProducesCodeAction(issue))
    .filter((issue) => issueIntersectsRange(liveDocument, issue, range))
    .flatMap((issue) => buildCodeActionsForIssue(liveDocument, issue))
    .filter(Boolean);
}

function buildCodeActionsForIssue(document, issue) {
  const actions = [];
  const action = issueAction(issue);
  if (isTerminalAction(action)) {
    actions.push(buildTerminalCodeAction(document, issue, action));
  } else {
    const quickFixAction = buildQuickFixCodeAction(document, issue, action);
    if (quickFixAction) {
      actions.push(quickFixAction);
    }
  }

  const followUpAction = buildFollowUpCodeAction(document, issue);
  if (followUpAction) {
    actions.push(followUpAction);
  }

  return actions.filter(Boolean);
}

function buildQuickFixCodeAction(document, issue, action) {
  const edit = buildWorkspaceEdit(document, issue, action);
  if (!edit) {
    return null;
  }

  return {
    title: `Realtime Dev Agent: ${issue.suggestion || issue.message}`,
    kind: 'quickfix',
    command: {
      title: `Realtime Dev Agent: ${issue.suggestion || issue.message}`,
      command: 'realtimeDevAgent.applyIssueFix',
      arguments: [{
        uri: document.uri,
        issue,
      }],
    },
  };
}

function buildFollowUpCodeAction(document, issue) {
  if (!supportsFollowUp(issue && issue.kind)) {
    return null;
  }

  const followUpComment = buildFollowUpComment(uriToFilePath(document.uri), issue);
  if (!followUpComment) {
    return null;
  }

  const edit = buildFollowUpWorkspaceEdit(document, issue, followUpComment);
  if (!edit) {
    return null;
  }

  return {
    title: 'Pingu - Dev Agent: Insert actionable follow-up',
    kind: 'quickfix',
    edit,
  };
}

function buildFollowUpWorkspaceEdit(document, issue, followUpComment) {
  const uri = document.uri;
  const lines = splitDocumentLines(document.text);
  const lineIndex = issueLineIndex(issue);
  const boundedLineIndex = Math.max(0, Math.min(lineIndex, Math.max(lines.length - 1, 0)));
  const currentLine = lines[boundedLineIndex] || '';

  if (boundedLineIndex >= lines.length - 1) {
    return {
      changes: {
        [uri]: [
          {
            range: zeroRange(boundedLineIndex, currentLine.length),
            newText: `\n${followUpComment}`,
          },
        ],
      },
    };
  }

  return {
    changes: {
      [uri]: [
        {
          range: zeroRange(boundedLineIndex + 1, 0),
          newText: `${followUpComment}\n`,
        },
      ],
    },
  };
}

function buildTerminalCodeAction(document, issue, action) {
  const payload = {
    uri: document.uri,
    command: String(action.command || '').trim(),
    cwd: String(action.cwd || '').trim() || path.dirname(uriToFilePath(document.uri)),
    line: Number(issue.line || 1),
    risk: resolveTerminalRisk(action),
    triggerText: issueTriggerText(document, issue),
    removeTrigger: Boolean(action.remove_trigger),
  };
  if (!payload.command) {
    return null;
  }

  return {
    title: `Realtime Dev Agent: ${issue.suggestion || issue.message}`,
    kind: 'quickfix',
    command: {
      title: `Realtime Dev Agent: ${issue.suggestion || issue.message}`,
      command: 'realtimeDevAgent.runTerminalTask',
      arguments: [payload],
    },
  };
}

function buildWorkspaceEdit(document, issue, action) {
  const uri = document.uri;
  const text = document.text;
  const lineIndex = issueLineIndex(issue);
  const lines = splitDocumentLines(text);
  const boundedLineIndex = Math.max(0, Math.min(lineIndex, Math.max(lines.length - 1, 0)));
  const currentLine = lines[boundedLineIndex] || '';
  if (String(issue && issue.kind || '') === 'undefined_variable'
    && isImportLikeLine(currentLine)
    && !isValidatedImportBindingIssue(issue)) {
    return null;
  }
  const indent = detectIndent(action.indent || currentLine);
  const snippetLines = normalizeSnippetLines(splitSnippetLines(issue.snippet || ''), indent);
  const snippetText = snippetLines.join('\n');
  const actionRange = normalizeActionRange(action && action.range);

  if (action.op === 'replace_line') {
    return {
      changes: {
        [uri]: [
          {
            range: actionRange || fullLineRange(lines, boundedLineIndex),
            newText: actionRange && typeof action.text === 'string'
              ? String(action.text || '')
              : snippetText,
          },
        ],
      },
    };
  }

  if (action.op === 'insert_before') {
    const insertBeforeLineIndex = resolvePreferredInsertBeforeLine(lines, boundedLineIndex, snippetLines);
    return {
      changes: {
        [uri]: [
          {
            range: zeroRange(insertBeforeLineIndex, 0),
            newText: `${snippetText}\n`,
          },
        ],
      },
    };
  }

  if (action.op === 'insert_after') {
    const insertion = boundedLineIndex >= lines.length - 1
      ? {
        range: zeroRange(boundedLineIndex, currentLine.length),
        newText: `\n${snippetText}`,
      }
      : {
        range: zeroRange(boundedLineIndex + 1, 0),
        newText: `${snippetText}\n`,
      };
    return {
      changes: {
        [uri]: [insertion],
      },
    };
  }

  if (action.op === 'write_file' && action.target_file) {
    const targetUri = pathToFileURL(action.target_file).toString();
    const documentChanges = [
      {
        kind: 'create',
        uri: targetUri,
      },
      {
        textDocument: {
          uri: targetUri,
          version: null,
        },
        edits: [
          {
            range: zeroRange(0, 0),
            newText: snippetText,
          },
        ],
      },
    ];

    if (action.remove_trigger) {
      const triggerLine = issue.line ? issue.line - 1 : boundedLineIndex;
      documentChanges.push({
        textDocument: {
          uri,
          version: document.version,
        },
        edits: [
          {
            range: fullLineRange(lines, triggerLine),
            newText: '',
          },
        ],
      });
    }

    return { documentChanges };
  }

  return null;
}

function issueProducesCodeAction(issue) {
  if (!supportsQuickFix(issue && issue.kind)) {
    return false;
  }

  const action = issueAction(issue);
  if (!action) {
    return false;
  }
  if (action.op === 'run_command') {
    return Boolean(action.command);
  }
  if (action.op === 'write_file') {
    return Boolean(action.target_file && issue.snippet);
  }
  return Boolean(issue.snippet || issue.kind === 'trailing_whitespace' || issue.kind === 'syntax_extra_delimiter');
}

function issueIntersectsRange(document, issue, range) {
  if (!range) {
    return true;
  }

  const lineIndex = issueLineIndex(issue);
  const startLine = Number(range.start && range.start.line || 0);
  const endLine = Number(range.end && range.end.line || startLine);
  return lineIndex >= startLine && lineIndex <= endLine;
}

function issueAction(issue) {
  return resolveIssueAction(issue);
}

function issueActionIdentity(issue) {
  const action = issueAction(issue);
  if (String(action && action.op || '') === 'write_file') {
    return String(action && action.target_file || '');
  }
  if (String(action && action.op || '') === 'run_command') {
    return String(action && action.command || '');
  }
  return String(issue && issue.snippet || '');
}

function automaticIssueKey(document, issue) {
  return [
    String(document && document.uri || ''),
    Number(issue && issue.line || 1),
    String(issue && issue.kind || ''),
    String(issue && issue.message || ''),
    issueActionIdentity(issue),
  ].join('|');
}

function shouldRunAutomaticIssueFix(trigger) {
  return String(trigger || '').trim() === 'save';
}

function isSafeUnitTestTarget(uri, targetFile) {
  const sourceFile = uriToFilePath(uri);
  const normalizedSource = path.resolve(String(sourceFile || ''));
  const normalizedTarget = path.resolve(String(targetFile || ''));
  if (!normalizedSource || !normalizedTarget || normalizedSource === normalizedTarget) {
    return false;
  }

  const targetDir = path.dirname(normalizedTarget).replace(/\\/g, '/');
  const sourceDir = path.dirname(normalizedSource).replace(/\\/g, '/');
  const targetName = path.basename(normalizedTarget).toLowerCase();

  if (/\/tests?\//.test(`${targetDir}/`)) {
    return true;
  }

  if (targetDir === sourceDir) {
    return /(^test_.*\.py$|_test\.(go|py|exs|rs|rb|c|vim|sh)$|_spec\.lua$|\.test\.(js|jsx|ts|tsx|mjs|cjs)$|\.spec\.(js|jsx|ts|tsx|mjs|cjs)$)/.test(targetName);
  }

  return false;
}

function isAutomaticUnitTestIssue(document, issue) {
  if (String(issue && issue.kind || '') !== 'unit_test') {
    return false;
  }
  const action = issueAction(issue);
  if (String(action && action.op || '') !== 'write_file') {
    return false;
  }
  if (!String(issue && issue.snippet || '').trim()) {
    return false;
  }
  return isSafeUnitTestTarget(document && document.uri, action && action.target_file);
}

function selectAutomaticIssue(document, issues) {
  return (Array.isArray(issues) ? issues : []).find((issue) => isAutomaticUnitTestIssue(document, issue)) || null;
}

function isTerminalAction(action) {
  return Boolean(action && action.op === 'run_command' && String(action.command || '').trim() !== '');
}

function issueLineIndex(issue) {
  return Math.max(0, Number(issue && issue.line || 1) - 1);
}

function issueTriggerText(document, issue) {
  const lines = splitDocumentLines(document.text);
  const lineIndex = issueLineIndex(issue);
  const boundedLineIndex = Math.max(0, Math.min(lineIndex, Math.max(lines.length - 1, 0)));
  return lines[boundedLineIndex] || '';
}

function isImportLikeLine(line) {
  const content = String(line || '').trim();
  if (!content) {
    return false;
  }

  return /^\s*import\b/.test(content)
    || /^\s*export\s+(?:\{|\*\s+from\b)/.test(content)
    || /^\s*from\b.+\bimport\b/.test(content)
    || /^\s*(?:const|let|var)\b.+?=\s*require\s*\(/.test(content)
    || /^\s*(?:alias|use|require)\b/.test(content)
    || /^\s*require_relative\b/.test(content)
    || /^\s*#include\b/.test(content);
}

function isValidatedImportBindingIssue(issue) {
  return String(issue && issue.kind || '') === 'undefined_variable'
    && /^(?:undefined_variable:\s*)?Import '([^']+)' nao exportado por /.test(String(issue && issue.message || ''));
}

function diagnosticSeverity(severity) {
  switch (severity) {
    case 'error':
      return 1;
    case 'warning':
      return 2;
    case 'info':
      return 3;
    default:
      return 4;
  }
}

function splitDocumentLines(text) {
  return String(text || '').replace(/\r\n/g, '\n').split('\n');
}

function splitSnippetLines(snippet) {
  return String(snippet || '').replace(/\r\n/g, '\n').split('\n');
}

function detectIndent(text) {
  const match = /^\s*/.exec(String(text || ''));
  return match ? match[0] : '';
}

function normalizeActionRange(range) {
  if (!range || typeof range !== 'object') {
    return null;
  }

  return {
    start: {
      line: Math.max(0, Number(range.start && range.start.line || 0)),
      character: Math.max(0, Number(range.start && range.start.character || 0)),
    },
    end: {
      line: Math.max(0, Number(range.end && range.end.line || 0)),
      character: Math.max(0, Number(range.end && range.end.character || 0)),
    },
  };
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

function fullLineRange(lines, lineIndex) {
  const boundedLineIndex = Math.max(0, Math.min(lineIndex, Math.max(lines.length - 1, 0)));
  const currentLine = lines[boundedLineIndex] || '';
  if (boundedLineIndex < lines.length - 1) {
    return {
      start: { line: boundedLineIndex, character: 0 },
      end: { line: boundedLineIndex + 1, character: 0 },
    };
  }
  return {
    start: { line: boundedLineIndex, character: 0 },
    end: { line: boundedLineIndex, character: currentLine.length },
  };
}

function zeroRange(line, character) {
  return {
    start: { line, character },
    end: { line, character },
  };
}

function uriToFilePath(uri) {
  if (String(uri || '').startsWith('file://')) {
    return fileURLToPath(uri);
  }
  return String(uri || '');
}

function sendRequest(method, params, callback) {
  const id = nextClientRequestId;
  nextClientRequestId += 1;
  if (typeof callback === 'function') {
    pendingClientRequests.set(id, callback);
  }
  writeMessage({
    jsonrpc: '2.0',
    id,
    method,
    params,
  });
}

function requestApplyEdit(label, edit) {
  return new Promise((resolve) => {
    sendRequest('workspace/applyEdit', {
      label,
      edit,
    }, (response) => {
      resolve(Boolean(response && response.result && response.result.applied));
    });
  });
}

function fullDocumentRangeForText(text) {
  const lines = splitDocumentLines(text);
  const lastLineIndex = Math.max(lines.length - 1, 0);
  const lastLine = lines[lastLineIndex] || '';
  return {
    start: { line: 0, character: 0 },
    end: { line: lastLineIndex, character: lastLine.length },
  };
}

function applyRangeChangeToText(text, range, replacement) {
  const sourceLines = splitDocumentLines(text);
  const safeRange = range || zeroRange(0, 0);
  const startLine = Math.max(0, Number(safeRange.start && safeRange.start.line || 0));
  const startCharacter = Math.max(0, Number(safeRange.start && safeRange.start.character || 0));
  const endLine = Math.max(startLine, Number(safeRange.end && safeRange.end.line || startLine));
  const endCharacter = Math.max(0, Number(safeRange.end && safeRange.end.character || 0));
  const replacementLines = String(replacement || '').split('\n');
  const prefix = String(sourceLines[startLine] || '').slice(0, startCharacter);
  const suffix = String(sourceLines[endLine] || '').slice(endCharacter);
  const before = sourceLines.slice(0, startLine);
  const after = sourceLines.slice(endLine + 1);
  const middle = replacementLines.length > 0 ? [...replacementLines] : [''];
  middle[0] = `${prefix}${middle[0]}`;
  middle[middle.length - 1] = `${middle[middle.length - 1]}${suffix}`;
  return [...before, ...middle, ...after].join('\n');
}

function compareEditRangeDescending(left, right) {
  const leftRange = left && left.range ? left.range : zeroRange(0, 0);
  const rightRange = right && right.range ? right.range : zeroRange(0, 0);
  const leftLine = Number(leftRange.start && leftRange.start.line || 0);
  const rightLine = Number(rightRange.start && rightRange.start.line || 0);
  if (leftLine !== rightLine) {
    return rightLine - leftLine;
  }
  const leftCharacter = Number(leftRange.start && leftRange.start.character || 0);
  const rightCharacter = Number(rightRange.start && rightRange.start.character || 0);
  return rightCharacter - leftCharacter;
}

function applyTextEditsToDocumentText(text, edits) {
  const orderedEdits = (Array.isArray(edits) ? [...edits] : []).sort(compareEditRangeDescending);
  return orderedEdits.reduce(
    (currentText, edit) => applyRangeChangeToText(currentText, edit && edit.range, edit && edit.newText),
    String(text || ''),
  );
}

function upsertLocalDocument(uri, text, version = null) {
  const existing = documents.get(uri);
  invalidateAnalysis(uri);
  documents.set(uri, {
    uri,
    text: String(text || ''),
    version: Number.isFinite(version) ? version : (existing ? existing.version : null),
  });
}

function applyWorkspaceEditLocally(edit) {
  if (!edit || typeof edit !== 'object') {
    return;
  }

  if (edit.changes && typeof edit.changes === 'object') {
    Object.entries(edit.changes).forEach(([uri, edits]) => {
      const currentDocument = documents.get(uri) || { uri, text: '', version: null };
      upsertLocalDocument(uri, applyTextEditsToDocumentText(currentDocument.text, edits), currentDocument.version);
    });
  }

  const documentChanges = Array.isArray(edit.documentChanges) ? edit.documentChanges : [];
  documentChanges.forEach((change) => {
    if (!change || typeof change !== 'object') {
      return;
    }
    if (change.kind === 'create') {
      if (!documents.has(change.uri)) {
        upsertLocalDocument(change.uri, '', null);
      }
      return;
    }
    if (change.kind === 'delete') {
      documents.delete(change.uri);
      issuesByUri.delete(change.uri);
      return;
    }
    if (!change.textDocument || !Array.isArray(change.edits)) {
      return;
    }
    const uri = change.textDocument.uri;
    const currentDocument = documents.get(uri) || { uri, text: '', version: null };
    upsertLocalDocument(
      uri,
      applyTextEditsToDocumentText(currentDocument.text, change.edits),
      change.textDocument.version,
    );
  });
}

async function applyIssueFix(document, issue, label) {
  const action = issueAction(issue);
  const edit = buildWorkspaceEdit(document, issue, action);
  if (!edit) {
    return false;
  }

  const snapshot = captureIssueFixSnapshot(document, action);
  const beforeIssues = issuesByUri.get(document.uri) || [];
  const applied = await requestApplyEdit(label, edit);
  if (!applied) {
    return false;
  }

  clearPendingAnalysis(document.uri);
  applyWorkspaceEditLocally(edit);
  const updatedDocument = documents.get(document.uri) || document;
  const afterIssues = analyzeIssuesForDocument(updatedDocument, { force: true });
  const guardResult = evaluateAutofixGuard({
    appliedIssues: [issue],
    beforeIssues,
    afterIssues,
    fileEntries: buildGuardFileEntries(snapshot),
    resolveMustClearKinds: mustClearKindsForIssue,
  });

  if (!guardResult.ok) {
    const restoreEdit = buildSnapshotRestoreEdit(snapshot);
    const restored = await requestApplyEdit('Realtime Dev Agent rollback', restoreEdit);
    if (restored) {
      restoreSnapshotLocally(snapshot);
      void analyzeAndPublish(document.uri, { force: true, skipAutomaticAutoFix: true });
    }
    sendNotification('window/logMessage', {
      type: 2,
      message: `[RealtimeDevAgent/Zed] rollback aplicado: ${summarizeGuardFailures(guardResult)}`,
    });
    return false;
  }

  issuesByUri.set(document.uri, afterIssues);
  publishDiagnostics(document.uri, afterIssues.map((afterIssue) => issueToDiagnostic(updatedDocument, afterIssue)));
  return true;
}

async function maybeAutoApplyIssues(document, issues, options = {}) {
  if (!document || options.skipAutomaticAutoFix) {
    return false;
  }

  const candidate = selectAutomaticIssue(document, issues);
  if (!candidate) {
    return false;
  }

  const uri = String(document.uri || '');
  const issueKey = automaticIssueKey(document, candidate);
  const seen = automaticIssueAttempts.get(uri) || new Set();
  if (seen.has(issueKey)) {
    return false;
  }

  seen.add(issueKey);
  automaticIssueAttempts.set(uri, seen);
  return applyIssueFix(document, candidate, 'Realtime Dev Agent automatic unit test');
}

function captureIssueFixSnapshot(document, action) {
  const entries = [{
    uri: document.uri,
    filePath: uriToFilePath(document.uri),
    exists: true,
    text: document.text,
  }];

  if (String(action && action.op || '') !== 'write_file' || !action.target_file) {
    return entries;
  }

  const targetFilePath = path.resolve(String(action.target_file || '').trim());
  const targetUri = pathToFileURL(targetFilePath).toString();
  if (entries.some((entry) => entry.uri === targetUri)) {
    return entries;
  }

  const openTargetDocument = documents.get(targetUri);
  const targetExists = openTargetDocument ? true : fs.existsSync(targetFilePath);
  entries.push({
    uri: targetUri,
    filePath: targetFilePath,
    exists: targetExists,
    text: openTargetDocument
      ? openTargetDocument.text
      : (targetExists ? fs.readFileSync(targetFilePath, 'utf8') : ''),
  });
  return entries;
}

function buildGuardFileEntries(snapshot) {
  return (Array.isArray(snapshot) ? snapshot : []).map((entry) => {
    const currentDocument = documents.get(entry.uri);
    return {
      path: entry.filePath,
      contents: currentDocument ? currentDocument.text : String(entry.text || ''),
    };
  });
}

function buildSnapshotRestoreEdit(snapshot) {
  const documentChanges = [];
  (Array.isArray(snapshot) ? snapshot : []).forEach((entry) => {
    const currentDocument = documents.get(entry.uri);
    if (!entry.exists) {
      if (currentDocument) {
        documentChanges.push({
          kind: 'delete',
          uri: entry.uri,
        });
      }
      return;
    }

    if (!currentDocument) {
      documentChanges.push({
        kind: 'create',
        uri: entry.uri,
      });
      documentChanges.push({
        textDocument: {
          uri: entry.uri,
          version: null,
        },
        edits: [{
          range: zeroRange(0, 0),
          newText: String(entry.text || ''),
        }],
      });
      return;
    }

    documentChanges.push({
      textDocument: {
        uri: entry.uri,
        version: currentDocument.version,
      },
      edits: [{
        range: fullDocumentRangeForText(currentDocument.text),
        newText: String(entry.text || ''),
      }],
    });
  });
  return { documentChanges };
}

function restoreSnapshotLocally(snapshot) {
  (Array.isArray(snapshot) ? snapshot : []).forEach((entry) => {
    if (!entry.exists) {
      documents.delete(entry.uri);
      issuesByUri.delete(entry.uri);
      return;
    }
    upsertLocalDocument(entry.uri, entry.text);
  });
}

function summarizeGuardFailures(guardResult) {
  const validationFailures = (guardResult && Array.isArray(guardResult.validationFailures))
    ? guardResult.validationFailures
    : [];
  const runtimeFailures = (guardResult && Array.isArray(guardResult.runtimeFailures))
    ? guardResult.runtimeFailures
    : [];

  const validationSummary = validationFailures
    .map((failure) => `${failure.kind}(${failure.beforeCount}->${failure.afterCount})`)
    .join(', ');
  const runtimeSummary = runtimeFailures
    .map((failure) => `${failure.command} em ${failure.filePath}`)
    .join(', ');

  return [validationSummary, runtimeSummary].filter(Boolean).join(' | ');
}

async function executeIssueFix(payload) {
  if (!payload || typeof payload !== 'object') {
    return;
  }

  const uri = String(payload.uri || '').trim();
  const document = documents.get(uri);
  const issue = payload.issue && typeof payload.issue === 'object' ? payload.issue : null;
  if (!uri || !document || !issue) {
    return;
  }
  await applyIssueFix(document, issue, 'Realtime Dev Agent quick fix');
}

function executeTerminalTask(payload) {
  if (!payload || typeof payload !== 'object') {
    return;
  }

  const command = String(payload.command || '').trim();
  const cwd = String(payload.cwd || '').trim() || process.cwd();
  const uri = String(payload.uri || '').trim();
  const line = Number(payload.line || 1);
  const triggerText = String(payload.triggerText || '');
  const removeTrigger = Boolean(payload.removeTrigger);
  if (!command) {
    return;
  }

  const riskMode = normalizeTerminalRiskMode(
    process.env.PINGU_TERMINAL_RISK_MODE || process.env.REALTIME_DEV_AGENT_TERMINAL_RISK_MODE || 'workspace_write',
  );
  const risk = resolveTerminalRisk(payload);
  if (!isTerminalRiskAllowed(riskMode, risk.level)) {
    sendNotification('window/logMessage', {
      type: 2,
      message: `[RealtimeDevAgent/Zed] ${terminalRiskBlockMessage(command, riskMode, risk)}`,
    });
    return;
  }

  const taskKey = [uri || '__no-uri__', line, command].join('|');
  if (activeTerminalTasks.has(taskKey)) {
    sendNotification('window/logMessage', {
      type: 3,
      message: `[RealtimeDevAgent/Zed] acao de terminal ja esta em execucao: ${command}`,
    });
    return;
  }

  sendNotification('window/logMessage', {
    type: 3,
    message: `[RealtimeDevAgent/Zed] terminal conectado em ${cwd}`,
  });
  sendNotification('window/logMessage', {
    type: 3,
    message: `[RealtimeDevAgent/Zed] command: ${command}`,
  });

  const child = spawn('/bin/sh', ['-lc', command], {
    cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  activeTerminalTasks.set(taskKey, child);

  child.stdout.on('data', (chunk) => {
    sendNotification('window/logMessage', {
      type: 3,
      message: String(chunk),
    });
  });

  child.stderr.on('data', (chunk) => {
    sendNotification('window/logMessage', {
      type: 1,
      message: String(chunk),
    });
  });

  child.on('error', (error) => {
    activeTerminalTasks.delete(taskKey);
    sendNotification('window/logMessage', {
      type: 1,
      message: `[RealtimeDevAgent/Zed] falha ao iniciar comando: ${String(error && error.message || error)}`,
    });
  });

  child.on('close', (exitCode) => {
    activeTerminalTasks.delete(taskKey);
    sendNotification('window/logMessage', {
      type: exitCode === 0 ? 3 : 1,
      message: `[RealtimeDevAgent/Zed] exit code: ${typeof exitCode === 'number' ? exitCode : 1}`,
    });
    sendNotification('window/logMessage', {
      type: 3,
      message: '[RealtimeDevAgent/Zed] terminal pronto para o proximo comando.',
    });

    if (exitCode === 0 && removeTrigger && uri) {
      requestTriggerRemoval(uri, line, triggerText);
    }
  });
}

function requestTriggerRemoval(uri, line, triggerText) {
  const document = documents.get(uri);
  if (!document) {
    return;
  }

  const edit = buildTriggerRemovalEdit(document, line, triggerText);
  if (!edit) {
    return;
  }

  sendRequest('workspace/applyEdit', {
    label: 'Realtime Dev Agent terminal task cleanup',
    edit,
  }, (response) => {
    const applied = Boolean(response && response.result && response.result.applied);
    if (!applied) {
      return;
    }
    clearPendingAnalysis(uri);
    applyTriggerRemovalToDocument(uri, line, triggerText);
    void analyzeAndPublish(uri, { force: true });
  });
}

function buildTriggerRemovalEdit(document, line, triggerText) {
  const lines = splitDocumentLines(document.text);
  const targetIndex = findTriggerLineIndex(lines, line, triggerText);
  if (targetIndex === -1) {
    return null;
  }

  return {
    changes: {
      [document.uri]: [
        {
          range: fullLineRange(lines, targetIndex),
          newText: '',
        },
      ],
    },
  };
}

function applyTriggerRemovalToDocument(uri, line, triggerText) {
  const document = documents.get(uri);
  if (!document) {
    return;
  }

  const lines = splitDocumentLines(document.text);
  const targetIndex = findTriggerLineIndex(lines, line, triggerText);
  if (targetIndex === -1) {
    return;
  }

  lines.splice(targetIndex, 1);
  upsertDocument(uri, lines.join('\n'), document.version);
}

function findTriggerLineIndex(lines, line, triggerText) {
  const expectedIndex = Math.max(0, Number(line || 1) - 1);
  if (expectedIndex < lines.length && lines[expectedIndex] === triggerText) {
    return expectedIndex;
  }
  if (!triggerText) {
    return -1;
  }
  return lines.findIndex((entry) => entry === triggerText);
}

function sendNotification(method, params) {
  writeMessage({
    jsonrpc: '2.0',
    method,
    params,
  });
}

function sendResponse(id, result) {
  writeMessage({
    jsonrpc: '2.0',
    id,
    result,
  });
}

function writeMessage(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}
