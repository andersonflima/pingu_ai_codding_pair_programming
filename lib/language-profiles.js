'use strict';

const path = require('path');

const LANGUAGE_PROFILES = Object.freeze([
  {
    id: 'javascript',
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
    commentPrefix: '//',
    unitTestStyle: 'native',
    bestPractices: [
      'Prefira funcoes puras e efeitos colaterais isolados nas bordas.',
      'Mantenha modulos pequenos com nomes explicitos e contratos claros.',
      'Evite mutacao compartilhada; prefira transformacoes imutaveis.',
      'No React, mantenha componentes orientados a estado e responsabilidades pequenas.',
    ],
  },
  {
    id: 'python',
    extensions: ['.py'],
    commentPrefix: '#',
    unitTestStyle: 'native',
    bestPractices: [
      'Prefira funcoes pequenas, com entradas e saidas explicitas.',
      'Isole IO, random e acesso externo para facilitar testes deterministas.',
      'Mantenha o contrato publico em modulos coesos e previsiveis.',
    ],
  },
  {
    id: 'elixir',
    extensions: ['.ex', '.exs'],
    commentPrefix: '#',
    unitTestStyle: 'native',
    bestPractices: [
      'Prefira pattern matching, pipelines simples e funcoes pequenas.',
      'Mantenha dados imutaveis e efeitos em fronteiras bem definidas.',
      'Use modulos coesos, contratos explicitos e contexto por dominio.',
    ],
  },
  {
    id: 'go',
    extensions: ['.go'],
    commentPrefix: '//',
    unitTestStyle: 'native',
    bestPractices: [
      'Mantenha pacotes pequenos com interfaces no consumidor.',
      'Trate erros de forma explicita e previsivel.',
      'Evite acoplamento desnecessario e prefira contratos publicos simples.',
    ],
  },
  {
    id: 'rust',
    extensions: ['.rs'],
    commentPrefix: '//',
    unitTestStyle: 'native',
    bestPractices: [
      'Modele ownership e lifetimes com clareza antes de otimizar.',
      'Prefira Result e tipos explicitos para contratos publicos.',
      'Mantenha modulos pequenos e fronteiras de erro previsiveis.',
    ],
  },
  {
    id: 'ruby',
    extensions: ['.rb'],
    commentPrefix: '#',
    unitTestStyle: 'native',
    bestPractices: [
      'Prefira objetos e funcoes pequenas com nomes claros.',
      'Mantenha regras de negocio fora de detalhes de framework.',
      'Teste comportamento publico, nao detalhe interno.',
    ],
  },
  {
    id: 'lua',
    extensions: ['.lua'],
    commentPrefix: '--',
    unitTestStyle: 'native',
    bestPractices: [
      'Prefira funcoes locais e evite vazamento para o escopo global.',
      'Mantenha tabelas pequenas e contratos de retorno explicitos.',
      'Separe montagem de dados de efeitos colaterais.',
    ],
  },
  {
    id: 'vim',
    extensions: ['.vim'],
    commentPrefix: '"',
    unitTestStyle: 'native',
    bestPractices: [
      'Prefira funcoes pequenas e script-local quando possivel.',
      'Isole side effects de buffer, janela e editor em pontos claros.',
      'Mantenha funcoes puras para regras e helpers de transformacao.',
    ],
  },
  {
    id: 'c',
    extensions: ['.c', '.h', '.cpp', '.hpp'],
    commentPrefix: '//',
    unitTestStyle: 'native',
    bestPractices: [
      'Modele ownership e tempo de vida de memoria de forma explicita.',
      'Prefira funcoes pequenas e contratos simples em headers minimos.',
      'Evite estado global e efeitos implicitos.',
    ],
  },
  {
    id: 'terraform',
    extensions: ['.tf'],
    commentPrefix: '#',
    structured: true,
    unitTestStyle: 'none',
    bestPractices: [
      'Declare versoes e contratos explicitos para reduzir drift.',
      'Separe modulos por responsabilidade e contexto de dominio.',
      'Evite configuracoes implicitas e nomes genericos.',
    ],
  },
  {
    id: 'yaml',
    extensions: ['.yaml', '.yml'],
    commentPrefix: '#',
    structured: true,
    unitTestStyle: 'contract',
    bestPractices: [
      'Mantenha estrutura pequena e consistente por responsabilidade.',
      'Evite valores ambiguos e prefira chaves explicitas.',
      'Em compose, mantenha servicos com contratos operacionais claros.',
    ],
  },
  {
    id: 'markdown',
    extensions: ['.md'],
    commentPrefix: '#',
    structured: true,
    unitTestStyle: 'contract',
    bestPractices: [
      'Comece com titulo principal claro e secoes objetivas.',
      'Documente contratos, contexto e exemplos verificaveis.',
      'Evite texto vago quando o documento orientar implementacao.',
    ],
  },
  {
    id: 'mermaid',
    extensions: ['.mmd', '.mermaid'],
    commentPrefix: '%%',
    structured: true,
    unitTestStyle: 'contract',
    bestPractices: [
      'Modele fluxo com nomes explicitos e direcao consistente.',
      'Evite excesso de detalhes visuais quando o objetivo for contrato.',
      'Mantenha nos e transicoes refletindo o dominio real.',
    ],
  },
  {
    id: 'dockerfile',
    extensions: ['.dockerfile'],
    commentPrefix: '#',
    structured: true,
    unitTestStyle: 'contract',
    bestPractices: [
      'Declare WORKDIR, imagem base e etapas de copia de forma explicita.',
      'Mantenha camadas previsiveis e minimas.',
      'Evite efeitos implicitos no diretorio de execucao.',
    ],
  },
  {
    id: 'shell',
    extensions: ['.sh'],
    commentPrefix: '#',
    unitTestStyle: 'none',
    bestPractices: [
      'Use set -eu quando o contrato do script exigir falha previsivel.',
      'Mantenha comandos pequenos e saidas claras para automacao.',
    ],
  },
  {
    id: 'toml',
    extensions: ['.toml'],
    commentPrefix: '#',
    unitTestStyle: 'none',
    bestPractices: [
      'Prefira chaves explicitas e secoes pequenas.',
      'Evite sobrecarregar um unico arquivo com contextos diferentes.',
    ],
  },
  {
    id: 'default',
    extensions: [],
    commentPrefix: '#',
    unitTestStyle: 'none',
    bestPractices: [
      'Prefira contratos pequenos, nomes claros e efeitos isolados.',
    ],
  },
]);

