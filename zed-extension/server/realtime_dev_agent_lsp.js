#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawn } = require('child_process');
const { fileURLToPath, pathToFileURL } = require('url');
const { analyzeText } = require('../../lib/analyzer');
const { buildFollowUpComment } = require('../../lib/follow-up');
const { resolveIssueAction, supportsFollowUp, supportsQuickFix } = require('../../lib/issue-kinds');
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

let messageBuffer = Buffer.alloc(0);
let shutdownRequested = false;
let nextClientRequestId = 1;

process.stdin.on('data', (chunk) => {
  messageBuffer = Buffer.concat([messageBuffer, chunk]);
  flushMessages();
});

process.stdin.on('end', () => {
  process.exit(0);
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
          commands: ['realtimeDevAgent.runTerminalTask'],
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
    sendResponse(message.id, null);
    return;
  }

  if (message.method === 'exit') {
    process.exit(shutdownRequested ? 0 : 1);
  }

  if (message.method === 'textDocument/didOpen') {
    const document = message.params && message.params.textDocument;
    if (!document) {
      return;
    }
    upsertDocument(document.uri, document.text, document.version);
    analyzeAndPublish(document.uri);
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
    analyzeAndPublish(document.uri);
    return;
  }

  if (message.method === 'textDocument/didSave') {
    const document = message.params && message.params.textDocument;
    if (!document || !document.uri) {
      return;
    }
    analyzeAndPublish(document.uri);
    return;
  }

  if (message.method === 'textDocument/didClose') {
    const document = message.params && message.params.textDocument;
    if (!document || !document.uri) {
      return;
    }
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
  documents.set(uri, {
    uri,
    text: String(text || ''),
    version: Number.isFinite(version) ? version : null,
  });
}

function analyzeAndPublish(uri) {
  const document = documents.get(uri);
  if (!document) {
    return;
  }

  const filePath = uriToFilePath(uri);
  const issues = analyzeText(filePath, document.text, { maxLineLength: 120 });
  issuesByUri.set(uri, issues);
  publishDiagnostics(uri, issues.map((issue) => issueToDiagnostic(document, issue)));
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
    const edit = buildWorkspaceEdit(document, issue, action);
    if (edit) {
      actions.push({
        title: `Realtime Dev Agent: ${issue.suggestion || issue.message}`,
        kind: 'quickfix',
        edit,
      });
    }
  }

  const followUpAction = buildFollowUpCodeAction(document, issue);
  if (followUpAction) {
    actions.push(followUpAction);
  }

  return actions.filter(Boolean);
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
  const indent = detectIndent(action.indent || currentLine);
  const snippetLines = normalizeSnippetLines(splitSnippetLines(issue.snippet || ''), indent);
  const snippetText = snippetLines.join('\n');

  if (action.op === 'replace_line') {
    return {
      changes: {
        [uri]: [
          {
            range: fullLineRange(lines, boundedLineIndex),
            newText: snippetText,
          },
        ],
      },
    };
  }

  if (action.op === 'insert_before') {
    return {
      changes: {
        [uri]: [
          {
            range: zeroRange(boundedLineIndex, 0),
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
    applyTriggerRemovalToDocument(uri, line, triggerText);
    analyzeAndPublish(uri);
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
