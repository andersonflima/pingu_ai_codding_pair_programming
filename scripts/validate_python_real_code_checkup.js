#!/usr/bin/env node
'use strict';

process.env.PINGU_ACTIVE_LANGUAGE_IDS = process.env.PINGU_ACTIVE_LANGUAGE_IDS || 'elixir,javascript,python';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeText } = require('../lib/analyzer');
const { hasLiveOpenAiValidation } = require('./require_real_ai_command');

const cases = [
  {
    id: 'existing:function_doc',
    relativeFile: path.join('src', 'billing_docs.py'),
    content: [
      'def soma(a, b):',
      '    return a + b',
      '',
      'def listar(itens):',
      '    return itens',
    ].join('\n'),
    expectedKinds: ['function_doc'],
    expectedSnippetIncludes: ['"""', 'Args:', 'Returns:'],
    applyKinds: ['function_doc', 'function_doc'],
    mustClearKinds: ['function_doc'],
    expectedSourceIncludesAfterApply: ['def soma(a, b):', 'def listar(itens):', '"""', 'Args:', 'Returns:'],
  },
  {
    id: 'existing:undefined_variable:param_typo',
    relativeFile: path.join('src', 'billing_param_typo.py'),
    content: [
      'def soma(a, b):',
      '    return aa + b',
    ].join('\n'),
    expectedKinds: ['undefined_variable'],
    expectedSnippetIncludes: ['return a + b'],
    forbiddenSnippetIncludes: ['pingu - correction'],
    applyKinds: ['undefined_variable'],
    mustClearKinds: ['undefined_variable'],
    expectedSourceIncludesAfterApply: ['return a + b'],
  },
  {
    id: 'existing:undefined_variable:map_reference',
    relativeFile: path.join('src', 'billing_map_reference.py'),
    content: [
      'def formatar_usuario(usuario_mapa):',
      '    nome = usuario_map["nome"]',
      '    return f"{nome} <{usuario_mapa[\'email\']}>"',
    ].join('\n'),
    expectedKinds: ['undefined_variable'],
    expectedSnippetIncludes: ['nome = usuario_mapa["nome"]'],
    forbiddenSnippetIncludes: ['pingu - correction'],
    applyKinds: ['undefined_variable'],
    mustClearKinds: ['undefined_variable'],
    expectedSourceIncludesAfterApply: ['nome = usuario_mapa["nome"]'],
  },
  {
    id: 'existing:undefined_variable:main_block_typo',
    relativeFile: path.join('src', 'billing_main_block_typo.py'),
    content: [
      'import hashlib',
      '',
      'def create_16char_hash(input_string):',
      '    sha256_hash = hashlib.sha256(input_string.encode()).hexdigest()',
      '    return sha256_hash[:16]',
      '',
      'if __name__ == "__main__":',
      '    input_string = "Hello, World! Hello, World! Hello, World! Hello, World!"',
      '    hash_16inch = create_16char_hash(input_sting)',
      '    print(f"16-inch hash of \'{input_string}\': {hash_16inch}")',
    ].join('\n'),
    expectedKinds: ['undefined_variable'],
    expectedSnippetIncludes: ['hash_16inch = create_16char_hash(input_string)'],
    forbiddenSnippetIncludes: ['pingu - correction'],
    applyKinds: ['undefined_variable'],
    mustClearKinds: ['undefined_variable'],
    expectedSourceIncludesAfterApply: ['hash_16inch = create_16char_hash(input_string)'],
  },
  {
    id: 'existing:undefined_variable:preserve_import_binding',
    relativeFile: path.join('src', 'billing_import_binding.py'),
    content: [
      'def build_hasher(sha256h):',
      '    from hashlib import sha256',
      '    return sha256(b"value").hexdigest()',
    ].join('\n'),
    forbiddenKinds: ['undefined_variable'],
    forbiddenSnippetIncludes: ['sha256h', 'import sha256h'],
  },
  {
    id: 'existing:undefined_variable:validate_local_import_source',
    relativeFile: path.join('src', 'billing_import_source.py'),
    supportFiles: [
      {
        relativeFile: path.join('src', 'hash.py'),
        content: [
          'def build_hash(value):',
          '    return value',
        ].join('\n'),
      },
    ],
    content: [
      'def build_hasher():',
      '    from .hash import build_hashh',
      '    return build_hash("value")',
    ].join('\n'),
    expectedKinds: ['undefined_variable'],
    expectedSnippetIncludes: ['from .hash import build_hash'],
    applyKinds: ['undefined_variable'],
    mustClearKinds: ['undefined_variable'],
    expectedSourceIncludesAfterApply: ['from .hash import build_hash', 'return build_hash("value")'],
  },
  {
    id: 'existing:undefined_variable:preserve_multiline_import_block',
    relativeFile: path.join('src', 'billing_multiline_import_block.py'),
    content: [
      'from room_state import (',
      '    ChatState,',
      '    create_empty_state,',
      '    create_invite,',
      '    create_private_room,',
      '    create_public_room,',
      '    get_room,',
      '    join_room,',
      '    leave_room,',
      '    list_rooms_for_client,',
      '    serialize_room,',
      ')',
      '',
      'state = {}',
      'invite = {}',
      'room = {}',
      'joined_room_ids = []',
      'factory = create_empty_state',
    ].join('\n'),
    forbiddenKinds: ['undefined_variable'],
    forbiddenSnippetIncludes: ['state,', 'invite,', 'room,', 'joined_room_ids,'],
  },
  {
    id: 'existing:undefined_variable:ignore_docstring',
    relativeFile: path.join('src', 'billing_ignore_docstring.py'),
    content: [
      'def normalizar(order):',
      '    """',
      '    Normaliza submitted_at Order filled_at Alpaca para submitted_at no padrao esperado.',
      '    Aceita aliases diferentes filled_avg_price e status sem tratar texto como codigo.',
      '    """',
      '    submitted_at = order["submitted_at"]',
      '    return submitted_at',
    ].join('\n'),
    forbiddenKinds: ['undefined_variable'],
    forbiddenSnippetIncludes: ['pingu - correction'],
  },
  {
    id: 'existing:python_syntax_prefixes_and_comprehension',
    relativeFile: path.join('src', 'billing_python_prefixes.py'),
    content: [
      'import re',
      'from datetime import datetime, timezone',
      '',
      'def normalizar(',
      '    value: datetime,',
      '    environment_variables: list[dict[str, str]],',
      ') -> tuple[str, dict[str, str], list[dict[str, str]]]:',
      '    pattern = re.compile(r"^\\d{12}$")',
      '    iso_value = value.astimezone(timezone.utc).isoformat(timespec="milliseconds")',
      '    pairs = {key: inner for key, inner in {"env": "prod"}.items()}',
      '    request = [',
      '        {',
      '            "name": item.get("name"),',
      '        }',
      '        for item in environment_variables',
      '        if isinstance(item, dict)',
      '    ]',
      '    try:',
      '        raise ValueError("falhou")',
      '    except ValueError as exc:',
      '        return f"{iso_value}:{pairs[\'env\']}:{exc}:{bool(pattern)}"',
    ].join('\n'),
    forbiddenKinds: ['undefined_variable', 'syntax_missing_comma'],
    forbiddenSnippetIncludes: ['pingu - correction'],
  },
  {
    id: 'existing:function_doc:multiline_signature',
    relativeFile: path.join('src', 'billing_multiline_signature.py'),
    content: [
      'def normalizar(',
      '    value: int,',
      '    *,',
      '    escala: int = 2,',
      ') -> int:',
      '    total = value * escala',
      '    return total',
    ].join('\n'),
    expectedKinds: ['function_doc'],
    expectedSnippetIncludes: ['"""', 'Args:', 'Returns:'],
    applyKinds: ['function_doc'],
    mustClearKinds: ['function_doc'],
    expectedSourceIncludesAfterApply: ['def normalizar(', '"""', 'Args:', 'Returns:'],
    forbiddenKinds: ['undefined_variable'],
    forbiddenSnippetIncludes: ['pingu - correction'],
  },
  {
    id: 'existing:function_doc:async_def',
    relativeFile: path.join('src', 'billing_async_signature.py'),
    content: [
      'async def normalizar_evento(payload: dict[str, str]) -> str:',
      '    room_id = payload["room_id"]',
      '    return room_id.strip()',
    ].join('\n'),
    expectedKinds: ['function_doc'],
    expectedSnippetIncludes: ['"""', 'Args:', 'Returns:'],
    applyKinds: ['function_doc'],
    mustClearKinds: ['function_doc'],
    expectedSourceIncludesAfterApply: ['async def normalizar_evento', '"""', 'Args:', 'Returns:'],
    forbiddenKinds: ['undefined_variable'],
    forbiddenSnippetIncludes: ['pingu - correction'],
  },
  {
    id: 'existing:function_doc:decorated_classmethod',
    relativeFile: path.join('src', 'billing_decorated_classmethod.py'),
    preContext: {
      entity: 'RoomSession',
      summary: 'fluxo realtime que normaliza payloads de rooms privadas e publicas',
    },
    content: [
      'from dataclasses import dataclass',
      '',
      '@dataclass',
      'class Pedido:',
      '    chat_state: dict[str, str]',
      '',
      '    @classmethod',
      '    def from_payload(',
      '        cls,',
      '        payload: dict[str, str],',
      '    ) -> "Pedido":',
      '        state = payload["chat_state"]',
      '        return cls(chat_state=state)',
    ].join('\n'),
    expectedKinds: ['function_doc'],
    expectedSnippetIncludes: ['"""', 'Args:', 'Returns:', 'RoomSession'],
    applyKinds: ['function_doc'],
    mustClearKinds: ['function_doc'],
    expectedSourceIncludesAfterApply: ['@classmethod', 'def from_payload(', '"""', 'RoomSession'],
    forbiddenKinds: ['undefined_variable'],
    forbiddenSnippetIncludes: ['pingu - correction'],
  },
  {
    id: 'existing:function_doc:skip_overload_stub',
    relativeFile: path.join('src', 'billing_overload_signature.py'),
    content: [
      'from typing import overload',
      '',
      '@overload',
      'def normalizar(value: str) -> str:',
      '    ...',
      '',
      '@overload',
      'def normalizar(value: int) -> int:',
      '    ...',
      '',
      'def normalizar(value):',
      '    return value',
    ].join('\n'),
    expectedKinds: ['function_doc'],
    expectedSnippetIncludes: ['"""', 'Args:', 'Returns:'],
    applyKinds: ['function_doc'],
    mustClearKinds: ['function_doc'],
    expectedSourceIncludesAfterApply: ['@overload', 'def normalizar(value):', '"""'],
    forbiddenKinds: ['undefined_variable'],
    forbiddenSnippetIncludes: ['pingu - correction'],
  },
  {
    id: 'existing:class_doc',
    relativeFile: path.join('src', 'billing_class_doc.py'),
    content: [
      'class Pedido:',
      '    pass',
    ].join('\n'),
    expectedKinds: ['class_doc'],
    expectedSnippetIncludes: ['"""'],
    applyKinds: ['class_doc'],
    mustClearKinds: ['class_doc'],
    expectedSourceIncludesAfterApply: ['class Pedido:', '"""'],
  },
  {
    id: 'existing:variable_doc:type_alias_and_dataclass_fields',
    relativeFile: path.join('src', 'billing_variable_doc.py'),
    content: [
      'from dataclasses import dataclass',
      'from typing import Any',
      '',
      'JsonDict = dict[str, Any]',
      '',
      '@dataclass',
      'class RuntimeState:',
      '    room_id: str',
      '    chat_state: JsonDict',
      '    lock: Any',
    ].join('\n'),
    expectedKinds: ['variable_doc'],
    applyKinds: ['variable_doc', 'variable_doc', 'variable_doc'],
    mustClearKinds: ['variable_doc'],
    expectedSourceIncludesAfterApply: ['JsonDict = dict[str, Any]', 'room_id: str', 'chat_state: JsonDict', 'lock: Any'],
    forbiddenSourceIncludesAfterApply: ['room_id disponivel'],
  },
  {
    id: 'existing:flow_comment',
    relativeFile: path.join('src', 'billing_flow_comment.py'),
    content: [
      'def soma(valor):',
      '    total = valor + 1',
      '    return total',
    ].join('\n'),
    expectedKinds: ['flow_comment'],
    applyKinds: ['flow_comment'],
    mustClearKinds: ['flow_comment'],
    expectedSourceIncludesAfterApply: ['total = valor + 1'],
  },
  {
    id: 'existing:debug_output',
    relativeFile: path.join('src', 'billing_debug_output.py'),
    content: [
      'def calcular_total(a, b):',
      '    total = a + b',
      '    print(total)',
    ].join('\n'),
    expectedKinds: ['debug_output'],
    applyKinds: ['debug_output'],
    mustClearKinds: ['debug_output'],
    forbiddenSourceIncludesAfterApply: ['print('],
  },
  {
    id: 'existing:todo_fixme',
    relativeFile: path.join('src', 'billing_todo_fixme.py'),
    content: [
      'def processar(payload):',
      '    # TODO: remover ajuste temporario',
      '    return payload',
    ].join('\n'),
    expectedKinds: ['todo_fixme'],
    applyKinds: ['todo_fixme'],
    mustClearKinds: ['todo_fixme'],
    forbiddenSourceIncludesAfterApply: ['TODO', 'FIXME'],
  },
  {
    id: 'existing:context_contract:calculator_return',
    relativeFile: path.join('src', 'calculadora_context_contract.py'),
    preContext: {
      entity: 'calculadora',
      summary: 'projeto de calculadora com retorno numerico para o cliente',
    },
    content: [
      'def resultado(a, b):',
      '    total = a + b',
      '    return True',
    ].join('\n'),
    expectedKinds: ['context_contract'],
    applyKinds: ['context_contract'],
    mustClearKinds: ['context_contract'],
    expectedSourceIncludesAfterApply: ['total = a + b', 'return total'],
    forbiddenSourceIncludesAfterApply: ['return True', 'return False'],
  },
  {
    id: 'existing:unit_test',
    relativeFile: path.join('src', 'billing_contract.py'),
    content: [
      'def soma(a, b):',
      '    return a + b',
      '',
      'def listar(itens):',
      '    return itens',
    ].join('\n'),
    expectedKinds: ['unit_test'],
    expectedSnippetIncludes: ['from src.billing_contract import *', 'assert soma(1, 2) == 3', 'assert listar([1, 2]) == [1, 2]'],
    applyKinds: ['unit_test'],
    mustClearKinds: ['unit_test'],
    expectedTargetFileSuffix: path.join('tests', 'src', 'test_billing_contract.py'),
    expectedTargetIncludesAfterApply: ['assert soma(1, 2) == 3', 'assert listar([1, 2]) == [1, 2]'],
  },
];
const realAiAvailable = hasLiveOpenAiValidation();

function createWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-python-real-checkup-'));
  const contextsDir = path.join(root, '.realtime-dev-agent', 'contexts');
  const contextFile = path.join(contextsDir, 'python-active.md');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.mkdirSync(contextsDir, { recursive: true });
  fs.writeFileSync(path.join(root, 'pyproject.toml'), [
    '[project]',
    'name = "pingu-python-real-checkup"',
    'version = "0.1.0"',
    '',
  ].join('\n'));
  return {
    root,
    contextFile,
  };
}

function buildActiveContextDocument(entity, summary) {
  return [
    '<!-- realtime-dev-agent-context -->',
    'architecture: onion',
    'blueprint_type: bff_crud',
    `entity: ${entity}`,
    'language: python',
    'slug: python-active',
    'source_ext: .py',
    'source_root: src',
    `summary: ${summary}`,
    '',
    '# Contexto ativo',
    `- Contexto principal: ${entity}`,
  ].join('\n');
}

function analyzeFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return analyzeText(filePath, content, { maxLineLength: 120 });
}

function readFileLines(targetFile) {
  return fs.readFileSync(targetFile, 'utf8').replace(/\r\n/g, '\n').split('\n');
}

function writeFileLines(targetFile, lines) {
  fs.writeFileSync(targetFile, lines.join('\n'), 'utf8');
}

