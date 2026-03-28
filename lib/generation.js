'use strict';

const path = require('path');
const fs = require('fs');
const { snippetFunctionSpec, functionDescriptionFromName, safeComment, commentPrefix, sanitizeIdentifier, sanitizeNaturalIdentifier, escapeRegExp, buildMaintenanceComment } = require('./support');

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
    .replace(/^\s*:\s*/, '')
    .trim();
}
function isActionableCommentTask(instruction) {
  return instruction.length >= 4;
}
function analysisExtension(fileOrExt) {
  const source = String(fileOrExt || '');
  if (source.startsWith('.')) {
    return source.toLowerCase();
  }
  const base = path.basename(source).toLowerCase();
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) {
    return '.dockerfile';
  }
  return path.extname(source).toLowerCase();
}
function commentTaskPattern(ext) {
  const lowerExt = analysisExtension(ext);
  if (['.ex', '.exs', '.rb', '.py', '.sh', '.toml', '.yaml', '.yml', '.tf', '.dockerfile'].includes(lowerExt)) {
    return /^\s*#\s*:\s*(.+)$/;
  }
  if (lowerExt === '.md') {
    return /^\s*<!--\s*:\s*(.+?)\s*-->\s*$/;
  }
  if (['.js', '.jsx', '.ts', '.tsx', '.go', '.java', '.kts', '.kt', '.cs', '.c', '.cpp', '.h', '.hpp', '.rs', '.scala', '.swift'].includes(lowerExt)) {
    return /^\s*\/\/\s*:\s*(.+)$/;
  }
  if (lowerExt === '.lua') {
    return /^\s*--\s*:\s*(.+)$/;
  }
  if (lowerExt === '.vim') {
    return /^\s*"\s*:\s*(.+)$/;
  }
  return /^\s*(?:#|\/\/|--|")\s*:\s*(.+)$/;
}
function synthesizeFromCommentTask(instruction, ext, lines = []) {
function synthesizeFromCommentTask(instruction, ext, lines = []) {
  const normalizedExt = analysisExtension(ext);
  if (normalizedExt === '.md') {
    return generateMarkdownSnippet(instruction);
  }
  const down = instruction.toLowerCase();
  const classified = classifyCommentTask(down);
  if (classified === 'example') {
    return generateExampleSnippet(instruction, ext);
  }
  if (classified === 'crud') {
    return generateCrudSnippet(instruction, ext);
  }
  if (classified === 'ui') {
    return generateUiSnippet(instruction, ext, lines);
  }
  if (classified === 'structure') {
    return generateStructureSnippet(instruction, ext);
  }
  if (classified === 'function') {
    return generateFunctionSnippet(instruction, ext, lines);
  }
  if (classified === 'comment') {
    return generateCommentSnippet(instruction, ext);
  }
  if (classified === 'test') {
    return generateTestSnippet(instruction, ext);
  }
  return generateGenericSnippet(instruction, ext);
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

    const instruction = normalizeCommentInstruction(match[1]);
    if (!isActionableCommentTask(instruction)) {
      return;
    }

    const generatedTask = normalizeGeneratedTaskResult(
      synthesizeFromCommentTask(instruction, ext, lines),
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
  return ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(ext.toLowerCase());
}
function isReactLikeExtension(ext) {
  return ['.jsx', '.tsx'].includes(String(ext || '').toLowerCase());
}
function isPythonLikeExtension(ext) {
  return ['.py'].includes(ext.toLowerCase());
}
function isGoExtension(ext) {
  return ['.go'].includes(ext.toLowerCase());
}
function isRustExtension(ext) {
  return ['.rs'].includes(ext.toLowerCase());
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
function generateFunctionSnippet(instruction, ext, lines = []) {
  const databaseFunction = generateDatabaseFunctionSnippet(instruction, ext, lines);
  if (databaseFunction) {
    const databaseName = extractGeneratedFunctionName(databaseFunction.snippet, ext);
    return decorateGeneratedSnippet(databaseFunction, databaseName, [], instruction, ext);
  }

  const [name, params] = parseFunctionRequest(instruction);
  const [signature, closer] = functionSignature(name, params, ext);
  const body = functionBodyHint(instruction, params, ext);
  const bodyIndent = functionBodyIndent(ext);
  const functionLines = [`${signature}`];
  const inlineDocBlock = buildInlineFunctionDocumentation(name, params, instruction, ext);
  if (inlineDocBlock) {
    functionLines.push(...inlineDocBlock.split('\n'));
  }
  functionLines.push(`${bodyIndent}${body}`);
  if (closer === 'none') {
    return decorateGeneratedSnippet(functionLines.join('\n'), name, params, instruction, ext);
  }
  functionLines.push(closer);
  return decorateGeneratedSnippet(functionLines.join('\n'), name, params, instruction, ext);
}
function decorateGeneratedSnippet(result, name, params, instruction, ext) {
  const normalized = normalizeGeneratedTaskResult(result, ext);
  const decoratedSnippet = addLeadingFunctionDocumentation(normalized.snippet, name, params, instruction, ext);
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
  if (!snippet || !extractGeneratedFunctionName(snippet, ext)) {
    return false;
  }
  if (isPythonLikeExtension(ext)) {
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
function generateUiSnippet(instruction, ext, lines = []) {
  if (isReactLikeExtension(ext)) {
    return generateReactUiSnippet(instruction, ext, lines);
  }
  return generateGenericSnippet(instruction, ext);
}
function functionBodyIndent(ext) {
  const lowerExt = String(ext || '').toLowerCase();
  if (lowerExt === '.py') {
    return '    ';
  }
  return '  ';
}
function generateReactUiSnippet(instruction, ext, lines = []) {
  const lowerInstruction = String(instruction || '').toLowerCase();
  const componentName = inferReactComponentName(lowerInstruction);
  const style = inferModuleStyle(ext, lines);

  if (/\blogin\b/.test(lowerInstruction)) {
    return decorateGeneratedSnippet({
      snippet: [
        `export function ${componentName}() {`,
        '  const [form, setForm] = useState({ email: "", password: "" });',
        '  const [isSubmitting, setIsSubmitting] = useState(false);',
        '',
        '  function handleChange(event) {',
        '    const { name, value } = event.target;',
        '    setForm((current) => ({ ...current, [name]: value }));',
        '  }',
        '',
        '  function handleSubmit(event) {',
        '    event.preventDefault();',
        '    setIsSubmitting(true);',
        '  }',
        '',
        '  return (',
        '    <main className="login-screen">',
        '      <section className="login-card">',
        '        <header className="login-card__header">',
        '          <p className="login-card__eyebrow">Acesso seguro</p>',
        '          <h1>Entrar na plataforma</h1>',
        '          <p>Use seu e-mail corporativo e senha para continuar.</p>',
        '        </header>',
        '',
        '        <form className="login-form" onSubmit={handleSubmit}>',
        '          <label className="login-form__field" htmlFor="email">',
        '            <span>E-mail</span>',
        '            <input',
        '              id="email"',
        '              name="email"',
        '              type="email"',
        '              autoComplete="email"',
        '              value={form.email}',
        '              onChange={handleChange}',
        '              placeholder="voce@empresa.com"',
        '              required',
        '            />',
        '          </label>',
        '',
        '          <label className="login-form__field" htmlFor="password">',
        '            <span>Senha</span>',
        '            <input',
        '              id="password"',
        '              name="password"',
        '              type="password"',
        '              autoComplete="current-password"',
        '              value={form.password}',
        '              onChange={handleChange}',
        '              placeholder="Digite sua senha"',
        '              required',
        '            />',
        '          </label>',
        '',
        '          <button className="login-form__submit" type="submit" disabled={isSubmitting}>',
        '            {isSubmitting ? "Entrando..." : "Entrar"}',
        '          </button>',
        '        </form>',
        '      </section>',
        '    </main>',
        '  );',
        '}',
      ].join('\n'),
      dependencies: [jsDependencySpec('named', 'useState', 'react', style)],
    }, componentName, [], instruction, ext);
  }

  return decorateGeneratedSnippet({
    snippet: [
      `export function ${componentName}() {`,
      '  return (',
      '    <section>',
      `      <h1>${safeJsxText(instruction)}</h1>`,
      '    </section>',
      '  );',
      '}',
    ].join('\n'),
    dependencies: [],
  }, componentName, [], instruction, ext);
}
function inferReactComponentName(instruction) {
  if (/\blogin\b/.test(instruction)) {
    return 'LoginScreen';
  }
  if (/\bdashboard\b/.test(instruction)) {
    return 'DashboardScreen';
  }
  if (/\bmodal\b/.test(instruction)) {
    return 'ModalView';
  }
  return 'GeneratedScreen';
}
function safeJsxText(value) {
  return String(value || '').replace(/[{}]/g, '').trim();
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
  ].join('
');
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
  const match = instruction.match(
    /\b(?:troca|trocar|substitui|substituir|substitua|corrige|corrigir|corrija)\s+([a-z_][a-zA-Z0-9_?!]*)\s+(?:por|para|=>|->)\s+([a-z_][a-zA-Z0-9_?!]*)/i,
  );
  if (!match) {
    return null;
  }
  return [match[1].trim(), match[2].trim()];
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
    return [sanitizeIdentifier(namedFunctionMatch[1]), []];
  }

  const explicitMatch = instruction.match(
    /\b(?:crie|cria|criar|faça|faca|implemente|implementar|implementa|implementacao|escreva|escrever|monta|montar)\b.*?\b(?:funcao|função|function|metodo|método)\b(?:\s+(?:chamada|chamado|chama|nome|nomeada|com)\s+)?([a-z_][a-zA-Z0-9_?!]*)?/i,
  );
  if (explicitMatch && explicitMatch[1] && !isInstructionNoiseToken(explicitMatch[1])) {
    return [sanitizeIdentifier(explicitMatch[1]), []];
  }

  if (/\b(funcao|função|function|metodo|método)\b/i.test(instruction)) {
    return [inferFunctionNameFromInstruction(instruction), []];
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
function isInstructionNoiseToken(token) {
  return ['que', 'quea', 'para', 'com', 'uma', 'um', 'uma', 'de', 'do', 'da', 'das', 'dos', 'seja', 'deve', 'vai'].includes(String(token).toLowerCase());
}
function inferFunctionNameFromInstruction(instruction) {
  const lower = instruction.toLowerCase();
  if (/\bretorn(?:a|e|ar)?\b/.test(lower)) {
    const numeric = lower.match(/\b(?:retorna|retorne|retornar|resultado|valor|devolve|devolver)\b[^0-9a-zA-Z_\\-]*([+-]?\d+(?:\.\d+)?)\b/);
    if (numeric && numeric[1]) {
      return `retornar_valor_${numeric[1].replace('.', '_')}`;
    }
    return 'retornar_valor';
  }
  if (/\bsoma\b/.test(lower)) {
    return 'soma';
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
function functionSignature(name, params, ext) {
  const paramsText = params.join(', ');
  if (['.ex', '.exs'].includes(ext.toLowerCase())) {
    return [`def ${sanitizeIdentifier(name)}(${paramsText}) do`, 'end'];
  }
  if (['.js', '.jsx', '.ts', '.tsx'].includes(ext.toLowerCase())) {
    return [`function ${sanitizeIdentifier(name)}(${paramsText}) {`, '}'];
  }
  if (ext.toLowerCase() === '.vim') {
    return [`function! ${sanitizeIdentifier(name)}(${paramsText})`, 'endfunction'];
  }
  if (ext.toLowerCase() === '.go') {
    const goParams = params.map((param) => `${sanitizeIdentifier(param)} any`).join(', ');
    return [`func ${toCamelCaseIdentifier(name)}(${goParams}) any {`, '}'];
  }
  if (ext.toLowerCase() === '.rs') {
    const rustParams = params.map((param) => `${toSnakeCaseIdentifier(param)}: &str`).join(', ');
    return [`fn ${toSnakeCaseIdentifier(name)}(${rustParams}) {`, '}'];
  }
  if (ext.toLowerCase() === '.py') {
    return [`def ${sanitizeIdentifier(name)}(${paramsText}):`, 'none'];
  }
  if (ext.toLowerCase() === '.rb') {
    return [`def ${sanitizeIdentifier(name)}(${paramsText})`, 'end'];
  }
  if (ext.toLowerCase() === '.lua') {
    return [`function ${sanitizeIdentifier(name)}(${paramsText})`, 'end'];
  }
  return [`function ${sanitizeIdentifier(name)}(${paramsText}) {`, '}'];
}
function functionBodyHint(instruction, params, ext) {
  const low = instruction.toLowerCase();
  const lowerExt = ext.toLowerCase();
  if (lowerExt === '.rs') {
    return `todo!("implementar logica: ${safeComment(instruction)}")`;
  }
  const inferredExpression = inferInstructionExpression(low, ext);
  if (inferredExpression) {
    return baseHint(inferredExpression, ext);
  }
  const explicitValue = extractLiteralFromInstruction(low);
  if (explicitValue) {
    return baseHint(explicitValue, ext);
  }
  const hasSum = low.includes('soma') || low.includes('sum');
  if (hasSum && params.length >= 2) {
    return baseHint(`${params[0]} + ${params[1]}`, ext);
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
  if (['.py', '.js', '.jsx', '.ts', '.tsx', '.go', '.java', '.kts', '.kt', '.c', '.cpp', '.h', '.hpp', '.cs', '.lua', '.vim'].includes(ext.toLowerCase())) {
    return `return ${expr}`;
  }
  return expr;
}

function checkUnitTestCoverage(lines, file) {
  const ext = path.extname(file).toLowerCase();
  if (shouldSkipUnitTestCoverage(file, ext)) {
    return [];
  }

  const candidates = extractTestCandidates(lines, file);
  if (!candidates.length) {
    return [];
  }

  const targetFile = resolveUnitTestTargetFile(file, ext);
  if (!targetFile || fs.existsSync(targetFile)) {
    return [];
  }

  const snippet = buildUnitTestSnippet(lines, file, targetFile, candidates, ext);
  if (!snippet) {
    return [];
  }

  return [
    {
      file,
      line: candidates[0].line || 1,
      severity: 'info',
      kind: 'unit_test',
      message: 'Cobertura basica de testes unitarios ausente',
      suggestion: 'Crie testes unitarios em tests/ para validar o contrato publico do codigo.',
      snippet,
      action: {
        op: 'write_file',
        target_file: targetFile,
        mkdir_p: true,
      },
    },
  ];
}
function shouldSkipUnitTestCoverage(file, ext) {
  const normalized = toPosixPath(file).toLowerCase();
  if (
    normalized.includes('/tests/')
    || normalized.endsWith('_test.go')
    || normalized.endsWith('_test.py')
    || normalized.endsWith('_test.exs')
    || normalized.endsWith('_spec.lua')
    || normalized.endsWith('_test.vim')
    || normalized.endsWith('.test.js')
    || normalized.endsWith('.test.jsx')
    || normalized.endsWith('.test.ts')
    || normalized.endsWith('.test.tsx')
    || normalized.endsWith('.spec.js')
    || normalized.endsWith('.spec.jsx')
    || normalized.endsWith('.spec.ts')
    || normalized.endsWith('.spec.tsx')
    || normalized.endsWith('_test.rs')
  ) {
    return true;
  }

  return !supportedUnitTestExtensions().includes(ext);
}
function supportedUnitTestExtensions() {
  return ['.js', '.jsx', '.ts', '.tsx', '.py', '.ex', '.exs', '.go', '.rs', '.lua', '.vim'];
}
function resolveUnitTestTargetFile(file, ext) {
  const projectRoot = resolveProjectRoot(file);
  const relativeSource = path.relative(projectRoot, file);
  if (!relativeSource || relativeSource.startsWith('..')) {
    return '';
  }

  const parsed = path.parse(relativeSource);
  const sourceDir = parsed.dir && parsed.dir !== '.' ? parsed.dir : '';
  const baseName = parsed.name;
  const lowerExt = String(ext || '').toLowerCase();

  if (isJavaScriptLikeExtension(lowerExt)) {
    return path.join(projectRoot, 'tests', sourceDir, `${baseName}.test${lowerExt}`);
  }
  if (isPythonLikeExtension(lowerExt)) {
    return path.join(projectRoot, 'tests', sourceDir, `test_${baseName}.py`);
  }
  if (['.ex', '.exs'].includes(lowerExt)) {
    return path.join(projectRoot, 'tests', sourceDir, `${baseName}_test.exs`);
  }
  if (isGoExtension(lowerExt)) {
    return path.join(projectRoot, 'tests', sourceDir, `${baseName}_test.go`);
  }
  if (isRustExtension(lowerExt)) {
    return path.join(projectRoot, 'tests', sourceDir, `${baseName}_test.rs`);
  }
  if (lowerExt === '.lua') {
    return path.join(projectRoot, 'tests', sourceDir, `${baseName}_spec.lua`);
  }
  if (lowerExt === '.vim') {
    return path.join(projectRoot, 'tests', sourceDir, `${baseName}_test.vim`);
  }

  return '';
}
function resolveProjectRoot(file) {
  const startDir = path.dirname(path.resolve(file));
  const markers = ['.git', 'package.json', 'pyproject.toml', 'setup.py', 'mix.exs', 'go.mod', 'Cargo.toml'];
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
function extractTestCandidates(lines, file) {
  const ext = path.extname(file).toLowerCase();
  if (isJavaScriptLikeExtension(ext)) {
    return extractJavaScriptTestCandidates(lines);
  }
  if (isPythonLikeExtension(ext)) {
    return extractPythonTestCandidates(lines);
  }
  if (['.ex', '.exs'].includes(ext)) {
    return extractElixirTestCandidates(lines);
  }
  if (isGoExtension(ext)) {
    return extractGoTestCandidates(lines);
  }
  if (isRustExtension(ext)) {
    return extractRustTestCandidates(lines);
  }
  if (ext === '.lua') {
    return extractLuaTestCandidates(lines);
  }
  if (ext === '.vim') {
    return extractVimTestCandidates(lines);
  }
  return [];
}
function extractJavaScriptTestCandidates(lines) {
  const candidates = [];
  const seen = new Set();
  const patterns = [
    /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/,
    /^\s*(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/,
    /^\s*export\s+const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/,
    /^\s*const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/,
  ];

  lines.forEach((line, index) => {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (!match) {
        continue;
      }

      const name = sanitizeIdentifier(match[1]);
      if (!name || seen.has(name)) {
        break;
      }

      seen.add(name);
      candidates.push({ name, arity: countParams(match[2]), line: index + 1 });
      break;
    }
  });

  return candidates;
}
function extractPythonTestCandidates(lines) {
  const candidates = [];
  const seen = new Set();

  lines.forEach((line, index) => {
    const match = line.match(/^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*:/);
    if (!match) {
      return;
    }

    const name = sanitizeIdentifier(match[1]);
    if (!name || name.startsWith('__') || seen.has(name)) {
      return;
    }

    seen.add(name);
    candidates.push({ name, arity: countParams(match[2]), line: index + 1 });
  });

  return candidates;
}
function extractElixirTestCandidates(lines) {
  const candidates = [];
  const seen = new Set();
  const moduleName = extractElixirModuleName(lines);

  lines.forEach((line, index) => {
    let match = line.match(/^\s*def\s+([a-z_][a-zA-Z0-9_?!]*)\s*\(([^)]*)\)/);
    if (!match) {
      match = line.match(/^\s*def\s+([a-z_][a-zA-Z0-9_?!]*)\s*do\b/);
    }
    if (!match) {
      return;
    }

    const name = sanitizeIdentifier(match[1]);
    if (!name || seen.has(name)) {
      return;
    }

    seen.add(name);
    candidates.push({ name, arity: countParams(match[2] || ''), line: index + 1, moduleName });
  });

  return candidates.filter((candidate) => candidate.moduleName);
}
function extractGoTestCandidates(lines) {
  const candidates = [];
  const seen = new Set();

  lines.forEach((line, index) => {
    const match = line.match(/^\s*func(?:\s*\([^)]*\))?\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/);
    if (!match) {
      return;
    }

    const name = sanitizeIdentifier(match[1]);
    if (!name || !/^[A-Z]/.test(name) || seen.has(name)) {
      return;
    }

    seen.add(name);
    candidates.push({ name, arity: countParams(match[2]), line: index + 1 });
  });

  return candidates;
}
function extractRustTestCandidates(lines) {
  const candidates = [];
  const seen = new Set();

  lines.forEach((line, index) => {
    const match = line.match(/^\s*pub\s+fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/);
    if (!match) {
      return;
    }

    const name = sanitizeIdentifier(match[1]);
    if (!name || seen.has(name)) {
      return;
    }

    seen.add(name);
    candidates.push({ name, arity: countParams(match[2]), line: index + 1 });
  });

  return candidates;
}
function extractLuaTestCandidates(lines) {
  const candidates = [];
  const seen = new Set();
  const patterns = [
    /^\s*local\s+function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/,
    /^\s*function\s+([A-Za-z_][A-Za-z0-9_.:]*)\s*\(([^)]*)\)/,
  ];

  lines.forEach((line, index) => {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (!match) {
        continue;
      }

      const rawName = String(match[1] || '').split(/[.:]/).pop();
      const name = sanitizeIdentifier(rawName);
      if (!name || seen.has(name)) {
        break;
      }

      seen.add(name);
      candidates.push({ name, arity: countParams(match[2]), line: index + 1 });
      break;
    }
  });

  return candidates;
}
function extractVimTestCandidates(lines) {
  const candidates = [];
  const seen = new Set();

  lines.forEach((line, index) => {
    const match = line.match(/^\s*function!?\s+((?:[gswbtlav]:)?[A-Za-z_#][A-Za-z0-9_:#]*)\s*\(([^)]*)\)/);
    if (!match) {
      return;
    }

    const rawName = String(match[1] || '').trim();
    if (!rawName || /^s:/.test(rawName) || seen.has(rawName)) {
      return;
    }

    seen.add(rawName);
    candidates.push({ name: rawName, arity: countParams(match[2]), line: index + 1 });
  });

  return candidates;
}
function extractElixirModuleName(lines) {
  for (const line of lines) {
    const match = String(line || '').match(/^\s*defmodule\s+([A-Za-z0-9_.]+)\s+do/);
    if (match && match[1]) {
      return match[1];
    }
  }

  return '';
}
function countParams(paramsText) {
  const normalized = String(paramsText || '').trim();
  if (!normalized) {
    return 0;
  }

  return normalized.split(',').map((part) => part.trim()).filter(Boolean).length;
}
function buildUnitTestSnippet(lines, file, targetFile, candidates, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  if (isJavaScriptLikeExtension(lowerExt)) {
    return buildJavaScriptUnitTestSnippet(file, targetFile, candidates, lowerExt);
  }
  if (isPythonLikeExtension(lowerExt)) {
    return buildPythonUnitTestSnippet(file, targetFile, candidates);
  }
  if (['.ex', '.exs'].includes(lowerExt)) {
    return buildElixirUnitTestSnippet(file, targetFile, candidates);
  }
  if (isGoExtension(lowerExt)) {
    return buildGoUnitTestSnippet(file, candidates);
  }
  if (isRustExtension(lowerExt)) {
    return buildRustUnitTestSnippet(file, candidates);
  }
  if (lowerExt === '.lua') {
    return buildLuaUnitTestSnippet(file, targetFile, candidates);
  }
  if (lowerExt === '.vim') {
    return buildVimUnitTestSnippet(file, targetFile, candidates);
  }
  return '';
}
function buildJavaScriptUnitTestSnippet(file, targetFile, candidates, ext) {
  const importPath = toImportPath(path.relative(path.dirname(targetFile), file));
  const moduleStyle = detectNodeModuleStyle(file, ext);
  const lines = [];

  if (moduleStyle === 'require') {
    lines.push('// Valida o contrato publico do modulo sem acoplar o teste aos detalhes internos.');
    lines.push("const test = require('node:test');");
    lines.push("const assert = require('node:assert/strict');");
    lines.push(`const subject = require(${JSON.stringify(importPath)});`);
  } else {
    lines.push('// Valida o contrato publico do modulo sem acoplar o teste aos detalhes internos.');
    lines.push("import test from 'node:test';");
    lines.push("import assert from 'node:assert/strict';");
    lines.push(`import * as subject from ${JSON.stringify(importPath)};`);
  }

  lines.push('');
  candidates.forEach((candidate, index) => {
    if (index > 0) {
      lines.push('');
    }
    lines.push(`// Garante que ${candidate.name} continua exposta como parte do contrato em foco.`);
    lines.push(`test(${JSON.stringify(`${candidate.name} permanece disponivel`)}, () => {`);
    lines.push(`  assert.equal(typeof subject.${candidate.name}, 'function');`);
    lines.push('});');
  });

  return lines.join('\n');
}
function detectNodeModuleStyle(file, ext) {
  if (['.ts', '.tsx'].includes(ext)) {
    return 'import';
  }

  const packageDir = findUpwards(path.dirname(path.resolve(file)), (currentDir) => pathExists(path.join(currentDir, 'package.json')));
  if (!packageDir) {
    return ext === '.js' ? 'require' : 'import';
  }

  const packageJsonPath = path.join(packageDir, 'package.json');
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return packageJson.type === 'module' ? 'import' : 'require';
  } catch (_error) {
    return ext === '.js' ? 'require' : 'import';
  }
}
function buildPythonUnitTestSnippet(file, targetFile, candidates) {
  const projectRoot = resolveProjectRoot(file);
  const rootDepth = upwardDepth(path.dirname(targetFile), projectRoot);
  const sourceRelative = toPosixPath(path.relative(projectRoot, file));
  const lines = [
    '"""Valida o contrato publico do modulo em foco sem acoplar o teste ao detalhe interno."""',
    '',
    'import importlib.util',
    'import unittest',
    'from pathlib import Path',
    '',
    `SOURCE_FILE = Path(__file__).resolve().parents[${rootDepth}] / ${JSON.stringify(sourceRelative)}`,
    'SPEC = importlib.util.spec_from_file_location("module_under_test", SOURCE_FILE)',
    'assert SPEC and SPEC.loader is not None',
    'module_under_test = importlib.util.module_from_spec(SPEC)',
    'SPEC.loader.exec_module(module_under_test)',
    '',
    'class ModuleContractTest(unittest.TestCase):',
    '    """Confirma que as entradas publicas continuam disponiveis para manutencao."""',
  ];

  candidates.forEach((candidate) => {
    lines.push('');
    lines.push(`    def test_${candidate.name}_continua_disponivel(self):`);
    lines.push(`        """Garante que ${candidate.name} permanece acessivel como funcao publica."""`);
    lines.push(`        self.assertTrue(callable(module_under_test.${candidate.name}))`);
  });

  lines.push('');
  lines.push('if __name__ == "__main__":');
  lines.push('    unittest.main()');
  return lines.join('\n');
}
function buildElixirUnitTestSnippet(file, targetFile, candidates) {
  const moduleName = candidates[0] && candidates[0].moduleName ? candidates[0].moduleName : '';
  if (!moduleName) {
    return '';
  }

  const sourceRelative = toPosixPath(path.relative(path.dirname(targetFile), file));
  const testModuleName = `${moduleName}Test`;
  const lines = [
    'ExUnit.start()',
    '',
    '# Carrega o modulo em foco para validar o contrato publico sem acoplamento ao restante da aplicacao.',
    `Code.require_file(Path.expand(${JSON.stringify(sourceRelative)}, __DIR__))`,
    '',
    `defmodule ${testModuleName} do`,
    '  use ExUnit.Case, async: true',
    '',
    '  @moduletag :unit',
  ];

  candidates.forEach((candidate) => {
    lines.push('');
    lines.push(`  test ${JSON.stringify(`${candidate.name}/${candidate.arity} permanece disponivel`)} do`);
    lines.push(`    assert function_exported?(${moduleName}, :${candidate.name}, ${candidate.arity})`);
    lines.push('  end');
  });

  lines.push('end');
  return lines.join('\n');
}
function buildGoUnitTestSnippet(file, candidates) {
  const importPath = resolveGoImportPath(file);
  if (!importPath) {
    return '';
  }

  const lines = [
    'package tests',
    '',
    'import (',
    '    "reflect"',
    '    "testing"',
    '',
    `    subject ${JSON.stringify(importPath)}`,
    ')',
  ];

  candidates.forEach((candidate) => {
    lines.push('');
    lines.push(`// Test${candidate.name}IsAvailable garante que ${candidate.name} continua exposta para o fluxo publico.`);
    lines.push(`func Test${candidate.name}IsAvailable(t *testing.T) {`);
    lines.push(`    if reflect.ValueOf(subject.${candidate.name}).Kind() != reflect.Func {`);
    lines.push(`        t.Fatalf(${JSON.stringify(`${candidate.name} deve continuar disponivel como funcao exportada`)})`);
    lines.push('    }');
    lines.push('}');
  });

  return lines.join('\n');
}
function resolveGoImportPath(file) {
  const moduleRoot = findUpwards(path.dirname(path.resolve(file)), (currentDir) => pathExists(path.join(currentDir, 'go.mod')));
  if (!moduleRoot) {
    return '';
  }

  const goModPath = path.join(moduleRoot, 'go.mod');
  const goModContent = fs.readFileSync(goModPath, 'utf8');
  const moduleMatch = goModContent.match(/^module\s+(.+)$/m);
  if (!moduleMatch || !moduleMatch[1]) {
    return '';
  }

  const relativeDir = toPosixPath(path.dirname(path.relative(moduleRoot, file)));
  if (!relativeDir || relativeDir === '.') {
    return moduleMatch[1].trim();
  }

  return `${moduleMatch[1].trim()}/${relativeDir}`;
}
function buildRustUnitTestSnippet(file, candidates) {
  const crateName = resolveCargoPackageName(file);
  if (!crateName) {
    return '';
  }

  const sourcePath = path.resolve(file);
  const cargoRoot = findUpwards(path.dirname(sourcePath), (currentDir) => pathExists(path.join(currentDir, 'Cargo.toml')));
  if (!cargoRoot) {
    return '';
  }

  const relativeSource = toPosixPath(path.relative(path.join(cargoRoot, 'src'), sourcePath));
  if (!relativeSource || relativeSource.startsWith('..') || relativeSource === 'main.rs') {
    return '';
  }

  const moduleSegments = relativeSource.replace(/\.rs$/, '').split('/').filter(Boolean);
  if (moduleSegments[moduleSegments.length - 1] === 'mod') {
    moduleSegments.pop();
  }

  const lines = ['// Valida o contrato publico do modulo em foco sem acoplamento ao detalhe interno.'];
  candidates.forEach((candidate, index) => {
    const importPath = [crateName, ...moduleSegments, candidate.name].join('::');
    lines.push(`use ${importPath};`);
    if (index === candidates.length - 1) {
      lines.push('');
    }
  });

  candidates.forEach((candidate, index) => {
    if (index > 0) {
      lines.push('');
    }
    lines.push(`// Garante que ${candidate.name} permanece disponivel no contrato publico.`);
    lines.push('#[test]');
    lines.push(`fn ${candidate.name}_is_available() {`);
    lines.push(`    let function_reference = ${candidate.name};`);
    lines.push('    let _ = function_reference;');
    lines.push('}');
  });

  return lines.join('\n');
}
function resolveCargoPackageName(file) {
  const cargoRoot = findUpwards(path.dirname(path.resolve(file)), (currentDir) => pathExists(path.join(currentDir, 'Cargo.toml')));
  if (!cargoRoot) {
    return '';
  }

  const cargoToml = fs.readFileSync(path.join(cargoRoot, 'Cargo.toml'), 'utf8');
  const packageMatch = cargoToml.match(/^name\s*=\s*"([^"]+)"/m);
  if (!packageMatch || !packageMatch[1]) {
    return '';
  }

  return packageMatch[1].replace(/-/g, '_');
}
function buildLuaUnitTestSnippet(file, targetFile, candidates) {
  const relativeSource = toPosixPath(path.relative(path.dirname(targetFile), file));
  const lines = [
    '-- Valida o contrato publico do modulo em foco sem acoplamento aos detalhes internos.',
    'local current_dir = debug.getinfo(1, "S").source:sub(2):match("(.*/)") or "./"',
    `local module_under_test = dofile(current_dir .. ${JSON.stringify(relativeSource)})`,
  ];

  candidates.forEach((candidate) => {
    lines.push('');
    lines.push(`-- Garante que ${candidate.name} continua disponivel para consumo do restante da base.`);
    lines.push(`local ${candidate.name}_ref = _G[${JSON.stringify(candidate.name)}]`);
    lines.push(`if type(${candidate.name}_ref) ~= 'function' and type(module_under_test) == 'table' then`);
    lines.push(`  ${candidate.name}_ref = module_under_test[${JSON.stringify(candidate.name)}]`);
    lines.push('end');
    lines.push(`assert(type(${candidate.name}_ref) == 'function', ${JSON.stringify(`${candidate.name} deve continuar disponivel como funcao`)})`);
  });

  return lines.join('\n');
}
function buildVimUnitTestSnippet(file, targetFile, candidates) {
  const relativeSource = toPosixPath(path.relative(path.dirname(targetFile), file));
  const lines = [
    `let s:test_dir = fnamemodify(expand(${JSON.stringify('<sfile>:p')}), ${JSON.stringify(':h')})`,
    `execute ${JSON.stringify('source ')} . fnameescape(fnamemodify(s:test_dir . ${JSON.stringify('/' + relativeSource)}, ${JSON.stringify(':p')}))`,
    '',
  ];

  candidates.forEach((candidate, index) => {
    const testName = candidate.name.replace(/[^A-Za-z0-9]+/g, '_');
    lines.push('" Garante que a funcao continua disponivel para o contrato publico.');
    lines.push(`function! Test_${testName}_exists() abort`);
    lines.push(`  call assert_true(exists('*' . ${JSON.stringify(candidate.name)}))`);
    lines.push('endfunction');
    if (index !== candidates.length - 1) {
      lines.push('');
    }
  });

  return lines.join('\n');
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
  checkCommentTask,
  checkUnitTestCoverage,
  checkMissingDependencies,
  buildLeadingFunctionDocumentation,
  isJavaScriptLikeExtension,
  isPythonLikeExtension,
  isGoExtension,
  isRustExtension,
};
