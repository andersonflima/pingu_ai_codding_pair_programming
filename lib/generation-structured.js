'use strict';

function createStructuredGenerators(helpers = {}) {
  const {
    sanitizeNaturalIdentifier,
    isInstructionNoiseToken,
    extractLiteralFromInstruction,
    isJavaScriptLikeExtension,
    isPythonLikeExtension,
    isGoExtension,
    isRustExtension,
    toCamelCaseIdentifier,
    toSnakeCaseIdentifier,
  } = helpers;

  function generateStructuredConfigSnippet(instruction, ext) {
    const lowerExt = String(ext || '').toLowerCase();
    const lowerInstruction = String(instruction || '').toLowerCase();

    if (lowerExt === '.dockerfile') {
      if (/\bworkdir\b/.test(lowerInstruction)) {
        return 'WORKDIR /app';
      }
      if (/\bporta\b|\bport\b|\bexpose\b/.test(lowerInstruction)) {
        return 'EXPOSE 3000';
      }
      return '';
    }

    if (lowerExt === '.tf') {
      if (/\bterraform\b/.test(lowerInstruction) && /\brequired\b/.test(lowerInstruction)) {
        return ['terraform {', '  required_version = ">= 1.5.0"', '}'].join('\n');
      }
      if (/\brequired version\b|\brequired_version\b/.test(lowerInstruction)) {
        return ['terraform {', '  required_version = ">= 1.5.0"', '}'].join('\n');
      }
      return '';
    }

    if (['.yaml', '.yml'].includes(lowerExt)) {
      const items = inferCollectionItems(lowerInstruction);
      if (/\bservicos?\b|\bservices?\b/.test(lowerInstruction)) {
        const values = items[0] && items[0].startsWith('item_') ? ['api', 'worker', 'web'] : items;
        return ['servicos:', ...values.map((item) => `  - ${item}`)].join('\n');
      }
      if (/\blista\b|\barray\b|\bcolecao\b|\bcoleção\b/.test(lowerInstruction)) {
        return ['itens:', ...items.map((item) => `  - ${item}`)].join('\n');
      }
      return '';
    }

    return '';
  }

  function generateStructureSnippet(instruction, ext) {
    const lower = String(instruction || '').toLowerCase();
    const requestsCollection = /\b(lista|array|vetor|colecao|coleção)\b/.test(lower);
    const requestsVariable = /\b(variavel|variável|constante)\b/.test(lower);

    if (requestsCollection || (requestsVariable && /\b(lista|array|vetor|colecao|coleção)\b/.test(lower))) {
      const items = inferCollectionItems(lower);
      const variableName = inferVariableNameFromInstruction(instruction, inferCollectionVariableName(lower, items));
      return variableDeclarationSnippet(variableName, collectionLiteralForLanguage(items, ext), ext);
    }

    if (requestsVariable) {
      const explicitValue = extractLiteralFromInstruction(lower);
      if (!explicitValue) {
        return '';
      }
      const variableName = inferVariableNameFromInstruction(instruction, 'valor');
      return variableDeclarationSnippet(variableName, explicitValue, ext);
    }

    return '';
  }

  function inferCollectionItems(instruction) {
    const text = String(instruction || '').toLowerCase();
    if (/\bfrutas?\b/.test(text)) {
      return ['maca', 'banana', 'uva'];
    }
    if (/\bcores?\b/.test(text)) {
      return ['vermelho', 'verde', 'azul'];
    }
    if (/\bnomes?\b/.test(text)) {
      return ['ana', 'bruno', 'carla'];
    }
    if (/\bcidades?\b/.test(text)) {
      return ['sao_paulo', 'rio_de_janeiro', 'belo_horizonte'];
    }
    return ['item_1', 'item_2', 'item_3'];
  }

  function inferCollectionVariableName(instruction, items) {
    const text = String(instruction || '');
    const explicitDomainMatch = text.match(
      /\b(?:lista|array|vetor|colecao|coleção)\s+(?:de|com)\s+([a-zà-ÿ_][a-zà-ÿ0-9_-]*)/i,
    );
    if (explicitDomainMatch && explicitDomainMatch[1] && !isInstructionNoiseToken(explicitDomainMatch[1])) {
      return sanitizeNaturalIdentifier(explicitDomainMatch[1]);
    }

    if (/\bfrutas?\b/i.test(text)) {
      return 'frutas';
    }
    if (/\bcores?\b/i.test(text)) {
      return 'cores';
    }
    if (/\bnomes?\b/i.test(text)) {
      return 'nomes';
    }
    if (/\bcidades?\b/i.test(text)) {
      return 'cidades';
    }
    if (Array.isArray(items) && items.length && items[0].startsWith('item_')) {
      return 'itens';
    }
    return 'itens';
  }

  function inferVariableNameFromInstruction(instruction, fallbackName = 'valor') {
    const explicitNameMatch = String(instruction || '').match(
      /\b(?:variavel|variável|constante|lista|array|vetor|colecao|coleção)\b(?:\s+(?:chamada|chamado|nomeada|nomeado|com\s+nome))?\s+([a-z_][a-zA-Z0-9_]*)/i,
    );
    if (explicitNameMatch && explicitNameMatch[1] && !isInstructionNoiseToken(explicitNameMatch[1])) {
      return sanitizeNaturalIdentifier(explicitNameMatch[1]);
    }
    return sanitizeNaturalIdentifier(fallbackName);
  }

  function variableDeclarationSnippet(name, valueLiteral, ext) {
    const lowerExt = String(ext || '').toLowerCase();
    const variableName = sanitizeNaturalIdentifier(name || 'valor');

    if (['.yaml', '.yml'].includes(lowerExt)) {
      if (/^\[.*\]$/.test(valueLiteral)) {
        const items = valueLiteral
          .replace(/^\[|\]$/g, '')
          .split(',')
          .map((item) => item.trim().replace(/^"|"$/g, ''))
          .filter(Boolean);
        return [`${variableName}:`, ...items.map((item) => `  - ${item}`)].join('\n');
      }
      return `${variableName}: ${valueLiteral}`;
    }
    if (lowerExt === '.tf') {
      return `${variableName} = ${valueLiteral}`;
    }
    if (lowerExt === '.dockerfile') {
      return `ENV ${variableName.toUpperCase()}=${String(valueLiteral).replace(/^"|"$/g, '')}`;
    }
    if (isJavaScriptLikeExtension(lowerExt)) {
      return `const ${variableName} = ${valueLiteral};`;
    }
    if (isPythonLikeExtension(lowerExt)) {
      return `${variableName} = ${valueLiteral}`;
    }
    if (['.ex', '.exs'].includes(lowerExt)) {
      return `${variableName} = ${valueLiteral}`;
    }
    if (isGoExtension(lowerExt)) {
      return `${toCamelCaseIdentifier(variableName)} := ${valueLiteral}`;
    }
    if (isRustExtension(lowerExt)) {
      return `let ${toSnakeCaseIdentifier(variableName)} = ${valueLiteral};`;
    }
    if (lowerExt === '.lua') {
      return `local ${variableName} = ${valueLiteral}`;
    }
    if (lowerExt === '.rb') {
      return `${variableName} = ${valueLiteral}`;
    }
    return `const ${variableName} = ${valueLiteral};`;
  }

  function collectionLiteralForLanguage(items, ext) {
    const lowerExt = String(ext || '').toLowerCase();
    const normalizedItems = Array.isArray(items) && items.length ? items : ['item_1', 'item_2', 'item_3'];
    const quotedItems = normalizedItems.map((item) => `"${String(item)}"`);

    if (isGoExtension(lowerExt)) {
      return `[]string{${quotedItems.join(', ')}}`;
    }
    if (isRustExtension(lowerExt)) {
      return `vec![${quotedItems.join(', ')}]`;
    }
    return `[${quotedItems.join(', ')}]`;
  }

  function parseVariableCorrectionRequest(instruction) {
    const match = String(instruction || '').match(
      /\b(?:troca|trocar|substitui|substituir|substitua|corrige|corrigir|corrija)\s+([a-z_][a-zA-Z0-9_?!]*)\s+(?:por|para|=>|->)\s+([a-z_][a-zA-Z0-9_?!]*)/i,
    );
    if (!match) {
      return null;
    }
    return [match[1].trim(), match[2].trim()];
  }

  return {
    generateStructuredConfigSnippet,
    generateStructureSnippet,
    parseVariableCorrectionRequest,
  };
}

module.exports = {
  createStructuredGenerators,
};
