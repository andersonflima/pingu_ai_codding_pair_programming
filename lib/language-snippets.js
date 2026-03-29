'use strict';

const { getLanguageProfile, bestPracticesFor, offlineCapabilitiesFor } = require('./language-profiles');

const CAPABILITY_DESCRIPTIONS = Object.freeze({
  simple_function: 'Geracao de funcoes utilitarias pequenas orientadas a contrato.',
  arithmetic_function: 'Geracao de funcoes aritmeticas com assinatura e retorno coerentes.',
  literal_return: 'Retorno deterministico de literais numericos, booleanos e strings.',
  dice_roll: 'Funcoes de dado e sorteio simples com runtime local por linguagem.',
  crud_scaffold: 'Scaffolding funcional inicial para CRUD e fluxos basicos de entidade.',
  context_blueprint: 'Criacao de contexto persistente para guiar implementacao offline.',
  unit_test_generation: 'Geracao automatica de testes de contrato e cobertura inicial.',
  terminal_task: 'Inferencia e execucao de acoes de terminal a partir de comentarios.',
  module_wrap: 'Encapsulamento de snippets em modulos quando a linguagem exigir.',
  required_version_fix: 'Normalizacao de contratos basicos de versao e estrutura.',
  contract_test_generation: 'Geracao de testes de contrato para formatos estruturados.',
  document_generation: 'Geracao de documentos baseados em contexto e objetivo.',
  diagram_generation: 'Geracao e validacao de diagramas Mermaid por comentario.',
  workdir_generation: 'Geracao de comandos operacionais basicos de Dockerfile.',
  simple_script: 'Geracao de scripts pequenos com fluxo previsivel.',
  comment_task: 'Aplicacao de snippets diretamente a partir de comentarios acionaveis.',
});

function describeOfflineCapability(capability) {
  const normalized = String(capability || '').trim();
  if (!normalized) {
    return '';
  }
  return CAPABILITY_DESCRIPTIONS[normalized] || normalized.replace(/_/g, ' ');
}

function buildOfflineLanguageGuidance(fileOrExt) {
  const profile = getLanguageProfile(fileOrExt);
  const offlineCapabilities = offlineCapabilitiesFor(fileOrExt);
  return {
    profileId: profile.id,
    bestPractices: bestPracticesFor(fileOrExt),
    offlineCapabilities,
    offlineCapabilityDescriptions: offlineCapabilities
      .map((capability) => describeOfflineCapability(capability))
      .filter(Boolean),
  };
}

function createLanguageSnippetLibrary(deps) {
  const {
    inferInstructionExpression,
    extractLiteralFromInstruction,
    inferArithmeticOperator,
    extractArithmeticLiteral,
    inferRequestedParamCount,
    inferSingleParamName,
  } = deps;

  function deriveOfflineFunctionPlan({ instruction, ext, name, params }) {
    const lowerInstruction = String(instruction || '').toLowerCase();
    const capabilities = new Set(offlineCapabilitiesFor(ext));
    const normalizedParams = Array.isArray(params)
      ? params.map((param) => String(param || '').trim()).filter(Boolean)
      : [];

    if (capabilities.has('dice_roll')) {
      const diceExpression = inferInstructionExpression(lowerInstruction, ext);
      if (diceExpression) {
        return {
          name,
          params: [],
          expression: diceExpression,
          capability: 'dice_roll',
        };
      }
    }

    if (capabilities.has('arithmetic_function')) {
      const arithmeticPlan = deriveArithmeticFunctionPlan(
        lowerInstruction,
        normalizedParams,
        inferArithmeticOperator,
        extractArithmeticLiteral,
        inferRequestedParamCount,
        inferSingleParamName,
      );
      if (arithmeticPlan) {
        return {
          name,
          ...arithmeticPlan,
          capability: 'arithmetic_function',
        };
      }
    }

    if (capabilities.has('literal_return')) {
      const explicitLiteral = extractLiteralFromInstruction(lowerInstruction);
      if (explicitLiteral) {
        return {
          name,
          params: normalizedParams,
          expression: explicitLiteral,
          capability: 'literal_return',
        };
      }
    }

    return null;
  }

  return {
    deriveOfflineFunctionPlan,
  };
}

function deriveArithmeticFunctionPlan(
  instruction,
  params,
  inferArithmeticOperator,
  extractArithmeticLiteral,
  inferRequestedParamCount,
  inferSingleParamName,
) {
  const operator = inferArithmeticOperator(instruction);
  if (!operator) {
    return null;
  }

  const literal = extractArithmeticLiteral(instruction, operator);
  const resolvedParams = resolveArithmeticParams(
    instruction,
    params,
    literal,
    inferRequestedParamCount,
    inferSingleParamName,
  );

  if (!resolvedParams.length) {
    return null;
  }

  if (literal) {
    return {
      params: [resolvedParams[0]],
      expression: `${resolvedParams[0]} ${operator} ${literal}`,
    };
  }

  if (resolvedParams.length < 2) {
    return null;
  }

  return {
    params: resolvedParams.slice(0, 2),
    expression: `${resolvedParams[0]} ${operator} ${resolvedParams[1]}`,
  };
}

function resolveArithmeticParams(instruction, params, literal, inferRequestedParamCount, inferSingleParamName) {
  const normalizedParams = Array.isArray(params) ? params.filter(Boolean) : [];
  if (literal) {
    if (normalizedParams.length >= 1) {
      return [normalizedParams[0]];
    }
    return [inferSingleParamName(instruction)];
  }

  if (normalizedParams.length >= 2) {
    return normalizedParams.slice(0, 2);
  }

  const requestedParamCount = inferRequestedParamCount(instruction);
  if (requestedParamCount === 1) {
    return [inferSingleParamName(instruction)];
  }
  if (requestedParamCount >= 2) {
    return ['a', 'b'];
  }
  if (normalizedParams.length === 1) {
    return [normalizedParams[0]];
  }
  return ['a', 'b'];
}

module.exports = {
  buildOfflineLanguageGuidance,
  createLanguageSnippetLibrary,
  describeOfflineCapability,
};
