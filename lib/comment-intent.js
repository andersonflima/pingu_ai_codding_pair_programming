'use strict';

const {
  analysisExtension,
  getCapabilityProfile,
  supportsCommentTaskIntent,
} = require('./language-capabilities');

const INTENT_MATCHERS = Object.freeze([
  { kind: 'test', regex: /\b(teste|testa|testando|assert|spec|scenario|cenario|it )\b/i, confidence: 0.98 },
  { kind: 'example', regex: /\bsolid\b/i, confidence: 0.94 },
  { kind: 'crud', regex: /\bcrud\b/i, confidence: 0.98 },
  { kind: 'ui', regex: /\b(tela|pagina|screen|page|login|formulario|form|componente|component|modal|dashboard|layout)\b/i, confidence: 0.93 },
  { kind: 'structure', regex: /\b(enum|class|classe|interface|contrato|type|struct|module|modulo|namespace|variavel|constante|lista|array|vetor|colecao|objeto|mapa|dicionario|hash)\b/i, confidence: 0.96 },
  { kind: 'comment', regex: /\b(comentario|comment|doc|docstring)\b/i, confidence: 0.92 },
  { kind: 'function', regex: /\b(funcao|function|metodo)\b/i, confidence: 0.9 },
  { kind: 'function', regex: /\b(implementa|implementar|implementacao|implemente|cria|criar|crie|criem|faca|adiciona|adicionar|monta|montar|gera|gerar|escreve|escrever|esqueleto|faz|fazer)\b/i, confidence: 0.8 },
]);

const STRUCTURED_TOKEN_PATTERNS = Object.freeze([
  ['enum', /\benum\b/i],
  ['class', /\b(class|classe)\b/i],
  ['interface', /\b(interface|contrato|type(?:\s+alias)?)\b/i],
  ['struct', /\bstruct\b/i],
  ['module', /\b(module|modulo|namespace)\b/i],
  ['object', /\b(objeto|mapa|dicionario|hash)\b/i],
  ['collection', /\b(lista|array|vetor|colecao)\b/i],
  ['variable', /\b(variavel|constante)\b/i],
]);

const REQUESTED_SYMBOL_NOISE_TOKENS = new Set([
  'a',
  'o',
  'as',
  'os',
  'e',
  'de',
  'do',
  'da',
  'das',
  'dos',
  'para',
  'com',
  'sem',
  'meu',
  'minha',
  'meus',
  'minhas',
  'this',
  'that',
  'the',
  'my',
  'your',
  'existing',
  'current',
  'function',
  'funcao',
  'metodo',
]);

function normalizeInstruction(instruction) {
  return String(instruction || '').replace(/\s+/g, ' ').trim();
}

function normalizeForMatching(instruction) {
  return normalizeInstruction(instruction)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function resolveIntentKind(normalizedInstruction) {
  if (!normalizedInstruction) {
    return { kind: 'generic', confidence: 0 };
  }

  const matched = INTENT_MATCHERS.find((candidate) => candidate.regex.test(normalizedInstruction));
  if (!matched) {
    return { kind: 'generic', confidence: 0.4 };
  }
  return { kind: matched.kind, confidence: matched.confidence };
}

function detectStructuredToken(normalizedInstruction) {
  const matched = STRUCTURED_TOKEN_PATTERNS.find((entry) => entry[1].test(normalizedInstruction));
  return matched ? matched[0] : '';
}

function resolveIntentToken(kind, structuredToken) {
  if (kind === 'structure' && structuredToken) {
    return structuredToken;
  }
  if (kind === 'example') {
    return 'function';
  }
  if (kind === 'generic') {
    return 'function';
  }
  return kind;
}

function isRequestedSymbolNoiseToken(token) {
  return REQUESTED_SYMBOL_NOISE_TOKENS.has(String(token || '').trim().toLowerCase());
}

function parseRequestedSymbolName(instruction) {
  const patterns = [
    /\b(?:funcao|function|metodo|class|classe|enum|interface|struct|module|modulo|objeto|variavel)\b(?:\s+(?:chamad[oa]|nomead[oa]|com\s+nome|de))?\s+([a-z_][a-zA-Z0-9_]*)/i,
    /\b(?:crie|criar|cria|implemente|implementar|implementa|escreva|escrever|faca|adicione|adicionar|gera|gerar)\b.*?\b([a-z_][a-zA-Z0-9_]*)\b/i,
  ];

  const matched = patterns
    .map((regex) => normalizeForMatching(instruction).match(regex))
    .find((result) => result && result[1] && !isRequestedSymbolNoiseToken(result[1]));
  return matched ? String(matched[1]).trim() : '';
}

function parseSemanticCommentIntent(instruction, ext) {
  const normalizedInstruction = normalizeInstruction(instruction);
  const matchableInstruction = normalizeForMatching(normalizedInstruction);
  const extension = analysisExtension(ext);
  const profile = getCapabilityProfile(extension);
  const resolvedIntent = resolveIntentKind(matchableInstruction);
  const structuredToken = detectStructuredToken(matchableInstruction);
  const intentToken = resolveIntentToken(resolvedIntent.kind, structuredToken);
  const supported = supportsCommentTaskIntent(extension, intentToken);
  const requestedSymbolName = parseRequestedSymbolName(normalizedInstruction);

  return {
    kind: resolvedIntent.kind,
    token: intentToken,
    confidence: resolvedIntent.confidence,
    supported,
    extension,
    languageId: profile.id,
    instruction: normalizedInstruction,
    hints: {
      structuredToken,
      requestedSymbolName,
      hasCrudKeyword: /\bcrud\b/i.test(matchableInstruction),
      hasUiKeyword: /\b(tela|pagina|screen|page|component|componente|layout|dashboard)\b/i.test(matchableInstruction),
    },
  };
}

function buildCommentIntentIR(intent) {
  if (!intent || typeof intent !== 'object') {
    return null;
  }

  return {
    version: '1.0',
    mode: 'comment_task',
    intent: {
      kind: intent.kind || 'generic',
      token: intent.token || 'function',
      confidence: Number.isFinite(intent.confidence) ? intent.confidence : 0,
    },
    target: {
      languageId: intent.languageId || 'default',
      extension: intent.extension || '',
    },
    subject: {
      requestedSymbolName: intent.hints && intent.hints.requestedSymbolName
        ? intent.hints.requestedSymbolName
        : '',
      structuredToken: intent.hints && intent.hints.structuredToken
        ? intent.hints.structuredToken
        : '',
    },
    constraints: {
      preferFunctional: true,
      useActiveContext: true,
      respectLanguageCapabilities: Boolean(intent.supported),
    },
  };
}

module.exports = {
  buildCommentIntentIR,
  parseSemanticCommentIntent,
};
