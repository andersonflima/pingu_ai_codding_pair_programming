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
const { buildOfflineLanguageGuidance, createLanguageSnippetLibrary } = require('./language-snippets');
const { createBlueprintTools } = require('./generation-blueprint');
const { createCommentTaskTools } = require('./generation-comment-task');
const { createDependencyTools } = require('./generation-dependencies');
const { createTerminalTaskTools } = require('./generation-terminal-task');
const { createStructuredGenerators } = require('./generation-structured');
const { createUiSnippetGenerator } = require('./generation-react');
const { createUnitTestCoverageChecker } = require('./generation-unit-tests');

const {
  generateStructuredConfigSnippet,
  generateStructureSnippet,
  parseVariableCorrectionRequest,
  structuredTaskAlreadyApplied,
} = createStructuredGenerators({
  sanitizeNaturalIdentifier,
  escapeRegExp,
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

const { deriveOfflineFunctionPlan } = createLanguageSnippetLibrary({
  inferInstructionExpression,
  extractLiteralFromInstruction,
  inferArithmeticOperator,
  extractArithmeticLiteral,
  inferRequestedParamCount,
  inferSingleParamName,
});

const { buildSnippetDependencyIssues, checkMissingDependencies } = createDependencyTools({
  escapeRegExp,
  inferModuleStyle,
  isGoExtension,
  isJavaScriptLikeExtension,
  isPythonLikeExtension,
  isRustExtension,
});

const { inferTerminalTaskAction } = createTerminalTaskTools({
  analysisExtension,
  isGoExtension,
  isPythonLikeExtension,
  isRubyExtension,
  isRustExtension,
  pathExists,
  resolveProjectRoot,
  safeComment,
});

const { buildContextBlueprintTasks, generateBlueprintAwareSnippet, loadActiveBlueprintContext } = createBlueprintTools({
  analysisExtension,
  buildOfflineLanguageGuidance,
  crudEntityNames,
  escapeRegExp,
  generateCrudSnippet,
  isJavaScriptLikeExtension,
  jsDocBlock,
  parseCrudEntityName,
  pathExists,
  resolveProjectRoot,
  sanitizeNaturalIdentifier,
  toImportPath,
  toPosixPath,
  upperFirst,
});

const { checkCommentTask } = createCommentTaskTools({
  analysisExtension,
  buildContextBlueprintTasks,
  buildSnippetDependencyIssues,
  commentTaskAlreadyApplied,
  inferTerminalTaskAction,
  isMermaidExtension,
  normalizeGeneratedTaskResult,
  supportsHashComments,
  supportsSlashComments,
  synthesizeFromCommentTask,
});

function normalizeGeneratedTaskResult(result, ext = '') {
  let normalized = { snippet: '', dependencies: [] };
  let metadata = {};
  if (!result) {
    normalized = { snippet: '', dependencies: [] };
  } else if (typeof result === 'string') {
    normalized = { snippet: result, dependencies: [] };
  } else {
    metadata = { ...result };
    delete metadata.snippet;
    delete metadata.dependencies;
    normalized = {
      snippet: String(result.snippet || ''),
      dependencies: Array.isArray(result.dependencies) ? result.dependencies : [],
    };
  }

  return {
    ...metadata,
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
function commentTaskAlreadyApplied(lines, commentIndex, generatedTask, ext = '') {
  if (structuredTaskAlreadyApplied(lines, commentIndex, generatedTask, ext)) {
    return true;
  }

  const snippet = typeof generatedTask === 'string'
    ? generatedTask
    : String(generatedTask && generatedTask.snippet || '');
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
      || /^[A-Za-z_][A-Za-z0-9_]*\s*\(\)\s*\{$/.test(line)
      || /^function!?\s+(?:[gswbtlav]:)?[A-Za-z_#][A-Za-z0-9_:#]*\s*\(/.test(line)
    ) {
      signatureLines.push(line);
    }
  }
  return signatureLines;
}
function analysisExtension(fileOrExt) {
  return resolveAnalysisExtension(fileOrExt);
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
function isShellExtension(ext) {
  return analysisExtension(ext) === '.sh';
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
  if (/\b(enum|class|classe|interface|contrato|type|struct|module|modulo|módulo|namespace|variavel|variável|constante|lista|array|vetor|colecao|coleção|objeto|mapa|dicionario|dicionário)\b/i.test(instruction)) {
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
  if (isShellExtension(ext)) {
    const shellSnippet = generateShellFunctionSnippet(instruction);
    const shellName = extractGeneratedFunctionName(shellSnippet, ext);
    return decorateGeneratedSnippet(shellSnippet, shellName, [], instruction, ext, { lines, sourceFile });
  }

  const databaseFunction = generateDatabaseFunctionSnippet(instruction, ext, lines);
  if (databaseFunction) {
    const databaseName = extractGeneratedFunctionName(databaseFunction.snippet, ext);
    return decorateGeneratedSnippet(databaseFunction, databaseName, [], instruction, ext, { lines, sourceFile });
  }

  const [name, params] = parseFunctionRequest(instruction);
  const offlineFunctionPlan = deriveOfflineFunctionPlan({ instruction, ext, name, params });
  const resolvedName = offlineFunctionPlan && offlineFunctionPlan.name ? offlineFunctionPlan.name : name;
  const resolvedParams = offlineFunctionPlan && Array.isArray(offlineFunctionPlan.params)
    ? offlineFunctionPlan.params
    : params;
  const body = offlineFunctionPlan
    ? baseHint(offlineFunctionPlan.expression, ext)
    : functionBodyHint(instruction, resolvedParams, ext);
  const snippet = buildRenderedFunctionSnippet(resolvedName, resolvedParams, instruction, ext, body);
  return decorateGeneratedSnippet(snippet, resolvedName, resolvedParams, instruction, ext, { lines, sourceFile });
}
function buildRenderedFunctionSnippet(name, params, instruction, ext, body) {
  const [signature, closer] = functionSignature(name, params, instruction, ext);
  const bodyIndent = functionBodyIndent(ext);
  const functionLines = [`${signature}`];
  const inlineDocBlock = buildInlineFunctionDocumentation(name, params, instruction, ext);
  if (inlineDocBlock) {
    functionLines.push(...inlineDocBlock.split('\n'));
  }
  functionLines.push(`${bodyIndent}${body}`);
  if (closer === 'none') {
    return functionLines.join('\n');
  }
  functionLines.push(closer);
  return functionLines.join('\n');
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
    } else if (String(ext || '').toLowerCase() === '.sh') {
      match = line.match(/^([a-z_][a-zA-Z0-9_]*)\s*\(\)\s*\{/);
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
function generateShellFunctionSnippet(instruction) {
  const [rawName, params] = parseFunctionRequest(instruction);
  const functionName = sanitizeIdentifier(rawName || inferFunctionNameFromInstruction(instruction));
  const normalizedParams = Array.isArray(params)
    ? params.map((param) => sanitizeNaturalIdentifier(param)).filter(Boolean)
    : [];

  return [
    `${functionName}() {`,
    ...normalizedParams.map((param, index) => `  ${param}="$${index + 1}"`),
    ...buildShellFunctionBody(instruction, normalizedParams).map((line) => `  ${line}`),
    '}',
  ].join('\n');
}

function buildShellFunctionBody(instruction, params) {
  const lowerInstruction = String(instruction || '').toLowerCase();
  const arithmeticExpression = inferArithmeticExpression(lowerInstruction, params);
  if (arithmeticExpression) {
    return [`printf '%s\\n' "$(( ${arithmeticExpression} ))"`];
  }

  const explicitLiteral = extractLiteralFromInstruction(lowerInstruction);
  if (explicitLiteral) {
    return [`printf '%s\\n' ${explicitLiteral}`];
  }

  return [
    `printf '%s\\n' ${JSON.stringify(`TODO: implementar logica para: ${safeComment(instruction)}`)}`,
  ];
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
function fallbackImplementationMessage(instruction) {
  return safeComment(instruction) || 'implementar fluxo solicitado';
}
function vimStringLiteral(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}
function executablePlaceholderStatement(instruction, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  const message = `implementar: ${fallbackImplementationMessage(instruction)}`;

  if (['.js', '.jsx', '.ts', '.tsx'].includes(lowerExt)) {
    return `throw new Error(${JSON.stringify(message)});`;
  }
  if (isPythonLikeExtension(lowerExt)) {
    return `raise NotImplementedError(${JSON.stringify(message)})`;
  }
  if (['.ex', '.exs'].includes(lowerExt)) {
    return `raise ${JSON.stringify(message)}`;
  }
  if (lowerExt === '.go') {
    return `panic(${JSON.stringify(message)})`;
  }
  if (lowerExt === '.rs') {
    return `unimplemented!(${JSON.stringify(message)})`;
  }
  if (lowerExt === '.rb') {
    return `raise NotImplementedError, ${JSON.stringify(message)}`;
  }
  if (lowerExt === '.lua') {
    return `error(${JSON.stringify(message)})`;
  }
  if (lowerExt === '.vim') {
    return `throw ${vimStringLiteral(message)}`;
  }
  if (isShellExtension(lowerExt)) {
    return `printf '%s\\n' ${JSON.stringify(message)} >&2; return 1`;
  }
  if (['.c', '.cpp', '.h', '.hpp'].includes(lowerExt)) {
    return 'return;';
  }
  return `${commentPrefix(ext)} ${message}`;
}
function executablePlaceholderSnippet(instruction, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  const message = fallbackImplementationMessage(instruction);

  if (['.js', '.jsx', '.ts', '.tsx'].includes(lowerExt)) {
    return `throw new Error(${JSON.stringify(`Implementacao pendente: ${message}`)});`;
  }
  if (isPythonLikeExtension(lowerExt)) {
    return `raise NotImplementedError(${JSON.stringify(`implementacao pendente: ${message}`)})`;
  }
  if (['.ex', '.exs'].includes(lowerExt)) {
    return `raise ${JSON.stringify(`implementacao pendente: ${message}`)}`;
  }
  if (lowerExt === '.go') {
    return `panic(${JSON.stringify(`implementacao pendente: ${message}`)})`;
  }
  if (lowerExt === '.rs') {
    return `unimplemented!(${JSON.stringify(`implementacao pendente: ${message}`)})`;
  }
  if (lowerExt === '.rb') {
    return `raise NotImplementedError, ${JSON.stringify(`implementacao pendente: ${message}`)}`;
  }
  if (lowerExt === '.lua') {
    return `error(${JSON.stringify(`implementacao pendente: ${message}`)})`;
  }
  if (lowerExt === '.vim') {
    return `throw ${vimStringLiteral(`implementacao pendente: ${message}`)}`;
  }
  if (isShellExtension(lowerExt)) {
    return [
      'set -eu',
      '',
      'main() {',
      `  printf '%s\\n' ${JSON.stringify(message)} >&2`,
      '  return 1',
      '}',
      '',
      'main "$@"',
    ].join('\n');
  }
  if (['.c', '.cpp', '.h', '.hpp'].includes(lowerExt)) {
    return [
      'void executar_fluxo_pendente(void) {',
      '  return;',
      '}',
    ].join('\n');
  }
  return `${commentPrefix(ext)} Implementacao pendente: ${message}`;
}
function generateTestSnippet(instruction, ext) {
  const lowerExt = ext.toLowerCase();
  const testTitle = fallbackImplementationMessage(instruction);
  const testName = toSnakeCaseIdentifier(testTitle) || 'validacao_basica';
  const pascalTestName = upperFirst(toCamelCaseIdentifier(testTitle) || 'ValidacaoBasica');

  if (['.js', '.jsx', '.ts', '.tsx'].includes(lowerExt)) {
    return [
      `test(${JSON.stringify(testTitle)}, () => {`,
      '  expect(true).toBe(true);',
      '});',
    ].join('\n');
  }
  if (['.ex', '.exs'].includes(lowerExt)) {
    return [
      `test "validacao: ${testTitle}" do`,
      '  assert true',
      'end',
    ].join('\n');
  }
  if (isPythonLikeExtension(lowerExt)) {
    return [
      `def test_${testName}():`,
      '    assert True',
    ].join('\n');
  }
  if (lowerExt === '.go') {
    return [
      `func Test${pascalTestName}(t *testing.T) {`,
      '  if !true {',
      '    t.Fatal("expected true")',
      '  }',
      '}',
    ].join('\n');
  }
  if (lowerExt === '.rs') {
    return [
      '#[test]',
      `fn ${testName}() {`,
      '    assert!(true);',
      '}',
    ].join('\n');
  }
  if (lowerExt === '.rb') {
    return [
      `def test_${testName}`,
      '  assert true',
      'end',
    ].join('\n');
  }
  if (lowerExt === '.lua') {
    return [
      `local function test_${testName}()`,
      '  assert(true)',
      'end',
    ].join('\n');
  }
  if (lowerExt === '.vim') {
    return [
      `function! Test_${pascalTestName}() abort`,
      '  call assert_true(v:true)',
      'endfunction',
    ].join('\n');
  }
  if (isShellExtension(lowerExt)) {
    return [
      `test_${testName}() {`,
      '  [ 1 -eq 1 ]',
      '}',
    ].join('\n');
  }
  if (['.c', '.cpp', '.h', '.hpp'].includes(lowerExt)) {
    return [
      '#include <assert.h>',
      '',
      `static void test_${testName}(void) {`,
      '  assert(1);',
      '}',
    ].join('\n');
  }

  return `${commentPrefix(ext)} validacao: ${testTitle}`;
}
function generateShellScriptSnippet(instruction) {
  const explicitLiteral = extractLiteralFromInstruction(String(instruction || ''));
  const shellMessage = explicitLiteral || JSON.stringify(fallbackImplementationMessage(instruction));

  return [
    'set -eu',
    '',
    'main() {',
    `  printf '%s\\n' ${shellMessage}`,
    '}',
    '',
    'main "$@"',
  ].join('\n');
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
  if (isShellExtension(ext)) {
    return generateShellScriptSnippet(instruction);
  }
  if (/\b(debug|dbg|registr|log(?:ar|ado)?|temporario|temporaria)\b/i.test(down)) {
    if (['.ex', '.exs'].includes(ext.toLowerCase())) {
      return 'Logger.debug("revisar log temporario antes do deploy")';
    }
    if (['.js', '.jsx', '.ts', '.tsx'].includes(ext.toLowerCase())) {
      return "console.debug('revisar log temporario antes do deploy');";
    }
    return `${prefix} revisar log temporario antes do merge`;
  }

  const replacementPair = parseVariableCorrectionRequest(instruction);
  if (replacementPair && replacementPair[0] && replacementPair[1]) {
    return [
      `${prefix} Corrige variavel ${replacementPair[0]} para ${replacementPair[1]}.`,
      `${prefix} Ajuste o trecho atual para manter o contrato da funcao.`,
    ].join('\n');
  }

  if (/\b(corrige|corrigir|corret|ajusta|ajustar|substitui|substituir|remove|remover|fix)\b/i.test(down)) {
    return executablePlaceholderSnippet(instruction, ext);
  }

  if (/\b(adiciona|adicionar|cria|criar|implementa|implementar|monta|montar|gera|gerar|executa|executar|add|implement)\b/i.test(down)) {
    return executablePlaceholderSnippet(instruction, ext);
  }
  return executablePlaceholderSnippet(instruction, ext);
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
    if (extractDiceSides(instruction)) {
      return [`int ${sanitizeIdentifier(name)}(void) {`, '}'];
    }
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
  return executablePlaceholderStatement(instruction, ext);
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

  const describedDice = text.match(/\b(?:dado|dice)\s+(?:de\s+)?(\d+)\s+(?:lados?|faces?|sides?)\b/);
  if (describedDice && describedDice[1]) {
    return Number.parseInt(describedDice[1], 10);
  }

  const sidedRoll = text.match(/\b(\d+)\s+(?:lados?|faces?|sides?)\b/);
  if (sidedRoll && sidedRoll[1] && /\b(?:dado|dice|rolagem|random|aleatorio|aleatório)\b/.test(text)) {
    return Number.parseInt(sidedRoll[1], 10);
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
  if (['.c', '.cpp', '.h', '.hpp'].includes(lowerExt)) {
    return `(rand() % ${sides}) + 1`;
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
