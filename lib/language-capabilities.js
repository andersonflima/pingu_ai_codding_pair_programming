'use strict';

const path = require('path');
const ACTIVE_LANGUAGE_IDS = Object.freeze(new Set(['elixir']));

const LANGUAGE_CAPABILITY_REGISTRY = Object.freeze([
  {
    id: 'javascript',
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
    commentPrefix: '//',
    unitTestStyle: 'native',
    structured: false,
    editorFeatures: ['comment_task', 'context_file', 'unit_test', 'terminal_task'],
    commentTaskIntents: ['function', 'crud', 'ui', 'test', 'comment', 'enum', 'class', 'interface', 'struct', 'module', 'object', 'collection', 'variable'],
    offlineCapabilities: ['simple_function', 'arithmetic_function', 'literal_return', 'dice_roll', 'crud_scaffold', 'context_blueprint', 'unit_test_generation', 'terminal_task'],
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
    structured: false,
    editorFeatures: ['comment_task', 'context_file', 'unit_test', 'terminal_task'],
    commentTaskIntents: ['function', 'crud', 'test', 'comment', 'enum', 'class', 'interface', 'struct', 'module', 'object', 'collection', 'variable'],
    offlineCapabilities: ['simple_function', 'arithmetic_function', 'literal_return', 'dice_roll', 'crud_scaffold', 'context_blueprint', 'unit_test_generation', 'terminal_task'],
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
    structured: false,
    editorFeatures: ['comment_task', 'context_file', 'unit_test', 'terminal_task'],
    commentTaskIntents: ['function', 'crud', 'test', 'comment', 'enum', 'class', 'interface', 'struct', 'module', 'object', 'collection', 'variable'],
    offlineCapabilities: ['simple_function', 'arithmetic_function', 'literal_return', 'dice_roll', 'crud_scaffold', 'context_blueprint', 'unit_test_generation', 'terminal_task', 'module_wrap'],
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
    structured: false,
    editorFeatures: ['comment_task', 'context_file', 'unit_test', 'terminal_task'],
    commentTaskIntents: ['function', 'crud', 'test', 'comment', 'enum', 'interface', 'struct', 'module', 'object', 'collection', 'variable'],
    offlineCapabilities: ['simple_function', 'arithmetic_function', 'literal_return', 'crud_scaffold', 'context_blueprint', 'unit_test_generation', 'terminal_task'],
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
    structured: false,
    editorFeatures: ['comment_task', 'context_file', 'unit_test', 'terminal_task'],
    commentTaskIntents: ['function', 'test', 'comment', 'enum', 'interface', 'struct', 'module', 'object', 'collection', 'variable'],
    offlineCapabilities: ['simple_function', 'arithmetic_function', 'literal_return', 'context_blueprint', 'unit_test_generation', 'terminal_task'],
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
    structured: false,
    editorFeatures: ['comment_task', 'context_file', 'unit_test', 'terminal_task'],
    commentTaskIntents: ['function', 'test', 'comment', 'enum', 'class', 'interface', 'struct', 'module', 'object', 'collection', 'variable'],
    offlineCapabilities: ['simple_function', 'arithmetic_function', 'literal_return', 'dice_roll', 'context_blueprint', 'unit_test_generation', 'terminal_task'],
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
    structured: false,
    editorFeatures: ['comment_task', 'context_file', 'unit_test', 'terminal_task'],
    commentTaskIntents: ['function', 'crud', 'test', 'comment', 'enum', 'class', 'interface', 'struct', 'module', 'object', 'collection', 'variable'],
    offlineCapabilities: ['simple_function', 'arithmetic_function', 'literal_return', 'dice_roll', 'crud_scaffold', 'context_blueprint', 'unit_test_generation', 'terminal_task'],
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
    structured: false,
    editorFeatures: ['comment_task', 'context_file', 'unit_test', 'terminal_task'],
    commentTaskIntents: ['function', 'test', 'comment', 'enum', 'class', 'interface', 'struct', 'module', 'object', 'collection', 'variable'],
    offlineCapabilities: ['simple_function', 'arithmetic_function', 'literal_return', 'context_blueprint', 'unit_test_generation', 'terminal_task'],
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
    structured: false,
    editorFeatures: ['comment_task', 'context_file', 'unit_test', 'terminal_task'],
    commentTaskIntents: ['function', 'test', 'comment', 'enum', 'interface', 'struct', 'object', 'collection', 'variable'],
    offlineCapabilities: ['simple_function', 'arithmetic_function', 'literal_return', 'context_blueprint', 'unit_test_generation', 'terminal_task'],
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
    unitTestStyle: 'contract',
    structured: true,
    editorFeatures: ['comment_task', 'context_file', 'unit_test', 'terminal_task'],
    commentTaskIntents: ['config', 'required_version', 'context_blueprint'],
    offlineCapabilities: ['required_version_fix', 'context_blueprint', 'contract_test_generation', 'terminal_task'],
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
    unitTestStyle: 'contract',
    structured: true,
    editorFeatures: ['comment_task', 'context_file', 'unit_test', 'terminal_task'],
    commentTaskIntents: ['config', 'collection', 'context_blueprint'],
    offlineCapabilities: ['contract_test_generation', 'context_blueprint', 'terminal_task'],
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
    unitTestStyle: 'contract',
    structured: true,
    editorFeatures: ['comment_task', 'context_file', 'unit_test', 'terminal_task'],
    commentTaskIntents: ['document', 'context_blueprint'],
    offlineCapabilities: ['document_generation', 'contract_test_generation', 'context_blueprint', 'terminal_task'],
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
    unitTestStyle: 'contract',
    structured: true,
    editorFeatures: ['comment_task', 'context_file', 'unit_test', 'terminal_task'],
    commentTaskIntents: ['diagram', 'context_blueprint'],
    offlineCapabilities: ['diagram_generation', 'contract_test_generation', 'context_blueprint', 'terminal_task'],
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
    unitTestStyle: 'contract',
    structured: true,
    editorFeatures: ['comment_task', 'context_file', 'unit_test', 'terminal_task'],
    commentTaskIntents: ['config', 'workdir'],
    offlineCapabilities: ['workdir_generation', 'context_blueprint', 'contract_test_generation', 'terminal_task'],
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
    unitTestStyle: 'contract',
    structured: false,
    editorFeatures: ['comment_task', 'context_file', 'unit_test', 'terminal_task'],
    commentTaskIntents: ['function', 'test', 'comment', 'enum', 'class', 'interface', 'struct', 'module', 'object', 'collection', 'variable', 'script'],
    offlineCapabilities: ['simple_function', 'arithmetic_function', 'literal_return', 'context_blueprint', 'contract_test_generation', 'terminal_task', 'simple_script'],
    bestPractices: [
      'Use set -eu quando o contrato do script exigir falha previsivel.',
      'Mantenha comandos pequenos e saidas claras para automacao.',
    ],
  },
  {
    id: 'toml',
    extensions: ['.toml'],
    commentPrefix: '#',
    unitTestStyle: 'contract',
    structured: true,
    editorFeatures: ['comment_task', 'context_file', 'unit_test', 'terminal_task'],
    commentTaskIntents: ['config', 'section', 'context_blueprint'],
    offlineCapabilities: ['comment_task', 'context_blueprint', 'contract_test_generation', 'terminal_task'],
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
    structured: false,
    editorFeatures: ['comment_task', 'terminal_task'],
    commentTaskIntents: ['function', 'comment'],
    offlineCapabilities: ['comment_task', 'terminal_task'],
    bestPractices: [
      'Prefira contratos pequenos, nomes claros e efeitos isolados.',
    ],
  },
]);

