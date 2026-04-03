'use strict';

const { safeComment } = require('./support');
const { analysisExtension, commentPrefix } = require('./language-profiles');

function normalizeFollowUpText(text) {
  return safeComment(text || '');
}

function normalizedIssueAction(issue) {
  if (issue && issue.action && typeof issue.action === 'object') {
    return issue.action;
  }
  return {};
}

function isBlueprintContextTarget(targetFile) {
  const normalized = String(targetFile || '').replace(/\\/g, '/');
  return normalized.includes('/.realtime-dev-agent/contexts/');
}

function followUpMarker(issue) {
  const action = normalizedIssueAction(issue);
  if (String(action.op || '') === 'run_command') {
    return '*';
  }
  if (String(action.op || '') === 'write_file' && isBlueprintContextTarget(action.target_file)) {
    return '**';
  }
  return ':';
}

function followUpCommentPrefix(file, marker) {
  if (analysisExtension(file) === '.md') {
    return `<!-- ${marker} `;
  }
  return `${commentPrefix(file)} ${marker} `;
}

function extractUndefinedVariableName(message) {
  const match = String(message || '').match(/Variavel '([^']+)' nao declarada/);
  return match ? match[1] : '';
}

function extractUndefinedVariableSuggestion(suggestion) {
  const match = String(suggestion || '').match(/Substitua por '([^']+)'/);
  return match ? match[1] : '';
}

function buildFollowUpInstruction(issue) {
  const message = normalizeFollowUpText(issue && issue.message);
  const suggestion = normalizeFollowUpText(issue && issue.suggestion);
  const kind = String(issue && issue.kind || '');
  const ext = analysisExtension(issue && issue.file || '');

  if (kind === 'undefined_variable') {
    const unknown = extractUndefinedVariableName(message);
    const replacement = extractUndefinedVariableSuggestion(suggestion);
    if (unknown && replacement) {
      return `substitua ${unknown} por ${replacement} retornando apenas o trecho corrigido sem comentarios explicativos`;
    }
  }

  if (kind === 'moduledoc') {
    return 'adicione @moduledoc idiomatico deixando claro o contrato do modulo';
  }

  if (kind === 'function_doc') {
    if (['.ex', '.exs'].includes(ext)) {
      return 'adicione @doc idiomatico para a funcao publica mantendo a regra de negocio';
    }
    if (ext === '.py') {
      return 'adicione docstring Python idiomatica no formato Google explicando responsabilidade, argumentos e retorno, com a indentacao correta do corpo';
    }
    if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(ext)) {
      return 'adicione JSDoc idiomatico explicando responsabilidade, parametros e retorno mantendo a regra de negocio';
    }
    return 'adicione @doc idiomatico para a funcao publica mantendo a regra de negocio';
  }

  if (kind === 'class_doc') {
    if (ext === '.py') {
      return 'adicione docstring curta e idiomatica para a classe deixando clara a responsabilidade principal';
    }
    return 'adicione documentacao curta para a classe mantendo o contrato atual';
  }

  if (kind === 'variable_doc') {
    return 'adicione comentario curto e contextual para a variavel ou atributo preservando o nome, o tipo e o contrato atual';
  }

  if (kind === 'function_spec') {
    return 'adicione @spec coerente com os parametros e o retorno reais da funcao';
  }

  if (kind === 'debug_output') {
    return 'remova a saida de debug mantendo apenas a regra de negocio e retorne so o codigo final';
  }

  if (kind === 'todo_fixme') {
    return 'remova o marcador TODO ou FIXME deixando o codigo final sem pendencia textual';
  }

  if (kind === 'flow_comment') {
    return 'adicione comentario curto e contextual acima deste passo do fluxo mantendo o codigo atual';
  }

  if (kind === 'functional_reassignment') {
    return 'refatore para fluxo funcional sem reatribuir a mesma variavel e retorne so o codigo final';
  }

  if (kind === 'nested_condition') {
    return 'refatore nested condition mantendo a regra de negocio';
  }

  if (kind === 'context_contract') {
    return 'ajuste o contrato da funcao para respeitar o contexto ativo do projeto';
  }

  if (suggestion) {
    return suggestion;
  }

  return message;
}

function buildFollowUpComment(file, issue) {
  const instruction = buildFollowUpInstruction(issue);
  if (!instruction) {
    return '';
  }

  const marker = followUpMarker(issue);
  const prefix = followUpCommentPrefix(file, marker);
  if (analysisExtension(file) === '.md') {
    return `${prefix}${instruction} -->`;
  }
  return `${prefix}${instruction}`;
}

module.exports = {
  buildFollowUpComment,
  buildFollowUpInstruction,
  followUpCommentPrefix,
  followUpMarker,
};
