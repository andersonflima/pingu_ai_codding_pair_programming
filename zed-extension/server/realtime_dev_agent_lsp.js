#!/usr/bin/env node
'use strict';

const { fileURLToPath, pathToFileURL } = require('url');
const { analyzeText } = require('../../lib/analyzer');

const documents = new Map();
const issuesByUri = new Map();

let messageBuffer = Buffer.alloc(0);
let shutdownRequested = false;

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
  if (message.method === 'initialize') {
    sendResponse(message.id, {
      capabilities: {
        textDocumentSync: 1,
        codeActionProvider: true,
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

  if (typeof message.id !== 'undefined') {
    sendResponse(message.id, null);
  }
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
    .filter((issue) => issueProducesWorkspaceEdit(issue))
    .filter((issue) => issueIntersectsRange(liveDocument, issue, range))
    .map((issue) => buildCodeAction(liveDocument, issue))
    .filter(Boolean);
}

function buildCodeAction(document, issue) {
  const action = issueAction(issue);
  const edit = buildWorkspaceEdit(document, issue, action);
  if (!edit) {
    return null;
  }

  return {
    title: `Realtime Dev Agent: ${issue.suggestion || issue.message}`,
    kind: 'quickfix',
    edit,
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

function issueProducesWorkspaceEdit(issue) {
  const action = issueAction(issue);
  if (!action || action.op === 'run_command') {
    return false;
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
  if (issue && issue.action && typeof issue.action === 'object' && issue.action.op) {
    return issue.action;
  }

  const defaults = {
    comment_task: { op: 'replace_line' },
    context_file: { op: 'write_file' },
    unit_test: { op: 'write_file' },
    missing_dependency: { op: 'insert_before' },
    moduledoc: { op: 'insert_before' },
    function_doc: { op: 'insert_before' },
    function_spec: { op: 'insert_before' },
    markdown_title: { op: 'insert_before' },
    terraform_required_version: { op: 'insert_before' },
    dockerfile_workdir: { op: 'insert_after' },
    trailing_whitespace: { op: 'replace_line' },
    tabs: { op: 'replace_line' },
    syntax_missing_quote: { op: 'replace_line' },
    syntax_extra_delimiter: { op: 'replace_line' },
    syntax_missing_delimiter: { op: 'insert_after' },
    syntax_missing_comma: { op: 'replace_line' },
  };

  return defaults[String(issue && issue.kind || '')] || { op: 'insert_before' };
}

function issueLineIndex(issue) {
  return Math.max(0, Number(issue && issue.line || 1) - 1);
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
