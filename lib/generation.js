'use strict';

const path = require('path');
const fs = require('fs');
const { snippetFunctionSpec, functionDescriptionFromName, safeComment, commentPrefix, sanitizeIdentifier, sanitizeNaturalIdentifier, escapeRegExp, buildMaintenanceComment } = require('./support');
const {
  analysisExtension: resolveAnalysisExtension,
  bestPracticesFor,
  isJavaScriptLikeExtension: resolveJavaScriptLikeExtension,
  isReactLikeExtension: resolveReactLikeExtension,
  isPythonLikeExtension: resolvePythonLikeExtension,
  isRubyExtension: resolveRubyExtension,
  isGoExtension: resolveGoExtension,
  isRustExtension: resolveRustExtension,
  isMermaidExtension,
  supportsSlashComments,
  supportsHashComments,
} = require('./language-profiles');
const { createStructuredGenerators } = require('./generation-structured');
const { createUiSnippetGenerator } = require('./generation-react');
const { createUnitTestCoverageChecker } = require('./generation-unit-tests');

const { generateStructuredConfigSnippet, generateStructureSnippet, parseVariableCorrectionRequest } = createStructuredGenerators({
  sanitizeNaturalIdentifier,
  isInstructionNoiseToken,
  extractLiteralFromInstruction,
  isJavaScriptLikeExtension,
  isPythonLikeExtension,
  isGoExtension,
  isRustExtension,
  toCamelCaseIdentifier,
  toSnakeCaseIdentifier,
});

const generateUiSnippet = createUiSnippetGenerator({
  isReactLikeExtension,
  generateGenericSnippet,
  decorateGeneratedSnippet,
  inferModuleStyle,
  jsDependencySpec,
});

const checkUnitTestCoverage = createUnitTestCoverageChecker({
  sanitizeIdentifier,
  sanitizeNaturalIdentifier,
  escapeRegExp,
  isJavaScriptLikeExtension,
  isPythonLikeExtension,
  isGoExtension,
  isRustExtension,
  isRubyExtension,
  resolveProjectRoot,
  findUpwards,
  pathExists,
  toPosixPath,
  toImportPath,
  upwardDepth,
  upperFirst,
});

