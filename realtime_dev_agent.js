#!/usr/bin/env node
'use strict';

const fs = require('fs');
const readline = require('readline');
const { analyzeText } = require('./lib/analyzer');
const { evaluateAutofixGuard } = require('./lib/autofix-guard');
const { renderVim, renderText, renderSuccessOrText, renderJson } = require('./lib/support');

const DEFAULT_MAX_LINE_LENGTH = 120;

const args = parseArgs(process.argv.slice(2));
if (!args.guardMode && !args.analyze && !args.stdin && !args.serveMode) {
  process.exit(1);
}

if (args.serveMode) {
  startServer();
} else if (args.guardMode) {
  const rawPayload = fs.readFileSync(0, 'utf8');
  const payload = String(rawPayload || '').trim() ? JSON.parse(rawPayload) : {};
  renderJson(evaluateAutofixGuard(payload));
} else {
  const sourcePath = args.sourcePath || args.analyze || 'stdin';
  const content = args.stdin
    ? fs.readFileSync(0, 'utf8')
    : fs.readFileSync(args.analyze, 'utf8');
  const issues = analyzeText(sourcePath, content, {
    maxLineLength: Number.isFinite(args.maxLineLength) ? args.maxLineLength : DEFAULT_MAX_LINE_LENGTH,
    analysisMode: args.analysisMode,
  });

  if (args.output === 'vim') {
    renderVim(issues);
  } else if (args.output === 'json') {
    renderJson(issues);
  } else if (args.output === 'text') {
    renderText(issues);
  } else {
    renderSuccessOrText(issues);
  }
}

function parseArgs(rawArgs) {
  const options = {
    output: 'text',
    maxLineLength: DEFAULT_MAX_LINE_LENGTH,
    stdin: false,
    guardMode: false,
    serveMode: false,
  };
  for (let i = 0; i < rawArgs.length; i += 1) {
    const current = rawArgs[i];
    if (current === '--analyze') {
      options.analyze = rawArgs[i + 1];
      i += 1;
    } else if (current === '--source-path') {
      options.sourcePath = rawArgs[i + 1];
      i += 1;
    } else if (current === '--stdin') {
      options.stdin = true;
    } else if (current === '--vim') {
      options.output = 'vim';
    } else if (current === '--json') {
      options.output = 'json';
    } else if (current === '--max-line-length' && rawArgs[i + 1]) {
      options.maxLineLength = Number.parseInt(rawArgs[i + 1], 10);
      i += 1;
    } else if (current === '--format' && rawArgs[i + 1]) {
      options.output = rawArgs[i + 1];
      i += 1;
    } else if (current === '--analysis-mode' && rawArgs[i + 1]) {
      options.analysisMode = rawArgs[i + 1];
      i += 1;
    } else if (current === '--autofix-guard') {
      options.guardMode = true;
      options.output = 'json';
    } else if (current === '--serve') {
      options.serveMode = true;
    }
  }
  return options;
}

function startServer() {
  const lineReader = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  lineReader.on('line', (line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed) {
      return;
    }

    let request = null;
    try {
      request = JSON.parse(trimmed);
    } catch (error) {
      writeServerResponse({
        id: null,
        ok: false,
        error: String(error && error.message || error || 'Falha ao interpretar request'),
      });
      return;
    }

    handleServerRequest(request);
  });
}

function handleServerRequest(request) {
  const responseId = request && Object.prototype.hasOwnProperty.call(request, 'id')
    ? request.id
    : null;

  try {
    const command = String(request && request.command || 'analyze').trim();
    if (command === 'guard') {
      writeServerResponse({
        id: responseId,
        ok: true,
        result: evaluateAutofixGuard(request && request.payload ? request.payload : {}),
      });
      return;
    }

    const sourcePath = String(request && request.sourcePath || request && request.filePath || 'stdin');
    const text = String(request && request.text || '');
    const issues = analyzeText(sourcePath, text, {
      maxLineLength: Number.isFinite(request && request.maxLineLength)
        ? request.maxLineLength
        : DEFAULT_MAX_LINE_LENGTH,
      analysisMode: request && request.analysisMode,
    });

    writeServerResponse({
      id: responseId,
      ok: true,
      issues,
    });
  } catch (error) {
    writeServerResponse({
      id: responseId,
      ok: false,
      error: String(error && error.stack || error && error.message || error || 'Falha inesperada'),
    });
  }
}

function writeServerResponse(response) {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}
