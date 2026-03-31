#!/usr/bin/env node
'use strict';

const fs = require('fs');

const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
const instruction = String(payload.instruction || '').toLowerCase();

if (instruction.includes('gerado via ai')) {
  process.stdout.write(JSON.stringify({
    snippet: [
      'function ai_generated_task() {',
      '  return 42;',
      '}',
    ].join('\n'),
  }));
  process.exit(0);
}

if (instruction.includes('gerado com contexto ativo')) {
  const activeBlueprint = payload.activeBlueprint || {};
  const entity = String(activeBlueprint.entity || 'registro').toLowerCase();
  const extension = String(payload.extension || '').toLowerCase();
  if (extension === '.py') {
    process.stdout.write(JSON.stringify({
      snippet: [
        `def criar_${entity}(payload):`,
        `    return {"entidade": "${entity}", "payload": dict(payload)}`,
      ].join('\n'),
    }));
    process.exit(0);
  }

  process.stdout.write(JSON.stringify({
    snippet: [
      `function criar_${entity}(payload) {`,
      `  return { entidade: '${entity}', payload: { ...payload } };`,
      '}',
    ].join('\n'),
  }));
  process.exit(0);
}

process.stdout.write('{}');