function snippetLines(snippet) {
  const normalized = String(snippet || '').replace(/\r\n/g, '\n');
  if (normalized.length === 0) {
    return [];
  }
  return normalized.split('\n');
}

function boundedLineIndex(line, lines) {
  const numeric = Number(line || 1);
  if (!Number.isFinite(numeric) || numeric <= 1) {
    return 0;
  }
  return Math.min(Math.max(0, numeric - 1), Math.max(0, lines.length - 1));
}

function findIssueForKind(issues, kind, testCase) {
  const expectedSuffix = testCase.expectedTargetFileSuffix || '';
  if (expectedSuffix) {
    const withTarget = issues.find((issue) => {
      if (issue.kind !== kind) {
        return false;
      }
      const targetFile = issue.action ? String(issue.action.target_file || '') : '';
      return targetFile.endsWith(expectedSuffix);
    });
    if (withTarget) {
      return withTarget;
    }
  }
  return issues.find((issue) => issue.kind === kind) || null;
}

function applyIssueAction(sourceFile, issue) {
  const action = issue && issue.action && typeof issue.action === 'object'
    ? issue.action
    : { op: 'insert_before' };
  const op = String(action.op || 'insert_before');
  const renderedSnippetLines = snippetLines(issue && issue.snippet);

  if (op === 'write_file') {
    const targetFile = String(action.target_file || sourceFile);
    if (action.mkdir_p) {
      fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    }
    fs.writeFileSync(targetFile, renderedSnippetLines.join('\n'), 'utf8');
    return targetFile;
  }

  const lines = readFileLines(sourceFile);
  const index = boundedLineIndex(issue.line, lines);

  if (op === 'replace_line') {
    lines.splice(index, 1, ...renderedSnippetLines);
    writeFileLines(sourceFile, lines);
    return sourceFile;
  }

  if (op === 'insert_after') {
    lines.splice(index + 1, 0, ...renderedSnippetLines);
    writeFileLines(sourceFile, lines);
    return sourceFile;
  }

  lines.splice(index, 0, ...renderedSnippetLines);
  writeFileLines(sourceFile, lines);
  return sourceFile;
}

