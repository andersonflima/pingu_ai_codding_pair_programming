#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
const mode = String(payload.mode || 'comment_task').toLowerCase();
const instruction = String(payload.effectiveInstruction || payload.instruction || '').toLowerCase();
const extension = String(payload.extension || '').toLowerCase();

if (mode === 'context_resolution') {
  process.stdout.write(JSON.stringify(buildContextResolution(payload)));
  process.exit(0);
}

if (mode === 'unit_test') {
  process.stdout.write(JSON.stringify(buildUnitTests(payload)));
  process.exit(0);
}

if (mode === 'issue_fix') {
  process.stdout.write(JSON.stringify(buildIssueFix(payload)));
  process.exit(0);
}

process.stdout.write(JSON.stringify(buildCommentTask(payload, instruction, extension)));

function isJavaScriptExtension(ext) {
  return ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(String(ext || '').toLowerCase());
}

function isPythonExtension(ext) {
  return String(ext || '').toLowerCase() === '.py';
}

function buildCommentTask(currentPayload, normalizedInstruction, normalizedExtension) {
  if (isJavaScriptExtension(normalizedExtension) && /\bcriar\b.*\bclass\b.*\bmain\b/.test(normalizedInstruction)) {
    return {
      snippet: [
        'class Main {}',
        '',
        'module.exports = { Main };',
      ].join('\n'),
    };
  }

  if (isJavaScriptExtension(normalizedExtension) && normalizedInstruction.includes('criar crud completo')) {
    const entity = resolveEntityName(currentPayload);
    const plural = pluralize(entity);
    const listFn = `listar${pascalize(plural)}`;
    const createFn = `criar${pascalize(entity)}`;
    return {
      snippet: [
        `function ${listFn}(${plural}) {`,
        `  return ${plural};`,
        '}',
        '',
        `function ${createFn}(${plural}, payload) {`,
        `  return [...${plural}, { id: ${plural}.length + 1, ...payload }];`,
        '}',
        '',
        `module.exports = { ${listFn}, ${createFn} };`,
      ].join('\n'),
    };
  }

  if (isJavaScriptExtension(normalizedExtension) && normalizedInstruction.includes('grafo direcionado')) {
    return {
      snippet: buildDirectedGraphSnippetJavaScript(),
    };
  }

  if (isPythonExtension(normalizedExtension) && /\bcriar\b.*\bclass\b.*\bmain\b/.test(normalizedInstruction)) {
    return {
      snippet: [
        'class Main:',
        '    pass',
      ].join('\n'),
    };
  }

  if (isPythonExtension(normalizedExtension) && normalizedInstruction.includes('criar crud completo')) {
    const entity = resolveEntityName(currentPayload);
    const plural = pluralize(entity);
    const listFn = `listar_${plural}`;
    const createFn = `criar_${entity}`;
    return {
      snippet: [
        `def ${listFn}(${plural}):`,
        `    return ${plural}`,
        '',
        `def ${createFn}(${plural}, payload):`,
        `    return [*${plural}, {'id': len(${plural}) + 1, **payload}]`,
      ].join('\n'),
    };
  }

  if (isPythonExtension(normalizedExtension) && normalizedInstruction.includes('grafo direcionado')) {
    return {
      snippet: buildDirectedGraphSnippetPython(),
    };
  }

  if (normalizedInstruction.includes('criar um module main')) {
    return { snippet: ['defmodule Main do', 'end'].join('\n') };
  }

  if (normalizedInstruction.includes('criar crud completo')) {
    const entity = resolveEntityName(currentPayload);
    const plural = pluralize(entity);
    const moduleName = pascalize(plural);
    return {
      snippet: [
        `defmodule ${moduleName} do`,
        `  def listar_${plural}(${plural}), do: ${plural}`,
        '',
        `  def criar_${entity}(${plural}, payload) do`,
        `    ${plural} ++ [Map.merge(%{id: length(${plural}) + 1}, payload)]`,
        '  end',
        'end',
      ].join('\n'),
    };
  }

  if (normalizedInstruction.includes('grafo direcionado')) {
    return {
      snippet: buildDirectedGraphSnippet(),
    };
  }

  if (normalizedInstruction.includes('enum status_pedido')) {
    return {
      snippet: [
        'defmodule StatusPedido do',
        '  @type status_pedido :: :pendente | :aprovado | :cancelado',
        '',
        '  def status_pedido_values do',
        '    [:pendente, :aprovado, :cancelado]',
        '  end',
        'end',
      ].join('\n'),
    };
  }

  if (normalizedInstruction.includes('cria modulo billing com funcoes listar e criar')) {
    return {
      snippet: [
        'defmodule Billing do',
        '  def listar(itens), do: itens',
        '',
        '  def criar(payload), do: payload',
        'end',
      ].join('\n'),
    };
  }

  if (normalizedInstruction.includes('class roombroadcaster')) {
    return {
      snippet: [
        'defmodule RoomBroadcaster do',
        '  defstruct usuarios_conectados_a_rooms: %{}',
        '',
        '  def broadcast(%__MODULE__{usuarios_conectados_a_rooms: usuarios_conectados_a_rooms}, room_id, mensagem) do',
        '    Map.get(usuarios_conectados_a_rooms, room_id, [])',
        '    |> Enum.map(fn usuario -> %{usuario: usuario, mensagem: mensagem} end)',
        '  end',
        'end',
      ].join('\n'),
    };
  }

  if (normalizedInstruction.includes('refatorar nested condition mantendo regra de negocio')) {
    return {
      snippet: buildNestedConditionRewrite(currentPayload),
      action: {
        op: 'write_file',
        target_file: currentPayload.sourceFile || '',
        mkdir_p: true,
      },
    };
  }

  if (normalizedInstruction.includes('gerado com contexto ativo')) {
    const entity = resolveEntityName(currentPayload);
    return {
      snippet: [
        `def criar_${entity}(payload) do`,
        `  %{entidade: "${entity}", payload: Map.new(payload)}`,
        'end',
      ].join('\n'),
    };
  }

  if (normalizedInstruction.includes('gerado via ai')) {
    return {
      snippet: [
        'defmodule AiGeneratedTask do',
        '  def answer, do: 42',
        'end',
      ].join('\n'),
    };
  }

  return {};
}