function normalizeGeneratedTaskResult(result, ext = '') {
  let normalized = { snippet: '', dependencies: [] };
  if (!result) {
    normalized = { snippet: '', dependencies: [] };
  } else if (typeof result === 'string') {
    normalized = { snippet: result, dependencies: [] };
  } else {
    normalized = {
      snippet: String(result.snippet || ''),
      dependencies: Array.isArray(result.dependencies) ? result.dependencies : [],
    };
  }

  return {
    ...normalized,
    snippet: addMaintenanceCommentsToSnippet(normalized.snippet, ext),
  };
}
function mapGeneratedTaskResultSnippet(result, mapper) {
  if (typeof mapper !== 'function') {
    return result;
  }

  if (typeof result === 'string') {
    return mapper(result);
  }

  if (!result || typeof result !== 'object') {
    return result;
  }

  return {
    ...result,
    snippet: mapper(String(result.snippet || '')),
  };
}
function commentTaskAlreadyApplied(lines, commentIndex, snippet, ext = '') {
  const firstSnippetLine = firstSignificantSnippetLine(snippet, ext);
  if (!firstSnippetLine) {
    return false;
  }

  const signatureLines = extractGeneratedSignatureLines(snippet);
  if (signatureLines.length > 0) {
    const existingLines = new Set();
    for (let index = 0; index < lines.length; index += 1) {
      if (index === commentIndex) {
        continue;
      }
      existingLines.add(String(lines[index] || '').trim());
    }
    return signatureLines.every((signatureLine) => existingLines.has(signatureLine));
  }

  for (let index = 0; index < lines.length; index += 1) {
    if (index === commentIndex) {
      continue;
    }
    const current = String(lines[index] || '').trim();
    if (current === firstSnippetLine) {
      return true;
    }
  }
  return false;
}
function firstSignificantSnippetLine(snippet, ext = '') {
  const lines = String(snippet || '')
    .split('\n')
    .map((line) => String(line).trim())
    .filter(Boolean);
  if (!lines.length) {
    return '';
  }
  const firstCodeLine = lines.find((line) => !isGeneratedCommentLine(line, ext));
  return firstCodeLine || lines[0];
}
function isGeneratedCommentLine(line, ext = '') {
  const trimmed = String(line || '').trim();
  const lowerExt = analysisExtension(ext);
  if (!trimmed) {
    return false;
  }
  if (lowerExt === '.md') {
    return /^<!--.*-->$/.test(trimmed);
  }
  return /^(?:\/\*\*|\/\*|\*\/|\*|\/\/|#|--|"|@doc\b|@spec\b|@moduledoc\b|"""|''')/.test(trimmed);
}
function hasLeadingSnippetComment(lines, ext = '') {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const trimmed = String(lines[index] || '').trim();
    if (!trimmed) {
      continue;
    }
    return isGeneratedCommentLine(trimmed, ext);
  }
  return false;
}
function addMaintenanceCommentsToSnippet(snippet, ext) {
  if (analysisExtension(ext) === '.md') {
    return String(snippet || '');
  }
  const sourceLines = String(snippet || '').split('\n');
  const resultLines = [];

  for (let index = 0; index < sourceLines.length; index += 1) {
    const line = String(sourceLines[index] || '');
    const trimmed = line.trim();
    if (!trimmed) {
      resultLines.push(line);
      continue;
    }

    if (!hasLeadingSnippetComment(resultLines, ext) && !isGeneratedCommentLine(line, ext)) {
      const comment = buildMaintenanceComment(line, ext, sourceLines.slice(index + 1, index + 4));
      if (comment) {
        resultLines.push(comment);
      }
    }

    resultLines.push(line);
  }

  return resultLines.join('\n');
}
function extractGeneratedSignatureLines(snippet) {
  const signatureLines = [];
  const lines = String(snippet || '')
    .split('\n')
    .map((line) => String(line).trim())
    .filter(Boolean);
  for (const line of lines) {
    if (
      /^def\s+[a-z_][a-zA-Z0-9_?!]*\s*\(/.test(line)
      || /^def\s+[a-z_][a-zA-Z0-9_?!]*\s*do\b/.test(line)
      || /^function\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(line)
      || /^export function\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(line)
      || /^func\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(line)
      || /^fn\s+[a-z_][a-zA-Z0-9_]*\s*\(/.test(line)
      || /^function!?\s+(?:[gswbtlav]:)?[A-Za-z_#][A-Za-z0-9_:#]*\s*\(/.test(line)
    ) {
      signatureLines.push(line);
    }
  }
  return signatureLines;
}
function normalizeCommentInstruction(raw) {
  return String(raw || '')
    .trim()
    .replace(/^\s*(?:\\s)?\s*(?:\*\*|[:*])\s*/, '')
    .trim();
}
function isActionableCommentTask(instruction) {
  const normalized = String(instruction || '').trim();
  if (normalized.length < 4) {
    return false;
  }
  return !isIncompleteCommentTask(normalized);
}
function isIncompleteCommentTask(instruction) {
  const lower = String(instruction || '').toLowerCase().trim();
  if (!lower) {
    return true;
  }

  if (/\b(que|de|do|da|para|com|sem|e|ou|a|o|um|uma|that|to|for|with|from|and|or)\s*$/.test(lower)) {
    return true;
  }

  if (/^(?:funcao|função|function|metodo|método|method)\s*$/.test(lower)) {
    return true;
  }

  if (/^(?:funcao|função|function|metodo|método|method)\s+(?:que|de|do|da|para|com|sem|that|to|for|with)\s*$/.test(lower)) {
    return true;
  }

  if (/^(?:crie|criar|cria|implemente|implementar|implementa|escreva|escrever|faça|faca|adicione|adicionar)\s+(?:uma?\s+)?(?:funcao|função|function|metodo|método|method)\s*$/.test(lower)) {
    return true;
  }

  return false;
}
function analysisExtension(fileOrExt) {
  return resolveAnalysisExtension(fileOrExt);
}
function commentTaskPattern(ext) {
  const lowerExt = analysisExtension(ext);
  if (supportsHashComments(lowerExt) || ['.tf'].includes(lowerExt)) {
    return /^\s*#\s*(?:\\s)?\s*(\*\*|[:*])\s*(.+)$/;
  }
  if (lowerExt === '.md') {
    return /^\s*<!--\s*(?:\\s)?\s*(\*\*|[:*])\s*(.+?)\s*-->\s*$/;
  }
  if (isMermaidExtension(lowerExt)) {
    return /^\s*%%\s*(?:\\s)?\s*(\*\*|[:*])\s*(.+)$/;
  }
  if (supportsSlashComments(lowerExt)) {
    return /^\s*\/\/\s*(?:\\s)?\s*(\*\*|[:*])\s*(.+)$/;
  }
  if (lowerExt === '.lua') {
    return /^\s*--\s*(?:\\s)?\s*(\*\*|[:*])\s*(.+)$/;
  }
  if (lowerExt === '.vim') {
    return /^\s*"\s*(?:\\s)?\s*(\*\*|[:*])\s*(.+)$/;
  }
  return /^\s*(?:#|\/\/|--|")\s*(?:\\s)?\s*(\*\*|[:*])\s*(.+)$/;
}
function buildTerminalTask(lines, file, lineNumber, instruction) {
  const action = inferTerminalTaskAction(file, instruction);
  if (!action || !action.command) {
    return null;
  }

  return {
    file,
    line: lineNumber,
    severity: 'info',
    kind: 'terminal_task',
    message: 'Acao de terminal solicitada no comentario',
    suggestion: `Executar no terminal: ${action.description}`,
    action: {
      op: 'run_command',
      command: action.command,
      cwd: action.cwd,
      remove_trigger: true,
    },
  };
}
function buildContextBlueprintTasks(lines, file, lineNumber, instruction) {
  const blueprint = parseContextBlueprintInstruction(file, instruction);
  if (!blueprint) {
    return [];
  }

  const projectRoot = resolveProjectRoot(file);
  const tasks = [];
  const contextTargetFile = path.join(projectRoot, '.realtime-dev-agent', 'contexts', `${blueprint.slug}.md`);
  const gitignoreIssue = buildAgentGitignoreIssue(file, lineNumber, projectRoot);

  if (gitignoreIssue) {
    tasks.push(gitignoreIssue);
  }

  if (!pathExists(contextTargetFile)) {
    tasks.push(buildContextBlueprintIssue(
      file,
      lineNumber,
      'Documento de contexto arquitetural ausente',
      `Documente o blueprint ${blueprint.displayName} para o agente seguir no projeto.`,
      buildContextBlueprintDocument(blueprint),
      contextTargetFile,
    ));
  }

  for (const scaffoldFile of buildContextBlueprintScaffoldFiles(projectRoot, blueprint)) {
    if (pathExists(scaffoldFile.targetFile)) {
      continue;
    }
    tasks.push(buildContextBlueprintIssue(
      file,
      lineNumber,
      `Estrutura ${scaffoldFile.role} ausente`,
      `Crie ${toPosixPath(path.relative(projectRoot, scaffoldFile.targetFile))} seguindo a Onion Architecture.`,
      scaffoldFile.contents,
      scaffoldFile.targetFile,
    ));
  }

  tasks.forEach((task) => {
    task.action.remove_trigger = true;
  });

  return tasks;
}
function buildAgentGitignoreIssue(file, lineNumber, projectRoot) {
  const targetFile = path.join(projectRoot, '.gitignore');
  const snippet = buildAgentGitignoreContents(targetFile);
  if (!snippet) {
    return null;
  }

  return buildContextBlueprintIssue(
    file,
    lineNumber,
    'Ignorar arquivos de contexto do agente no Git',
    'Atualize o .gitignore para nao versionar a pasta .realtime-dev-agent/.',
    snippet,
    targetFile,
  );
}
function buildAgentGitignoreContents(targetFile) {
  const currentContent = pathExists(targetFile)
    ? fs.readFileSync(targetFile, 'utf8')
    : '';

  if (gitignoreCoversAgentDirectory(currentContent)) {
    return '';
  }

  const currentLines = splitLines(currentContent);
  const nextLines = trimTrailingEmptyLines(currentLines);
  if (nextLines.length > 0) {
    nextLines.push('');
  }
  nextLines.push('.realtime-dev-agent/');
  return nextLines.join('\n');
}
function gitignoreCoversAgentDirectory(content) {
  return splitLines(content).some((line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return false;
    }
    return /^\.realtime-dev-agent(?:\/.*)?$/.test(trimmed);
  });
}
function splitLines(content) {
  return String(content || '').replace(/\r\n/g, '\n').split('\n');
}
function trimTrailingEmptyLines(lines) {
  const normalized = Array.isArray(lines) ? [...lines] : [];
  while (normalized.length > 0 && normalized[normalized.length - 1] === '') {
    normalized.pop();
  }
  return normalized;
}
function buildContextBlueprintIssue(file, lineNumber, message, suggestion, snippet, targetFile) {
  return {
    file,
    line: lineNumber,
    severity: 'info',
    kind: 'context_file',
    message,
    suggestion,
    snippet,
    action: {
      op: 'write_file',
      target_file: targetFile,
      mkdir_p: true,
      remove_trigger: false,
    },
  };
}
function parseContextBlueprintInstruction(file, instruction) {
  const normalizedInstruction = String(instruction || '').trim();
  if (!normalizedInstruction) {
    return null;
  }

  const lowerInstruction = normalizedInstruction.toLowerCase();
  const projectRoot = resolveProjectRoot(file);
  const sourceExt = resolveBlueprintSourceExtension(projectRoot, file);
  const sourceLanguage = blueprintLanguageLabel(sourceExt);
  const architecture = 'onion';
  const blueprintType = /\bbff\b/.test(lowerInstruction) && /\bcrud\b/.test(lowerInstruction)
    ? 'bff_crud'
    : 'project_context';
  const entity = blueprintType === 'bff_crud'
    ? parseCrudEntityName(normalizedInstruction)
    : inferBlueprintSubject(normalizedInstruction);
  const names = crudEntityNames(entity);
  const slugBase = blueprintType === 'bff_crud'
    ? `bff-crud-${names.singularSnake}`
    : sanitizeNaturalIdentifier(normalizedInstruction).replace(/_/g, '-');

  return {
    architecture,
    blueprintType,
    displayName: blueprintType === 'bff_crud'
      ? `BFF para CRUD de ${names.singularSnake}`
      : `Contexto de projeto: ${normalizedInstruction}`,
    entity: names.singularSnake,
    generatedAt: new Date().toISOString().slice(0, 10),
    language: sourceLanguage,
    names,
    projectRoot,
    slug: slugBase || 'project-context',
    sourceExt,
    sourceRoot: 'src',
    summary: normalizedInstruction,
  };
}
function inferBlueprintSubject(instruction) {
  const match = String(instruction || '').match(/\b(?:para|de|do|da)\s+([a-zà-ÿ_][a-zà-ÿ0-9_-]*)/i);
  if (match && match[1]) {
    return sanitizeNaturalIdentifier(match[1]);
  }
  return 'contexto';
}
function resolveBlueprintSourceExtension(projectRoot, file) {
  const currentExt = analysisExtension(file);
  if (['.ts', '.tsx', '.js', '.jsx'].includes(currentExt)) {
    return currentExt === '.tsx' ? '.ts' : currentExt === '.jsx' ? '.js' : currentExt;
  }
  if (pathExists(path.join(projectRoot, 'tsconfig.json'))) {
    return '.ts';
  }
  if (pathExists(path.join(projectRoot, 'package.json'))) {
    return '.js';
  }
  if (pathExists(path.join(projectRoot, 'go.mod'))) {
    return '.go';
  }
  if (pathExists(path.join(projectRoot, 'pyproject.toml')) || pathExists(path.join(projectRoot, 'requirements.txt'))) {
    return '.py';
  }
  if (['.lua', '.go', '.py'].includes(currentExt)) {
    return currentExt;
  }
  return '.js';
}
function blueprintLanguageLabel(ext) {
  if (['.ts', '.tsx'].includes(ext)) {
    return 'typescript';
  }
  if (['.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    return 'javascript';
  }
  if (ext === '.go') {
    return 'go';
  }
  if (ext === '.py') {
    return 'python';
  }
  if (ext === '.lua') {
    return 'lua';
  }
  return ext.replace(/^\./, '') || 'text';
}
function buildContextBlueprintDocument(blueprint) {
  const names = blueprint.names;
  const scaffoldFiles = buildContextBlueprintScaffoldFiles(blueprint.projectRoot, blueprint);
  return [
    '<!-- realtime-dev-agent-context -->',
    `slug: ${blueprint.slug}`,
    `blueprint_type: ${blueprint.blueprintType}`,
    `architecture: ${blueprint.architecture}`,
    `entity: ${names.singularSnake}`,
    `collection: ${names.pluralSnake}`,
    `language: ${blueprint.language}`,
    `source_ext: ${blueprint.sourceExt}`,
    `source_root: ${blueprint.sourceRoot}`,
    `generated_at: ${blueprint.generatedAt}`,
    '',
    `# Contexto do agente: ${blueprint.displayName}`,
    '',
    '## Objetivo',
    `- Guiar a implementacao do projeto a partir da intencao: ${blueprint.summary}.`,
    `- Manter o fluxo de desenvolvimento alinhado a uma ${upperFirst(blueprint.architecture)} Architecture com separacao explicita entre dominio, aplicacao, infraestrutura, interfaces e composicao.`,
    '',
    '## Regras de arquitetura',
    '- Dominio: regras puras, sem dependencia de IO ou framework.',
    '- Aplicacao: orquestra casos de uso por funcoes que recebem dependencias.',
    '- Infraestrutura: implementacoes concretas de repositorios e gateways.',
    '- Interfaces: controllers e rotas adaptando entrada e saida.',
    '- Main: composicao das dependencias do fluxo.',
    '',
    '## Entidade principal',
    `- Entidade: ${names.singularSnake}`,
    `- Colecao: ${names.pluralSnake}`,
    `- Escopo inicial: listar, detalhar, criar, atualizar e remover ${names.singularSnake}.`,
    '',
    '## Estrutura sugerida',
    ...scaffoldFiles.map((scaffoldFile) => `- ${toPosixPath(path.relative(blueprint.projectRoot, scaffoldFile.targetFile))}`),
    '',
    '## Como o agente deve usar este contexto',
    `- Ao gerar codigo para ${names.singularSnake}, priorize os arquivos em ${blueprint.sourceRoot}/domain, ${blueprint.sourceRoot}/application, ${blueprint.sourceRoot}/infrastructure, ${blueprint.sourceRoot}/interfaces e ${blueprint.sourceRoot}/main.`,
    '- Preserve composicao funcional e injecao explicita de dependencias.',
    '- Evite acoplar controller, regra de negocio e persistencia no mesmo arquivo.',
    '',
    '## Passos seguintes sugeridos',
    `- Implementar os casos de uso de ${names.pluralSnake} respeitando o contrato do repositorio.`,
    `- Substituir o repositorio em memoria por uma implementacao concreta quando a persistencia real for definida.`,
    `- Conectar as rotas de ${names.pluralSnake} ao servidor HTTP da aplicacao.`,
  ].join('\n');
}
function buildContextBlueprintScaffoldFiles(projectRoot, blueprint) {
  if (blueprint.blueprintType !== 'bff_crud' || !isJavaScriptLikeExtension(blueprint.sourceExt)) {
    return [];
  }

  const names = blueprint.names;
  const extension = blueprint.sourceExt;
  const sourceRoot = path.join(projectRoot, blueprint.sourceRoot);
  const files = {
    entityFile: path.join(sourceRoot, 'domain', 'entities', `${names.singularSnake}${extension}`),
    repositoryFile: path.join(sourceRoot, 'domain', 'repositories', `${names.singularSnake}-repository${extension}`),
    listUseCaseFile: path.join(sourceRoot, 'application', 'use-cases', `list-${names.pluralSnake}${extension}`),
    getUseCaseFile: path.join(sourceRoot, 'application', 'use-cases', `get-${names.singularSnake}-by-id${extension}`),
    createUseCaseFile: path.join(sourceRoot, 'application', 'use-cases', `create-${names.singularSnake}${extension}`),
    updateUseCaseFile: path.join(sourceRoot, 'application', 'use-cases', `update-${names.singularSnake}${extension}`),
    deleteUseCaseFile: path.join(sourceRoot, 'application', 'use-cases', `delete-${names.singularSnake}${extension}`),
    inMemoryRepositoryFile: path.join(sourceRoot, 'infrastructure', 'repositories', `in-memory-${names.singularSnake}-repository${extension}`),
    controllerFile: path.join(sourceRoot, 'interfaces', 'http', 'controllers', `${names.singularSnake}-controller${extension}`),
    routesFile: path.join(sourceRoot, 'interfaces', 'http', 'routes', `${names.singularSnake}-routes${extension}`),
    factoryFile: path.join(sourceRoot, 'main', 'factories', `${names.singularSnake}-crud-factory${extension}`),
  };

  return [
    { role: 'entidade de dominio', targetFile: files.entityFile, contents: buildOnionEntityFile(blueprint, files) },
    { role: 'porta de repositorio', targetFile: files.repositoryFile, contents: buildOnionRepositoryContractFile(blueprint, files) },
    { role: 'caso de uso de listagem', targetFile: files.listUseCaseFile, contents: buildOnionListUseCaseFile(blueprint, files) },
    { role: 'caso de uso de consulta', targetFile: files.getUseCaseFile, contents: buildOnionGetUseCaseFile(blueprint, files) },
    { role: 'caso de uso de criacao', targetFile: files.createUseCaseFile, contents: buildOnionCreateUseCaseFile(blueprint, files) },
    { role: 'caso de uso de atualizacao', targetFile: files.updateUseCaseFile, contents: buildOnionUpdateUseCaseFile(blueprint, files) },
    { role: 'caso de uso de remocao', targetFile: files.deleteUseCaseFile, contents: buildOnionDeleteUseCaseFile(blueprint, files) },
    { role: 'repositorio em memoria', targetFile: files.inMemoryRepositoryFile, contents: buildOnionInMemoryRepositoryFile(blueprint, files) },
    { role: 'controller HTTP', targetFile: files.controllerFile, contents: buildOnionControllerFile(blueprint, files) },
    { role: 'rotas HTTP', targetFile: files.routesFile, contents: buildOnionRoutesFile(blueprint, files) },
    { role: 'fabrica de composicao', targetFile: files.factoryFile, contents: buildOnionFactoryFile(blueprint, files) },
  ];
}
function blueprintImportPath(fromFile, toFile) {
  const relative = path.relative(path.dirname(fromFile), toFile);
  return toImportPath(relative).replace(/\.(js|jsx|ts|tsx|mjs|cjs)$/i, '');
}
function loadActiveBlueprintContext(file) {
  const projectRoot = resolveProjectRoot(file);
  const contextDir = path.join(projectRoot, '.realtime-dev-agent', 'contexts');
  if (!pathExists(contextDir)) {
    return null;
  }

  const candidates = fs.readdirSync(contextDir)
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => path.join(contextDir, entry))
    .filter((entry) => pathExists(entry))
    .map((entry) => ({
      entry,
      stats: fs.statSync(entry),
    }))
    .sort((left, right) => right.stats.mtimeMs - left.stats.mtimeMs);

  for (const candidate of candidates) {
    const parsed = parseBlueprintContextDocument(fs.readFileSync(candidate.entry, 'utf8'));
    if (parsed) {
      parsed.projectRoot = projectRoot;
      return parsed;
    }
  }

  return null;
}
function parseBlueprintContextDocument(text) {
  const lines = String(text || '').split(/\r?\n/);
  if (String(lines[0] || '').trim() !== '<!-- realtime-dev-agent-context -->') {
    return null;
  }

  const metadata = {};
  for (const line of lines.slice(1)) {
    const trimmed = String(line || '').trim();
    if (!trimmed) {
      break;
    }
    const match = trimmed.match(/^([a-z_]+):\s*(.+)$/);
    if (!match) {
      continue;
    }
    metadata[match[1]] = match[2];
  }

  if (!metadata.blueprint_type) {
    return null;
  }

  return {
    architecture: metadata.architecture || '',
    blueprintType: metadata.blueprint_type,
    entity: metadata.entity || '',
    language: metadata.language || '',
    slug: metadata.slug || '',
    sourceExt: metadata.source_ext || '.js',
    sourceRoot: metadata.source_root || 'src',
    names: crudEntityNames(metadata.entity || 'registro'),
  };
}
function generateBlueprintAwareSnippet(instruction, ext, sourceFile) {
  const blueprint = loadActiveBlueprintContext(sourceFile);
  if (!blueprint || blueprint.blueprintType !== 'bff_crud' || blueprint.architecture !== 'onion') {
    return '';
  }

  const scaffoldFiles = buildContextBlueprintScaffoldFiles(resolveProjectRoot(sourceFile), blueprint);
  const matchingFile = scaffoldFiles.find((scaffoldFile) => path.resolve(scaffoldFile.targetFile) === path.resolve(sourceFile));
  if (matchingFile) {
    return matchingFile.contents;
  }

  if (/\bcrud\b/i.test(instruction) && !new RegExp(`\\b${escapeRegExp(blueprint.entity)}\\b`, 'i').test(instruction)) {
    return generateCrudSnippet(`${instruction} ${blueprint.entity}`, ext);
  }

  return '';
}
function buildOnionEntityFile(blueprint) {
  const names = blueprint.names;
  const entityCamel = names.singularCamel;
  const entityPascal = names.singularPascal;
  return [
    jsDocBlock(
      `Normaliza os dados de ${names.singularSnake} para o contrato interno do dominio.`,
      [{ name: entityCamel, description: `Dados recebidos para ${names.singularSnake}.` }],
      `${entityPascal} normalizado para o restante da arquitetura.`,
    ),
    `export function normalize${entityPascal}(${entityCamel} = {}) {`,
    '  return {',
    `    id: ${entityCamel}.id ?? null,`,
    `    name: ${entityCamel}.name ?? '',`,
    `    email: ${entityCamel}.email ?? '',`,
    `    active: ${entityCamel}.active !== false,`,
    '  };',
    '}',
    '',
    jsDocBlock(
      `Aplica alteracoes de ${names.singularSnake} preservando o contrato do dominio.`,
      [
        { name: `current${entityPascal}`, description: `Estado atual de ${names.singularSnake}.` },
        { name: 'changes', description: `Alteracoes desejadas para ${names.singularSnake}.` },
      ],
      `${entityPascal} resultante apos a combinacao do estado atual com as alteracoes.`,
    ),
    `export function merge${entityPascal}Changes(current${entityPascal} = {}, changes = {}) {`,
    `  return normalize${entityPascal}({`,
    `    ...current${entityPascal},`,
    '    ...changes,',
    `    id: current${entityPascal}.id ?? changes.id ?? null,`,
    '  });',
    '}',
  ].join('\n');
}
function buildOnionRepositoryContractFile(blueprint) {
  const names = blueprint.names;
  const entityPascal = names.singularPascal;
  const repositoryMethods = [
    `list${names.pluralPascal}`,
    `get${entityPascal}ById`,
    `create${entityPascal}`,
    `update${entityPascal}`,
    `delete${entityPascal}`,
  ];
  return [
    'function assertRepositoryMethod(repository, methodName) {',
    '  if (!repository || typeof repository[methodName] !== "function") {',
    '    throw new Error(`Repositorio invalido: metodo ${methodName} nao encontrado`);',
    '  }',
    '  return repository;',
    '}',
    '',
    jsDocBlock(
      `Valida o contrato minimo do repositorio de ${names.singularSnake}.`,
      [{ name: `${names.singularCamel}Repository`, description: `Implementacao concreta do repositorio de ${names.singularSnake}.` }],
      `Repositorio validado para os casos de uso de ${names.pluralSnake}.`,
    ),
    `export function assert${entityPascal}Repository(${names.singularCamel}Repository) {`,
    `  ${JSON.stringify(repositoryMethods)}.forEach((methodName) => {`,
    `    assertRepositoryMethod(${names.singularCamel}Repository, methodName);`,
    '  });',
    `  return ${names.singularCamel}Repository;`,
    '}',
  ].join('\n');
}
function buildOnionListUseCaseFile(blueprint, files) {
  const names = blueprint.names;
  const repositoryImport = blueprintImportPath(files.listUseCaseFile, files.repositoryFile);
  return [
    `import { assert${names.singularPascal}Repository } from ${JSON.stringify(repositoryImport)};`,
    '',
    jsDocBlock(
      `Constroi o caso de uso responsavel por listar ${names.pluralSnake}.`,
      [{ name: 'dependencies', description: `Dependencias necessarias para a listagem de ${names.pluralSnake}.` }],
      `Funcao que lista ${names.pluralSnake} a partir do repositorio injetado.`,
    ),
    'export function buildListUsers(dependencies) {'.replace('Users', names.pluralPascal),
    `  const ${names.singularCamel}Repository = assert${names.singularPascal}Repository(dependencies.${names.singularCamel}Repository);`,
    `  return async function list${names.pluralPascal}(filters = {}) {`,
    `    return ${names.singularCamel}Repository.list${names.pluralPascal}(filters);`,
    '  };',
    '}',
  ].join('\n');
}
function buildOnionGetUseCaseFile(blueprint, files) {
  const names = blueprint.names;
  const repositoryImport = blueprintImportPath(files.getUseCaseFile, files.repositoryFile);
  return [
    `import { assert${names.singularPascal}Repository } from ${JSON.stringify(repositoryImport)};`,
    '',
    jsDocBlock(
      `Constroi o caso de uso responsavel por consultar ${names.singularSnake} por identificador.`,
      [{ name: 'dependencies', description: `Dependencias necessarias para buscar ${names.singularSnake}.` }],
      `Funcao que retorna ${names.singularSnake} ou null quando nao existir.`,
    ),
    `export function buildGet${names.singularPascal}ById(dependencies) {`,
    `  const ${names.singularCamel}Repository = assert${names.singularPascal}Repository(dependencies.${names.singularCamel}Repository);`,
    `  return async function get${names.singularPascal}ById(id) {`,
    `    return ${names.singularCamel}Repository.get${names.singularPascal}ById(id);`,
    '  };',
    '}',
  ].join('\n');
}
function buildOnionCreateUseCaseFile(blueprint, files) {
  const names = blueprint.names;
  const repositoryImport = blueprintImportPath(files.createUseCaseFile, files.repositoryFile);
  const entityImport = blueprintImportPath(files.createUseCaseFile, files.entityFile);
  return [
    `import { normalize${names.singularPascal} } from ${JSON.stringify(entityImport)};`,
    `import { assert${names.singularPascal}Repository } from ${JSON.stringify(repositoryImport)};`,
    '',
    jsDocBlock(
      `Constroi o caso de uso responsavel por criar ${names.singularSnake}.`,
      [{ name: 'dependencies', description: `Dependencias necessarias para criar ${names.singularSnake}.` }],
      `Funcao que persiste ${names.singularSnake} validado no repositorio.`,
    ),
    `export function buildCreate${names.singularPascal}(dependencies) {`,
    `  const ${names.singularCamel}Repository = assert${names.singularPascal}Repository(dependencies.${names.singularCamel}Repository);`,
    `  return async function create${names.singularPascal}(payload) {`,
    `    const normalized${names.singularPascal} = normalize${names.singularPascal}(payload);`,
    `    return ${names.singularCamel}Repository.create${names.singularPascal}(normalized${names.singularPascal});`,
    '  };',
    '}',
  ].join('\n');
}
function buildOnionUpdateUseCaseFile(blueprint, files) {
  const names = blueprint.names;
  const repositoryImport = blueprintImportPath(files.updateUseCaseFile, files.repositoryFile);
  const entityImport = blueprintImportPath(files.updateUseCaseFile, files.entityFile);
  return [
    `import { merge${names.singularPascal}Changes } from ${JSON.stringify(entityImport)};`,
    `import { assert${names.singularPascal}Repository } from ${JSON.stringify(repositoryImport)};`,
    '',
    jsDocBlock(
      `Constroi o caso de uso responsavel por atualizar ${names.singularSnake}.`,
      [{ name: 'dependencies', description: `Dependencias necessarias para atualizar ${names.singularSnake}.` }],
      `Funcao que busca o estado atual, aplica alteracoes e persiste o resultado.`,
    ),
    `export function buildUpdate${names.singularPascal}(dependencies) {`,
    `  const ${names.singularCamel}Repository = assert${names.singularPascal}Repository(dependencies.${names.singularCamel}Repository);`,
    `  return async function update${names.singularPascal}(id, changes) {`,
    `    const current${names.singularPascal} = await ${names.singularCamel}Repository.get${names.singularPascal}ById(id);`,
    `    if (!current${names.singularPascal}) {`,
    '      return null;',
    '    }',
    `    const merged${names.singularPascal} = merge${names.singularPascal}Changes(current${names.singularPascal}, changes);`,
    `    return ${names.singularCamel}Repository.update${names.singularPascal}(id, merged${names.singularPascal});`,
    '  };',
    '}',
  ].join('\n');
}
function buildOnionDeleteUseCaseFile(blueprint, files) {
  const names = blueprint.names;
  const repositoryImport = blueprintImportPath(files.deleteUseCaseFile, files.repositoryFile);
  return [
    `import { assert${names.singularPascal}Repository } from ${JSON.stringify(repositoryImport)};`,
    '',
    jsDocBlock(
      `Constroi o caso de uso responsavel por remover ${names.singularSnake}.`,
      [{ name: 'dependencies', description: `Dependencias necessarias para remover ${names.singularSnake}.` }],
      `Funcao que remove ${names.singularSnake} e retorna o registro excluido quando existir.`,
    ),
    `export function buildDelete${names.singularPascal}(dependencies) {`,
    `  const ${names.singularCamel}Repository = assert${names.singularPascal}Repository(dependencies.${names.singularCamel}Repository);`,
    `  return async function delete${names.singularPascal}(id) {`,
    `    return ${names.singularCamel}Repository.delete${names.singularPascal}(id);`,
    '  };',
    '}',
  ].join('\n');
}
function buildOnionInMemoryRepositoryFile(blueprint, files) {
  const names = blueprint.names;
  const entityImport = blueprintImportPath(files.inMemoryRepositoryFile, files.entityFile);
  return [
    `import { merge${names.singularPascal}Changes, normalize${names.singularPascal} } from ${JSON.stringify(entityImport)};`,
    '',
    `function clone${names.singularPascal}(${names.singularCamel}) {`,
    `  return normalize${names.singularPascal}(${names.singularCamel});`,
    '}',
    '',
    jsDocBlock(
      `Cria um repositorio em memoria para ${names.pluralSnake}, util para bootstrap e testes de fluxo.`,
      [{ name: 'seed', description: `Colecao inicial de ${names.pluralSnake}.` }],
      `Repositorio funcional com operacoes CRUD de ${names.singularSnake}.`,
    ),
    `export function buildInMemory${names.singularPascal}Repository(seed = []) {`,
    `  let state = seed.map((item) => normalize${names.singularPascal}(item));`,
    '',
    '  return {',
    `    async list${names.pluralPascal}() {`,
    `      return state.map((item) => clone${names.singularPascal}(item));`,
    '    },',
    `    async get${names.singularPascal}ById(id) {`,
    `      const current${names.singularPascal} = state.find((item) => item.id === id) || null;`,
    `      return current${names.singularPascal} ? clone${names.singularPascal}(current${names.singularPascal}) : null;`,
    '    },',
    `    async create${names.singularPascal}(payload) {`,
    `      const nextId = state.reduce((maxId, item) => Math.max(maxId, Number(item.id ?? 0)), 0) + 1;`,
    `      const created${names.singularPascal} = normalize${names.singularPascal}({ ...payload, id: nextId });`,
    `      state = [...state, created${names.singularPascal}];`,
    `      return clone${names.singularPascal}(created${names.singularPascal});`,
    '    },',
    `    async update${names.singularPascal}(id, payload) {`,
    `      const current${names.singularPascal} = state.find((item) => item.id === id) || null;`,
    `      if (!current${names.singularPascal}) {`,
    '        return null;',
    '      }',
    `      const updated${names.singularPascal} = merge${names.singularPascal}Changes(current${names.singularPascal}, payload);`,
    '      state = state.map((item) => (item.id === id ? updatedUser : item));'.replace('updatedUser', `updated${names.singularPascal}`),
    `      return clone${names.singularPascal}(updated${names.singularPascal});`,
    '    },',
    `    async delete${names.singularPascal}(id) {`,
    `      const current${names.singularPascal} = state.find((item) => item.id === id) || null;`,
    `      state = state.filter((item) => item.id !== id);`,
    `      return current${names.singularPascal} ? clone${names.singularPascal}(current${names.singularPascal}) : null;`,
    '    },',
    '  };',
    '}',
  ].join('\n');
}
function buildOnionControllerFile(blueprint, files) {
  const names = blueprint.names;
  const listImport = blueprintImportPath(files.controllerFile, files.listUseCaseFile);
  const getImport = blueprintImportPath(files.controllerFile, files.getUseCaseFile);
  const createImport = blueprintImportPath(files.controllerFile, files.createUseCaseFile);
  const updateImport = blueprintImportPath(files.controllerFile, files.updateUseCaseFile);
  const deleteImport = blueprintImportPath(files.controllerFile, files.deleteUseCaseFile);
  return [
    `import { buildCreate${names.singularPascal} } from ${JSON.stringify(createImport)};`,
    `import { buildDelete${names.singularPascal} } from ${JSON.stringify(deleteImport)};`,
    `import { buildGet${names.singularPascal}ById } from ${JSON.stringify(getImport)};`,
    `import { buildList${names.pluralPascal} } from ${JSON.stringify(listImport)};`,
    `import { buildUpdate${names.singularPascal} } from ${JSON.stringify(updateImport)};`,
    '',
    jsDocBlock(
      `Adapta os casos de uso de ${names.pluralSnake} para um contrato HTTP simples.`,
      [{ name: 'dependencies', description: `Dependencias compartilhadas entre os casos de uso de ${names.pluralSnake}.` }],
      `Controller funcional com handlers para ${names.pluralSnake}.`,
    ),
    `export function build${names.singularPascal}Controller(dependencies) {`,
    `  const list${names.pluralPascal} = buildList${names.pluralPascal}(dependencies);`,
    `  const get${names.singularPascal}ById = buildGet${names.singularPascal}ById(dependencies);`,
    `  const create${names.singularPascal} = buildCreate${names.singularPascal}(dependencies);`,
    `  const update${names.singularPascal} = buildUpdate${names.singularPascal}(dependencies);`,
    `  const delete${names.singularPascal} = buildDelete${names.singularPascal}(dependencies);`,
    '',
    '  return {',
    '    async list(request = {}) {',
    `      const ${names.pluralSnake} = await list${names.pluralPascal}(request.query ?? {});`,
    `      return { statusCode: 200, body: { ${names.pluralSnake} } };`,
    '    },',
    '    async getById(request = {}) {',
    `      const ${names.singularSnake} = await get${names.singularPascal}ById(request.params?.id);`,
    `      return ${names.singularSnake}`,
    `        ? { statusCode: 200, body: ${names.singularSnake} }`,
    "        : { statusCode: 404, body: { message: 'registro nao encontrado' } };",
    '    },',
    '    async create(request = {}) {',
    `      const ${names.singularSnake} = await create${names.singularPascal}(request.body ?? {});`,
    `      return { statusCode: 201, body: ${names.singularSnake} };`,
    '    },',
    '    async update(request = {}) {',
    `      const ${names.singularSnake} = await update${names.singularPascal}(request.params?.id, request.body ?? {});`,
    `      return ${names.singularSnake}`,
    `        ? { statusCode: 200, body: ${names.singularSnake} }`,
    "        : { statusCode: 404, body: { message: 'registro nao encontrado' } };",
    '    },',
    '    async remove(request = {}) {',
    `      const ${names.singularSnake} = await delete${names.singularPascal}(request.params?.id);`,
    `      return ${names.singularSnake}`,
    `        ? { statusCode: 200, body: ${names.singularSnake} }`,
    "        : { statusCode: 404, body: { message: 'registro nao encontrado' } };",
    '    },',
    '  };',
    '}',
  ].join('\n');
}
function buildOnionRoutesFile(blueprint, files) {
  const names = blueprint.names;
  const controllerImport = blueprintImportPath(files.routesFile, files.controllerFile);
  return [
    `import { build${names.singularPascal}Controller } from ${JSON.stringify(controllerImport)};`,
    '',
    jsDocBlock(
      `Cria a tabela de rotas HTTP para o CRUD de ${names.pluralSnake}.`,
      [{ name: 'dependencies', description: `Dependencias compartilhadas entre controller e casos de uso.` }],
      `Colecao de rotas HTTP pronta para adaptacao no servidor da aplicacao.`,
    ),
    `export function build${names.singularPascal}Routes(dependencies) {`,
    `  const ${names.singularCamel}Controller = build${names.singularPascal}Controller(dependencies);`,
    '  return [',
    `    { method: 'GET', path: '/${names.pluralSnake}', handler: ${names.singularCamel}Controller.list },`,
    `    { method: 'GET', path: '/${names.pluralSnake}/:id', handler: ${names.singularCamel}Controller.getById },`,
    `    { method: 'POST', path: '/${names.pluralSnake}', handler: ${names.singularCamel}Controller.create },`,
    `    { method: 'PUT', path: '/${names.pluralSnake}/:id', handler: ${names.singularCamel}Controller.update },`,
    `    { method: 'DELETE', path: '/${names.pluralSnake}/:id', handler: ${names.singularCamel}Controller.remove },`,
    '  ];',
    '}',
  ].join('\n');
}
function buildOnionFactoryFile(blueprint, files) {
  const names = blueprint.names;
  const repositoryImport = blueprintImportPath(files.factoryFile, files.inMemoryRepositoryFile);
  const routesImport = blueprintImportPath(files.factoryFile, files.routesFile);
  return [
    `import { buildInMemory${names.singularPascal}Repository } from ${JSON.stringify(repositoryImport)};`,
    `import { build${names.singularPascal}Routes } from ${JSON.stringify(routesImport)};`,
    '',
    jsDocBlock(
      `Compoe o BFF funcional de ${names.pluralSnake} usando Onion Architecture.`,
      [{ name: 'seed', description: `Colecao inicial opcional de ${names.pluralSnake}.` }],
      `Objeto de composicao com repositorio, dependencias e rotas de ${names.pluralSnake}.`,
    ),
    `export function build${names.singularPascal}CrudBff(seed = []) {`,
    `  const ${names.singularCamel}Repository = buildInMemory${names.singularPascal}Repository(seed);`,
    `  const dependencies = { ${names.singularCamel}Repository };`,
    `  const routes = build${names.singularPascal}Routes(dependencies);`,
    '  return {',
    `    ${names.singularCamel}Repository,`,
    '    dependencies,',
    '    routes,',
    '  };',
    '}',
  ].join('\n');
}
function inferTerminalTaskAction(file, instruction) {
  const normalizedInstruction = safeComment(instruction);
  const lowerInstruction = normalizedInstruction.toLowerCase();
  const projectRoot = resolveProjectRoot(file);
  const packageContext = readPackageContext(projectRoot);
  const explicitCommitMessage = extractCommitMessage(normalizedInstruction);

  if (/\b(?:git\s+)?status\b/.test(lowerInstruction)) {
    return buildTerminalAction(projectRoot, 'git status --short --branch', 'git status --short --branch');
  }
  if (/\b(?:git\s+)?diff\b/.test(lowerInstruction)) {
    return buildTerminalAction(projectRoot, 'git diff --stat', 'git diff --stat');
  }
  if (/\b(?:git\s+)?commit(?:ar|e|a|ar)?\b|\bcommite\b|\bcommit\b/.test(lowerInstruction)) {
    const commitMessage = explicitCommitMessage || defaultCommitMessage(file, normalizedInstruction);
    return buildTerminalAction(
      projectRoot,
      `git add -A && git commit -m ${shellQuote(commitMessage)}`,
      `git add -A && git commit -m ${commitMessage}`,
    );
  }
  if (/\b(?:instalar|instale|install)\b.*\b(?:dependencias|dependência|dependencias|deps|dependencies)\b/.test(lowerInstruction)) {
    const installCommand = inferProjectInstallCommand(projectRoot, packageContext);
    return installCommand ? buildTerminalAction(projectRoot, installCommand, installCommand) : null;
  }
  if (/\b(?:lint|lintar)\b/.test(lowerInstruction)) {
    const lintCommand = inferProjectLintCommand(file, projectRoot, packageContext);
    return lintCommand ? buildTerminalAction(projectRoot, lintCommand, lintCommand) : null;
  }
  if (/\b(?:format|formatar|fmt)\b/.test(lowerInstruction)) {
    const formatCommand = inferProjectFormatCommand(file, projectRoot, packageContext);
    return formatCommand ? buildTerminalAction(projectRoot, formatCommand, formatCommand) : null;
  }
  if (/\b(?:build|compilar|compile)\b/.test(lowerInstruction)) {
    const buildCommand = inferProjectBuildCommand(file, projectRoot, packageContext);
    return buildCommand ? buildTerminalAction(projectRoot, buildCommand, buildCommand) : null;
  }
  if (/\b(?:teste|testes|test|tests)\b/.test(lowerInstruction)) {
    const testCommand = inferProjectTestCommand(file, projectRoot, packageContext);
    return testCommand ? buildTerminalAction(projectRoot, testCommand, testCommand) : null;
  }
  if (/\b(?:rodar|rode|executar|execute|run|iniciar|subir)\b/.test(lowerInstruction)) {
    const runCommand = inferProjectRunCommand(file, projectRoot, packageContext, lowerInstruction);
    if (runCommand) {
      return buildTerminalAction(projectRoot, runCommand, runCommand);
    }
  }

  return null;
}
function buildTerminalAction(cwd, command, description) {
  return {
    cwd,
    command,
    description,
  };
}
function shellQuote(value) {
  return `'${String(value || '').replace(/'/g, `'\"'\"'`)}'`;
}
function defaultCommitMessage(file, instruction) {
  const base = path.basename(file || 'arquivo');
  const normalizedInstruction = safeComment(instruction);
  if (!normalizedInstruction) {
    return `chore: atualiza ${base}`;
  }
  return `chore: ${normalizedInstruction}`.slice(0, 120);
}
function extractCommitMessage(instruction) {
  const source = String(instruction || '').trim();
  if (!source) {
    return '';
  }

  const quotedMessage = source.match(/["']([^"']+)["']/);
  if (quotedMessage && quotedMessage[1]) {
    return safeComment(quotedMessage[1]);
  }

  const colonMessage = source.match(/\bcommit(?:ar|e|a|ar)?\b\s*:?\s*(.+)$/i);
  if (!colonMessage || !colonMessage[1]) {
    return '';
  }

  const normalized = safeComment(colonMessage[1]);
  if (!normalized || /^(do projeto|das mudancas|das mudanças|agora)$/i.test(normalized)) {
    return '';
  }
  return normalized;
}
function readPackageContext(projectRoot) {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  if (!pathExists(packageJsonPath)) {
    return null;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return {
      manager: detectPackageManager(projectRoot),
      scripts: packageJson && typeof packageJson.scripts === 'object' ? packageJson.scripts : {},
    };
  } catch (_error) {
    return {
      manager: detectPackageManager(projectRoot),
      scripts: {},
    };
  }
}
function detectPackageManager(projectRoot) {
  if (pathExists(path.join(projectRoot, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (pathExists(path.join(projectRoot, 'yarn.lock'))) {
    return 'yarn';
  }
  if (pathExists(path.join(projectRoot, 'bun.lockb')) || pathExists(path.join(projectRoot, 'bun.lock'))) {
    return 'bun';
  }
  return 'npm';
}
function packageScriptCommand(packageContext, scriptName) {
  if (!packageContext || !packageContext.scripts || !packageContext.scripts[scriptName]) {
    return '';
  }
  return `${packageContext.manager} run ${scriptName}`;
}
function inferProjectInstallCommand(projectRoot, packageContext) {
  if (packageContext) {
    return `${packageContext.manager} install`;
  }
  if (pathExists(path.join(projectRoot, 'mix.exs'))) {
    return 'mix deps.get';
  }
  if (pathExists(path.join(projectRoot, 'go.mod'))) {
    return 'go mod tidy';
  }
  if (pathExists(path.join(projectRoot, 'Cargo.toml'))) {
    return 'cargo fetch';
  }
  if (pathExists(path.join(projectRoot, 'requirements.txt'))) {
    return 'python -m pip install -r requirements.txt';
  }
  return '';
}
function inferProjectTestCommand(file, projectRoot, packageContext) {
  const ext = analysisExtension(file);
  if (['.ex', '.exs'].includes(ext) || pathExists(path.join(projectRoot, 'mix.exs'))) {
    return 'mix test';
  }
  const packageCommand = packageScriptCommand(packageContext, 'test');
  if (packageCommand) {
    return packageCommand;
  }
  if (isGoExtension(ext) || pathExists(path.join(projectRoot, 'go.mod'))) {
    return 'go test ./...';
  }
  if (isRustExtension(ext) || pathExists(path.join(projectRoot, 'Cargo.toml'))) {
    return 'cargo test';
  }
  if (isPythonLikeExtension(ext) || pathExists(path.join(projectRoot, 'pyproject.toml')) || pathExists(path.join(projectRoot, 'requirements.txt'))) {
    return 'python -m pytest';
  }
  if (ext === '.vim') {
    return `nvim --headless -u NONE -S ${shellQuote(file)}`;
  }
  if (ext === '.lua') {
    return `lua ${shellQuote(file)}`;
  }
  return '';
}
function inferProjectBuildCommand(file, projectRoot, packageContext) {
  const packageCommand = packageScriptCommand(packageContext, 'build');
  if (packageCommand) {
    return packageCommand;
  }

  const ext = analysisExtension(file);
  if (['.ex', '.exs'].includes(ext) || pathExists(path.join(projectRoot, 'mix.exs'))) {
    return 'mix compile';
  }
  if (isGoExtension(ext) || pathExists(path.join(projectRoot, 'go.mod'))) {
    return 'go build ./...';
  }
  if (isRustExtension(ext) || pathExists(path.join(projectRoot, 'Cargo.toml'))) {
    return 'cargo build';
  }
  return '';
}
function inferProjectLintCommand(file, projectRoot, packageContext) {
  const packageCommand = packageScriptCommand(packageContext, 'lint');
  if (packageCommand) {
    return packageCommand;
  }

  const ext = analysisExtension(file);
  if (isRustExtension(ext) || pathExists(path.join(projectRoot, 'Cargo.toml'))) {
    return 'cargo clippy';
  }
  if (isPythonLikeExtension(ext)) {
    return `python -m py_compile ${shellQuote(file)}`;
  }
  return '';
}
function inferProjectFormatCommand(file, projectRoot, packageContext) {
  const packageCommand = packageScriptCommand(packageContext, 'format');
  if (packageCommand) {
    return packageCommand;
  }

  const ext = analysisExtension(file);
  if (['.ex', '.exs'].includes(ext) || pathExists(path.join(projectRoot, 'mix.exs'))) {
    return 'mix format';
  }
  if (isRustExtension(ext) || pathExists(path.join(projectRoot, 'Cargo.toml'))) {
    return 'cargo fmt';
  }
  if (isGoExtension(ext)) {
    return `gofmt -w ${shellQuote(file)}`;
  }
  return '';
}
function inferProjectRunCommand(file, projectRoot, packageContext, lowerInstruction) {
  if (/\b(?:app|aplicacao|aplicação|projeto|dev|servidor|server)\b/.test(lowerInstruction)) {
    const packageDev = packageScriptCommand(packageContext, 'dev');
    if (packageDev) {
      return packageDev;
    }
    const packageStart = packageScriptCommand(packageContext, 'start');
    if (packageStart) {
      return packageStart;
    }
    if (pathExists(path.join(projectRoot, 'mix.exs'))) {
      return 'mix run';
    }
    if (pathExists(path.join(projectRoot, 'Cargo.toml'))) {
      return 'cargo run';
    }
  }

  const ext = analysisExtension(file);
  if (['.js', '.cjs', '.mjs'].includes(ext)) {
    return `node ${shellQuote(file)}`;
  }
  if (isPythonLikeExtension(ext)) {
    return `python ${shellQuote(file)}`;
  }
  if (ext === '.lua') {
    return `lua ${shellQuote(file)}`;
  }
  if (ext === '.sh') {
    return `bash ${shellQuote(file)}`;
  }
  if (isGoExtension(ext)) {
    return `go run ${shellQuote(file)}`;
  }
  if (ext === '.exs') {
    return `elixir ${shellQuote(file)}`;
  }
  if (ext === '.vim') {
    return `nvim --headless -u NONE -S ${shellQuote(file)}`;
  }
  return '';
}
function synthesizeFromCommentTask(instruction, ext, lines = [], sourceFile = '') {
  const normalizedExt = analysisExtension(ext);
  if (normalizedExt === '.md') {
    return generateMarkdownSnippet(instruction);
  }
  const blueprintSnippet = generateBlueprintAwareSnippet(instruction, ext, sourceFile);
  if (blueprintSnippet) {
    return blueprintSnippet;
  }

  const activeBlueprint = loadActiveBlueprintContext(sourceFile);
  const effectiveInstruction = activeBlueprint && /\bcrud\b/i.test(instruction) && !new RegExp(`\\b${escapeRegExp(activeBlueprint.entity)}\\b`, 'i').test(instruction)
    ? `${instruction} ${activeBlueprint.entity}`
    : instruction;
  const structuredConfigSnippet = generateStructuredConfigSnippet(effectiveInstruction, ext);
  if (structuredConfigSnippet) {
    return finalizeGeneratedTaskResult(structuredConfigSnippet, ext, lines, sourceFile);
  }
  const down = effectiveInstruction.toLowerCase();
  const classified = classifyCommentTask(down);
  if (classified === 'example') {
    const generated = generateExampleSnippet(effectiveInstruction, ext);
    return finalizeGeneratedTaskResult(generated, ext, lines, sourceFile);
  }
  if (classified === 'crud') {
    const generated = generateCrudSnippet(effectiveInstruction, ext);
    return finalizeGeneratedTaskResult(generated, ext, lines, sourceFile);
  }
  if (classified === 'ui') {
    const generated = generateUiSnippet(effectiveInstruction, ext, lines);
    return finalizeGeneratedTaskResult(generated, ext, lines, sourceFile);
  }
  if (classified === 'structure') {
    const generated = generateStructureSnippet(effectiveInstruction, ext);
    return finalizeGeneratedTaskResult(generated, ext, lines, sourceFile);
  }
  if (classified === 'function') {
    const generated = generateFunctionSnippet(effectiveInstruction, ext, lines, sourceFile);
    return finalizeGeneratedTaskResult(generated, ext, lines, sourceFile);
  }
  if (classified === 'comment') {
    const generated = generateCommentSnippet(effectiveInstruction, ext);
    return finalizeGeneratedTaskResult(generated, ext, lines, sourceFile);
  }
  if (classified === 'test') {
    const generated = generateTestSnippet(effectiveInstruction, ext);
    return finalizeGeneratedTaskResult(generated, ext, lines, sourceFile);
  }
  const generated = generateGenericSnippet(effectiveInstruction, ext);
  return finalizeGeneratedTaskResult(generated, ext, lines, sourceFile);
}
function buildSnippetDependencyIssues(lines, file, lineNumber, snippet, instruction, ext, hintedDependencies = []) {
  const dependencies = inferSnippetDependencies(snippet, instruction, ext, lines, hintedDependencies);
  return buildMissingDependencyIssues(lines, file, dependencies, lineNumber);
}
function checkCommentTask(lines, file) {
  const ext = analysisExtension(file);
  const pattern = commentTaskPattern(ext);
  const issues = [];

  lines.forEach((line, idx) => {
    const match = line.match(pattern);
    if (!match) {
      return;
    }

    const marker = match[1];
    const instruction = normalizeCommentInstruction(match[2]);
    if (!isActionableCommentTask(instruction)) {
      return;
    }

    if (marker === '*') {
      const terminalTask = buildTerminalTask(lines, file, idx + 1, instruction);
      if (terminalTask) {
        issues.push(terminalTask);
      }
      return;
    }
    if (marker === '**') {
      issues.push(...buildContextBlueprintTasks(lines, file, idx + 1, instruction));
      return;
    }

    const generatedTask = normalizeGeneratedTaskResult(
      synthesizeFromCommentTask(instruction, ext, lines, file),
      ext,
    );
    if (!generatedTask.snippet) {
      return;
    }
    if (commentTaskAlreadyApplied(lines, idx, generatedTask.snippet, ext)) {
      return;
    }

    issues.push({
      file,
      line: idx + 1,
      severity: 'info',
      kind: 'comment_task',
      message: 'Tarefa solicitada no comentario',
      suggestion: `Implementacao sugerida para: ${instruction}`,
      snippet: generatedTask.snippet,
    });

    issues.push(
      ...buildSnippetDependencyIssues(
        lines,
        file,
        idx + 1,
        generatedTask.snippet,
        instruction,
        ext,
        generatedTask.dependencies,
      ),
    );
  });

  return issues;
}
function checkMissingDependencies(lines, file) {
  const dependencies = inferReferencedDependencies(lines, file);
  return buildMissingDependencyIssues(lines, file, dependencies, 1);
}
function buildMissingDependencyIssues(lines, file, dependencies, fallbackLine) {
  const issues = [];
  for (const dependency of uniqueDependencySpecs(dependencies)) {
    if (dependencyAlreadyPresent(lines, dependency)) {
      continue;
    }

    const insertion = findDependencyInsertion(lines, dependency, fallbackLine);
    if (!insertion) {
      continue;
    }

    issues.push({
      file,
      line: insertion.line,
      severity: 'info',
      kind: 'missing_dependency',
      message: dependencyMessage(dependency),
      suggestion: dependencySuggestion(dependency),
      snippet: dependencySnippet(dependency),
      action: {
        op: insertion.op,
        dedupeLookahead: 8,
        dedupeLookbehind: 8,
        indent: dependency.language === 'elixir' ? '  ' : '',
      },
    });
  }
  return issues;
}
function uniqueDependencySpecs(dependencies) {
  const deduped = [];
  const seen = new Set();
  for (const dependency of Array.isArray(dependencies) ? dependencies : []) {
    const key = dependencySpecKey(dependency);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(dependency);
  }
  return deduped;
}
function dependencySpecKey(dependency) {
  if (!dependency || typeof dependency !== 'object') {
    return '';
  }
  return [
    dependency.language || '',
    dependency.importKind || '',
    dependency.symbol || '',
    dependency.source || '',
    dependency.moduleName || '',
    dependency.alias || '',
    dependency.style || '',
  ].join('|');
}
function inferSnippetDependencies(snippet, instruction, ext, lines, hintedDependencies = []) {
  const dependencies = [...hintedDependencies];
  const lowerExt = ext.toLowerCase();
  const text = String(snippet || '');
  const lowerInstruction = String(instruction || '').toLowerCase();

  if (['.ex', '.exs'].includes(lowerExt) && /\bLogger\.(debug|info|notice|warning|error|critical|alert|emergency)\b/.test(text)) {
    dependencies.push(elixirRequireSpec('Logger'));
  }

  if (isJavaScriptLikeExtension(lowerExt)) {
    const style = inferModuleStyle(lowerExt, lines);
    if (/\buseState\s*\(/.test(text)) {
      dependencies.push(jsDependencySpec('named', 'useState', 'react', style));
    }
    const isPrisma = /\bPrismaClient\b/.test(text) || /\bprisma\b/.test(lowerInstruction);
    const isMongo = /\bnew\s+MongoClient\s*\(/.test(text) || /\bmongo\b|\bmongodb\b/.test(lowerInstruction);
    const isMysql = /\bmysql\.createConnection\b/.test(text) || /\bmysql\b/.test(lowerInstruction);
    const isPostgresLike = /\bnew\s+Pool\s*\(/.test(text) || (!isPrisma && !isMongo && !isMysql && /\bpostgres\b|\bpostgresql\b|\bdatabase\b|\bbanco\b|\bdb\b/.test(lowerInstruction));

    if (isPrisma) {
      dependencies.push(jsDependencySpec('named', 'PrismaClient', '@prisma/client', style));
    }
    if (isPostgresLike) {
      dependencies.push(jsDependencySpec('named', 'Pool', 'pg', style));
    }
    if (isMongo) {
      dependencies.push(jsDependencySpec('named', 'MongoClient', 'mongodb', style));
    }
    if (/\bmongoose\.(connect|createConnection)\b/.test(text)) {
      dependencies.push(jsDependencySpec('default', 'mongoose', 'mongoose', style));
    }
    if (isMysql) {
      dependencies.push(jsDependencySpec('default', 'mysql', 'mysql2/promise', style));
    }
  }

  if (isPythonLikeExtension(lowerExt)) {
    if (/\brandom\.randint\s*\(/.test(text)) {
      dependencies.push(pythonDependencySpec('import', 'random'));
    }
    if (/\bos\.environ\b/.test(text) || /\bos\./.test(text)) {
      dependencies.push(pythonDependencySpec('import', 'os'));
    }
    if (/\bpsycopg\.connect\s*\(/.test(text)) {
      dependencies.push(pythonDependencySpec('import', 'psycopg'));
    }
    if (/\bMongoClient\s*\(/.test(text)) {
      dependencies.push(pythonDependencySpec('from', 'pymongo', 'MongoClient'));
    }
    if (/\bcreate_engine\s*\(/.test(text)) {
      dependencies.push(pythonDependencySpec('from', 'sqlalchemy', 'create_engine'));
    }
    if (/\bmysql\.connector\.connect\s*\(/.test(text)) {
      dependencies.push(pythonDependencySpec('import', 'mysql.connector'));
    }
  }

  if (isGoExtension(lowerExt)) {
    if (/\brand\.Intn\s*\(/.test(text)) {
      dependencies.push(goDependencySpec('math/rand'));
    }
    if (/\berrors\.New\s*\(/.test(text)) {
      dependencies.push(goDependencySpec('errors'));
    }
    if (/\bsql\.Open\s*\(/.test(text)) {
      dependencies.push(goDependencySpec('database/sql'));
    }
    if (/\bsql\.Open\(\s*"postgres"/.test(text)) {
      dependencies.push(goDependencySpec('github.com/lib/pq', '_'));
    }
    if (/\bsql\.Open\(\s*"mysql"/.test(text)) {
      dependencies.push(goDependencySpec('github.com/go-sql-driver/mysql', '_'));
    }
    if (/\bos\.Getenv\s*\(/.test(text)) {
      dependencies.push(goDependencySpec('os'));
    }
    if (/\bcontext\.(Background|TODO)\s*\(/.test(text) || /\bcontext\.Context\b/.test(text)) {
      dependencies.push(goDependencySpec('context'));
    }
    if (/\bmongo\.Connect\s*\(/.test(text)) {
      dependencies.push(goDependencySpec('go.mongodb.org/mongo-driver/mongo'));
    }
    if (/\boptions\.Client\s*\(/.test(text)) {
      dependencies.push(goDependencySpec('go.mongodb.org/mongo-driver/mongo/options'));
    }
  }

  if (isRustExtension(lowerExt)) {
    if (/\bPgPoolOptions::new\s*\(/.test(text)) {
      dependencies.push(rustDependencySpec('sqlx::postgres::PgPoolOptions'));
    }
    if (/\bPgPool\b/.test(text) && !/\bsqlx::PgPool\b/.test(text)) {
      dependencies.push(rustDependencySpec('sqlx::PgPool'));
    }
    if (/\bMySqlPoolOptions::new\s*\(/.test(text)) {
      dependencies.push(rustDependencySpec('sqlx::mysql::MySqlPoolOptions'));
    }
    if (/\bMySqlPool\b/.test(text) && !/\bsqlx::MySqlPool\b/.test(text)) {
      dependencies.push(rustDependencySpec('sqlx::MySqlPool'));
    }
    if (/\bClient::with_uri_str\s*\(/.test(text)) {
      dependencies.push(rustDependencySpec('mongodb::Client'));
    }
  }

  return uniqueDependencySpecs(dependencies);
}
function inferReferencedDependencies(lines, file) {
  const ext = path.extname(file).toLowerCase();
  const text = lines.join('\n');
  const dependencies = [];

  if (['.ex', '.exs'].includes(ext) && /\bLogger\.(debug|info|notice|warning|error|critical|alert|emergency)\b/.test(text)) {
    dependencies.push(elixirRequireSpec('Logger'));
  }

  if (isJavaScriptLikeExtension(ext)) {
    const style = inferModuleStyle(ext, lines);
    if (/\bPrismaClient\b/.test(text)) {
      dependencies.push(jsDependencySpec('named', 'PrismaClient', '@prisma/client', style));
    }
    if (/\bnew\s+Pool\s*\(/.test(text)) {
      dependencies.push(jsDependencySpec('named', 'Pool', 'pg', style));
    }
    if (/\bnew\s+MongoClient\s*\(/.test(text)) {
      dependencies.push(jsDependencySpec('named', 'MongoClient', 'mongodb', style));
    }
    if (/\bmongoose\.(connect|createConnection)\b/.test(text)) {
      dependencies.push(jsDependencySpec('default', 'mongoose', 'mongoose', style));
    }
    if (/\bmysql\.createConnection\b/.test(text)) {
      dependencies.push(jsDependencySpec('default', 'mysql', 'mysql2/promise', style));
    }
  }

  if (isPythonLikeExtension(ext)) {
    if (/\brandom\.randint\s*\(/.test(text)) {
      dependencies.push(pythonDependencySpec('import', 'random'));
    }
    if (/\bos\.environ\b/.test(text) || /\bos\./.test(text)) {
      dependencies.push(pythonDependencySpec('import', 'os'));
    }
    if (/\bpsycopg\.connect\s*\(/.test(text)) {
      dependencies.push(pythonDependencySpec('import', 'psycopg'));
    }
    if (/\bMongoClient\s*\(/.test(text)) {
      dependencies.push(pythonDependencySpec('from', 'pymongo', 'MongoClient'));
    }
    if (/\bcreate_engine\s*\(/.test(text)) {
      dependencies.push(pythonDependencySpec('from', 'sqlalchemy', 'create_engine'));
    }
    if (/\bmysql\.connector\.connect\s*\(/.test(text)) {
      dependencies.push(pythonDependencySpec('import', 'mysql.connector'));
    }
  }

  if (isGoExtension(ext)) {
    if (/\brand\.Intn\s*\(/.test(text)) {
      dependencies.push(goDependencySpec('math/rand'));
    }
    if (/\berrors\.New\s*\(/.test(text)) {
      dependencies.push(goDependencySpec('errors'));
    }
    if (/\bsql\.Open\s*\(/.test(text)) {
      dependencies.push(goDependencySpec('database/sql'));
    }
    if (/\bsql\.Open\(\s*"postgres"/.test(text)) {
      dependencies.push(goDependencySpec('github.com/lib/pq', '_'));
    }
    if (/\bsql\.Open\(\s*"mysql"/.test(text)) {
      dependencies.push(goDependencySpec('github.com/go-sql-driver/mysql', '_'));
    }
    if (/\bos\.Getenv\s*\(/.test(text)) {
      dependencies.push(goDependencySpec('os'));
    }
    if (/\bcontext\.(Background|TODO)\s*\(/.test(text) || /\bcontext\.Context\b/.test(text)) {
      dependencies.push(goDependencySpec('context'));
    }
    if (/\bmongo\.Connect\s*\(/.test(text)) {
      dependencies.push(goDependencySpec('go.mongodb.org/mongo-driver/mongo'));
    }
    if (/\boptions\.Client\s*\(/.test(text)) {
      dependencies.push(goDependencySpec('go.mongodb.org/mongo-driver/mongo/options'));
    }
  }

  if (isRustExtension(ext)) {
    if (/\bPgPoolOptions::new\s*\(/.test(text)) {
      dependencies.push(rustDependencySpec('sqlx::postgres::PgPoolOptions'));
    }
    if (/\bPgPool\b/.test(text) && !/\bsqlx::PgPool\b/.test(text)) {
      dependencies.push(rustDependencySpec('sqlx::PgPool'));
    }
    if (/\bMySqlPoolOptions::new\s*\(/.test(text)) {
      dependencies.push(rustDependencySpec('sqlx::mysql::MySqlPoolOptions'));
    }
    if (/\bMySqlPool\b/.test(text) && !/\bsqlx::MySqlPool\b/.test(text)) {
      dependencies.push(rustDependencySpec('sqlx::MySqlPool'));
    }
    if (/\bClient::with_uri_str\s*\(/.test(text)) {
      dependencies.push(rustDependencySpec('mongodb::Client'));
    }
  }

  return uniqueDependencySpecs(dependencies);
}
function jsDependencySpec(importKind, symbol, source, style) {
  return {
    language: 'javascript',
    importKind,
    symbol,
    source,
    style,
  };
}
function pythonDependencySpec(importKind, moduleName, symbol = '') {
  return {
    language: 'python',
    importKind,
    moduleName,
    symbol,
  };
}
function goDependencySpec(source, alias = '') {
  return {
    language: 'go',
    importKind: 'import',
    source,
    alias,
  };
}
function rustDependencySpec(source) {
  return {
    language: 'rust',
    importKind: 'use',
    source,
    symbol: String(source).split('::').pop(),
  };
}
function elixirRequireSpec(moduleName) {
  return {
    language: 'elixir',
    importKind: 'require',
    moduleName,
  };
}
function isJavaScriptLikeExtension(ext) {
  return resolveJavaScriptLikeExtension(ext);
}
function isReactLikeExtension(ext) {
  return resolveReactLikeExtension(ext);
}
function isPythonLikeExtension(ext) {
  return resolvePythonLikeExtension(ext);
}
function isRubyExtension(ext) {
  return resolveRubyExtension(ext);
}
function isGoExtension(ext) {
  return resolveGoExtension(ext);
}
function isRustExtension(ext) {
  return resolveRustExtension(ext);
}
function inferModuleStyle(ext, lines = []) {
  const lowerExt = String(ext || '').toLowerCase();
  if (['.ts', '.tsx', '.mjs'].includes(lowerExt)) {
    return 'esm';
  }
  if (lowerExt === '.cjs') {
    return 'cjs';
  }

  const text = Array.isArray(lines) ? lines.join('\n') : '';
  if (/^\s*import\b/m.test(text) || /^\s*export\b/m.test(text)) {
    return 'esm';
  }
  if (/require\(['"][^'"]+['"]\)/.test(text) || /module\.exports\b/.test(text)) {
    return 'cjs';
  }
  return 'esm';
}
function dependencyAlreadyPresent(lines, dependency) {
  const text = lines.join('\n');
  if (dependency.language === 'elixir') {
    return new RegExp(`^\\s*require\\s+${escapeRegExp(dependency.moduleName)}\\b`, 'm').test(text);
  }

  if (dependency.language === 'javascript') {
    const sourcePattern = escapeRegExp(dependency.source);
    if (dependency.importKind === 'default') {
      return new RegExp(`^\\s*import\\s+${escapeRegExp(dependency.symbol)}\\s+from\\s+['"]${sourcePattern}['"]`, 'm').test(text)
        || new RegExp(`^\\s*const\\s+${escapeRegExp(dependency.symbol)}\\s*=\\s*require\\(['"]${sourcePattern}['"]\\)`, 'm').test(text);
    }

    return new RegExp(`^\\s*import\\s*\\{[^}]*\\b${escapeRegExp(dependency.symbol)}\\b[^}]*\\}\\s*from\\s*['"]${sourcePattern}['"]`, 'm').test(text)
      || new RegExp(`^\\s*const\\s*\\{[^}]*\\b${escapeRegExp(dependency.symbol)}\\b[^}]*\\}\\s*=\\s*require\\(['"]${sourcePattern}['"]\\)`, 'm').test(text);
  }

  if (dependency.language === 'python') {
    if (dependency.importKind === 'from') {
      return new RegExp(`^\\s*from\\s+${escapeRegExp(dependency.moduleName)}\\s+import\\s+.*\\b${escapeRegExp(dependency.symbol)}\\b`, 'm').test(text);
    }
    return new RegExp(`^\\s*import\\s+${escapeRegExp(dependency.moduleName)}\\b`, 'm').test(text);
  }

  if (dependency.language === 'go') {
    const sourcePattern = escapeRegExp(dependency.source);
    if (dependency.alias === '_') {
      return new RegExp(`^\\s*(?:import\\s+)?_\\s+"${sourcePattern}"`, 'm').test(text);
    }
    return new RegExp(`^\\s*(?:import\\s+)?(?:[A-Za-z_][A-Za-z0-9_]*\\s+)?\"${sourcePattern}\"`, 'm').test(text);
  }

  if (dependency.language === 'rust') {
    const pathPattern = escapeRegExp(dependency.source);
    return new RegExp(`^\\s*use\\s+${pathPattern}\\s*;`, 'm').test(text)
      || new RegExp(`^\\s*use\\s+.*\\b${escapeRegExp(dependency.symbol)}\\b.*;`, 'm').test(text);
  }

  return false;
}
function findDependencyInsertion(lines, dependency, fallbackLine) {
  if (dependency.language === 'elixir') {
    return findElixirDependencyInsertion(lines, fallbackLine);
  }
  if (dependency.language === 'javascript') {
    return findJavaScriptDependencyInsertion(lines, fallbackLine);
  }
  if (dependency.language === 'python') {
    return findPythonDependencyInsertion(lines, fallbackLine);
  }
  if (dependency.language === 'go') {
    return findGoDependencyInsertion(lines, fallbackLine);
  }
  if (dependency.language === 'rust') {
    return findRustDependencyInsertion(lines, fallbackLine);
  }
  return fallbackLine > 1 ? { line: fallbackLine, op: 'insert_before' } : { line: 1, op: 'insert_before' };
}
function findJavaScriptDependencyInsertion(lines, fallbackLine) {
  let lastHeaderLine = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = String(lines[index] || '');
    const trimmed = line.trim();
    if (index === 0 && trimmed.startsWith('#!')) {
      lastHeaderLine = 1;
      continue;
    }
    if (/^\s*\/\/\s*:/.test(line)) {
      break;
    }
    if (
      trimmed === ''
      || trimmed.startsWith('//')
      || trimmed.startsWith('/*')
      || trimmed.startsWith('*')
      || trimmed.startsWith('*/')
      || /^\s*import\b/.test(line)
      || /^\s*(?:const|let|var)\s+.+=\s*require\(['"][^'"]+['"]\)/.test(line)
    ) {
      if (trimmed !== '') {
        lastHeaderLine = index + 1;
      }
      continue;
    }
    break;
  }

  if (lastHeaderLine > 0) {
    return { line: lastHeaderLine, op: 'insert_after' };
  }
  return { line: 1, op: 'insert_before' };
}
function findElixirDependencyInsertion(lines, fallbackLine) {
  const moduleLine = lines.findIndex((line) => /^\s*defmodule\s+/.test(line));
  if (moduleLine < 0) {
    return fallbackLine > 1 ? { line: fallbackLine, op: 'insert_before' } : { line: 1, op: 'insert_before' };
  }

  let insertionLine = moduleLine + 1;
  for (let index = moduleLine + 1; index < lines.length; index += 1) {
    const line = String(lines[index] || '');
    const trimmed = line.trim();

    if (trimmed === '') {
      insertionLine = index + 1;
      continue;
    }

    if (trimmed.startsWith('@moduledoc')) {
      insertionLine = index + 1;
      if (trimmed.includes('"""')) {
        let quoteCount = (trimmed.match(/"""/g) || []).length;
        let cursor = index + 1;
        while (quoteCount < 2 && cursor < lines.length) {
          quoteCount += (String(lines[cursor] || '').match(/"""/g) || []).length;
          insertionLine = cursor + 1;
          cursor += 1;
        }
        index = cursor - 1;
      }
      continue;
    }

    if (/^\s*(?:alias|import|use|require)\b/.test(line)) {
      insertionLine = index + 1;
      continue;
    }

    break;
  }

  return { line: insertionLine, op: 'insert_after' };
}
function findPythonDependencyInsertion(lines, fallbackLine) {
  let index = 0;
  if (String(lines[0] || '').startsWith('#!')) {
    index = 1;
  }
  if (/^#.*coding[:=]/.test(String(lines[index] || ''))) {
    index += 1;
  }

  if (/^\s*(?:"""|''')/.test(String(lines[index] || ''))) {
    const delimiter = String(lines[index]).includes('"""') ? '"""' : "'''";
    let quoteCount = (String(lines[index] || '').match(new RegExp(escapeRegExp(delimiter), 'g')) || []).length;
    index += 1;
    while (quoteCount < 2 && index < lines.length) {
      quoteCount += (String(lines[index] || '').match(new RegExp(escapeRegExp(delimiter), 'g')) || []).length;
      index += 1;
    }
  }

  let lastImportLine = 0;
  for (let cursor = index; cursor < lines.length; cursor += 1) {
    const line = String(lines[cursor] || '');
    const trimmed = line.trim();
    if (!trimmed) {
      if (lastImportLine > 0) {
        break;
      }
      continue;
    }
    if (/^\s*#\s*:/.test(line)) {
      break;
    }
    if (/^\s*#/.test(line) && lastImportLine === 0) {
      index = cursor + 1;
      continue;
    }
    if (/^\s*(?:from|import)\b/.test(line)) {
      lastImportLine = cursor + 1;
      continue;
    }
    break;
  }

  if (lastImportLine > 0) {
    return { line: lastImportLine, op: 'insert_after' };
  }
  if (index > 0) {
    return { line: index, op: 'insert_after' };
  }
  return { line: 1, op: 'insert_before' };
}
function findGoDependencyInsertion(lines, fallbackLine) {
  const packageLine = lines.findIndex((line) => /^\s*package\s+/.test(line));
  if (packageLine < 0) {
    return fallbackLine > 1 ? { line: fallbackLine, op: 'insert_before' } : { line: 1, op: 'insert_before' };
  }

  let lastImportLine = 0;
  for (let index = packageLine + 1; index < lines.length; index += 1) {
    const line = String(lines[index] || '');
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (/^\s*import\s*\($/.test(line)) {
      let cursor = index + 1;
      while (cursor < lines.length && !/^\s*\)/.test(String(lines[cursor] || ''))) {
        cursor += 1;
      }
      return { line: cursor + 1, op: 'insert_after' };
    }
    if (/^\s*import\b/.test(line)) {
      lastImportLine = index + 1;
      continue;
    }
    break;
  }

  if (lastImportLine > 0) {
    return { line: lastImportLine, op: 'insert_after' };
  }
  return { line: packageLine + 1, op: 'insert_after' };
}
function findRustDependencyInsertion(lines, fallbackLine) {
  let lastUseLine = 0;
  let headerLine = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = String(lines[index] || '');
    const trimmed = line.trim();
    if (!trimmed) {
      if (lastUseLine > 0) {
        break;
      }
      continue;
    }
    if (/^\s*#!\[/.test(line) || /^\s*\/\/[!/]/.test(line) || /^\s*\/\*/.test(line) || /^\s*\*/.test(line)) {
      headerLine = index + 1;
      continue;
    }
    if (/^\s*use\s+/.test(line)) {
      lastUseLine = index + 1;
      continue;
    }
    break;
  }

  if (lastUseLine > 0) {
    return { line: lastUseLine, op: 'insert_after' };
  }
  if (headerLine > 0) {
    return { line: headerLine, op: 'insert_after' };
  }
  return { line: 1, op: 'insert_before' };
}
function dependencyMessage(dependency) {
  if (dependency.language === 'elixir') {
    return `Dependencia '${dependency.moduleName}' sem require`;
  }
  if (dependency.language === 'python') {
    return `Dependencia '${dependency.symbol || dependency.moduleName}' sem import`;
  }
  if (dependency.language === 'go') {
    return `Pacote '${dependency.source}' sem import`;
  }
  if (dependency.language === 'rust') {
    return `Dependencia '${dependency.source}' sem use`;
  }
  return `Dependencia '${dependency.symbol}' sem import`;
}
function dependencySuggestion(dependency) {
  if (dependency.language === 'elixir') {
    return `Adicione require ${dependency.moduleName} para usar o modulo sem erro de compilacao.`;
  }
  if (dependency.language === 'python') {
    if (dependency.importKind === 'from') {
      return `Adicione from ${dependency.moduleName} import ${dependency.symbol} para manter o arquivo executavel.`;
    }
    return `Adicione import ${dependency.moduleName} para manter o arquivo executavel.`;
  }
  if (dependency.language === 'go') {
    return `Adicione import de '${dependency.source}' para compilar o trecho gerado sem erro.`;
  }
  if (dependency.language === 'rust') {
    return `Adicione use ${dependency.source}; para compilar o trecho gerado sem erro.`;
  }
  return `Adicione import de ${dependency.symbol} a partir de '${dependency.source}' para manter o arquivo executavel.`;
}
function dependencySnippet(dependency) {
  if (dependency.language === 'elixir') {
    return `  require ${dependency.moduleName}`;
  }

  if (dependency.language === 'python') {
    if (dependency.importKind === 'from') {
      return `from ${dependency.moduleName} import ${dependency.symbol}`;
    }
    return `import ${dependency.moduleName}`;
  }

  if (dependency.importKind === 'default') {
    if (dependency.style === 'cjs') {
      return `const ${dependency.symbol} = require('${dependency.source}');`;
    }
    return `import ${dependency.symbol} from '${dependency.source}';`;
  }

  if (dependency.style === 'cjs') {
    return `const { ${dependency.symbol} } = require('${dependency.source}');`;
  }
  if (dependency.language === 'javascript') {
    return `import { ${dependency.symbol} } from '${dependency.source}';`;
  }

  if (dependency.language === 'go') {
    if (dependency.alias) {
      return `import ${dependency.alias} "${dependency.source}"`;
    }
    return `import "${dependency.source}"`;
  }

  if (dependency.language === 'rust') {
    return `use ${dependency.source};`;
  }

  return `import { ${dependency.symbol} } from '${dependency.source}';`;
}
function classifyCommentTask(instruction) {
  if (/\b(teste|testa|testando|assert|it )/i.test(instruction)) {
    return 'test';
  }
  if (/\bsolid\b/i.test(instruction)) {
    return 'example';
  }
  if (/\bcrud\b/i.test(instruction)) {
    return 'crud';
  }
  if (/\b(tela|pagina|página|screen|page|login|formulario|formulário|form|componente|component|modal|dashboard)\b/i.test(instruction)) {
    return 'ui';
  }
  if (/\b(variavel|variável|constante|lista|array|vetor|colecao|coleção|objeto|mapa|dicionario|dicionário)\b/i.test(instruction)) {
    return 'structure';
  }
  if (/\b(corrige|corrigir|corrigindo|ajusta|ajustar|substitui|substituir|altera|alterar|troca|trocar|remove|remover|troque|corrija)\b/i.test(instruction)) {
    return 'generic';
  }
  if (/\b(funcao|função|function|metodo|método)\b/i.test(instruction)) {
    return 'function';
  }
  if (/\b(implementa|implementar|implementacao|implemente|cria|criar|crie|criem|faca|faça|adiciona|adicionar|monta|montar|gera|gerar|escreve|escrever|esqueleto|faz|fazer)\b/i.test(instruction)) {
    return 'function';
  }
  if (/\b(comentario|comment|doc|docstring)\b/i.test(instruction)) {
    return 'comment';
  }
  return 'generic';
}
function generateFunctionSnippet(instruction, ext, lines = [], sourceFile = '') {
  const databaseFunction = generateDatabaseFunctionSnippet(instruction, ext, lines);
  if (databaseFunction) {
    const databaseName = extractGeneratedFunctionName(databaseFunction.snippet, ext);
    return decorateGeneratedSnippet(databaseFunction, databaseName, [], instruction, ext, { lines, sourceFile });
  }

  const [name, params] = parseFunctionRequest(instruction);
  const [signature, closer] = functionSignature(name, params, instruction, ext);
  const body = functionBodyHint(instruction, params, ext);
  const bodyIndent = functionBodyIndent(ext);
  const functionLines = [`${signature}`];
  const inlineDocBlock = buildInlineFunctionDocumentation(name, params, instruction, ext);
  if (inlineDocBlock) {
    functionLines.push(...inlineDocBlock.split('\n'));
  }
  functionLines.push(`${bodyIndent}${body}`);
  if (closer === 'none') {
    return decorateGeneratedSnippet(functionLines.join('\n'), name, params, instruction, ext, { lines, sourceFile });
  }
  functionLines.push(closer);
  return decorateGeneratedSnippet(functionLines.join('\n'), name, params, instruction, ext, { lines, sourceFile });
}
function decorateGeneratedSnippet(result, name, params, instruction, ext, options = {}) {
  const normalized = normalizeGeneratedTaskResult(result, ext);
  let decoratedSnippet = addLeadingFunctionDocumentation(normalized.snippet, name, params, instruction, ext);
  decoratedSnippet = wrapElixirSnippetInModuleIfNeeded(
    decoratedSnippet,
    ext,
    Array.isArray(options.lines) ? options.lines : [],
    options.sourceFile || '',
    name,
  );
  return {
    ...normalized,
    snippet: decoratedSnippet,
  };
}
function addLeadingFunctionDocumentation(snippet, name, params, instruction, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  if (!shouldAddLeadingFunctionDocumentation(snippet, lowerExt)) {
    return snippet;
  }

  const functionName = name || extractGeneratedFunctionName(snippet, ext);
  const documentation = buildLeadingFunctionDocumentation(functionName, params, instruction, ext);
  if (!documentation) {
    return snippet;
  }
  return `${documentation}\n${snippet}`;
}
function shouldAddLeadingFunctionDocumentation(snippet, ext) {
  const generatedName = extractGeneratedFunctionName(snippet, ext);
  if (!snippet || !generatedName) {
    return false;
  }
  if (isPythonLikeExtension(ext)) {
    return false;
  }
  if (isReactLikeExtension(ext) && /^[A-Z]/.test(generatedName)) {
    return false;
  }
  const trimmed = String(snippet || '').trimStart();
  if (
    trimmed.startsWith('/**')
    || trimmed.startsWith('///')
    || trimmed.startsWith('// ')
    || trimmed.startsWith('# ')
    || trimmed.startsWith('@doc')
  ) {
    return false;
  }
  return true;
}
function finalizeGeneratedTaskResult(result, ext, lines = [], sourceFile = '') {
  return mapGeneratedTaskResultSnippet(result, (snippet) =>
    wrapElixirSnippetInModuleIfNeeded(snippet, ext, lines, sourceFile, ''),
  );
}
function wrapElixirSnippetInModuleIfNeeded(snippet, ext, lines = [], sourceFile = '', fallbackName = '') {
  const lowerExt = analysisExtension(ext);
  const normalizedSnippet = String(snippet || '');
  if (!['.ex', '.exs'].includes(lowerExt)) {
    return normalizedSnippet;
  }
  if (!shouldWrapElixirSnippet(normalizedSnippet, lines)) {
    return normalizedSnippet;
  }

  const moduleName = inferElixirModuleName(sourceFile, fallbackName);
  const indentedSnippet = normalizedSnippet
    .split('\n')
    .map((line) => line.length > 0 ? `  ${line}` : '')
    .join('\n');

  return [
    `defmodule ${moduleName} do`,
    indentedSnippet,
    'end',
  ].join('\n');
}
function shouldWrapElixirSnippet(snippet, lines = []) {
  const text = String(snippet || '');
  if (!text.trim()) {
    return false;
  }
  if (/^\s*defmodule\s+/m.test(text)) {
    return false;
  }
  if (Array.isArray(lines) && lines.some((line) => /^\s*defmodule\s+/.test(String(line || '')))) {
    return false;
  }
  return /^\s*(?:@doc|@spec|def\s+)/m.test(text);
}
function inferElixirModuleName(sourceFile, fallbackName = '') {
  const sourceName = String(sourceFile || '').trim()
    ? path.parse(String(sourceFile)).name
    : '';
  const candidate = sourceName || fallbackName || 'generated_task';
  return String(candidate)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((segment, index) => normalizePascalModuleSegment(segment, index === 0))
    .join('') || 'GeneratedTask';
}
function normalizePascalModuleSegment(segment, isLeadingSegment = false) {
  const normalized = String(segment || '')
    .replace(/[^A-Za-z0-9]/g, '')
    .trim();
  if (!normalized) {
    return '';
  }

  const pascalized = upperFirst(normalized.toLowerCase());
  if (isLeadingSegment && /^[0-9]/.test(pascalized)) {
    return `Generated${pascalized}`;
  }
  return pascalized;
}
function buildInlineFunctionDocumentation(name, params, instruction, ext) {
  if (!isPythonLikeExtension(ext)) {
    return '';
  }

  const summary = functionDocumentationSummary(name, instruction);
  const argsDescription = params.length
    ? params.map((param) => `        ${param}: parametro de entrada do fluxo.`).join('\n')
    : '        Nenhum argumento recebido.';
  const returnDescription = functionReturnDocumentation(instruction, ext);

  return [
    '    """',
    `    ${summary}`,
    '',
    '    Args:',
    argsDescription,
    '',
    '    Returns:',
    `        ${returnDescription}`,
    '    """',
  ].join('\n');
}
function buildLeadingFunctionDocumentation(name, params, instruction, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  const summary = functionDocumentationSummary(name, instruction);
  const returnDescription = functionReturnDocumentation(instruction, ext);
  const normalizedName = sanitizeIdentifier(name || extractGeneratedFunctionName('', ext) || 'funcao_gerada');

  if (['.ex', '.exs'].includes(lowerExt)) {
    const doc = [
      '@doc """',
      `  ${summary}`,
      '',
      '  ## Argumentos',
      params.length
        ? params.map((param) => `  - ${param}: parametro de entrada do fluxo.`).join('\n')
        : '  - Nenhum argumento recebido.',
      '',
      '  ## Retorno',
      `  ${returnDescription}`,
      '  """',
    ].join('\n');
    const spec = snippetFunctionSpec(normalizedName, params, ext, inferGeneratedSpecContext(instruction, ext));
    return `${doc}\n${spec}`;
  }

  if (isJavaScriptLikeExtension(lowerExt)) {
    const paramLines = params.map((param) => ` * @param {*} ${param} Parametro de entrada do fluxo.`);
    return [
      '/**',
      ` * ${summary}`,
      ...paramLines,
      ` * @returns {*} ${returnDescription}`,
      ' */',
    ].join('\n');
  }

  if (isPythonLikeExtension(lowerExt)) {
    return [
      `# ${summary}`,
      ...(params.length ? params.map((param) => `# ${param}: parametro de entrada do fluxo.`) : ['# Nenhum argumento recebido.']),
      `# Retorno: ${returnDescription}`,
    ].join('\n');
  }

  if (isGoExtension(lowerExt)) {
    return `// ${toCamelCaseIdentifier(normalizedName)} ${lowercaseFirst(summary)}`;
  }

  if (isRustExtension(lowerExt)) {
    return `/// ${summary}`;
  }

  if (lowerExt === '.rb') {
    return [
      `# ${summary}`,
      `# Retorno: ${returnDescription}`,
    ].join('\n');
  }

  if (lowerExt === '.vim') {
    return [
      `" ${summary}`,
      `" Retorno: ${returnDescription}`,
    ].join('\n');
  }

  if (lowerExt === '.lua') {
    return [
      `-- ${summary}`,
      `-- Retorno: ${returnDescription}`,
    ].join('\n');
  }

  return '';
}
function inferGeneratedSpecContext(instruction, ext) {
  return {
    returnType: inferInstructionReturnType(instruction, ext),
    paramTypes: [],
  };
}
function inferInstructionReturnType(instruction, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  if (!['.ex', '.exs'].includes(lowerExt)) {
    return 'any()';
  }

  if (extractDiceSides(instruction)) {
    return 'integer()';
  }

  const literalValue = extractLiteralFromInstruction(String(instruction || '').toLowerCase());
  if (/^(true|false)$/.test(literalValue)) {
    return 'boolean()';
  }
  if (/^[+-]?\d+$/.test(literalValue)) {
    return 'integer()';
  }
  if (/^[+-]?\d+\.\d+$/.test(literalValue)) {
    return 'float()';
  }
  if (/^".*"$/.test(literalValue)) {
    return 'String.t()';
  }
  return 'any()';
}
function functionDocumentationSummary(name, instruction) {
  const diceSides = extractDiceSides(instruction);
  if (diceSides) {
    return `Retorna um valor aleatorio entre 1 e ${diceSides} simulando a rolagem de um dado.`;
  }

  const lowerInstruction = String(instruction || '').toLowerCase();
  if (/\b(banco|database|db|postgres|postgresql|mysql|mongo|mongodb|prisma)\b/.test(lowerInstruction)) {
    return `Estabelece a conexao principal para ${sanitizeIdentifier(name || 'recurso')}.`;
  }

  const literalValue = extractLiteralFromInstruction(lowerInstruction);
  if (literalValue) {
    return `Retorna ${literalValue} de forma deterministica para o fluxo atual.`;
  }

  return functionDescriptionFromName(name || inferFunctionNameFromInstruction(instruction));
}
function functionReturnDocumentation(instruction, ext) {
  const diceSides = extractDiceSides(instruction);
  if (diceSides) {
    return `Numero inteiro entre 1 e ${diceSides}.`;
  }

  const literalValue = extractLiteralFromInstruction(String(instruction || '').toLowerCase());
  if (literalValue === 'true' || literalValue === 'false') {
    return `Valor booleano ${literalValue}.`;
  }
  if (literalValue) {
    return `Valor ${literalValue}.`;
  }

  if (isJavaScriptLikeExtension(ext) || isPythonLikeExtension(ext)) {
    return 'Valor calculado conforme a regra principal da funcao.';
  }

  return 'Resultado alinhado ao contrato principal da funcao.';
}
function extractGeneratedFunctionName(snippet, ext) {
  const lines = String(snippet || '')
    .split('\n')
    .map((line) => String(line).trim())
    .filter(Boolean);
  for (const line of lines) {
    let match = null;
    if (['.ex', '.exs'].includes(String(ext || '').toLowerCase())) {
      match = line.match(/^def\s+([a-z_][a-zA-Z0-9_?!]*)/);
    } else if (isJavaScriptLikeExtension(ext)) {
      match = line.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)/);
    } else if (isPythonLikeExtension(ext)) {
      match = line.match(/^def\s+([a-z_][a-zA-Z0-9_]*)\s*\(/);
    } else if (isGoExtension(ext)) {
      match = line.match(/^func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    } else if (isRustExtension(ext)) {
      match = line.match(/^(?:async\s+)?fn\s+([a-z_][a-zA-Z0-9_]*)\s*\(/);
    } else if (String(ext || '').toLowerCase() === '.rb') {
      match = line.match(/^def\s+([a-z_][a-zA-Z0-9_?!]*)/);
    } else if (String(ext || '').toLowerCase() === '.vim') {
      match = line.match(/^function!?\s+((?:[gswbtlav]:)?[A-Za-z_#][A-Za-z0-9_:#]*)\s*\(/);
    } else if (String(ext || '').toLowerCase() === '.lua') {
      match = line.match(/^(?:local\s+)?function\s+([a-z_][a-zA-Z0-9_]*)\s*\(/);
    }

    if (match && match[1]) {
      return sanitizeIdentifier(match[1]);
    }
  }
  return '';
}
function lowercaseFirst(text) {
  const value = String(text || '');
  if (!value) {
    return value;
  }
  return value.charAt(0).toLowerCase() + value.slice(1);
}
function functionBodyIndent(ext) {
  const lowerExt = String(ext || '').toLowerCase();
  if (lowerExt === '.py') {
    return '    ';
  }
  return '  ';
}
function generateDatabaseFunctionSnippet(instruction, ext, fileLines = []) {
  const lowerInstruction = String(instruction || '').toLowerCase();
  const mentionsDatabase = /\b(banco|database|db|postgres|postgresql|mysql|mongo|mongodb|prisma)\b/.test(lowerInstruction);
  const mentionsConnect = /\b(conecta|conectar|conecte|conexao|conexão|connect|connection)\b/.test(lowerInstruction);
  if (!mentionsDatabase || !mentionsConnect) {
    return null;
  }

  const [parsedName] = parseFunctionRequest(instruction);
  const functionName = formatFunctionNameForLanguage(parsedName || inferDatabaseFunctionName(lowerInstruction), ext);
  const lowerExt = ext.toLowerCase();

  if (isJavaScriptLikeExtension(lowerExt)) {
    return generateJavaScriptDatabaseFunctionSnippet(functionName, lowerInstruction, lowerExt, fileLines);
  }

  if (isPythonLikeExtension(lowerExt)) {
    return generatePythonDatabaseFunctionSnippet(functionName, lowerInstruction);
  }

  if (isGoExtension(lowerExt)) {
    return generateGoDatabaseFunctionSnippet(functionName, lowerInstruction);
  }

  if (isRustExtension(lowerExt)) {
    return generateRustDatabaseFunctionSnippet(functionName, lowerInstruction);
  }

  if (['.ex', '.exs'].includes(lowerExt)) {
    return generateElixirDatabaseFunctionSnippet(functionName, lowerInstruction);
  }

  return null;
}
function inferDatabaseFunctionName(instruction) {
  if (/\bprisma\b/.test(instruction)) {
    return 'connectPrisma';
  }
  if (/\bmongo\b|\bmongodb\b/.test(instruction)) {
    return 'connectMongo';
  }
  if (/\bmysql\b/.test(instruction)) {
    return 'connectMysql';
  }
  if (/\bpostgres\b|\bpostgresql\b/.test(instruction)) {
    return 'connectPostgres';
  }
  return 'connectDatabase';
}
function formatFunctionNameForLanguage(name, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  if (isGoExtension(lowerExt) || isJavaScriptLikeExtension(lowerExt)) {
    return toCamelCaseIdentifier(name);
  }
  if (isPythonLikeExtension(lowerExt) || isRustExtension(lowerExt) || ['.ex', '.exs'].includes(lowerExt)) {
    return toSnakeCaseIdentifier(name);
  }
  return sanitizeIdentifier(name);
}
function toSnakeCaseIdentifier(value) {
  const raw = String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase()
    .replace(/^_+|_+$/g, '');
  return raw || 'funcao_gerada';
}
function toCamelCaseIdentifier(value) {
  const parts = String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) {
    return 'funcaoGerada';
  }
  return parts
    .map((part, index) => {
      const lower = part.toLowerCase();
      if (index === 0) {
        return lower;
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
}
function generateJavaScriptDatabaseFunctionSnippet(functionName, instruction, ext, lines = []) {
  const style = inferModuleStyle(ext, lines);

  if (/\bprisma\b/.test(instruction)) {
    return {
      snippet: [
        `function ${functionName}() {`,
        '  return new PrismaClient();',
        '}',
      ].join('\n'),
      dependencies: [jsDependencySpec('named', 'PrismaClient', '@prisma/client', style)],
    };
  }

  if (/\bmongo\b|\bmongodb\b/.test(instruction)) {
    return {
      snippet: [
        `async function ${functionName}() {`,
        '  const client = new MongoClient(process.env.MONGODB_URL);',
        '  await client.connect();',
        '  return client;',
        '}',
      ].join('\n'),
      dependencies: [jsDependencySpec('named', 'MongoClient', 'mongodb', style)],
    };
  }

  if (/\bmysql\b/.test(instruction)) {
    return {
      snippet: [
        `async function ${functionName}() {`,
        '  return mysql.createConnection({',
        '    uri: process.env.DATABASE_URL,',
        '  });',
        '}',
      ].join('\n'),
      dependencies: [jsDependencySpec('default', 'mysql', 'mysql2/promise', style)],
    };
  }

  return {
    snippet: [
      `function ${functionName}() {`,
      '  return new Pool({',
      '    connectionString: process.env.DATABASE_URL,',
      '  });',
      '}',
    ].join('\n'),
    dependencies: [jsDependencySpec('named', 'Pool', 'pg', style)],
  };
}
function generatePythonDatabaseFunctionSnippet(functionName, instruction) {
  if (/\bmongo\b|\bmongodb\b/.test(instruction)) {
    return {
      snippet: [
        `def ${functionName}():`,
        '    client = MongoClient(os.environ["MONGODB_URL"])',
        '    return client',
      ].join('\n'),
      dependencies: [
        pythonDependencySpec('import', 'os'),
        pythonDependencySpec('from', 'pymongo', 'MongoClient'),
      ],
    };
  }

  if (/\bmysql\b/.test(instruction)) {
    return {
      snippet: [
        `def ${functionName}():`,
        '    return mysql.connector.connect(',
        '        option_files=os.environ["MYSQL_CONFIG_PATH"],',
        '    )',
      ].join('\n'),
      dependencies: [
        pythonDependencySpec('import', 'os'),
        pythonDependencySpec('import', 'mysql.connector'),
      ],
    };
  }

  if (/\bpostgres\b|\bpostgresql\b/.test(instruction)) {
    return {
      snippet: [
        `def ${functionName}():`,
        '    return psycopg.connect(os.environ["DATABASE_URL"])',
      ].join('\n'),
      dependencies: [
        pythonDependencySpec('import', 'os'),
        pythonDependencySpec('import', 'psycopg'),
      ],
    };
  }

  return {
    snippet: [
      `def ${functionName}():`,
      '    return create_engine(os.environ["DATABASE_URL"])',
    ].join('\n'),
    dependencies: [
      pythonDependencySpec('import', 'os'),
      pythonDependencySpec('from', 'sqlalchemy', 'create_engine'),
    ],
  };
}
function generateGoDatabaseFunctionSnippet(functionName, instruction) {
  if (/\bmongo\b|\bmongodb\b/.test(instruction)) {
    return {
      snippet: [
        `func ${functionName}(ctx context.Context) (*mongo.Client, error) {`,
        '  return mongo.Connect(ctx, options.Client().ApplyURI(os.Getenv("MONGODB_URL")))',
        '}',
      ].join('\n'),
      dependencies: [
        goDependencySpec('context'),
        goDependencySpec('os'),
        goDependencySpec('go.mongodb.org/mongo-driver/mongo'),
        goDependencySpec('go.mongodb.org/mongo-driver/mongo/options'),
      ],
    };
  }

  if (/\bmysql\b/.test(instruction)) {
    return {
      snippet: [
        `func ${functionName}() (*sql.DB, error) {`,
        '  return sql.Open("mysql", os.Getenv("DATABASE_URL"))',
        '}',
      ].join('\n'),
      dependencies: [
        goDependencySpec('database/sql'),
        goDependencySpec('os'),
        goDependencySpec('github.com/go-sql-driver/mysql', '_'),
      ],
    };
  }

  return {
    snippet: [
      `func ${functionName}() (*sql.DB, error) {`,
      '  return sql.Open("postgres", os.Getenv("DATABASE_URL"))',
      '}',
    ].join('\n'),
    dependencies: [
      goDependencySpec('database/sql'),
      goDependencySpec('os'),
      goDependencySpec('github.com/lib/pq', '_'),
    ],
  };
}
function generateRustDatabaseFunctionSnippet(functionName, instruction) {
  if (/\bmongo\b|\bmongodb\b/.test(instruction)) {
    return {
      snippet: [
        `async fn ${functionName}() -> mongodb::error::Result<Client> {`,
        '    Client::with_uri_str(std::env::var("MONGODB_URL").expect("MONGODB_URL nao definido")).await',
        '}',
      ].join('\n'),
      dependencies: [
        rustDependencySpec('mongodb::Client'),
      ],
    };
  }

  if (/\bmysql\b/.test(instruction)) {
    return {
      snippet: [
        `async fn ${functionName}() -> Result<MySqlPool, sqlx::Error> {`,
        '    MySqlPoolOptions::new()',
        '        .connect(&std::env::var("DATABASE_URL").expect("DATABASE_URL nao definido"))',
        '        .await',
        '}',
      ].join('\n'),
      dependencies: [
        rustDependencySpec('sqlx::MySqlPool'),
        rustDependencySpec('sqlx::mysql::MySqlPoolOptions'),
      ],
    };
  }

  return {
    snippet: [
      `async fn ${functionName}() -> Result<PgPool, sqlx::Error> {`,
      '    PgPoolOptions::new()',
      '        .connect(&std::env::var("DATABASE_URL").expect("DATABASE_URL nao definido"))',
      '        .await',
      '}',
    ].join('\n'),
    dependencies: [
      rustDependencySpec('sqlx::PgPool'),
      rustDependencySpec('sqlx::postgres::PgPoolOptions'),
    ],
  };
}
function generateElixirDatabaseFunctionSnippet(functionName, instruction) {
  if (/\bmongo\b|\bmongodb\b/.test(instruction)) {
    return {
      snippet: [
        `def ${functionName}(opts \\\\ []) do`,
        '  Mongo.start_link([',
        '    url: System.get_env("MONGODB_URL"),',
        '    name: __MODULE__.Mongo,',
        '  ] ++ opts)',
        'end',
      ].join('\n'),
      dependencies: [],
    };
  }

  if (/\bmysql\b/.test(instruction)) {
    return {
      snippet: [
        `def ${functionName}(opts \\\\ []) do`,
        '  MyXQL.start_link(',
        '    Keyword.merge([',
        '      hostname: "localhost",',
        '      username: "root",',
        '      password: "root",',
        '      database: "app_dev",',
        '    ], opts)',
        '  )',
        'end',
      ].join('\n'),
      dependencies: [],
    };
  }

  return {
    snippet: [
      `def ${functionName}(opts \\\\ []) do`,
      '  Postgrex.start_link(',
      '    Keyword.merge([',
      '      hostname: "localhost",',
      '      username: "postgres",',
      '      password: "postgres",',
      '      database: "app_dev",',
      '    ], opts)',
      '  )',
      'end',
    ].join('\n'),
    dependencies: [],
  };
}
function generateCrudSnippet(instruction, ext) {
  const entityName = parseCrudEntityName(instruction);
  const lowerExt = String(ext || '').toLowerCase();

  if (isJavaScriptLikeExtension(lowerExt)) {
    return generateJavaScriptCrudSnippet(entityName);
  }
  if (isPythonLikeExtension(lowerExt)) {
    return generatePythonCrudSnippet(entityName);
  }
  if (['.ex', '.exs'].includes(lowerExt)) {
    return generateElixirCrudSnippet(entityName);
  }
  if (isGoExtension(lowerExt)) {
    return generateGoCrudSnippet(entityName);
  }
  if (isRustExtension(lowerExt)) {
    return generateRustCrudSnippet(entityName);
  }
  if (lowerExt === '.lua') {
    return generateLuaCrudSnippet(entityName);
  }

  return generateGenericCrudSnippet(entityName, ext);
}
function generateExampleSnippet(instruction, ext) {
  const lower = String(instruction || '').toLowerCase();
  if (/\bsolid\b/.test(lower)) {
    return generateSolidExampleSnippet(ext);
  }
  return generateGenericSnippet(instruction, ext);
}
function generateSolidExampleSnippet(ext) {
  const lowerExt = String(ext || '').toLowerCase();
  if (isJavaScriptLikeExtension(lowerExt)) {
    return [
      jsDocBlock(
        'Valida os dados do usuario sem efeito colateral, mantendo responsabilidade unica.',
        [{ name: 'payload', description: 'Dados de entrada do usuario.' }],
        'Payload validado para o fluxo de criacao.',
      ),
      'export function validateUserPayload(payload) {',
      '  if (!payload?.email) {',
      '    throw new Error("email obrigatorio");',
      '  }',
      '  return { ...payload };',
      '}',
      '',
      jsDocBlock(
        'Constroi um caso de uso aplicando inversao de dependencia com funcoes injetadas.',
        [
          { name: 'repository', description: 'Porta de persistencia com a funcao save.' },
          { name: 'notifier', description: 'Porta de notificacao com a funcao sendWelcome.' },
        ],
        'Funcao de criacao de usuario desacoplada das implementacoes concretas.',
      ),
      'export function buildCreateUser({ repository, notifier }) {',
      '  return function createUser(payload) {',
      '    const user = repository.save(validateUserPayload(payload));',
      '    notifier.sendWelcome(user.email);',
      '    return user;',
      '  };',
      '}',
      '',
      jsDocBlock(
        'Aplica o principio aberto para extensao por meio de formatador injetado.',
        [{ name: 'formatter', description: 'Funcao que formata o usuario para a camada consumidora.' }],
        'Funcao especializada para apresentar usuarios sem alterar o fluxo principal.',
      ),
      'export function buildUserPresenter(formatter) {',
      '  return function presentUser(user) {',
      '    return formatter(user);',
      '  };',
      '}',
    ].join('\n');
  }

  if (isPythonLikeExtension(lowerExt)) {
    return [
      'def validate_user_payload(payload):',
      pythonDocstringBlock(
        'Valida os dados do usuario sem efeito colateral, mantendo responsabilidade unica.',
        [{ name: 'payload', description: 'Dados de entrada do usuario.' }],
        'Payload validado para o fluxo de criacao.',
      ),
      '    if not payload.get("email"):',
      '        raise ValueError("email obrigatorio")',
      '    return {**payload}',
      '',
      'def build_create_user(repository, notifier):',
      pythonDocstringBlock(
        'Constroi um caso de uso aplicando inversao de dependencia com funcoes injetadas.',
        [
          { name: 'repository', description: 'Porta de persistencia com a funcao save.' },
          { name: 'notifier', description: 'Porta de notificacao com a funcao send_welcome.' },
        ],
        'Funcao de criacao de usuario desacoplada das implementacoes concretas.',
      ),
      '    def create_user(payload):',
      '        user = repository["save"](validate_user_payload(payload))',
      '        notifier["send_welcome"](user["email"])',
      '        return user',
      '',
      '    return create_user',
      '',
      'def build_user_presenter(formatter):',
      pythonDocstringBlock(
        'Aplica o principio aberto para extensao por meio de formatador injetado.',
        [{ name: 'formatter', description: 'Funcao que formata o usuario para a camada consumidora.' }],
        'Funcao especializada para apresentar usuarios sem alterar o fluxo principal.',
      ),
      '    def present_user(user):',
      '        return formatter(user)',
      '',
      '    return present_user',
    ].join('\n');
  }

  if (['.ex', '.exs'].includes(lowerExt)) {
    return [
      '@doc """',
      'Valida os dados do usuario sem efeito colateral, mantendo responsabilidade unica.',
      '"""',
      '@spec validate_user_payload(map()) :: map()',
      'def validate_user_payload(payload) do',
      '  if Map.get(payload, :email) || Map.get(payload, "email") do',
      '    payload',
      '  else',
      '    raise ArgumentError, "email obrigatorio"',
      '  end',
      'end',
      '',
      '@doc """',
      'Constroi um caso de uso aplicando inversao de dependencia com funcoes injetadas.',
      '"""',
      '@spec build_create_user((map() -> map()), (String.t() -> any())) :: (map() -> map())',
      'def build_create_user(save_user, send_welcome) do',
      '  fn payload ->',
      '    user = payload |> validate_user_payload() |> save_user.()',
      '    send_welcome.(Map.get(user, :email, Map.get(user, "email")))',
      '    user',
      '  end',
      'end',
      '',
      '@doc """',
      'Aplica o principio aberto para extensao por meio de formatador injetado.',
      '"""',
      '@spec build_user_presenter((map() -> any())) :: (map() -> any())',
      'def build_user_presenter(formatter) do',
      '  fn user -> formatter.(user) end',
      'end',
    ].join('\n');
  }

  if (isGoExtension(lowerExt)) {
    return [
      goDocLine('ValidateUserPayload', 'valida os dados do usuario sem efeito colateral, mantendo responsabilidade unica.'),
      'func ValidateUserPayload(payload map[string]any) (map[string]any, error) {',
      '  if _, ok := payload["email"]; !ok {',
      '    return nil, errors.New("email obrigatorio")',
      '  }',
      '  copia := map[string]any{}',
      '  for chave, valor := range payload {',
      '    copia[chave] = valor',
      '  }',
      '  return copia, nil',
      '}',
      '',
      'type SaveUser func(map[string]any) map[string]any',
      'type SendWelcome func(string)',
      '',
      goDocLine('BuildCreateUser', 'constroi um caso de uso aplicando inversao de dependencia com funcoes injetadas.'),
      'func BuildCreateUser(saveUser SaveUser, sendWelcome SendWelcome) func(map[string]any) (map[string]any, error) {',
      '  return func(payload map[string]any) (map[string]any, error) {',
      '    validated, err := ValidateUserPayload(payload)',
      '    if err != nil {',
      '      return nil, err',
      '    }',
      '    user := saveUser(validated)',
      '    if email, ok := user["email"].(string); ok {',
      '      sendWelcome(email)',
      '    }',
      '    return user, nil',
      '  }',
      '}',
      '',
      goDocLine('BuildUserPresenter', 'aplica o principio aberto para extensao por meio de formatador injetado.'),
      'func BuildUserPresenter(formatter func(map[string]any) string) func(map[string]any) string {',
      '  return func(user map[string]any) string {',
      '    return formatter(user)',
      '  }',
      '}',
    ].join('\n');
  }

  if (isRustExtension(lowerExt)) {
    return [
      'use std::collections::HashMap;',
      '',
      rustDocLine('Valida os dados do usuario sem efeito colateral, mantendo responsabilidade unica.'),
      'pub fn validate_user_payload(payload: &HashMap<String, String>) -> Result<HashMap<String, String>, String> {',
      '    if !payload.contains_key("email") {',
      '        return Err("email obrigatorio".to_string());',
      '    }',
      '    Ok(payload.clone())',
      '}',
      '',
      rustDocLine('Constroi um caso de uso aplicando inversao de dependencia com funcoes injetadas.'),
      'pub fn build_create_user<SaveUser, SendWelcome>(',
      '    save_user: SaveUser,',
      '    send_welcome: SendWelcome,',
      ') -> impl Fn(HashMap<String, String>) -> Result<HashMap<String, String>, String>',
      'where',
      '    SaveUser: Fn(HashMap<String, String>) -> HashMap<String, String> + Clone,',
      '    SendWelcome: Fn(String) + Clone,',
      '{',
      '    move |payload| {',
      '        let validated = validate_user_payload(&payload)?;',
      '        let user = save_user(validated);',
      '        if let Some(email) = user.get("email") {',
      '            send_welcome(email.clone());',
      '        }',
      '        Ok(user)',
      '    }',
      '}',
      '',
      rustDocLine('Aplica o principio aberto para extensao por meio de formatador injetado.'),
      'pub fn build_user_presenter<Formatter>(',
      '    formatter: Formatter,',
      ') -> impl Fn(HashMap<String, String>) -> String',
      'where',
      '    Formatter: Fn(HashMap<String, String>) -> String + Clone,',
      '{',
      '    move |user| formatter(user)',
      '}',
    ].join('\n');
  }

  return [
    `${commentPrefix(ext)} Exemplo SOLID: separe validacao, persistencia e apresentacao em responsabilidades distintas.`,
    `${commentPrefix(ext)} Injete dependencias para manter o fluxo aberto para extensao e fechado para modificacao.`,
  ].join('\n');
}
function parseCrudEntityName(instruction) {
  const text = String(instruction || '').trim();
  const patterns = [
    /\bcrud\b(?:\s+(?:completo|complete|full))?(?:\s+(?:de|do|da|para))?\s+([a-zà-ÿ_][a-zà-ÿ0-9_-]*)/i,
    /\b([a-zà-ÿ_][a-zà-ÿ0-9_-]*)\s+crud\b(?:\s+(?:completo|complete|full))?/i,
    /\bcrud\b\s+([a-zà-ÿ_][a-zà-ÿ0-9_-]*)\s+(?:completo|complete|full)\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const candidate = sanitizeNaturalIdentifier(match[1]);
      if (candidate && !['crud', 'completo', 'complete', 'full'].includes(candidate.toLowerCase())) {
        return candidate;
      }
    }
  }
  return 'registro';
}
function crudEntityNames(entityName) {
  const singularSnake = toSnakeCaseIdentifier(entityName || 'registro');
  const pluralSnake = pluralizeIdentifier(singularSnake);
  const singularCamel = toCamelCaseIdentifier(singularSnake);
  const pluralCamel = toCamelCaseIdentifier(pluralSnake);
  const singularPascal = upperFirst(singularCamel);
  const pluralPascal = upperFirst(pluralCamel);

  return {
    singularSnake,
    pluralSnake,
    singularCamel,
    pluralCamel,
    singularPascal,
    pluralPascal,
  };
}
function pluralizeIdentifier(name) {
  const value = String(name || '').trim();
  if (!value) {
    return 'registros';
  }
  if (/s$/.test(value)) {
    return value;
  }
  return `${value}s`;
}
function upperFirst(text) {
  const value = String(text || '');
  if (!value) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}
function jsDocBlock(summary, paramDocs, returnDoc) {
  const params = Array.isArray(paramDocs) ? paramDocs : [];
  return [
    '/**',
    ` * ${summary}`,
    ...params.map((paramDoc) => ` * @param {*} ${paramDoc.name} ${paramDoc.description}`),
    ` * @returns {*} ${returnDoc}`,
    ' */',
  ].join('\n');
}
function pythonDocstringBlock(summary, paramDocs, returnDoc, indent = '    ') {
  const params = Array.isArray(paramDocs) ? paramDocs : [];
  return [
    `${indent}"""`,
    `${indent}${summary}`,
    '',
    `${indent}Args:`,
    ...(params.length
      ? params.map((paramDoc) => `${indent}    ${paramDoc.name}: ${paramDoc.description}`)
      : [`${indent}    Nenhum argumento recebido.`]),
    '',
    `${indent}Returns:`,
    `${indent}    ${returnDoc}`,
    `${indent}"""`,
  ].join('\n');
}
function goDocLine(functionName, summary) {
  return `// ${functionName} ${lowercaseFirst(summary)}`;
}
function rustDocLine(summary) {
  return `/// ${summary}`;
}
function generateJavaScriptCrudSnippet(entityName) {
  const names = crudEntityNames(entityName);
  const collection = names.pluralCamel;
  const item = names.singularCamel;
  const listName = `listar${names.pluralPascal}`;
  const findName = `buscar${names.singularPascal}PorId`;
  const createName = `criar${names.singularPascal}`;
  const updateName = `atualizar${names.singularPascal}`;
  const removeName = `remover${names.singularPascal}`;

  return [
    jsDocBlock(
      `Retorna a colecao atual de ${collection} sem mutacao.`,
      [{ name: collection, description: `Colecao atual de ${collection}.` }],
      `Colecao atual de ${collection}.`,
    ),
    `export function ${listName}(${collection}) {`,
    `  return ${collection};`,
    '}',
    '',
    jsDocBlock(
      `Busca um ${item} pelo identificador informado.`,
      [
        { name: collection, description: `Colecao atual de ${collection}.` },
        { name: 'id', description: `Identificador de ${item}.` },
      ],
      `${upperFirst(item)} encontrado ou null quando nao existir.`,
    ),
    `export function ${findName}(${collection}, id) {`,
    `  return ${collection}.find((${item}) => ${item}.id === id) ?? null;`,
    '}',
    '',
    jsDocBlock(
      `Cria um novo ${item} sem alterar a colecao original.`,
      [
        { name: collection, description: `Colecao atual de ${collection}.` },
        { name: 'payload', description: `Dados de entrada para ${item}.` },
      ],
      `Objeto contendo a nova colecao de ${collection} e o ${item} criado.`,
    ),
    `export function ${createName}(${collection}, payload) {`,
    '  const proximoId =',
    `    ${collection}.reduce(`,
    `      (maiorId, ${item}) => Math.max(maiorId, Number(${item}.id ?? 0)),`,
    '      0,',
    '    ) + 1;',
    `  const novo${names.singularPascal} = { ...payload, id: proximoId };`,
    '  return {',
    `    ${collection}: [...${collection}, novo${names.singularPascal}],`,
    `    ${item}: novo${names.singularPascal},`,
    '  };',
    '}',
    '',
    jsDocBlock(
      `Atualiza um ${item} existente preservando a imutabilidade da colecao.`,
      [
        { name: collection, description: `Colecao atual de ${collection}.` },
        { name: 'id', description: `Identificador de ${item}.` },
        { name: 'changes', description: `Campos a serem atualizados em ${item}.` },
      ],
      `Objeto contendo a nova colecao de ${collection} e o ${item} atualizado ou null.`,
    ),
    `export function ${updateName}(${collection}, id, changes) {`,
    `  const ${item}Atual = ${findName}(${collection}, id);`,
    `  if (!${item}Atual) {`,
    `    return { ${collection}, ${item}: null };`,
    '  }',
    `  const ${item}Atualizado = { ...${item}Atual, ...changes, id: ${item}Atual.id };`,
    '  return {',
    `    ${collection}: ${collection}.map((registro) => (registro.id === id ? ${item}Atualizado : registro)),`,
    `    ${item}: ${item}Atualizado,`,
    '  };',
    '}',
    '',
    jsDocBlock(
      `Remove um ${item} da colecao de forma funcional.`,
      [
        { name: collection, description: `Colecao atual de ${collection}.` },
        { name: 'id', description: `Identificador de ${item}.` },
      ],
      `Objeto contendo a nova colecao de ${collection} e o ${item} removido ou null.`,
    ),
    `export function ${removeName}(${collection}, id) {`,
    `  const ${item}Removido = ${findName}(${collection}, id);`,
    '  return {',
    `    ${collection}: ${collection}.filter((registro) => registro.id !== id),`,
    `    ${item}: ${item}Removido,`,
    '  };',
    '}',
  ].join('\n');
}
function generatePythonCrudSnippet(entityName) {
  const names = crudEntityNames(entityName);
  const collection = names.pluralSnake;
  const item = names.singularSnake;
  const listName = `listar_${collection}`;
  const findName = `buscar_${item}_por_id`;
  const createName = `criar_${item}`;
  const updateName = `atualizar_${item}`;
  const removeName = `remover_${item}`;

  return [
    `def ${listName}(${collection}):`,
    pythonDocstringBlock(
      `Retorna a colecao atual de ${collection} sem mutacao.`,
      [{ name: collection, description: `Colecao atual de ${collection}.` }],
      `Colecao atual de ${collection}.`,
    ),
    `    return ${collection}`,
    '',
    `def ${findName}(${collection}, identificador):`,
    pythonDocstringBlock(
      `Busca um ${item} pelo identificador informado.`,
      [
        { name: collection, description: `Colecao atual de ${collection}.` },
        { name: 'identificador', description: `Identificador de ${item}.` },
      ],
      `${upperFirst(item)} encontrado ou None quando nao existir.`,
    ),
    `    return next((registro for registro in ${collection} if registro.get("id") == identificador), None)`,
    '',
    `def ${createName}(${collection}, payload):`,
    pythonDocstringBlock(
      `Cria um novo ${item} sem alterar a colecao original.`,
      [
        { name: collection, description: `Colecao atual de ${collection}.` },
        { name: 'payload', description: `Dados de entrada para ${item}.` },
      ],
      `Dicionario contendo a nova colecao de ${collection} e o ${item} criado.`,
    ),
    `    proximo_id = max((int(registro.get("id", 0)) for registro in ${collection}), default=0) + 1`,
    `    novo_${item} = {"id": proximo_id, **payload}`,
    `    return {"${collection}": [*${collection}, novo_${item}], "${item}": novo_${item}}`,
    '',
    `def ${updateName}(${collection}, identificador, changes):`,
    pythonDocstringBlock(
      `Atualiza um ${item} existente preservando a imutabilidade da colecao.`,
      [
        { name: collection, description: `Colecao atual de ${collection}.` },
        { name: 'identificador', description: `Identificador de ${item}.` },
        { name: 'changes', description: `Campos a serem atualizados em ${item}.` },
      ],
      `Dicionario contendo a nova colecao de ${collection} e o ${item} atualizado ou None.`,
    ),
    `    ${item}_atual = ${findName}(${collection}, identificador)`,
    `    if ${item}_atual is None:`,
    `        return {"${collection}": ${collection}, "${item}": None}`,
    `    ${item}_atualizado = {**${item}_atual, **changes, "id": ${item}_atual.get("id")}`,
    `    return {`,
    `        "${collection}": [${item}_atualizado if registro.get("id") == identificador else registro for registro in ${collection}],`,
    `        "${item}": ${item}_atualizado,`,
    '    }',
    '',
    `def ${removeName}(${collection}, identificador):`,
    pythonDocstringBlock(
      `Remove um ${item} da colecao de forma funcional.`,
      [
        { name: collection, description: `Colecao atual de ${collection}.` },
        { name: 'identificador', description: `Identificador de ${item}.` },
      ],
      `Dicionario contendo a nova colecao de ${collection} e o ${item} removido ou None.`,
    ),
    `    ${item}_removido = ${findName}(${collection}, identificador)`,
    '    return {',
    `        "${collection}": [registro for registro in ${collection} if registro.get("id") != identificador],`,
    `        "${item}": ${item}_removido,`,
    '    }',
  ].join('\n');
}
function generateElixirCrudSnippet(entityName) {
  const names = crudEntityNames(entityName);
  const collection = names.pluralSnake;
  const item = names.singularSnake;
  const listName = `listar_${collection}`;
  const findName = `buscar_${item}_por_id`;
  const createName = `criar_${item}`;
  const updateName = `atualizar_${item}`;
  const removeName = `remover_${item}`;

  return [
    '@doc """',
    `Retorna a colecao atual de ${collection} sem mutacao.`,
    '"""',
    `@spec ${listName}(list(map())) :: list(map())`,
    `def ${listName}(${collection}), do: ${collection}`,
    '',
    '@doc """',
    `Busca um ${item} pelo identificador informado.`,
    '"""',
    `@spec ${findName}(list(map()), term()) :: map() | nil`,
    `def ${findName}(${collection}, id) do`,
    `  Enum.find(${collection}, fn registro ->`,
    '    Map.get(registro, :id, Map.get(registro, "id")) == id',
    '  end)',
    'end',
    '',
    '@doc """',
    `Cria um novo ${item} sem alterar a colecao original.`,
    '"""',
    `@spec ${createName}(list(map()), map()) :: %{${collection}: list(map()), ${item}: map()}`,
    `def ${createName}(${collection}, payload) do`,
    '  proximo_id =',
    `    ${collection}`,
    '    |> Enum.map(fn registro -> Map.get(registro, :id, Map.get(registro, "id", 0)) end)',
    '    |> Enum.map(fn valor -> if is_integer(valor), do: valor, else: 0 end)',
    '    |> Enum.max(fn -> 0 end)',
    '    |> Kernel.+(1)',
    '',
    `  novo_${item} = Map.put(payload, :id, proximo_id)`,
    `%{${collection}: ${collection} ++ [novo_${item}], ${item}: novo_${item}}`,
    'end',
    '',
    '@doc """',
    `Atualiza um ${item} existente preservando a imutabilidade da colecao.`,
    '"""',
    `@spec ${updateName}(list(map()), term(), map()) :: %{${collection}: list(map()), ${item}: map() | nil}`,
    `def ${updateName}(${collection}, id, changes) do`,
    `  ${item}_atual = ${findName}(${collection}, id)`,
    '',
    `  if is_nil(${item}_atual) do`,
    `    %{${collection}: ${collection}, ${item}: nil}`,
    '  else',
    `    ${item}_atualizado = Map.merge(${item}_atual, changes) |> Map.put(:id, Map.get(${item}_atual, :id, Map.get(${item}_atual, "id")))`,
    '',
    '    %{',
    `      ${collection}: Enum.map(${collection}, fn registro -> if Map.get(registro, :id, Map.get(registro, "id")) == id, do: ${item}_atualizado, else: registro end),`,
    `      ${item}: ${item}_atualizado`,
    '    }',
    '  end',
    'end',
    '',
    '@doc """',
    `Remove um ${item} da colecao de forma funcional.`,
    '"""',
    `@spec ${removeName}(list(map()), term()) :: %{${collection}: list(map()), ${item}: map() | nil}`,
    `def ${removeName}(${collection}, id) do`,
    `  ${item}_removido = ${findName}(${collection}, id)`,
    '',
    '  %{',
    `    ${collection}: Enum.reject(${collection}, fn registro -> Map.get(registro, :id, Map.get(registro, "id")) == id end),`,
    `    ${item}: ${item}_removido`,
    '  }',
    'end',
  ].join('\n');
}
function generateGoCrudSnippet(entityName) {
  const names = crudEntityNames(entityName);
  const singularPascal = names.singularPascal;
  const pluralPascal = names.pluralPascal;
  const listName = `Listar${pluralPascal}`;
  const findName = `Buscar${singularPascal}PorID`;
  const createName = `Criar${singularPascal}`;
  const updateName = `Atualizar${singularPascal}`;
  const removeName = `Remover${singularPascal}`;

  return [
    `type ${singularPascal} map[string]any`,
    '',
    `type ${singularPascal}MutationResult struct {`,
    `  ${pluralPascal} []${singularPascal}`,
    `  ${singularPascal} ${singularPascal}`,
    '}',
    '',
    goDocLine(listName, `retorna a colecao atual de ${names.pluralSnake} sem mutacao.`),
    `func ${listName}(${names.pluralCamel} []${singularPascal}) []${singularPascal} {`,
    `  return ${names.pluralCamel}`,
    '}',
    '',
    goDocLine(findName, `busca um ${names.singularSnake} pelo identificador informado.`),
    `func ${findName}(${names.pluralCamel} []${singularPascal}, id int) (${singularPascal}, bool) {`,
    `  for _, registro := range ${names.pluralCamel} {`,
    '    valor, ok := registro["id"].(int)',
    '    if ok && valor == id {',
    '      return registro, true',
    '    }',
    '  }',
    `  return ${singularPascal}{}, false`,
    '}',
    '',
    goDocLine(createName, `cria um novo ${names.singularSnake} sem alterar a colecao original.`),
    `func ${createName}(${names.pluralCamel} []${singularPascal}, payload ${singularPascal}) ${singularPascal}MutationResult {`,
    '  proximoID := 1',
    `  for _, registro := range ${names.pluralCamel} {`,
    '    valor, ok := registro["id"].(int)',
    '    if ok && valor >= proximoID {',
    '      proximoID = valor + 1',
    '    }',
    '  }',
    `  novo${singularPascal} := clone${singularPascal}(payload)`,
    `  novo${singularPascal}["id"] = proximoID`,
    `  novos${pluralPascal} := append(append([]${singularPascal}{}, ${names.pluralCamel}...), novo${singularPascal})`,
    `  return ${singularPascal}MutationResult{${pluralPascal}: novos${pluralPascal}, ${singularPascal}: novo${singularPascal}}`,
    '}',
    '',
    goDocLine(updateName, `atualiza um ${names.singularSnake} existente preservando a imutabilidade da colecao.`),
    `func ${updateName}(${names.pluralCamel} []${singularPascal}, id int, changes ${singularPascal}) ${singularPascal}MutationResult {`,
    `  ${names.singularCamel}Atual, ok := ${findName}(${names.pluralCamel}, id)`,
    '  if !ok {',
    `    return ${singularPascal}MutationResult{${pluralPascal}: ${names.pluralCamel}, ${singularPascal}: ${singularPascal}{}}`,
    '  }',
    `  ${names.singularCamel}Atualizado := clone${singularPascal}(${names.singularCamel}Atual)`,
    '  for chave, valor := range changes {',
    '    if chave != "id" {',
    `      ${names.singularCamel}Atualizado[chave] = valor`,
    '    }',
    '  }',
    `  novos${pluralPascal} := make([]${singularPascal}, 0, len(${names.pluralCamel}))`,
    `  for _, registro := range ${names.pluralCamel} {`,
    '    valor, ok := registro["id"].(int)',
    '    if ok && valor == id {',
    `      novos${pluralPascal} = append(novos${pluralPascal}, ${names.singularCamel}Atualizado)`,
    '      continue',
    '    }',
    `    novos${pluralPascal} = append(novos${pluralPascal}, registro)`,
    '  }',
    `  return ${singularPascal}MutationResult{${pluralPascal}: novos${pluralPascal}, ${singularPascal}: ${names.singularCamel}Atualizado}`,
    '}',
    '',
    goDocLine(removeName, `remove um ${names.singularSnake} da colecao de forma funcional.`),
    `func ${removeName}(${names.pluralCamel} []${singularPascal}, id int) ${singularPascal}MutationResult {`,
    `  ${names.singularCamel}Removido, _ := ${findName}(${names.pluralCamel}, id)`,
    `  novos${pluralPascal} := make([]${singularPascal}, 0, len(${names.pluralCamel}))`,
    `  for _, registro := range ${names.pluralCamel} {`,
    '    valor, ok := registro["id"].(int)',
    '    if ok && valor == id {',
    '      continue',
    '    }',
    `    novos${pluralPascal} = append(novos${pluralPascal}, registro)`,
    '  }',
    `  return ${singularPascal}MutationResult{${pluralPascal}: novos${pluralPascal}, ${singularPascal}: ${names.singularCamel}Removido}`,
    '}',
    '',
    goDocLine(`clone${singularPascal}`, `cria uma copia rasa de ${names.singularSnake} para preservar imutabilidade.`),
    `func clone${singularPascal}(origem ${singularPascal}) ${singularPascal} {`,
    `  copia := make(${singularPascal}, len(origem))`,
    '  for chave, valor := range origem {',
    '    copia[chave] = valor',
    '  }',
    '  return copia',
    '}',
  ].join('\n');
}
function generateRustCrudSnippet(entityName) {
  const names = crudEntityNames(entityName);
  const singularPascal = names.singularPascal;
  const pluralSnake = names.pluralSnake;
  const item = names.singularSnake;

  return [
    'pub type Registro = std::collections::HashMap<String, String>;',
    '',
    `pub struct ${singularPascal}MutationResult {`,
    `    pub ${pluralSnake}: Vec<Registro>,`,
    `    pub ${item}: Option<Registro>,`,
    '}',
    '',
    rustDocLine(`Retorna a colecao atual de ${pluralSnake} sem mutacao.`),
    `pub fn listar_${pluralSnake}(${pluralSnake}: &[Registro]) -> Vec<Registro> {`,
    `    ${pluralSnake}.to_vec()`,
    '}',
    '',
    rustDocLine(`Busca um ${item} pelo identificador informado.`),
    `pub fn buscar_${item}_por_id(${pluralSnake}: &[Registro], id: &str) -> Option<Registro> {`,
    `    ${pluralSnake}`,
    '        .iter()',
    '        .find(|registro| registro.get("id").map(String::as_str) == Some(id))',
    '        .cloned()',
    '}',
    '',
    rustDocLine(`Cria um novo ${item} sem alterar a colecao original.`),
    `pub fn criar_${item}(${pluralSnake}: &[Registro], payload: &Registro) -> ${singularPascal}MutationResult {`,
    '    let proximo_id =',
    `        ${pluralSnake}`,
    '            .iter()',
    '            .filter_map(|registro| registro.get("id").and_then(|valor| valor.parse::<usize>().ok()))',
    '            .max()',
    '            .unwrap_or(0)',
    '            + 1;',
    `    let mut novo_${item} = payload.clone();`,
    `    novo_${item}.insert("id".to_string(), proximo_id.to_string());`,
    `    let mut novos_${pluralSnake} = ${pluralSnake}.to_vec();`,
    `    novos_${pluralSnake}.push(novo_${item}.clone());`,
    `    ${singularPascal}MutationResult { ${pluralSnake}: novos_${pluralSnake}, ${item}: Some(novo_${item}) }`,
    '}',
    '',
    rustDocLine(`Atualiza um ${item} existente preservando a imutabilidade da colecao.`),
    `pub fn atualizar_${item}(${pluralSnake}: &[Registro], id: &str, changes: &Registro) -> ${singularPascal}MutationResult {`,
    `    let ${item}_atual = buscar_${item}_por_id(${pluralSnake}, id);`,
    `    let Some(base_${item}) = ${item}_atual.clone() else {`,
    `        return ${singularPascal}MutationResult { ${pluralSnake}: ${pluralSnake}.to_vec(), ${item}: None };`,
    '    };',
    `    let mut ${item}_atualizado = base_${item}.clone();`,
    '    for (chave, valor) in changes.iter() {',
    '        if chave != "id" {',
    `            ${item}_atualizado.insert(chave.clone(), valor.clone());`,
    '        }',
    '    }',
    `    let novos_${pluralSnake} = ${pluralSnake}`,
    '        .iter()',
    `        .map(|registro| if registro.get("id").map(String::as_str) == Some(id) { ${item}_atualizado.clone() } else { registro.clone() })`,
    '        .collect::<Vec<_>>();',
    `    ${singularPascal}MutationResult { ${pluralSnake}: novos_${pluralSnake}, ${item}: Some(${item}_atualizado) }`,
    '}',
    '',
    rustDocLine(`Remove um ${item} da colecao de forma funcional.`),
    `pub fn remover_${item}(${pluralSnake}: &[Registro], id: &str) -> ${singularPascal}MutationResult {`,
    `    let ${item}_removido = buscar_${item}_por_id(${pluralSnake}, id);`,
    `    let novos_${pluralSnake} = ${pluralSnake}`,
    '        .iter()',
    '        .filter(|registro| registro.get("id").map(String::as_str) != Some(id))',
    '        .cloned()',
    '        .collect::<Vec<_>>();',
    `    ${singularPascal}MutationResult { ${pluralSnake}: novos_${pluralSnake}, ${item}: ${item}_removido }`,
    '}',
  ].join('\n');
}
function generateLuaCrudSnippet(entityName) {
  const names = crudEntityNames(entityName);
  const collection = names.pluralSnake;
  const item = names.singularSnake;
  const listName =     `listar_${collection}`;
  const findName =     `buscar_${item}_por_id`;
  const createName =     `criar_${item}`;
  const updateName =     `atualizar_${item}`;
  const removeName =     `remover_${item}`;
  const cloneItemName =     `clone_${item}`;
  const cloneCollectionName =     `clone_${collection}`;

  return [
    `-- Funcao ${cloneItemName}: cria uma copia rasa de ${item} para evitar mutacao compartilhada.`,
    `local function ${cloneItemName}(origem)`,
    '  local copia = {}',
    '  for chave, valor in pairs(origem or {}) do',
    '    copia[chave] = valor',
    '  end',
    '  return copia',
    'end',
    '',
    `-- Funcao ${cloneCollectionName}: duplica a colecao preservando o contrato funcional do fluxo.`,
    `local function ${cloneCollectionName}(origem)`,
    '  local copia = {}',
    '  for indice, registro in ipairs(origem or {}) do',
    `    copia[indice] = ${cloneItemName}(registro)`,
    '  end',
    '  return copia',
    'end',
    '',
    `-- Funcao ${listName}: retorna a colecao atual de ${collection} sem mutacao.`,
    `function ${listName}(${collection})`,
    `  return ${cloneCollectionName}(${collection})`,
    'end',
    '',
    `-- Funcao ${findName}: busca um ${item} pelo identificador informado.`,
    `function ${findName}(${collection}, id)`,
    `  for _, registro in ipairs(${collection} or {}) do`,
    '    if registro.id == id then',
    `      return ${cloneItemName}(registro)`,
    '    end',
    '  end',
    '  return nil',
    'end',
    '',
    `-- Funcao ${createName}: cria um novo ${item} preservando a imutabilidade da colecao.`,
    `function ${createName}(${collection}, payload)`,
    '  local proximo_id = 1',
    `  for _, registro in ipairs(${collection} or {}) do`,
    '    local id_atual = tonumber(registro.id) or 0',
    '    if id_atual >= proximo_id then',
    '      proximo_id = id_atual + 1',
    '    end',
    '  end',
    `  local novo_${item} = ${cloneItemName}(payload or {})`,
    `  novo_${item}.id = proximo_id`,
    `  local novos_${collection} = ${cloneCollectionName}(${collection})`,
    `  table.insert(novos_${collection}, ${cloneItemName}(novo_${item}))`,
    '  return {',
    `    ${collection} = novos_${collection},`,
    `    ${item} = ${cloneItemName}(novo_${item}),`,
    '  }',
    'end',
    '',
    `-- Funcao ${updateName}: atualiza um ${item} existente preservando a imutabilidade da colecao.`,
    `function ${updateName}(${collection}, id, changes)`,
    `  local ${item}_atual = ${findName}(${collection}, id)`,
    `  if ${item}_atual == nil then`,
    '    return {',
    `      ${collection} = ${cloneCollectionName}(${collection}),`,
    `      ${item} = nil,`,
    '    }',
    '  end',
    `  local ${item}_atualizado = ${cloneItemName}(${item}_atual)`,
    '  for chave, valor in pairs(changes or {}) do',
    '    if chave ~= "id" then',
    `      ${item}_atualizado[chave] = valor`,
    '    end',
    '  end',
    `  local novos_${collection} = {}`,
    `  for indice, registro in ipairs(${collection} or {}) do`,
    '    if registro.id == id then',
    `      novos_${collection}[indice] = ${cloneItemName}(${item}_atualizado)`,
    '    else',
    `      novos_${collection}[indice] = ${cloneItemName}(registro)`,
    '    end',
    '  end',
    '  return {',
    `    ${collection} = novos_${collection},`,
    `    ${item} = ${cloneItemName}(${item}_atualizado),`,
    '  }',
    'end',
    '',
    `-- Funcao ${removeName}: remove um ${item} da colecao de forma funcional.`,
    `function ${removeName}(${collection}, id)`,
    `  local ${item}_removido = ${findName}(${collection}, id)`,
    `  local novos_${collection} = {}`,
    '  local proximo_indice = 1',
    `  for _, registro in ipairs(${collection} or {}) do`,
    '    if registro.id ~= id then',
    `      novos_${collection}[proximo_indice] = ${cloneItemName}(registro)`,
    '      proximo_indice = proximo_indice + 1',
    '    end',
    '  end',
    '  return {',
    `    ${collection} = novos_${collection},`,
    `    ${item} = ${item}_removido,`,
    '  }',
    'end',
  ].join('\n');
}
function generateGenericCrudSnippet(entityName, ext) {
  const prefix = commentPrefix(ext);
  const names = crudEntityNames(entityName);
  return [
    `${prefix} CRUD completo para ${names.singularSnake}:`,
    `${prefix} - listar_${names.pluralSnake}`,
    `${prefix} - buscar_${names.singularSnake}_por_id`,
    `${prefix} - criar_${names.singularSnake}`,
    `${prefix} - atualizar_${names.singularSnake}`,
    `${prefix} - remover_${names.singularSnake}`,
  ].join('\n');
}
function generateMarkdownSnippet(instruction) {
  const normalized = safeComment(instruction).replace(/[.:]+$/, '');
  const title = normalized
    ? normalized.charAt(0).toUpperCase() + normalized.slice(1)
    : 'Nova secao';

  if (/\b(checklist|check list|lista|todo)\b/i.test(instruction)) {
    return [
      '## ' + title,
      '',
      '- [ ] Item 1',
      '- [ ] Item 2',
    ].join('\n');
  }

  if (/\b(tabela|table)\b/i.test(instruction)) {
    return [
      '## ' + title,
      '',
      '| Campo | Valor |',
      '| --- | --- |',
      '| Exemplo | Descreva aqui |',
    ].join('\n');
  }

  return [
    '## ' + title,
    '',
    'Descreva aqui o objetivo, o contexto e os passos relevantes.',
  ].join('\n');
}
function generateCommentSnippet(instruction, ext) {
  const prefix = commentPrefix(ext);
  if (prefix === '#') {
    return `# TODO: ${instruction}\n# ${instruction}`;
  }
  if (prefix === '//') {
    return `// TODO: ${instruction}\n// ${instruction}`;
  }
  if (prefix === '"') {
    return `" TODO: ${instruction}\n" ${instruction}`;
  }
  return `-- TODO: ${instruction}\n-- ${instruction}`;
}
function generateTestSnippet(instruction, ext) {
  const comment = commentPrefix(ext);
  if (['.ex', '.exs'].includes(ext.toLowerCase())) {
    return [
      `test "validacao: ${safeComment(instruction)}" do`,
      '  assert true',
      'end',
    ].join('\n');
  }
  return [`${comment} validacao: ${safeComment(instruction)}`, 'assert_true(true) # TODO implementar'].join('\n');
}
function generateGenericSnippet(instruction, ext) {
  const prefix = commentPrefix(ext);
  const down = instruction.toLowerCase();
  const structuredConfigSnippet = generateStructuredConfigSnippet(instruction, ext);
  if (structuredConfigSnippet) {
    return structuredConfigSnippet;
  }
  const structureSnippet = generateStructureSnippet(instruction, ext);
  if (structureSnippet) {
    return structureSnippet;
  }
  if (/\b(debug|dbg|registr|log(?:ar|ado)?|temporario|temporaria)\b/i.test(down)) {
    if (['.ex', '.exs'].includes(ext.toLowerCase())) {
      return [
        'Logger.debug("TODO: revisar e manter somente logs estruturados")',
        '# TODO: substituir chamadas diretas de debug por logger estruturado.',
      ].join('\n');
    }
    if (['.js', '.jsx', '.ts', '.tsx'].includes(ext.toLowerCase())) {
      return [
        "console.debug('TODO: revisar log temporario antes do deploy')",
        '// TODO: remover logs temporarios antes do merge.',
      ].join('\n');
    }
    return `${prefix} TODO: substituir logs temporarios antes do merge\n${prefix} TODO: revisar pontos de debug`;
  }

  const replacementPair = parseVariableCorrectionRequest(instruction);
  if (replacementPair && replacementPair[0] && replacementPair[1]) {
    return [
      `${prefix} Corrige variavel ${replacementPair[0]} para ${replacementPair[1]}.`,
      `${prefix} Ajuste o trecho atual para manter o contrato da funcao.`,
    ].join('\n');
  }

  if (/\b(corrige|corrigir|corret|ajusta|ajustar|substitui|substituir|remove|remover|fix)\b/i.test(down)) {
    return `${prefix} Ajuste solicitado: alinhe o codigo ao contexto e mantenha a intencao do fluxo.`;
  }

  if (/\b(adiciona|adicionar|cria|criar|implementa|implementar|monta|montar|gera|gerar|executa|executar|add|implement)\b/i.test(down)) {
    return `${prefix} Implementacao solicitada:\n${prefix} ${safeComment(instruction)}`;
  }
  return `${prefix} Ajuste este ponto conforme o objetivo:\n${prefix} ${safeComment(instruction)}`;
}
function parseFunctionRequest(instruction) {
  const lower = instruction.toLowerCase();
  const tupleMatch = lower.match(/([a-z_][a-zA-Z0-9_?!]*)\s*\(([^)]*)\)/);
  if (tupleMatch) {
    return [sanitizeIdentifier(tupleMatch[1]), parseParams(tupleMatch[2])];
  }

  const namedFunctionMatch = instruction.match(
    /\b(?:funcao|função|function|metodo|método)\b(?:\s+(?:chamada|chamado|nomeada|nomeado|com\s+nome))?\s+([a-z_][a-zA-Z0-9_?!]*)/i,
  );
  if (namedFunctionMatch && namedFunctionMatch[1] && !isInstructionNoiseToken(namedFunctionMatch[1])) {
    const functionName = sanitizeIdentifier(namedFunctionMatch[1]);
    return [functionName, inferImplicitFunctionParams(functionName, instruction)];
  }

  const explicitMatch = instruction.match(
    /\b(?:crie|cria|criar|faça|faca|implemente|implementar|implementa|implementacao|escreva|escrever|monta|montar)\b.*?\b(?:funcao|função|function|metodo|método)\b(?:\s+(?:chamada|chamado|chama|nome|nomeada|com)\s+)?([a-z_][a-zA-Z0-9_?!]*)?/i,
  );
  if (explicitMatch && explicitMatch[1] && !isInstructionNoiseToken(explicitMatch[1])) {
    const functionName = sanitizeIdentifier(explicitMatch[1]);
    return [functionName, inferImplicitFunctionParams(functionName, instruction)];
  }

  if (/\b(funcao|função|function|metodo|método)\b/i.test(instruction)) {
    const functionName = inferFunctionNameFromInstruction(instruction);
    return [functionName, inferImplicitFunctionParams(functionName, instruction)];
  }

  const fnMatch = lower.match(
    /\b(?:implementa|implementar|implementacao|cria|criar|adiciona|adicionar|monta|montar|gera|gerar|faz|fazer|calcula|calcular|valida|validar|processa|processar)\s+([a-z_][a-zA-Z0-9_?!]*)/i,
  );
  if (fnMatch) {
    return [sanitizeIdentifier(fnMatch[1]), ['arg']];
  }

  const anyMatch = lower.match(/\b([a-z_][a-zA-Z0-9_?!]*)\b/);
  if (anyMatch) {
    return [sanitizeIdentifier(anyMatch[1]), ['arg']];
  }
  return ['agent_task', ['arg']];
}
function inferImplicitFunctionParams(name, instruction) {
  const normalizedName = sanitizeIdentifier(name);
  const normalizedInstruction = String(instruction || '').toLowerCase();
  const arithmeticContext = `${normalizedName} ${normalizedInstruction}`;
  const requestedParamCount = inferRequestedParamCount(arithmeticContext);
  const arithmeticOperator = inferArithmeticOperator(arithmeticContext);
  const arithmeticLiteral = extractArithmeticLiteral(arithmeticContext, arithmeticOperator);

  if (requestedParamCount === 1 && arithmeticOperator) {
    return [inferSingleParamName(arithmeticContext)];
  }

  if (requestedParamCount === 1) {
    return [inferSingleParamName(arithmeticContext)];
  }

  if (requestedParamCount >= 2) {
    return ['a', 'b'];
  }

  if (arithmeticLiteral && arithmeticOperator) {
    return [inferSingleParamName(arithmeticContext)];
  }

  if (arithmeticOperator) {
    return ['a', 'b'];
  }

  return [];
}
function inferRequestedParamCount(instruction) {
  const text = String(instruction || '').toLowerCase();
  if (/\b(?:recebe|receber|receive|receives)\s+(?:um|uma|one|1)\s+(?:numero|número|valor|parametro|parâmetro|argumento)\b/.test(text)) {
    return 1;
  }
  if (/\b(?:recebe|receber|receive|receives)\s+(?:dois|duas|two|2)\s+(?:numeros|números|valores|parametros|parâmetros|argumentos)\b/.test(text)) {
    return 2;
  }
  return 0;
}
function inferSingleParamName(instruction) {
  const text = String(instruction || '').toLowerCase();
  if (/\bnumero|número\b/.test(text)) {
    return 'numero';
  }
  if (/\btexto|string\b/.test(text)) {
    return 'texto';
  }
  if (/\bvalor\b/.test(text)) {
    return 'valor';
  }
  return 'valor';
}
function isInstructionNoiseToken(token) {
  return ['que', 'quea', 'para', 'com', 'uma', 'um', 'uma', 'de', 'do', 'da', 'das', 'dos', 'seja', 'deve', 'vai'].includes(String(token).toLowerCase());
}
function inferFunctionNameFromInstruction(instruction) {
  const lower = instruction.toLowerCase();
  const arithmeticOperator = inferArithmeticOperator(lower);
  const arithmeticLiteral = extractArithmeticLiteral(lower, arithmeticOperator);
  if (arithmeticOperator === '+' && arithmeticLiteral) {
    return `somar_${arithmeticLiteral.replace('.', '_').replace('-', 'menos_')}`;
  }
  if (arithmeticOperator === '-') {
    return arithmeticLiteral ? `subtrair_${arithmeticLiteral.replace('.', '_').replace('-', 'menos_')}` : 'subtrair';
  }
  if (arithmeticOperator === '*') {
    return arithmeticLiteral ? `multiplicar_por_${arithmeticLiteral.replace('.', '_').replace('-', 'menos_')}` : 'multiplicar';
  }
  if (arithmeticOperator === '/') {
    return arithmeticLiteral ? `dividir_por_${arithmeticLiteral.replace('.', '_').replace('-', 'menos_')}` : 'dividir';
  }
  if (/\bsoma\b/.test(lower)) {
    return 'soma';
  }
  if (/\bretorn(?:a|e|ar)?\b/.test(lower)) {
    const numeric = lower.match(/\b(?:retorna|retorne|retornar|resultado|valor|devolve|devolver)\b[^0-9a-zA-Z_\\-]*([+-]?\d+(?:\.\d+)?)\b/);
    if (numeric && numeric[1]) {
      return `retornar_valor_${numeric[1].replace('.', '_')}`;
    }
    return 'retornar_valor';
  }
  if (/\bcalcula|calcular\b/.test(lower)) {
    return 'calculo';
  }
  return 'funcao_gerada';
}
function parseParams(rawParams) {
  return rawParams
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => (token === 'arg' ? 'arg' : sanitizeIdentifier(token)))
    .map((token) => (token.length === 0 ? 'arg' : token))
    .concat();
}
function inferArithmeticContract(name, params, instruction, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  if (!Array.isArray(params) || params.length < 1) {
    return null;
  }

  const arithmeticContext = `${sanitizeIdentifier(name)} ${String(instruction || '').toLowerCase()}`;
  const operator = inferArithmeticOperator(arithmeticContext);
  if (!operator) {
    return null;
  }
  const literal = extractArithmeticLiteral(arithmeticContext, operator);

  if (lowerExt === '.go') {
    return {
      params: params.map((param) => `${sanitizeIdentifier(param)} float64`).join(', '),
      returnType: ' float64',
    };
  }

  if (lowerExt === '.rs') {
    return {
      params: params.map((param) => `${toSnakeCaseIdentifier(param)}: f64`).join(', '),
      returnType: ' -> f64',
    };
  }

  if (['.c', '.cpp', '.h', '.hpp'].includes(lowerExt)) {
    return {
      params: params.map((param) => `double ${sanitizeIdentifier(param)}`).join(', '),
      returnType: 'double',
    };
  }

  if (literal && params.length >= 1) {
    return {
      params: params.join(', '),
      returnType: '',
    };
  }

  return null;
}
function functionSignature(name, params, instruction, ext) {
  const lowerExt = ext.toLowerCase();
  const paramsText = params.join(', ');
  if (['.ex', '.exs'].includes(lowerExt)) {
    return [`def ${sanitizeIdentifier(name)}(${paramsText}) do`, 'end'];
  }
  if (['.js', '.jsx', '.ts', '.tsx'].includes(lowerExt)) {
    return [`function ${sanitizeIdentifier(name)}(${paramsText}) {`, '}'];
  }
  if (lowerExt === '.vim') {
    return [`function! ${sanitizeIdentifier(name)}(${paramsText})`, 'endfunction'];
  }
  if (lowerExt === '.go') {
    const arithmeticContract = inferArithmeticContract(name, params, instruction, ext);
    if (arithmeticContract) {
      return [`func ${toCamelCaseIdentifier(name)}(${arithmeticContract.params})${arithmeticContract.returnType} {`, '}'];
    }
    const goParams = params.map((param) => `${sanitizeIdentifier(param)} any`).join(', ');
    return [`func ${toCamelCaseIdentifier(name)}(${goParams}) any {`, '}'];
  }
  if (lowerExt === '.rs') {
    const arithmeticContract = inferArithmeticContract(name, params, instruction, ext);
    if (arithmeticContract) {
      return [`fn ${toSnakeCaseIdentifier(name)}(${arithmeticContract.params})${arithmeticContract.returnType} {`, '}'];
    }
    const rustParams = params.map((param) => `${toSnakeCaseIdentifier(param)}: &str`).join(', ');
    return [`fn ${toSnakeCaseIdentifier(name)}(${rustParams}) {`, '}'];
  }
  if (lowerExt === '.py') {
    return [`def ${sanitizeIdentifier(name)}(${paramsText}):`, 'none'];
  }
  if (['.c', '.cpp', '.h', '.hpp'].includes(lowerExt)) {
    const arithmeticContract = inferArithmeticContract(name, params, instruction, ext);
    if (arithmeticContract) {
      return [`${arithmeticContract.returnType} ${sanitizeIdentifier(name)}(${arithmeticContract.params}) {`, '}'];
    }
    const cParams = params.length > 0
      ? params.map((param) => `double ${sanitizeIdentifier(param)}`).join(', ')
      : 'void';
    return [`void ${sanitizeIdentifier(name)}(${cParams}) {`, '}'];
  }
  if (lowerExt === '.rb') {
    return [`def ${sanitizeIdentifier(name)}(${paramsText})`, 'end'];
  }
  if (lowerExt === '.lua') {
    return [`function ${sanitizeIdentifier(name)}(${paramsText})`, 'end'];
  }
  return [`function ${sanitizeIdentifier(name)}(${paramsText}) {`, '}'];
}
function functionBodyHint(instruction, params, ext) {
  const low = instruction.toLowerCase();
  const lowerExt = ext.toLowerCase();
  const inferredExpression = inferInstructionExpression(low, ext);
  if (inferredExpression) {
    return baseHint(inferredExpression, ext);
  }
  const arithmeticExpression = inferArithmeticExpression(low, params);
  if (arithmeticExpression) {
    return baseHint(arithmeticExpression, ext);
  }
  const explicitValue = extractLiteralFromInstruction(low);
  if (explicitValue) {
    return baseHint(explicitValue, ext);
  }
  if (lowerExt === '.rs') {
    return `todo!("implementar logica: ${safeComment(instruction)}")`;
  }
  if (low.includes('return')) {
    return baseHint('nil', ext);
  }
  if (['.ex', '.exs', '.rb'].includes(lowerExt)) {
    return `# TODO: implementar logica para: ${safeComment(instruction)}`;
  }
  if (['.lua', '.vim'].includes(lowerExt)) {
    return `${commentPrefix(ext)} TODO: implementar logica para: ${safeComment(instruction)}`;
  }
  return `${commentPrefix(ext)} TODO: implement logic: ${safeComment(instruction)}`;
}
function inferArithmeticExpression(instruction, params) {
  if (!Array.isArray(params) || params.length < 1) {
    return '';
  }

  const text = String(instruction || '').toLowerCase();
  const operator = inferArithmeticOperator(text);
  if (!operator) {
    return '';
  }
  const literal = extractArithmeticLiteral(text, operator);
  if (literal) {
    return `${params[0]} ${operator} ${literal}`;
  }
  if (params.length < 2) {
    return '';
  }
  const left = params[0];
  const right = params[1];
  return `${left} ${operator} ${right}`;
}
function inferArithmeticOperator(instruction) {
  const text = String(instruction || '').toLowerCase();
  if (/\b(soma|somar|sum|add|adicao|adição)\b/.test(text)) {
    return '+';
  }
  if (/\b(subtracao|subtração|subtrair|subtract)\b/.test(text)) {
    return '-';
  }
  if (/\b(multiplicacao|multiplicação|multiplicar|multiply)\b/.test(text)) {
    return '*';
  }
  if (/\b(divisao|divisão|dividir|divide)\b/.test(text)) {
    return '/';
  }
  return '';
}
function extractArithmeticLiteral(instruction, operator) {
  const text = String(instruction || '').toLowerCase();
  if (emptyString(operator)) {
    return '';
  }
  const escapedOperator = escapeRegExp(operator);
  const operatorMatch = text.match(new RegExp(`${escapedOperator}\\s*([+-]?\\d+(?:\\.\\d+)?)\\b`));
  if (operatorMatch && operatorMatch[1]) {
    return operatorMatch[1];
  }

  if (operator === '+') {
    const keywordMatch = text.match(/\b(?:soma|somar|add|adiciona|adicionar)\s+([+-]?\d+(?:\.\d+)?)\b/);
    if (keywordMatch && keywordMatch[1]) {
      return keywordMatch[1];
    }
  }
  if (operator === '-') {
    const keywordMatch = text.match(/\b(?:subtrai|subtrair|subtract|remove|remover)\s+([+-]?\d+(?:\.\d+)?)\b/);
    if (keywordMatch && keywordMatch[1]) {
      return keywordMatch[1];
    }
  }
  if (operator === '*') {
    const keywordMatch = text.match(/\b(?:multiplica|multiplicar|multiply)\s+(?:por\s+)?([+-]?\d+(?:\.\d+)?)\b/);
    if (keywordMatch && keywordMatch[1]) {
      return keywordMatch[1];
    }
  }
  if (operator === '/') {
    const keywordMatch = text.match(/\b(?:divide|dividir)\s+(?:por\s+)?([+-]?\d+(?:\.\d+)?)\b/);
    if (keywordMatch && keywordMatch[1]) {
      return keywordMatch[1];
    }
  }
  return '';
}
function emptyString(value) {
  return String(value || '') === '';
}
function inferInstructionExpression(instruction, ext) {
  const diceSides = extractDiceSides(instruction);
  if (!diceSides) {
    return '';
  }
  return diceExpressionForLanguage(diceSides, ext);
}
function extractDiceSides(instruction) {
  const text = String(instruction || '').toLowerCase();
  const explicitDice = text.match(/\bd(\d+)\b/);
  if (explicitDice && explicitDice[1]) {
    return Number.parseInt(explicitDice[1], 10);
  }

  if (/\bdado\b|\bdice\b/.test(text)) {
    if (/\brpg\b/.test(text)) {
      return 20;
    }
    return 6;
  }

  return 0;
}
function diceExpressionForLanguage(sides, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  if (['.ex', '.exs'].includes(lowerExt)) {
    return `Enum.random(1..${sides})`;
  }
  if (isJavaScriptLikeExtension(lowerExt)) {
    return `Math.floor(Math.random() * ${sides}) + 1`;
  }
  if (isPythonLikeExtension(lowerExt)) {
    return `random.randint(1, ${sides})`;
  }
  if (isGoExtension(lowerExt)) {
    return `rand.Intn(${sides}) + 1`;
  }
  if (lowerExt === '.rb') {
    return `rand(1..${sides})`;
  }
  if (lowerExt === '.lua') {
    return `math.random(1, ${sides})`;
  }
  return '';
}
function extractLiteralFromInstruction(instruction) {
  const numeric = instruction.match(
    /\b(?:retorna|retorne|retornar|devolve|devolver|resultado|valor)\b[^0-9a-zA-Z\-_]*([+-]?\d+(?:\.\d+)?)\b/,
  );
  if (numeric && numeric[1]) {
    return numeric[1];
  }

  const boolMatch = instruction.match(/\b(verdadeiro|falso|true|false)\b/);
  if (boolMatch && boolMatch[1]) {
    return /^(verdadeiro|true)$/i.test(boolMatch[1]) ? 'true' : 'false';
  }

  const quoted = instruction.match(/"([^"]+)"|'([^']+)'/);
  if (quoted) {
    return `"${quoted[1] || quoted[2]}"`;
  }

  return '';
}
function baseHint(expr, ext) {
  if (['.c', '.cpp', '.h', '.hpp', '.java', '.cs'].includes(ext.toLowerCase())) {
    return `return ${expr};`;
  }
  if (['.py', '.js', '.jsx', '.ts', '.tsx', '.go', '.kts', '.kt', '.lua', '.vim'].includes(ext.toLowerCase())) {
    return `return ${expr}`;
  }
  return expr;
}

function resolveProjectRoot(file) {
  const startDir = path.dirname(path.resolve(file));
  const markers = ['.git', 'tests', 'test', 'package.json', 'pyproject.toml', 'setup.py', 'mix.exs', 'go.mod', 'Cargo.toml'];
  const resolved = findUpwards(startDir, (currentDir) => markers.some((marker) => pathExists(path.join(currentDir, marker))));
  return resolved || startDir;
}
function findUpwards(startDir, matcher) {
  let currentDir = path.resolve(startDir);
  while (true) {
    if (matcher(currentDir)) {
      return currentDir;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return '';
    }
    currentDir = parentDir;
  }
}
function pathExists(targetPath) {
  try {
    fs.accessSync(targetPath);
    return true;
  } catch (_error) {
    return false;
  }
}
function upwardDepth(fromDir, toDir) {
  const relative = path.relative(path.resolve(fromDir), path.resolve(toDir));
  if (!relative) {
    return 0;
  }

  return relative.split(path.sep).filter(Boolean).length;
}
function toImportPath(relativePath) {
  const normalized = toPosixPath(relativePath);
  if (!normalized) {
    return './';
  }
  if (normalized.startsWith('.')) {
    return normalized;
  }

  return `./${normalized}`;
}
function toPosixPath(value) {
  return String(value || '').split(path.sep).join('/');
}

module.exports = {
  analysisExtension,
  bestPracticesFor,
  checkCommentTask,
  checkUnitTestCoverage,
  checkMissingDependencies,
  buildLeadingFunctionDocumentation,
  isJavaScriptLikeExtension,
  isReactLikeExtension,
  isPythonLikeExtension,
  isGoExtension,
  isRustExtension,
  isRubyExtension,
};