function validateCase(workspace, testCase) {
  if (testCase.preContext) {
    fs.writeFileSync(
      workspace.contextFile,
      buildActiveContextDocument(testCase.preContext.entity, testCase.preContext.summary),
      'utf8',
    );
  } else {
    fs.rmSync(workspace.contextFile, { force: true });
  }

  const filePath = path.join(workspace.root, testCase.relativeFile);
  (testCase.supportFiles || []).forEach((supportFile) => {
    const supportPath = path.join(workspace.root, supportFile.relativeFile);
    fs.mkdirSync(path.dirname(supportPath), { recursive: true });
    fs.writeFileSync(supportPath, `${supportFile.content}\n`, 'utf8');
  });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${testCase.content}\n`, 'utf8');

  let currentIssues = analyzeFile(filePath);
  const issueKinds = new Set(currentIssues.map((issue) => issue.kind));
  const missingKinds = (testCase.expectedKinds || []).filter((kind) => !issueKinds.has(kind));
  const forbiddenKinds = (testCase.forbiddenKinds || []).filter((kind) => issueKinds.has(kind));
  const snippetPayload = currentIssues.map((issue) => String(issue.snippet || '')).join('\n---\n');
  const missingSnippets = (testCase.expectedSnippetIncludes || []).filter((fragment) => !snippetPayload.includes(fragment));
  const forbiddenSnippets = (testCase.forbiddenSnippetIncludes || []).filter((fragment) => snippetPayload.includes(fragment));

  if (
    !realAiAvailable
    && issueKinds.has('ai_required')
    && (missingKinds.length > 0 || missingSnippets.length > 0 || forbiddenSnippets.length > 0)
  ) {
    return {
      id: testCase.id,
      filePath,
      ok: true,
      skipped: true,
      missingKinds,
      forbiddenKinds: [],
      missingSnippets,
      forbiddenSnippets,
      applyFailures: [],
      sourceExpectationFailures: [],
      targetExpectationFailures: [],
      actualKinds: Array.from(issueKinds).sort(),
      remainingKindsAfterApply: Array.from(issueKinds).sort(),
    };
  }

  const applyFailures = [];
  const appliedTargets = {};
  const applyKinds = Array.isArray(testCase.applyKinds) ? testCase.applyKinds : [];

  applyKinds.forEach((kind) => {
    const issue = findIssueForKind(currentIssues, kind, testCase);
    if (!issue) {
      applyFailures.push(`issue ausente para aplicar kind=${kind}`);
      return;
    }
    const target = applyIssueAction(filePath, issue);
    appliedTargets[kind] = target;
    currentIssues = analyzeFile(filePath);
  });

  (testCase.mustClearKinds || []).forEach((kind) => {
    if (currentIssues.some((issue) => issue.kind === kind)) {
      applyFailures.push(`kind ${kind} permaneceu apos aplicacao`);
    }
  });

  const sourceExpectationFailures = [];
  const sourceAfterApply = fs.readFileSync(filePath, 'utf8');
  (testCase.expectedSourceIncludesAfterApply || []).forEach((fragment) => {
    if (!sourceAfterApply.includes(fragment)) {
      sourceExpectationFailures.push(`fonte sem trecho esperado apos aplicar: ${fragment}`);
    }
  });
  (testCase.forbiddenSourceIncludesAfterApply || []).forEach((fragment) => {
    if (sourceAfterApply.includes(fragment)) {
      sourceExpectationFailures.push(`fonte contem trecho proibido apos aplicar: ${fragment}`);
    }
  });

  const targetExpectationFailures = [];
  if ((testCase.expectedTargetIncludesAfterApply || []).length > 0) {
    const targetPath = appliedTargets.unit_test || appliedTargets.context_file || '';
    if (!targetPath || !fs.existsSync(targetPath)) {
      targetExpectationFailures.push('arquivo alvo esperado nao foi criado');
    } else {
      const targetContent = fs.readFileSync(targetPath, 'utf8');
      (testCase.expectedTargetIncludesAfterApply || []).forEach((fragment) => {
        if (!targetContent.includes(fragment)) {
          targetExpectationFailures.push(`alvo sem trecho esperado apos aplicar: ${fragment}`);
        }
      });
    }
  }

  return {
    id: testCase.id,
    filePath,
    ok: missingKinds.length === 0
      && forbiddenKinds.length === 0
      && missingSnippets.length === 0
      && forbiddenSnippets.length === 0
      && applyFailures.length === 0
      && sourceExpectationFailures.length === 0
      && targetExpectationFailures.length === 0,
    missingKinds,
    forbiddenKinds,
    missingSnippets,
    forbiddenSnippets,
    applyFailures,
    sourceExpectationFailures,
    targetExpectationFailures,
    actualKinds: Array.from(issueKinds).sort(),
    remainingKindsAfterApply: Array.from(new Set(currentIssues.map((issue) => issue.kind))).sort(),
  };
}

function main() {
  const workspace = createWorkspace();
  const results = cases.map((testCase) => validateCase(workspace, testCase));
  const skipped = results.filter((result) => result.skipped);
  const failures = results.filter((result) => !result.ok);

  const report = {
    ok: failures.length === 0,
    workspace: workspace.root,
    totalCases: results.length,
    passedCases: results.length - failures.length - skipped.length,
    skippedCases: skipped.length,
    failedCases: failures.length,
    realAiAvailable,
    failures: failures.map((failure) => ({
      id: failure.id,
      file: failure.filePath,
      missingKinds: failure.missingKinds,
      missingSnippets: failure.missingSnippets,
      forbiddenSnippets: failure.forbiddenSnippets,
      applyFailures: failure.applyFailures,
      sourceExpectationFailures: failure.sourceExpectationFailures,
      targetExpectationFailures: failure.targetExpectationFailures,
      actualKinds: failure.actualKinds,
      remainingKindsAfterApply: failure.remainingKindsAfterApply,
    })),
    skipped: skipped.map((result) => ({
      id: result.id,
      file: result.filePath,
      actualKinds: result.actualKinds,
    })),
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  fs.rmSync(workspace.root, { recursive: true, force: true });
  process.exitCode = report.ok ? 0 : 1;
}

main();
