'use strict';

const path = require('path');
const {
  cDependencySpec,
  dependencySpecKey,
  elixirRequireSpec,
  goDependencySpec,
  jsDependencySpec,
  pythonDependencySpec,
  rustDependencySpec,
  uniqueDependencySpecs,
} = require('./dependency-specs');

function createDependencyTools(deps) {
  const {
    escapeRegExp,
    inferModuleStyle,
    isGoExtension,
    isJavaScriptLikeExtension,
    isPythonLikeExtension,
    isRustExtension,
  } = deps;

  function buildSnippetDependencyIssues(lines, file, lineNumber, snippet, instruction, ext, hintedDependencies = []) {
    const dependencies = inferSnippetDependencies(snippet, instruction, ext, lines, hintedDependencies);
    return buildMissingDependencyIssues(lines, file, dependencies, lineNumber);
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

  function inferSnippetDependencies(snippet, instruction, ext, lines, hintedDependencies = []) {
    const dependencies = [...hintedDependencies];
    const lowerExt = String(ext || '').toLowerCase();
    const text = String(snippet || '');
    const lowerInstruction = String(instruction || '').toLowerCase();

    if (['.ex', '.exs'].includes(lowerExt) && /\bLogger\.(debug|info|notice|warning|error|critical|alert|emergency)\b/.test(text)) {
      dependencies.push(elixirRequireSpec('Logger'));
    }

    if (isJavaScriptLikeExtension(lowerExt)) {
      const style = inferModuleStyle(lowerExt, lines);
      const isPrisma = /\bPrismaClient\b/.test(text) || /\bprisma\b/.test(lowerInstruction);
      const isMongo = /\bnew\s+MongoClient\s*\(/.test(text) || /\bmongo\b|\bmongodb\b/.test(lowerInstruction);
      const isMysql = /\bmysql\.createConnection\b/.test(text) || /\bmysql\b/.test(lowerInstruction);
      const isPostgresLike = /\bnew\s+Pool\s*\(/.test(text) || (!isPrisma && !isMongo && !isMysql && /\bpostgres\b|\bpostgresql\b|\bdatabase\b|\bbanco\b|\bdb\b/.test(lowerInstruction));

      if (/\buseState\s*\(/.test(text)) {
        dependencies.push(jsDependencySpec('named', 'useState', 'react', style));
      }
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

    if (['.c', '.cpp', '.h', '.hpp'].includes(lowerExt)) {
      if (/\brand\s*\(/.test(text)) {
        dependencies.push(cDependencySpec('stdlib.h'));
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

    if (['.c', '.cpp', '.h', '.hpp'].includes(ext) && /\brand\s*\(/.test(text)) {
      dependencies.push(cDependencySpec('stdlib.h'));
    }

    return uniqueDependencySpecs(dependencies);
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

    if (dependency.language === 'c') {
      return new RegExp(`^\\s*#include\\s+<${escapeRegExp(dependency.source)}>`, 'm').test(text);
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
    if (dependency.language === 'c') {
      return findCDependencyInsertion(lines, fallbackLine);
    }
    return fallbackLine > 1 ? { line: fallbackLine, op: 'insert_before' } : { line: 1, op: 'insert_before' };
  }

  function findJavaScriptDependencyInsertion(lines) {
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

  function findPythonDependencyInsertion(lines) {
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

  function findRustDependencyInsertion(lines) {
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

  function findCDependencyInsertion(lines, fallbackLine) {
    let lastIncludeLine = 0;

    for (let index = 0; index < lines.length; index += 1) {
      const line = String(lines[index] || '');
      const trimmed = line.trim();
      if (!trimmed) {
        if (lastIncludeLine > 0) {
          break;
        }
        continue;
      }
      if (/^\s*#include\s+[<"][^>"]+[>"]/.test(line)) {
        lastIncludeLine = index + 1;
        continue;
      }
      if (/^\s*\/\*/.test(line) || /^\s*\*/.test(line) || /^\s*\/\//.test(line)) {
        continue;
      }
      break;
    }

    if (lastIncludeLine > 0) {
      return { line: lastIncludeLine, op: 'insert_after' };
    }
    return fallbackLine > 1 ? { line: fallbackLine, op: 'insert_before' } : { line: 1, op: 'insert_before' };
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
    if (dependency.language === 'c') {
      return `Cabecalho '${dependency.source}' sem include`;
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
    if (dependency.language === 'c') {
      return `Adicione #include <${dependency.source}> para compilar o trecho gerado sem erro.`;
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
    if (dependency.language === 'c') {
      return `#include <${dependency.source}>`;
    }
    return `import { ${dependency.symbol} } from '${dependency.source}';`;
  }

  return {
    buildSnippetDependencyIssues,
    checkMissingDependencies,
  };
}

module.exports = {
  createDependencyTools,
};
