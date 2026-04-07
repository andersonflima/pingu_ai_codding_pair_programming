'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeText } = require('../lib/analyzer');
const { requireLiveOpenAiValidation } = require('./require_real_ai_command');

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
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-live-semantic-comments-'));
  writeFile(path.join(workspaceRoot, 'package.json'), JSON.stringify({
    name: 'billing-room-live-semantic-comments',
    private: true,
    type: 'module',
  }, null, 2));
  writeFile(path.join(workspaceRoot, 'README.md'), [
    '# Billing Room Live Semantic Comments',
    '',
    'Servidor realtime para salas privadas, convites e presenca de participantes.',
    '',
  ].join('\n'));
  writeFile(path.join(workspaceRoot, '.realtime-dev-agent', 'contexts', 'billing-room-live.md'), [
    'architecture: Onion',
    'entity: RoomSession',
    'source_root: src',
    'source_ext: .py',
    'summary: Fluxo realtime de rooms, invites e participants.',
    '',
  ].join('\n'));

  const pythonFile = path.join(workspaceRoot, 'src', 'room_runtime.py');
  writeFile(pythonFile, [
    'from dataclasses import dataclass',
    'from typing import Any',
    '',
    '@dataclass',
    'class RoomSessionRuntime:',
    '    chat_state: dict[str, Any]',
    '    sockets_by_client_id: dict[str, Any]',
    '',
    '    def build_room_snapshot(',
    '        self,',
    '        payload: dict[str, Any],',
    '    ) -> dict[str, Any]:',
    '        room_id = payload["room_id"]',
    '        participant_count = len(self.sockets_by_client_id)',
    '        room_snapshot = {"room_id": room_id, "participants": participant_count}',
    '        return room_snapshot',
    '',
  ].join('\n'));

  const javascriptFile = path.join(workspaceRoot, 'src', 'join_room.js');
  writeFile(javascriptFile, [
    'function handleJoinRoom(runtimeState, payload) {',
    '  const roomId = payload.roomId;',
    '  const participantCount = runtimeState.participants.length;',
    '  return { roomId, participantCount };',
    '}',
    '',
    'module.exports = { handleJoinRoom };',
    '',
  ].join('\n'));

  return {
    workspaceRoot,
    pythonFile,
    javascriptFile,
  };
}

function normalize(text) {
  return String(text || '').toLowerCase();
}

function containsOneOf(text, terms = []) {
  const normalized = normalize(text);
  return terms.some((term) => normalized.includes(String(term || '').toLowerCase()));
}

function assertSemanticSnippet(issue, options) {
  const snippet = String(issue && issue.snippet || '');
  assert(snippet.trim().length > 0, 'live semantic comments: snippet vazio para issue esperada', { issue });

  const expectedTerms = Array.isArray(options.expectedTerms) ? options.expectedTerms : [];
  assert(
    containsOneOf(snippet, expectedTerms),
    'live semantic comments: snippet nao refletiu termos concretos de dominio',
    {
      kind: issue && issue.kind,
      snippet,
      expectedTerms,
    },
  );

  const forbiddenPatterns = Array.isArray(options.forbiddenPatterns) ? options.forbiddenPatterns : [];
  forbiddenPatterns.forEach((pattern) => {
    assert(
      !pattern.test(snippet),
      'live semantic comments: snippet caiu em formula generica proibida',
      {
        kind: issue && issue.kind,
        snippet,
        forbiddenPattern: String(pattern),
      },
    );
  });
}

function findIssue(issues, kind, predicate = null) {
  return (issues || []).find((issue) => {
    if (!issue || issue.kind !== kind) {
      return false;
    }
    return typeof predicate === 'function' ? predicate(issue) : true;
  });
}

function main() {
  const liveState = requireLiveOpenAiValidation('live-semantic-comment-quality');
  const { workspaceRoot, pythonFile, javascriptFile } = buildWorkspace();
  try {
    const genericPatterns = [
      /comportamento principal/i,
      /responsabilidade principal/i,
      /etapa atual/i,
      /proxima etapa do fluxo/i,
    ];

    const pythonContents = fs.readFileSync(pythonFile, 'utf8');
    const pythonIssues = analyzeText(pythonFile, pythonContents, { maxLineLength: 120 });
    const pythonFunctionDoc = findIssue(pythonIssues, 'function_doc', (issue) => issue.metadata && issue.metadata.symbolName === 'build_room_snapshot');
    const pythonClassDoc = findIssue(pythonIssues, 'class_doc');
    const pythonVariableDoc = findIssue(pythonIssues, 'variable_doc', (issue) => issue.metadata && issue.metadata.symbolName === 'chat_state');
    const pythonFlowComment = findIssue(pythonIssues, 'flow_comment', (issue) => issue.metadata && /room_snapshot/i.test(String(issue.metadata.symbolName || issue.metadata.currentStep || '')));

    assert(Boolean(pythonFunctionDoc), 'live semantic comments: function_doc Python ausente', { pythonIssues });
    assert(Boolean(pythonClassDoc), 'live semantic comments: class_doc Python ausente', { pythonIssues });
    assert(Boolean(pythonVariableDoc), 'live semantic comments: variable_doc Python ausente', { pythonIssues });
    assert(Boolean(pythonFlowComment), 'live semantic comments: flow_comment Python ausente', { pythonIssues });

    assertSemanticSnippet(pythonFunctionDoc, {
      expectedTerms: ['room', 'snapshot', 'participant', 'chat_state', 'roomsession'],
      forbiddenPatterns: genericPatterns,
    });
    assertSemanticSnippet(pythonClassDoc, {
      expectedTerms: ['room', 'chat_state', 'socket', 'participant', 'roomsession'],
      forbiddenPatterns: genericPatterns,
    });
    assertSemanticSnippet(pythonVariableDoc, {
      expectedTerms: ['chat', 'room', 'participant', 'socket', 'state'],
      forbiddenPatterns: genericPatterns,
    });
    assertSemanticSnippet(pythonFlowComment, {
      expectedTerms: ['room', 'snapshot', 'participant', 'payload'],
      forbiddenPatterns: genericPatterns,
    });

    const javascriptContents = fs.readFileSync(javascriptFile, 'utf8');
    const javascriptIssues = analyzeText(javascriptFile, javascriptContents, { maxLineLength: 120 });
    const javascriptFunctionDoc = findIssue(javascriptIssues, 'function_doc', (issue) => issue.metadata && issue.metadata.symbolName === 'handleJoinRoom');

    assert(Boolean(javascriptFunctionDoc), 'live semantic comments: function_doc JavaScript ausente', { javascriptIssues });
    assertSemanticSnippet(javascriptFunctionDoc, {
      expectedTerms: ['room', 'participant', 'runtimeState', 'payload'],
      forbiddenPatterns: genericPatterns,
    });

    process.stdout.write(`${JSON.stringify({
      ok: true,
      liveMessage: liveState.message,
      checked: {
        python: {
          functionDoc: pythonFunctionDoc.snippet,
          classDoc: pythonClassDoc.snippet,
          variableDoc: pythonVariableDoc.snippet,
          flowComment: pythonFlowComment.snippet,
        },
        javascript: {
          functionDoc: javascriptFunctionDoc.snippet,
        },
      },
    }, null, 2)}\n`);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

main();
