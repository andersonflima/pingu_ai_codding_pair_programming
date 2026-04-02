#!/usr/bin/env node
'use strict';

const { evaluateAutofixGuard } = require('../lib/autofix-guard');

function readStdin() {
  return new Promise((resolve, reject) => {
    let buffer = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buffer += String(chunk || '');
    });
    process.stdin.on('end', () => resolve(buffer));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const rawInput = await readStdin();
  const payload = rawInput.trim() ? JSON.parse(rawInput) : {};
  const result = evaluateAutofixGuard(payload);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error && (error.stack || error.message) || String(error)}\n`);
  process.exitCode = 1;
});