function buildContextResolution(currentPayload) {
  const blueprintHint = currentPayload.blueprintHint || {};
  const entity = resolveEntityName(currentPayload);
  const summary = String(blueprintHint.summary || currentPayload.instruction || 'contexto ativo').trim();
  const sourceExt = String(blueprintHint.sourceExt || currentPayload.extension || '.ex');
  const contextMetadata = resolveContextMetadata(sourceExt);
  const sourceRoot = String(blueprintHint.sourceRoot || contextMetadata.sourceRoot);
  const existingContext = String(currentPayload.existingContextDocument || '');
  const currentEntity = String(currentPayload.activeBlueprint && currentPayload.activeBlueprint.entity || '').trim();
  const mergedSummary = currentEntity && currentEntity === entity
    ? `${summary} | merged_with_existing_context`
    : summary;

  return {
    snippet: [
      '<!-- realtime-dev-agent-context -->',
      'architecture: onion',
      'blueprint_type: bff_crud',
      `entity: ${entity}`,
      `language: ${contextMetadata.language}`,
      `slug: ${contextMetadata.slug}`,
      `source_ext: ${sourceExt}`,
      `source_root: ${sourceRoot}`,
      `summary: ${mergedSummary}`,
      '',
      '# Contexto ativo',
      `- Contexto principal: ${entity}`,
      `- Linguagem alvo: ${contextMetadata.language}`,
      `- Politica aplicada: ${currentEntity && currentEntity === entity ? 'merge' : 'overwrite'}`,
      existingContext && currentEntity && currentEntity === entity
        ? `- Contexto anterior preservado para ${currentEntity}`
        : `- Contexto anterior substituido${currentEntity ? ` (${currentEntity})` : ''}`,
    ].filter(Boolean).join('\n'),
    action: {
      op: 'write_file',
      target_file: String(currentPayload.targetFile || ''),
      mkdir_p: true,
    },
  };
}

function buildUnitTests(currentPayload) {
  const source = String(currentPayload.content || '');
  const sourceExt = String(currentPayload.extension || path.extname(String(currentPayload.sourceFile || '')) || '.ex').toLowerCase();
  if (isJavaScriptExtension(sourceExt)) {
    return buildJavaScriptUnitTests(currentPayload);
  }
  if (isPythonExtension(sourceExt)) {
    return buildPythonUnitTests(currentPayload);
  }

  const moduleMatch = source.match(/defmodule\s+([A-Za-z0-9_.?!]+)\s+do/);
  const moduleName = moduleMatch ? moduleMatch[1] : pascalize(path.parse(String(currentPayload.sourceFile || '')).name || 'module');
  const targetFile = String(currentPayload.targetFile || '');
  const testModuleName = `${moduleName}Test`;
  const candidates = Array.isArray(currentPayload.testCandidates) ? currentPayload.testCandidates : [];
  const describeBlocks = candidates.map((candidate) => buildExUnitBlock(moduleName, candidate));

  return {
    snippet: [
      'ExUnit.start()',
      '',
      `defmodule ${testModuleName} do`,
      '  use ExUnit.Case, async: true',
      '',
      ...describeBlocks.flatMap((block) => block.split('\n')),
      'end',
    ].join('\n'),
    action: {
      op: 'write_file',
      target_file: targetFile,
      mkdir_p: true,
    },
  };
}

function buildJavaScriptUnitTests(currentPayload) {
  const targetFile = String(currentPayload.targetFile || '');
  const sourceFile = String(currentPayload.sourceFile || '');
  const candidates = Array.isArray(currentPayload.testCandidates) ? currentPayload.testCandidates : [];
  const relativeSource = toPosixPath(path.relative(path.dirname(targetFile), sourceFile));
  const importPath = relativeSource.startsWith('.') ? relativeSource : `./${relativeSource}`;

  const lines = [
    "const test = require('node:test');",
    "const assert = require('node:assert/strict');",
    `const subject = require(${JSON.stringify(importPath)});`,
    '',
  ];

  candidates.forEach((candidate, index) => {
    const name = String(candidate && candidate.name || 'executar');
    const arity = Number(candidate && candidate.arity || 0);
    if (index > 0) {
      lines.push('');
    }
    lines.push(`test(${JSON.stringify(`${name}/${arity} permanece disponivel`)}, () => {`);
    lines.push(`  assert.equal(typeof subject.${name}, 'function');`);
    lines.push('});');

    const behaviorAssertion = buildJavaScriptCandidateAssertion(name, arity);
    if (behaviorAssertion) {
      lines.push('');
      lines.push(`test(${JSON.stringify(`${name}/${arity} executa o contrato principal`)}, () => {`);
      lines.push(`  ${behaviorAssertion}`);
      lines.push('});');
    }
  });

  return {
    snippet: lines.join('\n'),
    action: {
      op: 'write_file',
      target_file: targetFile,
      mkdir_p: true,
    },
  };
}

