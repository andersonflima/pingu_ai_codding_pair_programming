#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { evaluateAutofixGuard } = require('./autofix-guard');

function readPayload() {
  const raw = fs.readFileSync(0, 'utf8');
  if (!String(raw || '').trim()) {
    return {};
  }
  return JSON.parse(raw);
}

function writeResult(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function main() {
  try {
    const payload = readPayload();
    writeResult(evaluateAutofixGuard(payload));
  } catch (error) {
    writeResult({
      ok: false,
      error: String(error && (error.stack || error.message) || error),
    });
    process.exitCode = 1;
  }
}

main();
