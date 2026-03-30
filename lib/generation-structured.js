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

    if (lowerExt === '.toml') {
      if (/\b(?:secao|seção|section|bloco)\b/.test(lowerInstruction)) {
        const sectionName = inferTomlSectionName(instruction);
        const sectionEntries = inferTomlSectionEntries(lowerInstruction);
        return [`[${sectionName}]`, ...sectionEntries].join('\n');
      }
      return '';
    }

    return '';
  }

  function generateStructureSnippet(instruction, ext) {
    const lower = String(instruction || '').toLowerCase();
    const requestsEnum = /\benum\b/.test(lower);
    const requestsClass = /\b(class|classe)\b/.test(lower);
    const requestsInterface = /\b(interface|contrato|type alias|type)\b/.test(lower);
    const requestsStruct = /\bstruct\b/.test(lower);
    const requestsModule = /\b(module|modulo|módulo|namespace)\b/.test(lower);
    const requestsObject = /\b(objeto|mapa|dicionario|dicionário|hash)\b/.test(lower);
    const requestsCollection = /\b(lista|array|vetor|colecao|coleção)\b/.test(lower);
    const requestsVariable = /\b(variavel|variável|constante)\b/.test(lower);

    if (requestsEnum) {
      return generateEnumSnippet(instruction, ext);
    }

    if (requestsClass) {
      return generateClassSnippet(instruction, ext);
    }

    if (requestsInterface) {
      return generateInterfaceSnippet(instruction, ext);
    }

    if (requestsStruct) {
      return generateStructSnippet(instruction, ext);
    }

    if (requestsModule) {
      return generateModuleSnippet(instruction, ext);
    }

    if (requestsObject) {
      return generateObjectSnippet(instruction, ext);
    }

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

  function generateEnumSnippet(instruction, ext) {
    const lowerExt = String(ext || '').toLowerCase();
    const enumName = inferEnumName(instruction);
    const enumMembers = inferEnumMembers(instruction);

    if (['.ts', '.tsx'].includes(lowerExt)) {
      return [
        `export enum ${enumName} {`,
        ...enumMembers.map((member) => `  ${member.pascalName} = '${member.constantValue}',`),
        '}',
      ].join('\n');
    }

    if (['.js', '.jsx', '.mjs', '.cjs'].includes(lowerExt)) {
      return [
        `export const ${enumName} = Object.freeze({`,
        ...enumMembers.map((member) => `  ${member.pascalName}: '${member.constantValue}',`),
        '});',
      ].join('\n');
    }

    if (isPythonLikeExtension(lowerExt)) {
      return [
        'from enum import Enum',
        '',
        `class ${enumName}(Enum):`,
        ...enumMembers.map((member) => `    ${member.constantName} = "${member.constantValue}"`),
      ].join('\n');
    }

    if (['.ex', '.exs'].includes(lowerExt)) {
      const typeName = toSnakeCaseIdentifier(enumName);
      return [
        `@type ${typeName} :: ${enumMembers.map((member) => `:${member.atomName}`).join(' | ')}`,
        `def ${typeName}_values do`,
        `  [${enumMembers.map((member) => `:${member.atomName}`).join(', ')}]`,
        'end',
      ].join('\n');
    }

    if (isGoExtension(lowerExt)) {
      return [
        `type ${enumName} string`,
        '',
        'const (',
        ...enumMembers.map((member) => `  ${enumName}${member.pascalName} ${enumName} = "${member.constantValue}"`),
        ')',
      ].join('\n');
    }

    if (isRustExtension(lowerExt)) {
      return [
        `pub enum ${enumName} {`,
        ...enumMembers.map((member) => `    ${member.pascalName},`),
        '}',
      ].join('\n');
    }

    if (lowerExt === '.rb') {
      return [
        `${enumName} = {`,
        ...enumMembers.map((member) => `  ${member.atomName}: '${member.constantValue}',`),
        '}.freeze',
      ].join('\n');
    }

    if (lowerExt === '.lua') {
      return [
        `local ${enumName} = {`,
        ...enumMembers.map((member) => `  ${member.constantName} = "${member.constantValue}",`),
        '}',
      ].join('\n');
    }

    if (lowerExt === '.vim') {
      return [
        `let s:${toSnakeCaseIdentifier(enumName)} = {`,
        ...enumMembers.map((member) => `\\ '${member.atomName}': '${member.constantValue}',`),
        '\\ }',
      ].join('\n');
    }

    if (lowerExt === '.sh') {
      return enumMembers
        .map((member) => `readonly ${toSnakeCaseIdentifier(enumName).toUpperCase()}_${member.constantName}="${member.constantValue}"`)
        .join('\n');
    }

    if (lowerExt === '.c') {
      return [
        `typedef enum ${enumName} {`,
        ...enumMembers.map((member) => `  ${toSnakeCaseIdentifier(enumName).toUpperCase()}_${member.constantName},`),
        `} ${enumName};`,
      ].join('\n');
    }

    return '';
  }

  function generateObjectSnippet(instruction, ext) {
    const lowerExt = String(ext || '').toLowerCase();
    const objectName = inferObjectName(instruction);
    const fields = inferObjectFields(instruction);

    if (isJavaScriptLikeExtension(lowerExt)) {
      return [
        `const ${objectName} = {`,
        ...fields.map((field) => `  ${field}: ${objectFieldValueForLanguage(field, lowerExt)},`),
        '};',
      ].join('\n');
    }

    if (isPythonLikeExtension(lowerExt)) {
      return [
        `${objectName} = {`,
        ...fields.map((field) => `    "${field}": ${objectFieldValueForLanguage(field, lowerExt)},`),
        '}',
      ].join('\n');
    }

    if (['.ex', '.exs'].includes(lowerExt)) {
      return `${objectName} = %{ ${fields.map((field) => `${field}: ${objectFieldValueForLanguage(field, lowerExt)}`).join(', ')} }`;
    }

    if (isGoExtension(lowerExt)) {
      return [
        `${toCamelCaseIdentifier(objectName)} := map[string]any{`,
        ...fields.map((field) => `  "${field}": ${objectFieldValueForLanguage(field, lowerExt)},`),
        '}',
      ].join('\n');
    }

    if (isRustExtension(lowerExt)) {
      return [
        `let ${toSnakeCaseIdentifier(objectName)} = std::collections::HashMap::from([`,
        ...fields.map((field) => `    ("${field}", ${objectFieldValueForLanguage(field, lowerExt)}),`),
        ']);',
      ].join('\n');
    }

    if (lowerExt === '.rb') {
      return [
        `${objectName} = {`,
        ...fields.map((field) => `  ${field}: ${objectFieldValueForLanguage(field, lowerExt)},`),
        '}',
      ].join('\n');
    }

    if (lowerExt === '.lua') {
      return [
        `local ${objectName} = {`,
        ...fields.map((field) => `  ${field} = ${objectFieldValueForLanguage(field, lowerExt)},`),
        '}',
      ].join('\n');
    }

    if (lowerExt === '.vim') {
      return [
        `let ${objectName} = {`,
        ...fields.map((field) => `\\ '${field}': ${objectFieldValueForLanguage(field, lowerExt)},`),
        '\\ }',
      ].join('\n');
    }

    if (lowerExt === '.sh') {
      return fields
        .map((field) => `${toSnakeCaseIdentifier(objectName).toUpperCase()}_${toSnakeCaseIdentifier(field).toUpperCase()}=${shellObjectFieldValue(field)}`)
        .join('\n');
    }

    if (lowerExt === '.c') {
      return [
        'typedef struct {',
        ...fields.map((field) => `  const char* ${toSnakeCaseIdentifier(field)};`),
        `} ${toPascalCaseIdentifier(objectName)};`,
      ].join('\n');
    }

    return '';
  }

  function generateClassSnippet(instruction, ext) {
    const lowerExt = String(ext || '').toLowerCase();
    const className = inferNamedStructureName(
      instruction,
      /\b(?:class|classe)\b(?:\s+(?:chamado|chamada|nomeado|nomeada|com\s+nome|de))?\s+([a-z_][a-zA-Z0-9_]*)/i,
      'Servico',
    );
    const fields = inferStructureFields(instruction);

    if (['.js', '.jsx', '.mjs', '.cjs'].includes(lowerExt)) {
      return [
        `export class ${className} {`,
        `  constructor({ ${fields.map((field) => `${field} = ${structureFieldDefaultValue(field, lowerExt)}`).join(', ')} } = {}) {`,
        ...fields.map((field) => `    this.${field} = ${field};`),
        '  }',
        '}',
      ].join('\n');
    }

    if (['.ts', '.tsx'].includes(lowerExt)) {
      const descriptor = typedConstructorDescriptor(fields, lowerExt);
      return [
        `export class ${className} {`,
        ...fields.map((field) => `  ${field}: ${structureFieldType(field, lowerExt)};`),
        '',
        `  constructor({ ${fields.map((field) => `${field} = ${structureFieldDefaultValue(field, lowerExt)}`).join(', ')} }: ${descriptor} = {}) {`,
        ...fields.map((field) => `    this.${field} = ${field};`),
        '  }',
        '}',
      ].join('\n');
    }

    if (isPythonLikeExtension(lowerExt)) {
      return [
        `class ${className}:`,
        `    def __init__(self, ${fields.map((field) => `${field}=${structureFieldDefaultValue(field, lowerExt)}`).join(', ')}):`,
        ...fields.map((field) => `        self.${field} = ${field}`),
      ].join('\n');
    }

    if (['.ex', '.exs'].includes(lowerExt)) {
      return generateStructModuleSnippet(className, fields);
    }

    if (isGoExtension(lowerExt) || isRustExtension(lowerExt) || lowerExt === '.c') {
      return generateStructSnippet(instruction.replace(/\b(class|classe)\b/i, 'struct'), ext);
    }

    if (lowerExt === '.rb') {
      return [
        `class ${className}`,
        `  attr_reader ${fields.map((field) => `:${field}`).join(', ')}`,
        '',
        `  def initialize(${fields.map((field) => `${field}: ${structureFieldDefaultValue(field, lowerExt)}`).join(', ')})`,
        ...fields.map((field) => `    @${field} = ${field}`),
        '  end',
        'end',
      ].join('\n');
    }

    if (lowerExt === '.lua') {
      return [
        `local ${className} = {}`,
        `${className}.__index = ${className}`,
        '',
        `function ${className}.new(attrs)`,
        '  local self = setmetatable({}, ' + className + ')',
        '  attrs = attrs or {}',
        ...fields.map((field) => `  self.${field} = attrs.${field} or ${structureFieldDefaultValue(field, lowerExt)}`),
        '  return self',
        'end',
      ].join('\n');
    }

    if (lowerExt === '.vim') {
      const scriptLocalName = toSnakeCaseIdentifier(className);
      return [
        `function! s:${scriptLocalName}_new(attrs) abort`,
        ...fields.map((field) => `  let l:${field} = get(a:attrs, '${field}', ${structureFieldDefaultValue(field, lowerExt)})`),
        `  return { ${fields.map((field) => `'${field}': l:${field}`).join(', ')} }`,
        'endfunction',
      ].join('\n');
    }

    if (lowerExt === '.sh') {
      const functionName = `create_${toSnakeCaseIdentifier(className)}`;
      return [
        `${functionName}() {`,
        ...fields.map((field) => `  local ${field}=\${${Math.max(1, fields.indexOf(field) + 1)}:-${shellLiteral(structureFieldDefaultPrimitive(field))}}`),
        `  printf '%s\\n' "${fields.map((field) => `${field}=\\$${field}`).join(' ')}"`,
        '}',
      ].join('\n');
    }

    return '';
  }

  function generateInterfaceSnippet(instruction, ext) {
    const lowerExt = String(ext || '').toLowerCase();
    const interfaceName = inferNamedStructureName(
      instruction,
      /\b(?:interface|contrato|type(?:\s+alias)?)\b(?:\s+(?:chamado|chamada|nomeado|nomeada|com\s+nome|de))?\s+([a-z_][a-zA-Z0-9_]*)/i,
      'Contrato',
    );
    const fields = inferStructureFields(instruction);
    const methods = inferContractMethods(instruction);

    if (['.ts', '.tsx'].includes(lowerExt)) {
      return [
        `export interface ${interfaceName} {`,
        ...fields.map((field) => `  ${field}: ${structureFieldType(field, lowerExt)};`),
        ...methods.map((method) => `  ${method}(): void;`),
        '}',
      ].join('\n');
    }

    if (['.js', '.jsx', '.mjs', '.cjs'].includes(lowerExt)) {
      return [
        '/**',
        ` * @typedef {Object} ${interfaceName}`,
        ...fields.map((field) => ` * @property {${jsDocTypeForField(field)}} ${field}`),
        ...methods.map((method) => ` * @property {Function} ${method}`),
        ' */',
      ].join('\n');
    }

    if (isPythonLikeExtension(lowerExt)) {
      return [
        'from typing import TypedDict',
        '',
        `class ${interfaceName}(TypedDict):`,
        ...fields.map((field) => `    ${field}: ${structureFieldType(field, lowerExt)}`),
      ].join('\n');
    }

    if (['.ex', '.exs'].includes(lowerExt)) {
      const typeName = toSnakeCaseIdentifier(interfaceName);
      return [
        `@type ${typeName} :: %{`,
        ...fields.map((field, index) => `  ${field}: ${structureFieldType(field, lowerExt)}${index === fields.length - 1 ? '' : ','}`),
        '}',
      ].join('\n');
    }

    if (isGoExtension(lowerExt)) {
      return [
        `type ${interfaceName} interface {`,
        ...methods.map((method) => `  ${toPascalCaseIdentifier(method)}() error`),
        '}',
      ].join('\n');
    }

    if (isRustExtension(lowerExt)) {
      return [
        `pub trait ${interfaceName} {`,
        ...methods.map((method) => `    fn ${toSnakeCaseIdentifier(method)}(&self) -> bool;`),
        '}',
      ].join('\n');
    }

    if (lowerExt === '.rb') {
      return [
        `module ${interfaceName}`,
        ...methods.flatMap((method) => [
          `  def ${toSnakeCaseIdentifier(method)}`,
          `    raise NotImplementedError, 'implemente #${toSnakeCaseIdentifier(method)}'`,
          '  end',
          '',
        ]).slice(0, -1),
        'end',
      ].join('\n');
    }

    if (lowerExt === '.lua') {
      return [
        `local ${interfaceName} = {}`,
        ...methods.flatMap((method) => [
          '',
          `function ${interfaceName}:${toSnakeCaseIdentifier(method)}()`,
          `  error('implemente ${toSnakeCaseIdentifier(method)}')`,
          'end',
        ]),
        '',
        `return ${interfaceName}`,
      ].join('\n');
    }

    if (lowerExt === '.vim') {
      const prefix = toSnakeCaseIdentifier(interfaceName);
      return [
        ...methods.flatMap((method) => [
          `function! s:${prefix}_${toSnakeCaseIdentifier(method)}() abort`,
          `  throw 'implemente s:${prefix}_${toSnakeCaseIdentifier(method)}'`,
          'endfunction',
          '',
        ]),
        `let s:${prefix}_contract = { ${methods.map((method) => `'${toSnakeCaseIdentifier(method)}': function('s:${prefix}_${toSnakeCaseIdentifier(method)}')`).join(', ')} }`,
      ].join('\n');
    }

    if (lowerExt === '.sh') {
      const prefix = toSnakeCaseIdentifier(interfaceName);
      return methods
        .map((method) => [
          `${prefix}_${toSnakeCaseIdentifier(method)}() {`,
          `  printf '%s\\n' 'implemente ${prefix}_${toSnakeCaseIdentifier(method)}' >&2`,
          '  return 1',
          '}',
        ].join('\n'))
        .join('\n\n');
    }

    if (lowerExt === '.c') {
      return [
        `typedef struct ${interfaceName}Contract {`,
        ...methods.map((method) => `  int (*${toSnakeCaseIdentifier(method)})(void* self);`),
        `} ${interfaceName}Contract;`,
      ].join('\n');
    }

    return '';
  }

  function generateStructSnippet(instruction, ext) {
    const lowerExt = String(ext || '').toLowerCase();
    const structName = inferNamedStructureName(
      instruction,
      /\bstruct\b(?:\s+(?:chamado|chamada|nomeado|nomeada|com\s+nome|de))?\s+([a-z_][a-zA-Z0-9_]*)/i,
      'Registro',
    );
    const fields = inferStructureFields(instruction);

    if (['.ts', '.tsx'].includes(lowerExt)) {
      return [
        `export type ${structName} = {`,
        ...fields.map((field) => `  ${field}: ${structureFieldType(field, lowerExt)};`),
        '};',
      ].join('\n');
    }

    if (['.js', '.jsx', '.mjs', '.cjs'].includes(lowerExt)) {
      const factoryName = `create${structName}`;
      return [
        `export function ${factoryName}({ ${fields.map((field) => `${field} = ${structureFieldDefaultValue(field, lowerExt)}`).join(', ')} } = {}) {`,
        '  return {',
        ...fields.map((field) => `    ${field},`),
        '  };',
        '}',
      ].join('\n');
    }

    if (isPythonLikeExtension(lowerExt)) {
      return [
        'from dataclasses import dataclass',
        '',
        '@dataclass(frozen=True)',
        `class ${structName}:`,
        ...fields.map((field) => `    ${field}: ${structureFieldType(field, lowerExt)} = ${structureFieldDefaultValue(field, lowerExt)}`),
      ].join('\n');
    }

    if (['.ex', '.exs'].includes(lowerExt)) {
      return generateStructModuleSnippet(structName, fields);
    }

    if (isGoExtension(lowerExt)) {
      return [
        `type ${structName} struct {`,
        ...fields.map((field) => `  ${toPascalCaseIdentifier(field)} ${structureFieldType(field, lowerExt)}`),
        '}',
      ].join('\n');
    }

    if (isRustExtension(lowerExt)) {
      return [
        `pub struct ${structName} {`,
        ...fields.map((field) => `    pub ${toSnakeCaseIdentifier(field)}: ${structureFieldType(field, lowerExt)},`),
        '}',
      ].join('\n');
    }

    if (lowerExt === '.rb') {
      return `${structName} = Struct.new(${fields.map((field) => `:${field}`).join(', ')}, keyword_init: true)`;
    }

    if (lowerExt === '.lua') {
      return [
        `local ${structName} = {`,
        ...fields.map((field) => `  ${field} = ${structureFieldDefaultValue(field, lowerExt)},`),
        '}',
      ].join('\n');
    }

    if (lowerExt === '.vim') {
      return `let s:${toSnakeCaseIdentifier(structName)} = { ${fields.map((field) => `'${field}': ${structureFieldDefaultValue(field, lowerExt)}`).join(', ')} }`;
    }

    if (lowerExt === '.sh') {
      const functionName = `build_${toSnakeCaseIdentifier(structName)}`;
      return [
        `${functionName}() {`,
        `  printf '%s\\n' "${fields.map((field) => `${field}=${shellLiteral(structureFieldDefaultPrimitive(field))}`).join(' ')}"`,
        '}',
      ].join('\n');
    }

    if (lowerExt === '.c') {
      return [
        `typedef struct ${structName} {`,
        ...fields.map((field) => `  ${structureFieldType(field, lowerExt)} ${toSnakeCaseIdentifier(field)};`),
        `} ${structName};`,
      ].join('\n');
    }

    return '';
  }

  function generateModuleSnippet(instruction, ext) {
    const lowerExt = String(ext || '').toLowerCase();
    const moduleName = inferNamedStructureName(
      instruction,
      /\b(?:module|modulo|módulo|namespace)\b(?:\s+(?:chamado|chamada|nomeado|nomeada|com\s+nome|de))?\s+([a-z_][a-zA-Z0-9_]*)/i,
      'CoreModule',
    );
    const functions = inferModuleFunctions(instruction);

    if (['.js', '.jsx', '.mjs', '.cjs'].includes(lowerExt)) {
      return [
        `export const ${moduleName} = {`,
        ...functions.map((fnName, index) => [
          `  ${toSnakeCaseIdentifier(fnName)}(${moduleFunctionArgument(fnName)}) {`,
          `    ${moduleFunctionBody(fnName, lowerExt)}`,
          `  }${index === functions.length - 1 ? '' : ','}`,
        ].join('\n')),
        '};',
      ].join('\n');
    }

    if (['.ts', '.tsx'].includes(lowerExt)) {
      return [
        `export const ${moduleName} = {`,
        ...functions.map((fnName, index) => [
          `  ${toSnakeCaseIdentifier(fnName)}(${moduleFunctionArgument(fnName)}: ${moduleFunctionArgumentType(fnName, lowerExt)}) {`,
          `    ${moduleFunctionBody(fnName, lowerExt)}`,
          `  }${index === functions.length - 1 ? '' : ','}`,
        ].join('\n')),
        '} as const;',
      ].join('\n');
    }

    if (isPythonLikeExtension(lowerExt)) {
      return [
        `class ${moduleName}:`,
        ...functions.flatMap((fnName) => [
          '    @staticmethod',
          `    def ${toSnakeCaseIdentifier(fnName)}(${moduleFunctionArgument(fnName)}):`,
          `        ${pythonModuleFunctionBody(fnName)}`,
          '',
        ]).slice(0, -1),
      ].join('\n');
    }

    if (['.ex', '.exs'].includes(lowerExt)) {
      return [
        `defmodule ${moduleName} do`,
        ...functions.flatMap((fnName) => [
          `  def ${toSnakeCaseIdentifier(fnName)}(${moduleFunctionArgument(fnName)}) do`,
          `    ${elixirModuleFunctionBody(fnName)}`,
          '  end',
          '',
        ]).slice(0, -1),
        'end',
      ].join('\n');
    }

    if (isGoExtension(lowerExt)) {
      return [
        `type ${moduleName} struct {}`,
        '',
        ...functions.flatMap((fnName) => [
          `func (${moduleName}) ${toPascalCaseIdentifier(fnName)}(${moduleFunctionArgument(fnName)} ${moduleFunctionArgumentType(fnName, lowerExt)}) ${moduleFunctionReturnType(fnName, lowerExt)} {`,
          `  ${goModuleFunctionBody(fnName)}`,
          '}',
          '',
        ]).slice(0, -1),
      ].join('\n');
    }

    if (isRustExtension(lowerExt)) {
      const snakeName = toSnakeCaseIdentifier(moduleName);
      return [
        `pub mod ${snakeName} {`,
        ...functions.flatMap((fnName) => [
          `    pub fn ${toSnakeCaseIdentifier(fnName)}(${moduleFunctionArgument(fnName)}: ${moduleFunctionArgumentType(fnName, lowerExt)}) -> ${moduleFunctionReturnType(fnName, lowerExt)} {`,
          `        ${rustModuleFunctionBody(fnName)}`,
          '    }',
          '',
        ]).slice(0, -1),
        '}',
      ].join('\n');
    }

    if (lowerExt === '.rb') {
      return [
        `module ${moduleName}`,
        ...functions.flatMap((fnName) => [
          `  def self.${toSnakeCaseIdentifier(fnName)}(${moduleFunctionArgument(fnName)})`,
          `    ${rubyModuleFunctionBody(fnName)}`,
          '  end',
          '',
        ]).slice(0, -1),
        'end',
      ].join('\n');
    }

    if (lowerExt === '.lua') {
      return [
        `local ${moduleName} = {}`,
        ...functions.flatMap((fnName) => [
          '',
          `function ${moduleName}.${toSnakeCaseIdentifier(fnName)}(${moduleFunctionArgument(fnName)})`,
          `  ${luaModuleFunctionBody(fnName)}`,
          'end',
        ]),
        '',
        `return ${moduleName}`,
      ].join('\n');
    }

    if (lowerExt === '.vim') {
      const snakeName = toSnakeCaseIdentifier(moduleName);
      return functions
        .map((fnName) => [
          `function! s:${snakeName}_${toSnakeCaseIdentifier(fnName)}(${moduleFunctionArgument(fnName)}) abort`,
          `  ${vimModuleFunctionBody(fnName)}`,
          'endfunction',
        ].join('\n'))
        .join('\n\n');
    }

    if (lowerExt === '.sh') {
      const snakeName = toSnakeCaseIdentifier(moduleName);
      return functions
        .map((fnName) => [
          `${snakeName}_${toSnakeCaseIdentifier(fnName)}() {`,
          `  ${shellModuleFunctionBody(fnName)}`,
          '}',
        ].join('\n'))
        .join('\n\n');
    }

    if (lowerExt === '.c') {
      const snakeName = toSnakeCaseIdentifier(moduleName);
      return functions
        .map((fnName) => [
          `static void ${snakeName}_${toSnakeCaseIdentifier(fnName)}(void) {`,
          '  return;',
          '}',
        ].join('\n'))
        .join('\n\n');
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

  function inferEnumName(instruction) {
    const explicitNameMatch = String(instruction || '').match(
      /\benum\b(?:\s+(?:chamado|chamada|nomeado|nomeada|com\s+nome|de))?\s+([a-z_][a-zA-Z0-9_]*)/i,
    );
    if (explicitNameMatch && explicitNameMatch[1] && !isInstructionNoiseToken(explicitNameMatch[1])) {
      return toPascalCaseIdentifier(explicitNameMatch[1]);
    }
    return 'Status';
  }

  function inferEnumMembers(instruction) {
    const segmentMatch = String(instruction || '').match(
      /\benum\b.*?\b(?:com|values?|valores?|casos?|itens?|opcoes?|opções)\b\s+(.+)$/i,
    );
    const members = segmentMatch
      ? splitNaturalList(segmentMatch[1]).map((item) => normalizeEnumMember(item)).filter(Boolean)
      : [];

    const resolvedMembers = members.length > 0 ? members : ['ativo', 'inativo', 'arquivado'];
    return resolvedMembers.map((member) => ({
      atomName: toSnakeCaseIdentifier(member),
      constantName: toSnakeCaseIdentifier(member).toUpperCase(),
      constantValue: toSnakeCaseIdentifier(member).toUpperCase(),
      pascalName: toPascalCaseIdentifier(member),
    }));
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

  function inferObjectFields(instruction) {
    const segmentMatch = String(instruction || '').match(
      /\b(?:objeto|mapa|dicionario|dicionário|hash)\b.*?\b(?:com|campos?|chaves?|keys?)\b\s+(.+)$/i,
    );
    const fields = segmentMatch
      ? splitNaturalList(segmentMatch[1]).map((item) => sanitizeNaturalIdentifier(item)).filter(Boolean)
      : [];
    return fields.length > 0 ? fields : ['id', 'nome', 'status'];
  }

  function inferNamedStructureName(instruction, pattern, fallbackName) {
    const match = String(instruction || '').match(pattern);
    if (match && match[1] && !isInstructionNoiseToken(match[1])) {
      return toPascalCaseIdentifier(match[1]);
    }
    return toPascalCaseIdentifier(fallbackName);
  }

  function inferStructureFields(instruction) {
    const segmentMatch = String(instruction || '').match(
      /\b(?:com|campos?|atributos?|propriedades|props?|chaves?)\b\s+(.+)$/i,
    );
    const fields = segmentMatch
      ? splitNaturalList(segmentMatch[1]).map((item) => sanitizeNaturalIdentifier(item)).filter(Boolean)
      : [];
    return fields.length > 0 ? fields : ['id', 'nome', 'status'];
  }

  function inferContractMethods(instruction) {
    const segmentMatch = String(instruction || '').match(
      /\b(?:metodos?|métodos?|funcoes?|funções)\b\s+(.+)$/i,
    );
    const methods = segmentMatch
      ? splitNaturalList(segmentMatch[1]).map((item) => sanitizeNaturalIdentifier(item)).filter(Boolean)
      : [];
    return methods.length > 0 ? methods : ['validar'];
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

  function generateStructModuleSnippet(name, fields) {
    return [
      `defmodule ${name} do`,
      `  defstruct ${fields.map((field) => `:${field}`).join(', ')}`,
      'end',
    ].join('\n');
  }

  function splitNaturalList(value) {
    return String(value || '')
      .replace(/\b(?:e|and|ou|or)\b/gi, ',')
      .split(/[,\n/|]/)
      .map((item) => String(item || '').trim())
      .filter((item) => item !== '');
  }

  function normalizeEnumMember(value) {
    const normalized = sanitizeNaturalIdentifier(String(value || '').trim());
    if (!normalized || isInstructionNoiseToken(normalized)) {
      return '';
    }
    return normalized;
  }

  function toPascalCaseIdentifier(value) {
    const camelCase = toCamelCaseIdentifier(value);
    if (!camelCase) {
      return 'Status';
    }
    return camelCase.charAt(0).toUpperCase() + camelCase.slice(1);
  }

  function typedConstructorDescriptor(fields, ext) {
    return `{ ${fields.map((field) => `${field}?: ${structureFieldType(field, ext)}`).join('; ')} }`;
  }

  function classifyStructureField(field) {
    const value = toSnakeCaseIdentifier(field);
    if (value === 'id') {
      return 'id';
    }
    if (['ativo', 'enabled', 'habilitado', 'habilitada'].includes(value)) {
      return 'boolean';
    }
    if (['total', 'amount', 'valor', 'count', 'contador', 'quantidade'].includes(value)) {
      return 'number';
    }
    if (value === 'email') {
      return 'email';
    }
    if (value === 'status') {
      return 'status';
    }
    return 'string';
  }

  function structureFieldType(field, ext) {
    const kind = classifyStructureField(field);
    const lowerExt = String(ext || '').toLowerCase();

    if (['.ts', '.tsx'].includes(lowerExt)) {
      if (kind === 'id') {
        return 'string | null';
      }
      if (kind === 'boolean') {
        return 'boolean';
      }
      if (kind === 'number') {
        return 'number';
      }
      return 'string';
    }

    if (isPythonLikeExtension(lowerExt)) {
      if (kind === 'id') {
        return 'str | None';
      }
      if (kind === 'boolean') {
        return 'bool';
      }
      if (kind === 'number') {
        return 'int';
      }
      return 'str';
    }

    if (['.ex', '.exs'].includes(lowerExt)) {
      if (kind === 'id') {
        return 'String.t() | nil';
      }
      if (kind === 'boolean') {
        return 'boolean()';
      }
      if (kind === 'number') {
        return 'integer()';
      }
      return 'String.t()';
    }

    if (isGoExtension(lowerExt)) {
      if (kind === 'boolean') {
        return 'bool';
      }
      if (kind === 'number') {
        return 'int';
      }
      return 'string';
    }

    if (isRustExtension(lowerExt)) {
      if (kind === 'id') {
        return 'Option<String>';
      }
      if (kind === 'boolean') {
        return 'bool';
      }
      if (kind === 'number') {
        return 'i64';
      }
      return 'String';
    }

    if (lowerExt === '.c') {
      if (kind === 'boolean' || kind === 'number') {
        return 'int';
      }
      return 'const char*';
    }

    return 'string';
  }

  function structureFieldDefaultPrimitive(field) {
    const kind = classifyStructureField(field);
    if (kind === 'id') {
      return 'null';
    }
    if (kind === 'boolean') {
      return 'true';
    }
    if (kind === 'number') {
      return '0';
    }
    if (kind === 'email') {
      return 'dev@example.com';
    }
    if (kind === 'status') {
      return 'ativo';
    }
    return 'exemplo';
  }

  function structureFieldDefaultValue(field, ext) {
    const kind = classifyStructureField(field);
    const primitive = structureFieldDefaultPrimitive(field);
    const lowerExt = String(ext || '').toLowerCase();

    if (kind === 'id') {
      if (['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'].includes(lowerExt)) {
        return 'null';
      }
      if (isPythonLikeExtension(lowerExt)) {
        return 'None';
      }
      if (['.ex', '.exs', '.rb', '.lua'].includes(lowerExt)) {
        return 'nil';
      }
      if (lowerExt === '.vim') {
        return 'v:null';
      }
      return quotedValue('1', lowerExt);
    }

    if (kind === 'boolean') {
      if (isPythonLikeExtension(lowerExt)) {
        return 'True';
      }
      if (lowerExt === '.vim') {
        return 'v:true';
      }
      return 'true';
    }

    if (kind === 'number') {
      return '0';
    }

    return quotedValue(primitive, lowerExt);
  }

  function jsDocTypeForField(field) {
    const kind = classifyStructureField(field);
    if (kind === 'id') {
      return 'string|null';
    }
    if (kind === 'boolean') {
      return 'boolean';
    }
    if (kind === 'number') {
      return 'number';
    }
    return 'string';
  }

  function objectFieldValueForLanguage(field, ext) {
    const lowerField = toSnakeCaseIdentifier(field);
    const lowerExt = String(ext || '').toLowerCase();

    if (lowerField === 'id') {
      if (isRustExtension(lowerExt)) {
        return '"1"';
      }
      return '1';
    }
    if (['ativo', 'enabled', 'habilitado', 'habilitada'].includes(lowerField)) {
      return 'true';
    }
    if (['total', 'amount', 'valor'].includes(lowerField)) {
      return '0';
    }
    if (lowerField === 'status') {
      return quotedValue('ativo', lowerExt);
    }
    if (lowerField === 'email') {
      return quotedValue('dev@example.com', lowerExt);
    }
    return quotedValue('exemplo', lowerExt);
  }

  function quotedValue(value, ext) {
    if (['.ex', '.exs'].includes(ext)) {
      return `"${value}"`;
    }
    if (ext === '.vim') {
      return `'${value}'`;
    }
    if (ext === '.rb') {
      return `'${value}'`;
    }
    return `"${value}"`;
  }

  function shellObjectFieldValue(field) {
    const lowerField = toSnakeCaseIdentifier(field);
    if (lowerField === 'id') {
      return '1';
    }
    if (['ativo', 'enabled', 'habilitado', 'habilitada'].includes(lowerField)) {
      return 'true';
    }
    if (lowerField === 'email') {
      return 'dev@example.com';
    }
    if (lowerField === 'status') {
      return 'ativo';
    }
    return 'exemplo';
  }

  function moduleFunctionArgument(name) {
    const normalized = toSnakeCaseIdentifier(name);
    if (/\b(list|listar|all|todos)\b/.test(normalized)) {
      return 'itens';
    }
    if (/\b(create|criar|build|montar|compose|registrar)\b/.test(normalized)) {
      return 'payload';
    }
    return 'valor';
  }

  function moduleFunctionArgumentType(name, ext) {
    const normalized = moduleFunctionArgument(name);
    const lowerExt = String(ext || '').toLowerCase();
    if (['.ts', '.tsx'].includes(lowerExt)) {
      if (normalized === 'itens') {
        return 'string[]';
      }
      if (normalized === 'payload') {
        return 'Record<string, unknown>';
      }
      return 'string';
    }
    if (isGoExtension(lowerExt)) {
      if (normalized === 'itens') {
        return '[]string';
      }
      if (normalized === 'payload') {
        return 'map[string]any';
      }
      return 'string';
    }
    if (isRustExtension(lowerExt)) {
      if (normalized === 'itens') {
        return 'Vec<String>';
      }
      if (normalized === 'payload') {
        return 'std::collections::HashMap<String, String>';
      }
      return 'String';
    }
    return 'string';
  }

  function moduleFunctionReturnType(name, ext) {
    return moduleFunctionArgumentType(name, ext);
  }

  function moduleFunctionBody(name, ext) {
    const argument = moduleFunctionArgument(name);
    const lowerExt = String(ext || '').toLowerCase();
    if (argument === 'payload') {
      if (['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'].includes(lowerExt)) {
        return 'return { ...payload };';
      }
      return 'return payload;';
    }
    if (argument === 'itens') {
      return 'return itens;';
    }
    return 'return valor;';
  }

  function pythonModuleFunctionBody(name) {
    const argument = moduleFunctionArgument(name);
    if (argument === 'payload') {
      return 'return dict(payload)';
    }
    return `return ${argument}`;
  }

  function elixirModuleFunctionBody(name) {
    const argument = moduleFunctionArgument(name);
    if (argument === 'payload') {
      return 'Map.new(payload)';
    }
    return argument;
  }

  function goModuleFunctionBody(name) {
    return `return ${moduleFunctionArgument(name)}`;
  }

  function rustModuleFunctionBody(name) {
    return moduleFunctionArgument(name);
  }

  function rubyModuleFunctionBody(name) {
    const argument = moduleFunctionArgument(name);
    if (argument === 'payload') {
      return 'payload.dup';
    }
    return argument;
  }

  function luaModuleFunctionBody(name) {
    return `return ${moduleFunctionArgument(name)}`;
  }

  function vimModuleFunctionBody(name) {
    return `return a:${moduleFunctionArgument(name)}`;
  }

  function shellModuleFunctionBody(name) {
    const argument = moduleFunctionArgument(name);
    if (argument === 'itens') {
      return 'printf \'%s\\n\' "$@"';
    }
    return `printf '%s\\n' "\${1:-${shellLiteral(structureFieldDefaultPrimitive(argument === 'payload' ? 'status' : 'nome'))}}"`;
  }

  function shellLiteral(value) {
    return String(value || '');
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
    if (lowerExt === '.toml') {
      return `${variableName} = ${valueLiteral}`;
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

  function inferTomlSectionName(instruction) {
    const match = String(instruction || '').match(
      /\b(?:secao|seção|section|bloco)\b(?:\s+(?:chamada|chamado|nomeada|nomeado|de|do|da))?\s+([a-z_][a-zA-Z0-9_]*)/i,
    );
    if (match && match[1] && !isInstructionNoiseToken(match[1])) {
      return sanitizeNaturalIdentifier(match[1]);
    }
    return 'app';
  }

  function inferTomlSectionEntries(instruction) {
    if (/\bporta|port\b/.test(instruction)) {
      return ['port = 3000'];
    }
    if (/\benabled|habilitado|habilitada|ativo|ativa\b/.test(instruction)) {
      return ['enabled = true'];
    }
    if (/\btimeout\b/.test(instruction)) {
      return ['timeout = 30'];
    }
    return ['enabled = true'];
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