const EXTENSION_TO_CAPABILITY = new Map();
LANGUAGE_CAPABILITY_REGISTRY.forEach((entry) => {
  entry.extensions.forEach((extension) => {
    EXTENSION_TO_CAPABILITY.set(extension, entry);
  });
});
const DEFAULT_CAPABILITY_ENTRY = LANGUAGE_CAPABILITY_REGISTRY[LANGUAGE_CAPABILITY_REGISTRY.length - 1];

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

function getCapabilityProfile(fileOrExt) {
  const extension = analysisExtension(fileOrExt);
  const resolved = EXTENSION_TO_CAPABILITY.get(extension) || DEFAULT_CAPABILITY_ENTRY;
  if (resolved.id === 'default') {
    return DEFAULT_CAPABILITY_ENTRY;
  }
  return ACTIVE_LANGUAGE_IDS.has(resolved.id) ? resolved : DEFAULT_CAPABILITY_ENTRY;
}

function cloneList(value) {
  return Array.isArray(value) ? [...value] : [];
}

function declaredCommentTaskIntentsFor(fileOrExt) {
  return cloneList(getCapabilityProfile(fileOrExt).commentTaskIntents);
}

function declaredEditorFeaturesFor(fileOrExt) {
  return cloneList(getCapabilityProfile(fileOrExt).editorFeatures);
}

function supportsCommentTaskIntent(fileOrExt, intent) {
  const normalizedIntent = String(intent || '').trim().toLowerCase();
  if (!normalizedIntent || !isLanguageActive(fileOrExt)) {
    return false;
  }
  return declaredCommentTaskIntentsFor(fileOrExt).includes(normalizedIntent);
}
function supportsEditorFeature(fileOrExt, feature) {
  const normalizedFeature = String(feature || '').trim();
  if (!normalizedFeature || !isLanguageActive(fileOrExt)) {
    return false;
  }
  return declaredEditorFeaturesFor(fileOrExt).includes(normalizedFeature);
}
function isLanguageActive(fileOrExt) {
  const extension = analysisExtension(fileOrExt);
  const resolved = EXTENSION_TO_CAPABILITY.get(extension);
  return Boolean(resolved && ACTIVE_LANGUAGE_IDS.has(resolved.id));
}
function requiresAiForFeature(fileOrExt, feature) {
  if (!isLanguageActive(fileOrExt)) {
    return false;
  }
  return ['comment_task', 'context_file', 'unit_test'].includes(String(feature || '').trim());
}
function activeLanguageIds() {
  return Array.from(ACTIVE_LANGUAGE_IDS);
}

function languageCapabilityRegistry() {
  return LANGUAGE_CAPABILITY_REGISTRY
    .filter((entry) => entry.id === 'default' || ACTIVE_LANGUAGE_IDS.has(entry.id))
    .map((entry) => ({
    ...entry,
    extensions: cloneList(entry.extensions),
    editorFeatures: cloneList(entry.editorFeatures),
    commentTaskIntents: cloneList(entry.commentTaskIntents),
    offlineCapabilities: cloneList(entry.offlineCapabilities),
    bestPractices: cloneList(entry.bestPractices),
    }));
}

module.exports = {
  ACTIVE_LANGUAGE_IDS,
  LANGUAGE_CAPABILITY_REGISTRY,
  activeLanguageIds,
  analysisExtension,
  declaredCommentTaskIntentsFor,
  declaredEditorFeaturesFor,
  getCapabilityProfile,
  isLanguageActive,
  languageCapabilityRegistry,
  requiresAiForFeature,
  supportsCommentTaskIntent,
  supportsEditorFeature,
};
