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

function buildCommentTask(currentPayload, normalizedInstruction, normalizedExtension) {
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
  const sourceExt = String(blueprintHint.sourceExt || '.ex');
  const sourceRoot = String(blueprintHint.sourceRoot || 'lib');
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
      'language: elixir',
      'slug: elixir-active',
      `source_ext: ${sourceExt}`,
      `source_root: ${sourceRoot}`,
      `summary: ${mergedSummary}`,
      '',
      '# Contexto ativo',
      `- Contexto principal: ${entity}`,
      '- Linguagem alvo: elixir',
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

function buildIssueFix(currentPayload) {
  const issue = currentPayload.issue || {};
  const issueKind = String(issue.kind || '');
  const source = String(currentPayload.content || '');
  const lineText = String(currentPayload.issueContext && currentPayload.issueContext.lineText || '');

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
    const rewritten = replaceLineInSource(source, Number(issue.line || 1), [
      `    # pingu - correction : corrigido nome da variavel ${unknown} para ${replacement}, pois ${replacement} e o identificador valido no escopo atual.`,
      fixedLine,
    ]);
    return rewriteFileResult(currentPayload, rewritten);
  }

  if (issueKind === 'debug_output') {
    const cleanedLine = inferDebugReplacementLine(source, lineText);
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

function inferDebugReplacementLine(source, lineText) {
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

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
