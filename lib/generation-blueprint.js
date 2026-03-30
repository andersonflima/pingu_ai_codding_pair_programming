'use strict';

const fs = require('fs');
const path = require('path');

function createBlueprintTools(deps) {
  const {
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
  } = deps;

  function buildContextBlueprintTasks(_lines, file, lineNumber, instruction) {
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
      architecture: 'onion',
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
    const languageGuidance = buildOfflineLanguageGuidance(blueprint.sourceExt);
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
      '## Cobertura offline da linguagem',
      `- Perfil: ${languageGuidance.profileId}`,
      ...languageGuidance.offlineCapabilityDescriptions.map((description) => `- ${description}`),
      '',
      '## Boas praticas da linguagem',
      ...languageGuidance.bestPractices.map((practice) => `- ${practice}`),
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
      { role: 'entidade de dominio', targetFile: files.entityFile, contents: buildOnionEntityFile(blueprint) },
      { role: 'porta de repositorio', targetFile: files.repositoryFile, contents: buildOnionRepositoryContractFile(blueprint) },
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

  return {
    buildContextBlueprintTasks,
    generateBlueprintAwareSnippet,
    loadActiveBlueprintContext,
  };
}

module.exports = {
  createBlueprintTools,
};
