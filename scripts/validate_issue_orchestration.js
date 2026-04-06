#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeText } = require('../lib/analyzer');
const { buildFollowUpInstruction } = require('../lib/follow-up');
const {
  autoFixNoOpReason,
  buildIssueConfidenceReport,
  semanticPriorityForIssue,
} = require('../lib/issue-confidence');
const { classifyAutofixBatch, evaluateAutofixGuard } = require('../lib/autofix-guard');
const { loadProjectMemory } = require('../lib/project-memory');

function assert(condition, message, details = {}) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function writeFile(targetFile, contents) {
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.writeFileSync(targetFile, contents, 'utf8');
}

function buildWorkspace() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-issue-orchestration-'));
  writeFile(path.join(workspaceRoot, 'package.json'), JSON.stringify({
    name: 'billing-room-realtime',
    type: 'module',
    scripts: {
      test: 'node --test',
      lint: 'eslint .',
    },
  }, null, 2));
  writeFile(path.join(workspaceRoot, 'README.md'), [
    '# Billing Room Realtime',
    '',
    'Servidor realtime para salas privadas e publicas com WebSocket.',
    '',
  ].join('\n'));
  writeFile(path.join(workspaceRoot, '.realtime-dev-agent', 'contexts', 'billing-room-active.md'), [
    'architecture: Onion',
    'entity: RoomSession',
    'source_root: src',
    'source_ext: .py',
    'summary: Fluxo realtime para salas e convites.',
    '',
  ].join('\n'));
  const sourceFile = path.join(workspaceRoot, 'src', 'runtime_state.py');
  writeFile(sourceFile, [
    'from dataclasses import dataclass',
    'from typing import Any',
    '',
    '@dataclass',
    'class RuntimeState:',
    '    chat_state: dict[str, Any]',
    '    lock: Any',
    '',
    'async def handle_connection(runtime_state: RuntimeState, payload: dict[str, Any]) -> None:',
    '    room_snapshot = payload.get("room")',
    '    return None',
    '',
  ].join('\n'));
  return {
    workspaceRoot,
    sourceFile,
  };
}

function main() {
  const { workspaceRoot, sourceFile } = buildWorkspace();
  try {
    const contents = fs.readFileSync(sourceFile, 'utf8');
    const issues = analyzeText(sourceFile, contents, { maxLineLength: 120 });
    const functionDocIssue = issues.find((issue) => issue && issue.kind === 'function_doc');
    const variableDocIssue = issues.find((issue) => issue && issue.kind === 'variable_doc' && issue.metadata && issue.metadata.symbolName === 'chat_state');

    assert(Boolean(functionDocIssue), 'orchestration: async def deveria gerar function_doc', { issues });
    assert(Boolean(variableDocIssue), 'orchestration: atributo relevante deveria gerar variable_doc', { issues });
    assert(
      functionDocIssue.confidence && Number(functionDocIssue.confidence.score) >= 0.7,
      'orchestration: function_doc com declaracao conhecida deveria sair com confianca media/alta',
      { confidence: functionDocIssue && functionDocIssue.confidence },
    );
    assert(
      Number(functionDocIssue.autofixPriority) < Number(variableDocIssue.autofixPriority),
      'orchestration: function_doc deveria priorizar acima de variable_doc no mesmo arquivo',
      {
        functionDocPriority: functionDocIssue.autofixPriority,
        variableDocPriority: variableDocIssue.autofixPriority,
      },
    );

    const projectMemory = loadProjectMemory(sourceFile);
    assert(projectMemory.projectName === 'billing-room-realtime', 'orchestration: memoria do projeto deveria ler package.json', { projectMemory });
    assert(projectMemory.architecture === 'Onion', 'orchestration: memoria do projeto deveria ler contexto ativo', { projectMemory });
    assert(projectMemory.entity === 'RoomSession', 'orchestration: memoria do projeto deveria expor entidade ativa', { projectMemory });

    const followUpInstruction = buildFollowUpInstruction(variableDocIssue);
    assert(followUpInstruction.includes('arquitetura Onion'), 'orchestration: follow-up deveria incluir arquitetura do projeto', { followUpInstruction });
    assert(followUpInstruction.includes('RoomSession'), 'orchestration: follow-up deveria incluir entidade do projeto', { followUpInstruction });
    assert(followUpInstruction.includes('chat_state'), 'orchestration: follow-up deveria incluir o simbolo relevante', { followUpInstruction });

    const lowConfidenceIssue = {
      file: sourceFile,
      line: 9,
      kind: 'comment_task',
      severity: 'warning',
      action: { op: 'write_file', target_file: path.join(workspaceRoot, 'tmp', 'generated.txt') },
      confidence: { score: 0.42, label: 'low' },
    };
    assert(
      Boolean(autoFixNoOpReason(lowConfidenceIssue, { autoMode: true })),
      'orchestration: lote estrutural com baixa confianca deveria virar no-op automatico',
      { noOpReason: autoFixNoOpReason(lowConfidenceIssue, { autoMode: true }) },
    );

    const commentOnlyBatch = classifyAutofixBatch([functionDocIssue], [{ path: sourceFile, contents }]);
    assert(commentOnlyBatch.strategy === 'documentation_only', 'orchestration: lote documental deveria ser classificado corretamente', { commentOnlyBatch });
    assert(commentOnlyBatch.requiresRuntimeValidation === false, 'orchestration: lote documental nao deveria exigir validacao runtime', { commentOnlyBatch });

    const guardResult = evaluateAutofixGuard({
      appliedIssues: [functionDocIssue],
      beforeIssues: issues,
      afterIssues: issues.filter((issue) => issue !== functionDocIssue),
      fileEntries: [{ path: sourceFile, contents }],
    });
    assert(guardResult.ok, 'orchestration: guard deveria aceitar lote puramente documental quando must-clear fecha', { guardResult });
    assert(guardResult.batchProfile.strategy === 'documentation_only', 'orchestration: guard deveria expor o perfil do lote', { guardResult });

    const report = buildIssueConfidenceReport(issues);
    assert(report.total >= 2, 'orchestration: relatorio deveria agregar issues analisadas', { report });
    assert(report.kinds.function_doc && report.kinds.variable_doc, 'orchestration: relatorio deveria agregar por kind', { report });
    assert(report.languages.python && report.languages.python.count >= 2, 'orchestration: relatorio deveria agregar por linguagem', { report });
    assert(
      semanticPriorityForIssue(functionDocIssue) === Number(functionDocIssue.autofixPriority),
      'orchestration: prioridade semantica deveria casar com a prioridade anotada',
      {
        semanticPriority: semanticPriorityForIssue(functionDocIssue),
        autofixPriority: functionDocIssue.autofixPriority,
      },
    );

    process.stdout.write(`${JSON.stringify({
      ok: true,
      projectMemory,
      followUpInstruction,
      batchProfile: guardResult.batchProfile,
      report,
    }, null, 2)}\n`);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

main();