const EXTENSION_TO_PROFILE = new Map();
LANGUAGE_PROFILES.forEach((profile) => {
  profile.extensions.forEach((extension) => {
    EXTENSION_TO_PROFILE.set(extension, profile);
  });
});

function analysisExtension(fileOrExt) {
  const source = String(fileOrExt || '');
  if (!source) {
    return '';
  }
  if (source.startsWith('.')) {
    return source.toLowerCase();
  }
  const base = path.basename(source).toLowerCase();
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) {
    return '.dockerfile';
  }
  return path.extname(source).toLowerCase();
}

function getLanguageProfile(fileOrExt) {
  const extension = analysisExtension(fileOrExt);
  return EXTENSION_TO_PROFILE.get(extension) || EXTENSION_TO_PROFILE.get('') || LANGUAGE_PROFILES[LANGUAGE_PROFILES.length - 1];
}

function hasExtension(fileOrExt, extensions) {
  const extension = analysisExtension(fileOrExt);
  return Array.isArray(extensions) && extensions.includes(extension);
}

function isJavaScriptLikeExtension(fileOrExt) {
  return hasExtension(fileOrExt, ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
}

function isReactLikeExtension(fileOrExt) {
  return hasExtension(fileOrExt, ['.jsx', '.tsx']);
}

function isPythonLikeExtension(fileOrExt) {
  return hasExtension(fileOrExt, ['.py']);
}

function isRubyExtension(fileOrExt) {
  return hasExtension(fileOrExt, ['.rb']);
}

function isGoExtension(fileOrExt) {
  return hasExtension(fileOrExt, ['.go']);
}

function isRustExtension(fileOrExt) {
  return hasExtension(fileOrExt, ['.rs']);
}

function isElixirExtension(fileOrExt) {
  return hasExtension(fileOrExt, ['.ex', '.exs']);
}

function isMermaidExtension(fileOrExt) {
  return hasExtension(fileOrExt, ['.mmd', '.mermaid']);
}

function isStructuredTextKind(fileOrExt) {
  return Boolean(getLanguageProfile(fileOrExt).structured);
}

function supportsSlashComments(fileOrExt) {
  return ['javascript', 'go', 'rust', 'c'].includes(getLanguageProfile(fileOrExt).id);
}

function supportsHashComments(fileOrExt) {
  return ['python', 'elixir', 'ruby', 'terraform', 'yaml', 'dockerfile', 'shell', 'toml'].includes(getLanguageProfile(fileOrExt).id);
}

function commentPrefix(fileOrExt) {
  return getLanguageProfile(fileOrExt).commentPrefix || '#';
}

function unitTestStyle(fileOrExt) {
  return getLanguageProfile(fileOrExt).unitTestStyle || 'none';
}

function bestPracticesFor(fileOrExt) {
  return [...(getLanguageProfile(fileOrExt).bestPractices || [])];
}

module.exports = {
  LANGUAGE_PROFILES,
  analysisExtension,
  getLanguageProfile,
  commentPrefix,
  bestPracticesFor,
  unitTestStyle,
  isStructuredTextKind,
  isJavaScriptLikeExtension,
  isReactLikeExtension,
  isPythonLikeExtension,
  isRubyExtension,
  isGoExtension,
  isRustExtension,
  isElixirExtension,
  isMermaidExtension,
  supportsSlashComments,
  supportsHashComments,
};
