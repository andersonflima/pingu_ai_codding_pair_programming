'use strict';

function createStructuredIntentParser(helpers = {}) {
  const {
    extractLiteralFromInstruction,
    isInstructionNoiseToken,
    sanitizeNaturalIdentifier,
    toCamelCaseIdentifier,
    toSnakeCaseIdentifier,
  } = helpers;

  function toPascalCaseIdentifier(value, fallbackName = 'Estrutura') {
    const camelCase = toCamelCaseIdentifier(value);
    if (!camelCase) {
      return fallbackName;
    }
    return camelCase.charAt(0).toUpperCase() + camelCase.slice(1);
  }

  function splitNaturalList(value) {
    return String(value || '')
      .replace(/\b(?:e|and|ou|or)\b/gi, ',')
      .split(/[,\n/|]/)
      .map((item) => String(item || '').trim())
      .filter((item) => item !== '');
  }

  function uniqueIdentifiers(values) {
    const seen = new Set();
    return (Array.isArray(values) ? values : [])
      .map((value) => sanitizeNaturalIdentifier(value))
      .filter(Boolean)
      .filter((value) => {
        if (seen.has(value)) {
          return false;
        }
        seen.add(value);
        return true;
      });
  }

  function normalizeFieldSegment(value) {
    return String(value || '')
      .replace(/^(?:campos?|atributos?|propriedades|props?|chaves?)\b[:\s-]*/i, '')
      .trim();
  }

  function stripMethodClauses(value) {
    return String(value || '')
      .replace(
        /\b(?:e|and|ou|or)?\s*(?:metodos?|métodos?|metodo|método|funcoes?|funções|funcao|função|acoes?|ações|acao|ação|implementac(?:ao|ão)|comportamentos?)\b.*$/i,
        '',
      )
      .replace(/\b(?:implementac(?:ao|ão)|comportamentos?)\b.*$/i, '')
      .trim();
  }

  function inferNamedStructureName(instruction, pattern, fallbackName) {
    const match = String(instruction || '').match(pattern);
    if (match && match[1] && !isInstructionNoiseToken(match[1])) {
      return toPascalCaseIdentifier(match[1], fallbackName);
    }
    return toPascalCaseIdentifier(fallbackName, fallbackName);
  }

  function inferStructureFields(instruction, fallbackFields = ['id', 'nome', 'status']) {
    const segmentMatch = String(instruction || '').match(
      /\b(?:com|campos?|atributos?|propriedades|props?|chaves?)\b\s+(.+)$/i,
    );
    const fields = segmentMatch
      ? splitNaturalList(normalizeFieldSegment(segmentMatch[1])).map((item) => sanitizeNaturalIdentifier(item)).filter(Boolean)
      : [];
    return fields.length > 0 ? fields : fallbackFields;
  }

  function inferEnumMembers(instruction) {
    const segmentMatch = String(instruction || '').match(
      /\benum\b.*?\b(?:com|values?|valores?|casos?|itens?|opcoes?|opções)\b\s+(.+)$/i,
    );
    const members = segmentMatch
      ? splitNaturalList(segmentMatch[1])
        .map((item) => sanitizeNaturalIdentifier(item))
        .filter((item) => item && !isInstructionNoiseToken(item))
      : [];

    const resolvedMembers = members.length > 0 ? members : ['ativo', 'inativo', 'arquivado'];
    return resolvedMembers.map((member) => ({
      atomName: toSnakeCaseIdentifier(member),
      constantName: toSnakeCaseIdentifier(member).toUpperCase(),
      constantValue: toSnakeCaseIdentifier(member).toUpperCase(),
      pascalName: toPascalCaseIdentifier(member, 'Valor'),
      raw: member,
    }));
  }

  function inferContractMethods(instruction) {
    const segmentMatch = String(instruction || '').match(
      /\b(?:metodos?|métodos?|metodo|método|funcoes?|funções|funcao|função)\b\s+(.+)$/i,
    );
    const methods = segmentMatch
      ? splitNaturalList(segmentMatch[1]).map((item) => sanitizeNaturalIdentifier(item)).filter(Boolean)
      : [];
    return methods.length > 0 ? methods : ['validar'];
  }

  function inferClassMethods(instruction) {
    const text = String(instruction || '');
    const explicitMatch = text.match(
      /\b(?:metodos?|métodos?|metodo|método|funcoes?|funções|funcao|função)\b\s+(.+)$/i,
    );
    const explicitMethods = explicitMatch
      ? splitNaturalList(stripMethodClauses(explicitMatch[1]))
        .map((item) => sanitizeNaturalIdentifier(item))
        .filter(Boolean)
      : [];
    const semanticMethods = [];
    if (/\b(?:broadcast|transmitir|notificar|notify|emitir|publicar)\b/i.test(text)) {
      semanticMethods.push('broadcast');
    }
    return uniqueIdentifiers([...explicitMethods, ...semanticMethods]);
  }

  function inferClassFields(instruction, methods = []) {
    const text = String(instruction || '');
    const explicitSegmentMatch = text.match(
      /\b(?:campos?|atributos?|propriedades|props?|chaves?)\b\s+(.+)$/i,
    );
    if (explicitSegmentMatch) {
      const explicitFields = splitNaturalList(stripMethodClauses(normalizeFieldSegment(explicitSegmentMatch[1])))
        .map((item) => sanitizeNaturalIdentifier(item))
        .filter(Boolean);
      if (explicitFields.length > 0) {
        return uniqueIdentifiers(explicitFields);
      }
    }

    const genericSegmentMatch = text.match(/\bcom\b\s+(.+)$/i);
    if (genericSegmentMatch) {
      const inferredFields = splitNaturalList(stripMethodClauses(genericSegmentMatch[1]))
        .map((item) => sanitizeNaturalIdentifier(item))
        .filter(Boolean);
      if (inferredFields.length > 0) {
        return uniqueIdentifiers(inferredFields);
      }
    }

    if (methods.includes('broadcast') || /\busuarios?_conectados?_a_rooms?\b/i.test(text)) {
      return ['usuarios_conectados_a_rooms'];
    }

    return ['id', 'nome', 'status'];
  }

  function inferModuleFunctions(instruction) {
    const segmentMatch = String(instruction || '').match(
      /\b(?:funcoes?|funções|acoes?|ações|rotas?)\b\s+(.+)$/i,
    );
    const functions = segmentMatch
      ? splitNaturalList(segmentMatch[1]).map((item) => sanitizeNaturalIdentifier(item)).filter(Boolean)
      : [];
    return functions.length > 0 ? functions : ['listar', 'criar'];
  }

  function inferObjectName(instruction) {
    const explicitNameMatch = String(instruction || '').match(
      /\b(?:objeto|mapa|dicionario|dicionário|hash)\b(?:\s+(?:chamado|chamada|nomeado|nomeada|com\s+nome|de))?\s+([a-z_][a-zA-Z0-9_]*)/i,
    );
    if (explicitNameMatch && explicitNameMatch[1] && !isInstructionNoiseToken(explicitNameMatch[1])) {
      return sanitizeNaturalIdentifier(explicitNameMatch[1]);
    }
    return 'dados';
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

  function parseStructuredIntent(instruction) {
    const normalizedInstruction = String(instruction || '').trim();
    const lower = normalizedInstruction.toLowerCase();

    if (/\benum\b/.test(lower)) {
      return {
        kind: 'enum',
        name: inferNamedStructureName(
          normalizedInstruction,
          /\benum\b(?:\s+(?:chamado|chamada|nomeado|nomeada|com\s+nome|de))?\s+([a-z_][a-zA-Z0-9_]*)/i,
          'Status',
        ),
        members: inferEnumMembers(normalizedInstruction),
      };
    }

    if (/\b(class|classe)\b/.test(lower)) {
      const methods = inferClassMethods(normalizedInstruction);
      return {
        kind: 'class',
        name: inferNamedStructureName(
          normalizedInstruction,
          /\b(?:class|classe)\b(?:\s+(?:chamado|chamada|nomeado|nomeada|com\s+nome|de))?\s+([a-z_][a-zA-Z0-9_]*)/i,
          'Servico',
        ),
        fields: inferClassFields(normalizedInstruction, methods),
        methods,
      };
    }

    if (/\b(interface|contrato|type alias|type)\b/.test(lower)) {
      return {
        kind: 'interface',
        name: inferNamedStructureName(
          normalizedInstruction,
          /\b(?:interface|contrato|type(?:\s+alias)?)\b(?:\s+(?:chamado|chamada|nomeado|nomeada|com\s+nome|de))?\s+([a-z_][a-zA-Z0-9_]*)/i,
          'Contrato',
        ),
        fields: inferStructureFields(normalizedInstruction),
        methods: inferContractMethods(normalizedInstruction),
      };
    }

    if (/\bstruct\b/.test(lower)) {
      return {
        kind: 'struct',
        name: inferNamedStructureName(
          normalizedInstruction,
          /\bstruct\b(?:\s+(?:chamado|chamada|nomeado|nomeada|com\s+nome|de))?\s+([a-z_][a-zA-Z0-9_]*)/i,
          'Registro',
        ),
        fields: inferStructureFields(normalizedInstruction),
      };
    }

    if (/\b(module|modulo|módulo|namespace)\b/.test(lower)) {
      return {
        kind: 'module',
        name: inferNamedStructureName(
          normalizedInstruction,
          /\b(?:module|modulo|módulo|namespace)\b(?:\s+(?:chamado|chamada|nomeado|nomeada|com\s+nome|de))?\s+([a-z_][a-zA-Z0-9_]*)/i,
          'CoreModule',
        ),
        methods: inferModuleFunctions(normalizedInstruction),
      };
    }

    if (/\b(objeto|mapa|dicionario|dicionário|hash)\b/.test(lower)) {
      return {
        kind: 'object',
        name: inferObjectName(normalizedInstruction),
        fields: inferStructureFields(normalizedInstruction),
      };
    }

    if (/\b(lista|array|vetor|colecao|coleção)\b/.test(lower)) {
      const items = inferCollectionItems(normalizedInstruction);
      return {
        kind: 'collection',
        name: inferVariableNameFromInstruction(
          normalizedInstruction,
          inferCollectionVariableName(normalizedInstruction, items),
        ),
        items,
      };
    }

    if (/\b(variavel|variável|constante)\b/.test(lower)) {
      const explicitValue = extractLiteralFromInstruction(lower);
      return {
        kind: 'variable',
        name: inferVariableNameFromInstruction(normalizedInstruction, 'valor'),
        value: explicitValue,
      };
    }

    return null;
  }

  return {
    parseStructuredIntent,
  };
}

module.exports = {
  createStructuredIntentParser,
};