function buildPythonUnitTests(currentPayload) {
  const targetFile = String(currentPayload.targetFile || '');
  const modulePath = String(currentPayload.sourceFile || '');
  const moduleName = path.parse(modulePath).name;
  const candidates = Array.isArray(currentPayload.testCandidates) ? currentPayload.testCandidates : [];

  const lines = [
    `from src.${moduleName} import *`,
    '',
  ];

  candidates.forEach((candidate, index) => {
    const name = String(candidate && candidate.name || 'executar');
    const arity = Number(candidate && candidate.arity || 0);
    if (index > 0) {
      lines.push('');
    }
    lines.push(`def test_${name}_${arity}_disponivel():`);
    lines.push(`    assert callable(${name})`);

    const assertion = buildPythonCandidateAssertion(name, arity);
    if (assertion) {
      lines.push('');
      lines.push(`def test_${name}_${arity}_contrato_principal():`);
      lines.push(`    ${assertion}`);
    }
  });

  return {
    snippet: lines.join('\n'),
    action: {
      op: 'write_file',
      target_file: targetFile,
      mkdir_p: true,
    },
  };
}

function buildPythonCandidateAssertion(candidateName, arity) {
  if (candidateName === 'soma' && arity === 1) {
    return 'assert soma(1) == 2';
  }
  if (candidateName === 'soma' && arity === 2) {
    return 'assert soma(1, 2) == 3';
  }
  if (candidateName === 'listar' && arity === 1) {
    return 'assert listar([1, 2]) == [1, 2]';
  }
  if (candidateName.startsWith('listar_') && arity === 1) {
    return `assert ${candidateName}([{'id': 1}]) == [{'id': 1}]`;
  }
  return '';
}

function buildJavaScriptCandidateAssertion(candidateName, arity) {
  if (candidateName === 'soma' && arity === 1) {
    return 'assert.equal(subject.soma(1), 2);';
  }
  if (candidateName === 'soma' && arity === 2) {
    return 'assert.equal(subject.soma(1, 2), 3);';
  }
  if (candidateName === 'listar' && arity === 1) {
    return 'assert.deepEqual(subject.listar([1, 2]), [1, 2]);';
  }
  if (candidateName.startsWith('listar') && arity === 1) {
    return `assert.deepEqual(subject[${JSON.stringify(candidateName)}]([{ id: 1 }]), [{ id: 1 }]);`;
  }
  return '';
}

