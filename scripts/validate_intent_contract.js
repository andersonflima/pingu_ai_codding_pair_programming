#!/usr/bin/env node
'use strict';

const path = require('path');
const { analyzeText } = require('../lib/analyzer');

const repoRoot = path.resolve(__dirname, '..');

const intentContractCases = [
  {
    id: 'intent:function:javascript',
    sourcePath: path.join(repoRoot, '__intent_contract__', 'javascript', 'function_prompt.js'),
    content: '//: cria funcao soma com dois parametros\n',
    expectedKind: 'function',
    expectedToken: 'function',
    expectedSupported: true,
  },
  {
    id: 'intent:crud:javascript',
    sourcePath: path.join(repoRoot, '__intent_contract__', 'javascript', 'crud_prompt.js'),
    content: '//: cria crud de usuario\n',
    expectedKind: 'crud',
    expectedToken: 'crud',
    expectedSupported: true,
  },
  {
    id: 'intent:structure:typescript',
    sourcePath: path.join(repoRoot, '__intent_contract__', 'typescript', 'enum_prompt.ts'),
    content: '//: cria enum StatusPedido com pendente e aprovado\n',
    expectedKind: 'structure',
    expectedToken: 'enum',
    expectedSupported: true,
  },
  {
    id: 'intent:ui:tsx',
    sourcePath: path.join(repoRoot, '__intent_contract__', 'react', 'ui_prompt.tsx'),
    content: '//: cria componente de login com formulario e botao\n',
    expectedKind: 'ui',
    expectedToken: 'ui',
    expectedSupported: true,
  },
  {
    id: 'intent:test:python',
    sourcePath: path.join(repoRoot, '__intent_contract__', 'python', 'test_prompt.py'),
    content: '#: cria teste para validar a funcao soma\n',
    expectedKind: 'test',
    expectedToken: 'test',
    expectedSupported: true,
  },
  {
    id: 'intent:ui:python:unsupported',
    sourcePath: path.join(repoRoot, '__intent_contract__', 'python', 'ui_prompt.py'),
    content: '#: cria tela de login com formulario\n',
    expectedKind: 'ui',
    expectedToken: 'ui',
    expectedSupported: false,
  },
  {
    id: 'intent:comment:lua',
    sourcePath: path.join(repoRoot, '__intent_contract__', 'lua', 'comment_prompt.lua'),
    content: '--: gera comentario de manutencao\n',
    expectedKind: 'comment',
    expectedToken: 'comment',
    expectedSupported: true,
  },
  {
    id: 'precision:module:elixir:minimal',
    sourcePath: path.join(repoRoot, '__intent_contract__', 'elixir', 'module_main.ex'),
    content: '#:: criar um module main elixir\n',
    expectedKind: 'structure',
    expectedToken: 'module',
    expectedSupported: true,
    requiredSnippetIncludes: ['defmodule Main do', 'end'],
    forbiddenSnippetIncludes: ['def listar(', 'def criar(', '@moduledoc', '@spec'],
  },
  {
    id: 'precision:class:nodejs:minimal',
    sourcePath: path.join(repoRoot, '__intent_contract__', 'javascript', 'class_main.js'),
    content: '//:: criar um class main nodejs\n',
    expectedKind: 'structure',
    expectedToken: 'class',
    expectedSupported: true,
    requiredSnippetIncludes: ['class Main {', '}'],
    forbiddenSnippetIncludes: ['constructor(', 'this.id', 'this.nome', 'this.status'],
  },
  {
    id: 'precision:class:python:minimal',
    sourcePath: path.join(repoRoot, '__intent_contract__', 'python', 'class_main.py'),
    content: '#:: criar uma class main python\n',
    expectedKind: 'structure',
    expectedToken: 'class',
    expectedSupported: true,
    requiredSnippetIncludes: ['class Main:', 'pass'],
    forbiddenSnippetIncludes: ['def __init__', 'self.id', 'self.nome', 'self.status'],
  },
  {
    id: 'precision:elixir:refactor-nested-condition',
    sourcePath: path.join(repoRoot, '__intent_contract__', 'elixir', 'nested_refactor.exs'),
    content: [
      '# corrigir nested condition',
      '#: refatorar nested condition mantendo regra de negocio',
      'defmodule CorrecaoNestedCondition do',
      '  defp classificar_idade(idade) do',
      '    if idade >= 0 do',
      '      if idade < 13 do',
      '        :crianca',
      '      else',
      '        if idade < 18 do',
      '          :adolescente',
      '        else',
      '          :adulto',
      '        end',
      '      end',
      '    else',
      '      :invalida',
      '    end',
      '  end',
      'end',
      '',
    ].join('\n'),
    expectedKind: 'generic',
    expectedToken: 'function',
    expectedSupported: true,
    expectedActionOp: 'write_file',
    requiredSnippetIncludes: ['cond do', 'idade < 0 -> :invalida', 'idade < 13 -> :crianca', 'true -> :adulto'],
    forbiddenSnippetIncludes: ['# TODO:', '#: refatorar nested condition mantendo regra de negocio'],
  },
];