function buildIssueFix(currentPayload) {
  const issue = currentPayload.issue || {};
  const issueKind = String(issue.kind || '');
  const source = String(currentPayload.content || '');
  const lineText = String(currentPayload.issueContext && currentPayload.issueContext.lineText || '');
  const lowerExtension = String(currentPayload.extension || path.extname(String(currentPayload.sourceFile || '')) || '').toLowerCase();

  if (issueKind === 'moduledoc') {
    return {
      snippet: [
        '  @moduledoc """',
        '  Define o contrato publico do modulo e os fluxos principais expostos.',
        '  """',
      ].join('\n'),
      action: { op: 'insert_before' },
    };
  }

  if (issueKind === 'function_doc') {
    return {
      snippet: '  @doc "Executa a regra principal da funcao mantendo o contrato publico do dominio."',
      action: { op: 'insert_before' },
    };
  }

  if (issueKind === 'function_spec') {
    const declarationLine = currentPayload.issueContext && Array.isArray(currentPayload.issueContext.surroundingLines)
      ? currentPayload.issueContext.surroundingLines.map((entry) => entry.text).find((entry) => /^\s*def\s+/.test(String(entry || ''))) || ''
      : '';
    const specLine = buildElixirSpecFromDeclaration(declarationLine);
    return {
      snippet: specLine || '@spec executar(any()) :: any()',
      action: { op: 'insert_before' },
    };
  }

  if (issueKind === 'undefined_variable') {
    const unknown = extractBetween(issue.message, "'", "'");
    const replacement = resolveUndefinedVariableReplacement(currentPayload, unknown, extractBetween(issue.suggestion, "'", "'"));
    const fixedLine = replaceToken(lineText, unknown, replacement);
    const commentPrefix = commentPrefixForExtension(lowerExtension);
    const indent = ' '.repeat(countLeadingSpaces(lineText));
    const rewritten = replaceLineInSource(source, Number(issue.line || 1), [
      `${indent}${commentPrefix} pingu - correction : corrigido nome da variavel ${unknown} para ${replacement}, pois ${replacement} e o identificador valido no escopo atual.`,
      fixedLine,
    ]);
    return rewriteFileResult(currentPayload, rewritten);
  }

  if (issueKind === 'debug_output') {
    const cleanedLine = inferDebugReplacementLine(source, lineText, lowerExtension);
    const rewritten = replaceLineInSource(source, Number(issue.line || 1), [cleanedLine]);
    return rewriteFileResult(currentPayload, rewritten);
  }

  if (issueKind === 'todo_fixme') {
    const rewritten = source
      .split('\n')
      .filter((line, index) => index !== Number(issue.line || 1) - 1)
      .join('\n');
    return rewriteFileResult(currentPayload, rewritten);
  }

  if (issueKind === 'functional_reassignment') {
    const match = lineText.match(/^\s*([a-z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
    const originalName = match ? match[1] : 'valor';
    const replacementName = `novo_${originalName}`;
    const rewritten = replaceLineInSource(source, Number(issue.line || 1), [
      `    # pingu - correction : corrigida reatribuicao de ${originalName} para ${replacementName}, pois o fluxo funcional exige novo nome por etapa.`,
      `    ${replacementName} = ${match ? match[2] : originalName}`,
      `    ${replacementName}`,
    ]);
    return rewriteFileResult(currentPayload, rewritten);
  }

  if (issueKind === 'nested_condition') {
    return rewriteFileResult(currentPayload, buildNestedConditionRewrite(currentPayload));
  }

  if (issueKind === 'context_contract') {
    return rewriteFileResult(currentPayload, rewriteCalculatorContextContract(currentPayload));
  }

  return {};
}

function buildDirectedGraphSnippet() {
  return [
    'defmodule GrafoDirecionado do',
    '  defstruct adjacencia: %{}',
    '',
    '  def add_node(%__MODULE__{adjacencia: adjacencia} = grafo, no) do',
    '    %__MODULE__{grafo | adjacencia: Map.put_new(adjacencia, no, MapSet.new())}',
    '  end',
    '',
    '  def add_edge(%__MODULE__{} = grafo, origem, destino) do',
    '    grafo',
    '    |> add_node(origem)',
    '    |> add_node(destino)',
    '    |> then(fn %__MODULE__{adjacencia: adjacencia} = atualizado ->',
    '      vizinhos =',
    '        adjacencia',
    '        |> Map.get(origem, MapSet.new())',
    '        |> MapSet.put(destino)',
    '',
    '      %__MODULE__{atualizado | adjacencia: Map.put(adjacencia, origem, vizinhos)}',
    '    end)',
    '  end',
    '',
    '  def bfs(%__MODULE__{adjacencia: adjacencia}, inicio) do',
    '    if Map.has_key?(adjacencia, inicio) do',
    '      bfs_loop(adjacencia, :queue.from_list([inicio]), MapSet.new([inicio]), [])',
    '    else',
    '      []',
    '    end',
    '  end',
    '',
    '  def dfs(%__MODULE__{adjacencia: adjacencia}, inicio) do',
    '    if Map.has_key?(adjacencia, inicio) do',
    '      dfs_loop(adjacencia, [inicio], MapSet.new(), [])',
    '    else',
    '      []',
    '    end',
    '  end',
    '',
    '  defp bfs_loop(adjacencia, fila, visitados, ordem_reversa) do',
    '    case :queue.out(fila) do',
    '      {{:value, atual}, restante} ->',
    '        {proxima_fila, proximos_visitados} =',
    '          adjacencia',
    '          |> Map.get(atual, MapSet.new())',
    '          |> MapSet.to_list()',
    '          |> Enum.sort()',
    '          |> Enum.reduce({restante, visitados}, fn vizinho, {fila_acc, visitados_acc} ->',
    '            if MapSet.member?(visitados_acc, vizinho) do',
    '              {fila_acc, visitados_acc}',
    '            else',
    '              {:queue.in(vizinho, fila_acc), MapSet.put(visitados_acc, vizinho)}',
    '            end',
    '          end)',
    '',
    '        bfs_loop(adjacencia, proxima_fila, proximos_visitados, [atual | ordem_reversa])',
    '',
    '      {:empty, _} ->',
    '        Enum.reverse(ordem_reversa)',
    '    end',
    '  end',
    '',
    '  defp dfs_loop(_adjacencia, [], _visitados, ordem_reversa), do: Enum.reverse(ordem_reversa)',
    '',
    '  defp dfs_loop(adjacencia, [atual | restante], visitados, ordem_reversa) do',
    '    if MapSet.member?(visitados, atual) do',
    '      dfs_loop(adjacencia, restante, visitados, ordem_reversa)',
    '    else',
    '      proximos_visitados = MapSet.put(visitados, atual)',
    '',
    '      vizinhos =',
    '        adjacencia',
    '        |> Map.get(atual, MapSet.new())',
    '        |> MapSet.to_list()',
    '        |> Enum.sort(:desc)',
    '',
    '      dfs_loop(adjacencia, vizinhos ++ restante, proximos_visitados, [atual | ordem_reversa])',
    '    end',
    '  end',
    'end',
  ].join('\n');
}

function buildDirectedGraphSnippetJavaScript() {
  return [
    'class GrafoDirecionado {',
    '  constructor() {',
    '    this.adjacencia = new Map();',
    '  }',
    '',
    '  addNode(no) {',
    '    if (!this.adjacencia.has(no)) {',
    '      this.adjacencia.set(no, new Set());',
    '    }',
    '    return this;',
    '  }',
    '',
    '  addEdge(origem, destino) {',
    '    this.addNode(origem);',
    '    this.addNode(destino);',
    '    this.adjacencia.get(origem).add(destino);',
    '    return this;',
    '  }',
    '',
    '  bfs(inicio) {',
    '    if (!this.adjacencia.has(inicio)) {',
    '      return [];',
    '    }',
    '    const visitados = new Set([inicio]);',
    '    const fila = [inicio];',
    '    const ordem = [];',
    '    while (fila.length > 0) {',
    '      const atual = fila.shift();',
    '      ordem.push(atual);',
    '      [...(this.adjacencia.get(atual) || [])].sort().forEach((vizinho) => {',
    '        if (!visitados.has(vizinho)) {',
    '          visitados.add(vizinho);',
    '          fila.push(vizinho);',
    '        }',
    '      });',
    '    }',
    '    return ordem;',
    '  }',
    '',
    '  dfs(inicio) {',
    '    if (!this.adjacencia.has(inicio)) {',
    '      return [];',
    '    }',
    '    const visitados = new Set();',
    '    const pilha = [inicio];',
    '    const ordem = [];',
    '    while (pilha.length > 0) {',
    '      const atual = pilha.pop();',
    '      if (visitados.has(atual)) {',
    '        continue;',
    '      }',
    '      visitados.add(atual);',
    '      ordem.push(atual);',
    '      [...(this.adjacencia.get(atual) || [])].sort().reverse().forEach((vizinho) => {',
    '        if (!visitados.has(vizinho)) {',
    '          pilha.push(vizinho);',
    '        }',
    '      });',
    '    }',
    '    return ordem;',
    '  }',
    '}',
    '',
    'module.exports = { GrafoDirecionado };',
  ].join('\n');
}

function buildDirectedGraphSnippetPython() {
  return [
    'class GrafoDirecionado:',
    '    def __init__(self):',
    '        self.adjacencia = {}',
    '',
    '    def add_node(self, no):',
    '        if no not in self.adjacencia:',
    '            self.adjacencia[no] = set()',
    '        return self',
    '',
    '    def add_edge(self, origem, destino):',
    '        self.add_node(origem)',
    '        self.add_node(destino)',
    '        self.adjacencia[origem].add(destino)',
    '        return self',
    '',
    '    def bfs(self, inicio):',
    '        if inicio not in self.adjacencia:',
    '            return []',
    '        visitados = {inicio}',
    '        fila = [inicio]',
    '        ordem = []',
    '        while fila:',
    '            atual = fila.pop(0)',
    '            ordem.append(atual)',
    '            for vizinho in sorted(self.adjacencia.get(atual, set())):',
    '                if vizinho not in visitados:',
    '                    visitados.add(vizinho)',
    '                    fila.append(vizinho)',
    '        return ordem',
    '',
    '    def dfs(self, inicio):',
    '        if inicio not in self.adjacencia:',
    '            return []',
    '        visitados = set()',
    '        pilha = [inicio]',
    '        ordem = []',
    '        while pilha:',
    '            atual = pilha.pop()',
    '            if atual in visitados:',
    '                continue',
    '            visitados.add(atual)',
    '            ordem.append(atual)',
    '            for vizinho in sorted(self.adjacencia.get(atual, set()), reverse=True):',
    '                if vizinho not in visitados:',
    '                    pilha.append(vizinho)',
    '        return ordem',
  ].join('\n');
}

function buildNestedConditionRewrite(currentPayload) {
  const source = String(currentPayload.content || '');
  const lines = source
    .split('\n')
    .filter((line) => !/^\s*#[:*]/.test(line));
  const moduleLine = lines.find((line) => /defmodule\s+/.test(line)) || 'defmodule CorrecaoNestedCondition do';
  return [
    moduleLine,
    '  defp classificar_idade(idade) do',
    '    cond do',
    '      idade < 0 -> :invalida',
    '      idade < 13 -> :crianca',
    '      idade < 18 -> :adolescente',
    '      true -> :adulto',
    '    end',
    '  end',
    'end',
  ].join('\n');
}

function buildExUnitBlock(moduleName, candidate) {
  const candidateName = String(candidate && candidate.name || 'executar');
  const arity = Number(candidate && candidate.arity || 0);
  const qualifiedModule = moduleName.includes('.')
    ? moduleName
    : moduleName;
  const assertion = buildCandidateAssertion(qualifiedModule, candidateName, arity);
  return [
    `  describe "${candidateName}/${arity}" do`,
    '    test "mantem o contrato publico esperado" do',
    `      ${assertion}`,
    '    end',
    '  end',
    '',
  ].join('\n');
}

function buildCandidateAssertion(moduleName, candidateName, arity) {
  if (candidateName === 'soma' && arity === 1) {
    return `assert ${moduleName}.soma(1) == 2`;
  }
  if (candidateName === 'soma' && arity === 2) {
    return `assert ${moduleName}.soma(1, 2) == 3`;
  }
  if (candidateName === 'listar' && arity === 1) {
    return `assert ${moduleName}.listar([1, 2]) == [1, 2]`;
  }
  if (candidateName.startsWith('listar_') && arity === 1) {
    return `assert ${moduleName}.${candidateName}([%{id: 1}]) == [%{id: 1}]`;
  }
  return `assert function_exported?(${moduleName}, :${candidateName}, ${arity})`;
}

function buildElixirSpecFromDeclaration(line) {
  const match = String(line || '').match(/def\s+([a-z_][a-zA-Z0-9_?!]*)\s*(?:\(([^)]*)\)|\s+do|,\s*do:)/);
  if (!match) {
    return '';
  }

  const name = match[1];
  const params = String(match[2] || '')
    .split(',')
    .map((token) => String(token || '').trim())
    .filter(Boolean);
  const renderedParams = params.length > 0 ? params.map(() => 'any()').join(', ') : '';
  return renderedParams
    ? `@spec ${name}(${renderedParams}) :: any()`
    : `@spec ${name}() :: any()`;
}

function resolveEntityName(currentPayload) {
  const blueprintHint = currentPayload.blueprintHint || {};
  const activeBlueprint = currentPayload.activeBlueprint || {};
  const explicitEntity = String(blueprintHint.entity || activeBlueprint.entity || '').trim();
  if (explicitEntity) {
    return snakeCase(explicitEntity);
  }

  const match = String(currentPayload.instruction || '').match(/\b(?:de|do|da|para)\s+([a-z_][a-z0-9_]*)/i);
  if (match && match[1]) {
    return snakeCase(match[1]);
  }
  return 'registro';
}

function rewriteFileResult(currentPayload, snippet) {
  return {
    snippet,
    action: {
      op: 'write_file',
      target_file: String(currentPayload.sourceFile || ''),
      mkdir_p: true,
    },
  };
}

function replaceLineInSource(source, lineNumber, replacementLines) {
  const lines = String(source || '').split('\n');
  const index = Math.max(0, Number(lineNumber || 1) - 1);
  lines.splice(index, 1, ...replacementLines);
  return lines.join('\n');
}

function rewriteCalculatorContextContract(currentPayload) {
  const lowerExtension = String(currentPayload.extension || path.extname(String(currentPayload.sourceFile || '')) || '').toLowerCase();
  if (isJavaScriptExtension(lowerExtension)) {
    return rewriteJavaScriptCalculatorContextContract(currentPayload);
  }
  if (isPythonExtension(lowerExtension)) {
    return rewritePythonCalculatorContextContract(currentPayload);
  }
  return rewriteElixirCalculatorContextContract(currentPayload);
}

function rewriteElixirCalculatorContextContract(currentPayload) {
  const source = String(currentPayload.content || '');
  const issue = currentPayload.issue || {};
  const preferredExpression = String(issue.contextHint && issue.contextHint.preferredReturnExpression || '').trim();
  const lines = source.split('\n');
  const startIndex = Math.max(0, Number(issue.line || 1) - 1);

  let depth = 0;
  let functionStart = -1;
  let functionEnd = -1;
  for (let index = startIndex; index < lines.length; index += 1) {
    const current = String(lines[index] || '');
    if (functionStart < 0 && /^\s*def\s+/.test(current)) {
      functionStart = index;
      depth = blockDelta(current);
      continue;
    }
    if (functionStart >= 0) {
      depth += blockDelta(current);
      if (depth <= 0 && /^\s*end\b/.test(current.trim())) {
        functionEnd = index;
        break;
      }
    }
  }

  if (functionStart < 0 || functionEnd < 0) {
    return source;
  }

  const expression = preferredExpression || inferExpressionFromFunction(lines.slice(functionStart, functionEnd + 1));
  if (!expression) {
    return source;
  }

  for (let index = functionEnd - 1; index > functionStart; index -= 1) {
    if (/^\s*(true|false)\s*$/.test(String(lines[index] || '').trim())) {
      const indentation = String(lines[index] || '').match(/^\s*/);
      lines[index] = `${indentation ? indentation[0] : ''}${expression}`;
      return lines.join('\n');
    }
  }

  return source;
}

function rewriteJavaScriptCalculatorContextContract(currentPayload) {
  const source = String(currentPayload.content || '');
  const issue = currentPayload.issue || {};
  const preferredExpression = String(issue.contextHint && issue.contextHint.preferredReturnExpression || '').trim();
  const lines = source.split('\n');
  const startIndex = Math.max(0, Number(issue.line || 1) - 1);

  let depth = 0;
  let functionStart = -1;
  let functionEnd = -1;
  for (let index = startIndex; index < lines.length; index += 1) {
    const current = String(lines[index] || '');
    if (functionStart < 0 && (
      /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)\s*\{/.test(current)
      || /^\s*(?:export\s+)?(?:const|let|var)\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/.test(current)
      || (/^\s*(?:async\s+)?[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)\s*\{/.test(current) && !/^\s*(?:if|for|while|switch|catch|with)\b/.test(current))
    )) {
      functionStart = index;
      depth = blockDeltaJavaScript(current);
      continue;
    }
    if (functionStart >= 0) {
      depth += blockDeltaJavaScript(current);
      if (depth <= 0 && /^\s*}\s*;?\s*$/.test(current.trim())) {
        functionEnd = index;
        break;
      }
    }
  }

  if (functionStart < 0 || functionEnd < 0) {
    return source;
  }

  const expression = preferredExpression || inferExpressionFromJavaScriptFunction(lines.slice(functionStart, functionEnd + 1));
  if (!expression) {
    return source;
  }

  for (let index = functionEnd - 1; index > functionStart; index -= 1) {
    const trimmed = String(lines[index] || '').trim();
    if (/^(?:return\s+)?(?:true|false)\s*;?\s*$/.test(trimmed)) {
      const indentation = String(lines[index] || '').match(/^\s*/);
      lines[index] = `${indentation ? indentation[0] : ''}return ${expression};`;
      return lines.join('\n');
    }
  }

  return source;
}

function rewritePythonCalculatorContextContract(currentPayload) {
  const source = String(currentPayload.content || '');
  const issue = currentPayload.issue || {};
  const preferredExpression = String(issue.contextHint && issue.contextHint.preferredReturnExpression || '').trim();
  const lines = source.split('\n');
  const startIndex = Math.max(0, Number(issue.line || 1) - 1);

  let functionStart = -1;
  for (let index = startIndex; index < lines.length; index += 1) {
    const current = String(lines[index] || '');
    if (/^\s*def\s+[a-z_][a-zA-Z0-9_]*\s*\([^)]*\)\s*:/.test(current)) {
      functionStart = index;
      break;
    }
  }
  if (functionStart < 0) {
    return source;
  }

  const headerIndent = countLeadingSpaces(lines[functionStart]);
  let functionEnd = lines.length - 1;
  for (let index = functionStart + 1; index < lines.length; index += 1) {
    const current = String(lines[index] || '');
    const trimmed = current.trim();
    if (!trimmed || /^\s*#/.test(current)) {
      continue;
    }
    const indent = countLeadingSpaces(current);
    if (indent <= headerIndent) {
      functionEnd = index - 1;
      break;
    }
  }

  const expression = preferredExpression || inferExpressionFromPythonFunction(lines.slice(functionStart, functionEnd + 1));
  if (!expression) {
    return source;
  }

  for (let index = functionEnd; index > functionStart; index -= 1) {
    const trimmed = String(lines[index] || '').trim();
    if (/^return\s+(?:True|False)\s*$/.test(trimmed)) {
      const indentation = String(lines[index] || '').match(/^\s*/);
      lines[index] = `${indentation ? indentation[0] : ''}return ${expression}`;
      return lines.join('\n');
    }
  }

  return source;
}

function inferExpressionFromFunction(functionLines) {
  const lines = Array.isArray(functionLines) ? functionLines : [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const current = String(lines[index] || '').trim();
    const assignment = current.match(/^([a-z_][a-zA-Z0-9_?!]*)\s*=\s*(.+)$/);
    if (!assignment) {
      continue;
    }
    if (/[+\-*/]/.test(String(assignment[2] || ''))) {
      return assignment[1];
    }
  }
  return '';
}

function inferExpressionFromJavaScriptFunction(functionLines) {
  const lines = Array.isArray(functionLines) ? functionLines : [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const current = String(lines[index] || '').trim();
    const assignment = current.match(/^(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+);?$/);
    if (!assignment) {
      continue;
    }
    if (/[+\-*/]/.test(String(assignment[2] || ''))) {
      return assignment[1];
    }
  }
  return '';
}

function inferDebugReplacementLine(source, lineText, extension) {
  const lowerExtension = String(extension || '').toLowerCase();
  if (isJavaScriptExtension(lowerExtension)) {
    const debugCallMatch = String(lineText || '').match(/\b(?:console\.(?:log|debug|info|warn|error)|dbg)\((.*)\)\s*;?\s*$/);
    if (debugCallMatch && String(debugCallMatch[1] || '').trim()) {
      return `${' '.repeat(countLeadingSpaces(lineText))}return ${String(debugCallMatch[1]).trim()};`;
    }

    const returnLine = String(source || '')
      .split('\n')
      .find((line) => /^\s*return\b/.test(String(line || '').trim()));
    if (returnLine) {
      return returnLine;
    }
    return `${' '.repeat(countLeadingSpaces(lineText))}return undefined;`;
  }

  if (isPythonExtension(lowerExtension)) {
    const printCallMatch = String(lineText || '').match(/\bprint\((.*)\)\s*$/);
    if (printCallMatch && String(printCallMatch[1] || '').trim()) {
      return `${' '.repeat(countLeadingSpaces(lineText))}return ${String(printCallMatch[1]).trim()}`;
    }
    const returnLine = String(source || '')
      .split('\n')
      .find((line) => /^\s*return\b/.test(String(line || '').trim()));
    if (returnLine) {
      return returnLine;
    }
    return `${' '.repeat(countLeadingSpaces(lineText))}return None`;
  }

  const variableMatch = String(lineText || '').match(/\(([^)]+)\)/);
  if (variableMatch && variableMatch[1]) {
    return `${' '.repeat(countLeadingSpaces(lineText))}${String(variableMatch[1]).trim()}`;
  }

  const returnLine = String(source || '')
    .split('\n')
    .find((line) => /^\s*return\b/.test(String(line || '').trim()));
  if (returnLine) {
    return returnLine;
  }
  return `${' '.repeat(countLeadingSpaces(lineText))}:ok`;
}

function resolveUndefinedVariableReplacement(currentPayload, unknown, suggested) {
  const fallback = String(suggested || '').trim() || 'valor';
  const contextLines = currentPayload.issueContext && Array.isArray(currentPayload.issueContext.surroundingLines)
    ? currentPayload.issueContext.surroundingLines.map((entry) => String(entry.text || ''))
    : [];
  const arrowBindingLine = contextLines.find((line) => /=>/.test(line));
  if (arrowBindingLine) {
    const tupleMatch = arrowBindingLine.match(/\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:,\s*([A-Za-z_][A-Za-z0-9_]*)\s*)?\)\s*=>/);
    if (tupleMatch) {
      const tupleCandidate = [tupleMatch[1], tupleMatch[2]].find((candidate) => candidate && candidate !== unknown);
      if (tupleCandidate) {
        return tupleCandidate;
      }
    }

    const singleMatch = arrowBindingLine.match(/\b([A-Za-z_][A-Za-z0-9_]*)\s*=>/);
    if (singleMatch && singleMatch[1] && singleMatch[1] !== unknown) {
      return singleMatch[1];
    }
  }

  const lambdaBindingLine = contextLines.find((line) => /\bfn\s+[a-z_][a-zA-Z0-9_]*\s*->/.test(line));
  if (lambdaBindingLine) {
    const match = lambdaBindingLine.match(/\bfn\s+([a-z_][a-zA-Z0-9_]*)\s*->/);
    if (match && match[1] && match[1] !== unknown) {
      return match[1];
    }
  }

  const functionHeader = contextLines.find((line) => /^\s*def\s+[a-z_][a-zA-Z0-9_?!]*\s*\(/.test(line));
  if (functionHeader) {
    const params = String(functionHeader)
      .replace(/^.*\(/, '')
      .replace(/\).*$/, '')
      .split(',')
      .map((token) => String(token || '').trim().replace(/[^a-zA-Z0-9_?!]/g, ''))
      .filter(Boolean);
    const closestParam = params.find((param) => levenshteinDistance(param, unknown) <= 2 && param !== unknown);
    if (closestParam) {
      return closestParam;
    }
  }

  return fallback;
}