function validateCase(contractCase) {
  const issues = analyzeText(contractCase.sourcePath, contractCase.content, { maxLineLength: 120 });
  const commentTaskIssue = issues.find((issue) => issue.kind === 'comment_task');
  if (!commentTaskIssue) {
    return {
      ok: false,
      id: contractCase.id,
      reason: 'comment_task ausente',
      details: { issueKinds: issues.map((issue) => issue.kind) },
    };
  }

  const intent = commentTaskIssue.intent || null;
  const intentIR = commentTaskIssue.intentIR || null;
  const snippet = String(commentTaskIssue.snippet || '');
  const requiredSnippetIncludes = Array.isArray(contractCase.requiredSnippetIncludes)
    ? contractCase.requiredSnippetIncludes
    : [];
  const forbiddenSnippetIncludes = Array.isArray(contractCase.forbiddenSnippetIncludes)
    ? contractCase.forbiddenSnippetIncludes
    : [];
  const expectedActionOp = contractCase.expectedActionOp || '';
  const failures = [];

  if (!intent) {
    failures.push('intent ausente');
  } else {
    if (intent.kind !== contractCase.expectedKind) {
      failures.push(`intent.kind esperado=${contractCase.expectedKind} atual=${intent.kind}`);
    }
    if (intent.token !== contractCase.expectedToken) {
      failures.push(`intent.token esperado=${contractCase.expectedToken} atual=${intent.token}`);
    }
    if (intent.supported !== contractCase.expectedSupported) {
      failures.push(`intent.supported esperado=${contractCase.expectedSupported} atual=${intent.supported}`);
    }
  }

  if (!intentIR) {
    failures.push('intentIR ausente');
  } else {
    if (intentIR.mode !== 'comment_task') {
      failures.push(`intentIR.mode esperado=comment_task atual=${intentIR.mode}`);
    }
    if (!intentIR.intent || intentIR.intent.kind !== contractCase.expectedKind) {
      const actualKind = intentIR.intent && intentIR.intent.kind ? intentIR.intent.kind : 'undefined';
      failures.push(`intentIR.intent.kind esperado=${contractCase.expectedKind} atual=${actualKind}`);
    }
    if (!intentIR.constraints || intentIR.constraints.preferFunctional !== true) {
      failures.push('intentIR.constraints.preferFunctional deveria ser true');
    }
    if (!intentIR.constraints || intentIR.constraints.useActiveContext !== true) {
      failures.push('intentIR.constraints.useActiveContext deveria ser true');
    }
  }

  if (expectedActionOp) {
    const actionOp = commentTaskIssue.action && commentTaskIssue.action.op
      ? commentTaskIssue.action.op
      : '';
    if (actionOp !== expectedActionOp) {
      failures.push(`action.op esperado=${expectedActionOp} atual=${actionOp || 'undefined'}`);
    }
  }

  requiredSnippetIncludes.forEach((fragment) => {
    if (!snippet.includes(fragment)) {
      failures.push(`snippet sem trecho esperado: ${fragment}`);
    }
  });

  forbiddenSnippetIncludes.forEach((fragment) => {
    if (snippet.includes(fragment)) {
      failures.push(`snippet contem trecho proibido: ${fragment}`);
    }
  });

  return {
    ok: failures.length === 0,
    id: contractCase.id,
    reason: failures.join('; '),
    details: failures.length === 0 ? null : { intent, intentIR },
  };
}

function main() {
  const results = intentContractCases.map(validateCase);
  const failures = results.filter((result) => !result.ok);

  if (failures.length === 0) {
    console.log(`intent contract ok: ${results.length} casos validados`);
    return;
  }

  console.error(`intent contract falhou: ${failures.length} de ${results.length} casos`);
  failures.forEach((failure) => {
    console.error(`- ${failure.id}: ${failure.reason}`);
  });
  process.exitCode = 1;
}

main();