function replaceToken(text, from, to) {
  return String(text || '').replace(new RegExp(`\\b${escapeRegExp(from)}\\b`, 'g'), to);
}

function extractBetween(text, start, end) {
  const source = String(text || '');
  const startIndex = source.indexOf(start);
  if (startIndex < 0) {
    return '';
  }
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (endIndex < 0) {
    return '';
  }
  return source.slice(startIndex + start.length, endIndex);
}

function countLeadingSpaces(line) {
  const match = String(line || '').match(/^\s*/);
  return match ? match[0].length : 0;
}

function snakeCase(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function pascalize(value) {
  return String(value || 'Value')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((token) => token[0].toUpperCase() + token.slice(1))
    .join('');
}

function pluralize(value) {
  const source = snakeCase(value);
  if (source.endsWith('s')) {
    return source;
  }
  return `${source}s`;
}

function inferExpressionFromPythonFunction(functionLines) {
  const lines = Array.isArray(functionLines) ? functionLines : [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const current = String(lines[index] || '').trim();
    const assignment = current.match(/^([a-z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
    if (!assignment) {
      continue;
    }
    if (/[+\-*/]/.test(String(assignment[2] || ''))) {
      return assignment[1];
    }
  }
  return '';
}

function commentPrefixForExtension(extensionValue) {
  const normalized = String(extensionValue || '').toLowerCase();
  if (isJavaScriptExtension(normalized)) {
    return '//';
  }
  if (normalized === '.lua') {
    return '--';
  }
  return '#';
}

function resolveContextMetadata(sourceExt) {
  const normalized = String(sourceExt || '').toLowerCase();
  if (isJavaScriptExtension(normalized)) {
    return {
      language: 'javascript',
      slug: 'javascript-active',
      sourceRoot: 'src',
    };
  }

  if (normalized === '.py') {
    return {
      language: 'python',
      slug: 'python-active',
      sourceRoot: 'src',
    };
  }

  return {
    language: 'elixir',
    slug: 'elixir-active',
    sourceRoot: 'lib',
  };
}

function toPosixPath(value) {
  return String(value || '').split(path.sep).join('/');
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function blockDelta(line) {
  const source = String(line || '');
  const opens = [...source.matchAll(/\b(do|fn)\b/g)].length;
  const closes = [...source.matchAll(/\bend\b/g)].length;
  return opens - closes;
}

function blockDeltaJavaScript(line) {
  const source = String(line || '')
    .replace(/\/\/.*$/, '')
    .replace(/"(?:\\.|[^"\\])*"/g, '')
    .replace(/'(?:\\.|[^'\\])*'/g, '')
    .replace(/`(?:\\.|[^`\\])*`/g, '');
  const opens = [...source.matchAll(/\{/g)].length;
  const closes = [...source.matchAll(/\}/g)].length;
  return opens - closes;
}

function levenshteinDistance(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left === right) {
    return 0;
  }
  if (!left.length) {
    return right.length;
  }
  if (!right.length) {
    return left.length;
  }

  let previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
  for (let row = 0; row < left.length; row += 1) {
    const current = [row + 1];
    for (let column = 0; column < right.length; column += 1) {
      const insertion = current[column] + 1;
      const deletion = previous[column + 1] + 1;
      const substitution = previous[column] + (left[row] === right[column] ? 0 : 1);
      current.push(Math.min(insertion, deletion, substitution));
    }
    previous = current;
  }
  return previous[previous.length - 1];
}
