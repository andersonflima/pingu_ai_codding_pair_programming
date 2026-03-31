'use strict';

const { createStructuredIntentParser } = require('./generation-structured-parser');

function createStructuredGenerators(helpers = {}) {
  const {
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
  } = helpers;

  const { parseStructuredIntent } = createStructuredIntentParser({
    extractLiteralFromInstruction,
    isInstructionNoiseToken,
    sanitizeNaturalIdentifier,
    toCamelCaseIdentifier,
    toSnakeCaseIdentifier,
  });

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
    const intent = parseStructuredIntent(instruction);
    if (!intent) {
      return '';
    }

    if (intent.kind === 'enum') {
      return {
        snippet: generateEnumSnippet(instruction, ext),
        structuredIntent: intent,
        semanticIdentity: semanticIdentityForIntent(intent),
      };
    }

    if (intent.kind === 'class') {
      return {
        snippet: generateClassSnippet(intent, ext),
        structuredIntent: intent,
        semanticIdentity: semanticIdentityForIntent(intent),
      };
    }

    if (intent.kind === 'interface') {
      return {
        snippet: generateInterfaceSnippet(instruction, ext),
        structuredIntent: intent,
        semanticIdentity: semanticIdentityForIntent(intent),
      };
    }

    if (intent.kind === 'struct') {
      return {
        snippet: generateStructSnippet(instruction, ext),
        structuredIntent: intent,
        semanticIdentity: semanticIdentityForIntent(intent),
      };
    }

    if (intent.kind === 'module') {
      return {
        snippet: generateModuleSnippet(instruction, ext),
        structuredIntent: intent,
        semanticIdentity: semanticIdentityForIntent(intent),
      };
    }

    if (intent.kind === 'object') {
      return {
        snippet: generateObjectSnippet(instruction, ext),
        structuredIntent: intent,
        semanticIdentity: semanticIdentityForIntent(intent),
      };
    }

    if (intent.kind === 'collection') {
      return variableDeclarationSnippet(intent.name, collectionLiteralForLanguage(intent.items, ext), ext);
    }

    if (intent.kind === 'variable') {
      if (!intent.value) {
        return '';
      }
      return variableDeclarationSnippet(intent.name, intent.value, ext);
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

  function generateClassSnippet(classIntentOrInstruction, ext) {
    const lowerExt = String(ext || '').toLowerCase();
    const classIntent = resolveClassIntent(classIntentOrInstruction);
    const className = classIntent.name;
    const fields = classIntent.fields;
    const methods = classIntent.methods;

    if (['.js', '.jsx', '.mjs', '.cjs'].includes(lowerExt)) {
      return [
        `export class ${className} {`,
        `  constructor({ ${fields.map((field) => `${field} = ${structureFieldDefaultValue(field, lowerExt)}`).join(', ')} } = {}) {`,
        ...fields.map((field) => `    this.${field} = ${field};`),
        '  }',
        ...renderClassMethodsForLanguage(methods, fields, lowerExt),
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
        ...renderClassMethodsForLanguage(methods, fields, lowerExt),
        '}',
      ].join('\n');
    }

    if (isPythonLikeExtension(lowerExt)) {
      return [
        `class ${className}:`,
        `    def __init__(self, ${fields.map((field) => `${field}=${pythonClassConstructorDefaultValue(field)}`).join(', ')}):`,
        ...fields.map((field) => `        self.${field} = ${pythonClassFieldAssignment(field)}`),
        ...renderClassMethodsForLanguage(methods, fields, lowerExt),
      ].join('\n');
    }

    if (['.ex', '.exs'].includes(lowerExt)) {
      return generateStructModuleSnippet(className, fields, methods);
    }

    if (isGoExtension(lowerExt)) {
      return generateGoClassSnippet(className, fields, methods);
    }

    if (isRustExtension(lowerExt)) {
      return generateRustClassSnippet(className, fields, methods);
    }

    if (lowerExt === '.c') {
      return generateCClassSnippet(className, fields, methods);
    }

    if (lowerExt === '.rb') {
      return [
        `class ${className}`,
        `  attr_reader ${fields.map((field) => `:${field}`).join(', ')}`,
        '',
        `  def initialize(${fields.map((field) => `${field}: ${structureFieldDefaultValue(field, lowerExt)}`).join(', ')})`,
        ...fields.map((field) => `    @${field} = ${field}`),
        '  end',
        ...renderClassMethodsForLanguage(methods, fields, lowerExt),
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
        ...renderClassMethodsForLanguage(methods, fields, lowerExt, className),
      ].join('\n');
    }

    if (lowerExt === '.vim') {
      const scriptLocalName = toSnakeCaseIdentifier(className);
      return [
        `function! s:${scriptLocalName}_new(attrs) abort`,
        ...fields.map((field) => `  let l:${field} = get(a:attrs, '${field}', ${structureFieldDefaultValue(field, lowerExt)})`),
        `  return { ${fields.map((field) => `'${field}': l:${field}`).join(', ')} }`,
        'endfunction',
        ...renderClassMethodsForLanguage(methods, fields, lowerExt, className),
      ].join('\n');
    }

    if (lowerExt === '.sh') {
      const functionName = `create_${toSnakeCaseIdentifier(className)}`;
      return [
        `${functionName}() {`,
        ...fields.map((field) => `  local ${field}=\${${Math.max(1, fields.indexOf(field) + 1)}:-${shellLiteral(structureFieldDefaultPrimitive(field))}}`),
        `  printf '%s\\n' "${fields.map((field) => `${field}=\\$${field}`).join(' ')}"`,
        '}',
        ...renderClassMethodsForLanguage(methods, fields, lowerExt, className),
      ].join('\n');
    }

    return '';
  }

  function resolveClassIntent(classIntentOrInstruction) {
    if (
      classIntentOrInstruction
      && typeof classIntentOrInstruction === 'object'
      && classIntentOrInstruction.kind === 'class'
    ) {
      return {
        name: classIntentOrInstruction.name || 'Servico',
        fields: Array.isArray(classIntentOrInstruction.fields) && classIntentOrInstruction.fields.length > 0
          ? classIntentOrInstruction.fields
          : ['id', 'nome', 'status'],
        methods: Array.isArray(classIntentOrInstruction.methods)
          ? classIntentOrInstruction.methods
          : [],
      };
    }

    const fallbackIntent = parseStructuredIntent(classIntentOrInstruction);
    if (fallbackIntent && fallbackIntent.kind === 'class') {
      return resolveClassIntent(fallbackIntent);
    }

    return {
      name: inferNamedStructureName(
        classIntentOrInstruction,
        /\b(?:class|classe)\b(?:\s+(?:chamado|chamada|nomeado|nomeada|com\s+nome|de))?\s+([a-z_][a-zA-Z0-9_]*)/i,
        'Servico',
      ),
      fields: inferStructureFields(classIntentOrInstruction),
      methods: [],
    };
  }

  function renderClassMethodsForLanguage(methods, fields, ext, className = 'Servico') {
    const lowerExt = String(ext || '').toLowerCase();
    const normalizedMethods = uniqueNormalizedMethodNames(methods);

    if (normalizedMethods.length === 0) {
      return [];
    }

    if (['.js', '.jsx', '.mjs', '.cjs'].includes(lowerExt)) {
      return normalizedMethods.flatMap((methodName) => renderJavaScriptClassMethod(methodName, fields));
    }

    if (['.ts', '.tsx'].includes(lowerExt)) {
      return normalizedMethods.flatMap((methodName) => renderTypeScriptClassMethod(methodName, fields));
    }

    if (isPythonLikeExtension(lowerExt)) {
      return normalizedMethods.flatMap((methodName) => renderPythonClassMethod(methodName, fields));
    }

    if (lowerExt === '.rb') {
      return normalizedMethods.flatMap((methodName) => renderRubyClassMethod(methodName, fields));
    }

    if (lowerExt === '.lua') {
      return normalizedMethods.flatMap((methodName) => renderLuaClassMethod(methodName, fields, className));
    }

    if (lowerExt === '.vim') {
      return normalizedMethods.flatMap((methodName) => renderVimClassMethod(methodName, fields, className));
    }

    if (lowerExt === '.sh') {
      return normalizedMethods.flatMap((methodName) => renderShellClassMethod(methodName, fields, className));
    }

    return [];
  }

  function uniqueNormalizedMethodNames(methods) {
    const seen = new Set();
    return (Array.isArray(methods) ? methods : [])
      .map((method) => toSnakeCaseIdentifier(method))
      .filter(Boolean)
      .filter((method) => {
        if (seen.has(method)) {
          return false;
        }
        seen.add(method);
        return true;
      });
  }

  function isBroadcastMethod(methodName) {
    return /\b(?:broadcast|transmitir|notificar|notify|emitir|publicar)\b/.test(toSnakeCaseIdentifier(methodName));
  }

  function isJoinRoomMethod(methodName) {
    return /\b(?:join_room|entrar_na_room|entrar_na_sala|connect_user|conectar_usuario)\b/.test(toSnakeCaseIdentifier(methodName));
  }

  function isLeaveRoomMethod(methodName) {
    return /\b(?:leave_room|sair_da_room|sair_da_sala|disconnect_user|desconectar_usuario)\b/.test(toSnakeCaseIdentifier(methodName));
  }

  function inferBroadcastField(fields) {
    const normalizedFields = Array.isArray(fields) ? fields : [];
    return normalizedFields.find((field) => /usuarios?_conectados?_a_rooms?|usuarios?_por_room|rooms?|salas?/.test(toSnakeCaseIdentifier(field)))
      || normalizedFields[0]
      || 'usuarios_conectados_a_rooms';
  }

  function genericClassMethodArgument(methodName) {
    const normalized = toSnakeCaseIdentifier(methodName);
    if (/\b(?:registrar|adicionar|create|criar|build)\b/.test(normalized)) {
      return 'payload';
    }
    if (/\b(?:listar|list|buscar|find|get)\b/.test(normalized)) {
      return 'filtro';
    }
    return 'valor';
  }

  function genericClassMethodBody(methodName, ext) {
    const argument = genericClassMethodArgument(methodName);
    const lowerExt = String(ext || '').toLowerCase();
    if (isPythonLikeExtension(lowerExt)) {
      return [`        return ${argument}`];
    }
    if (lowerExt === '.rb') {
      return [`    ${argument}`];
    }
    if (lowerExt === '.lua') {
      return [`  return ${argument}`];
    }
    if (lowerExt === '.vim') {
      return [`  return a:${argument}`];
    }
    if (lowerExt === '.sh') {
      return [`  printf '%s\\n' "\${1:-${shellLiteral(structureFieldDefaultPrimitive(argument === 'payload' ? 'status' : 'nome'))}}"`];
    }
    return [`    return ${argument};`];
  }

  function renderJavaScriptClassMethod(methodName, fields) {
    if (isJoinRoomMethod(methodName)) {
      const fieldName = inferBroadcastField(fields);
      return [
        '',
        '  joinRoom(roomId, usuario) {',
        `    const usuariosDaRoom = this.${fieldName}[roomId] ?? [];`,
        '    if (!usuariosDaRoom.includes(usuario)) {',
        '      usuariosDaRoom.push(usuario);',
        '    }',
        `    this.${fieldName}[roomId] = usuariosDaRoom;`,
        '    return usuariosDaRoom;',
        '  }',
      ];
    }

    if (isLeaveRoomMethod(methodName)) {
      const fieldName = inferBroadcastField(fields);
      return [
        '',
        '  leaveRoom(roomId, usuario) {',
        `    const usuariosDaRoom = this.${fieldName}[roomId] ?? [];`,
        '    const usuariosConectados = usuariosDaRoom.filter((atual) => atual !== usuario);',
        `    this.${fieldName}[roomId] = usuariosConectados;`,
        '    return usuariosConectados;',
        '  }',
      ];
    }

    if (isBroadcastMethod(methodName)) {
      const fieldName = inferBroadcastField(fields);
      return [
        '',
        `  ${toCamelCaseIdentifier(methodName)}(roomId, mensagem) {`,
        `    const usuariosDaRoom = this.${fieldName}[roomId] ?? [];`,
        '    return usuariosDaRoom.map((usuario) => {',
        "      if (typeof usuario.send === 'function') {",
        '        usuario.send(mensagem);',
        "      } else if (typeof usuario.enviar === 'function') {",
        '        usuario.enviar(mensagem);',
        '      }',
        '      return usuario;',
        '    });',
        '  }',
      ];
    }

    const argument = genericClassMethodArgument(methodName);
    return [
      '',
      `  ${toCamelCaseIdentifier(methodName)}(${argument}) {`,
      ...genericClassMethodBody(methodName, '.js'),
      '  }',
    ];
  }

  function renderTypeScriptClassMethod(methodName, fields) {
    if (isJoinRoomMethod(methodName)) {
      const fieldName = inferBroadcastField(fields);
      return [
        '',
        '  joinRoom(roomId: string, usuario: Record<string, unknown>): Array<Record<string, unknown>> {',
        `    const usuariosDaRoom = this.${fieldName}[roomId] ?? [];`,
        '    if (!usuariosDaRoom.includes(usuario)) {',
        '      usuariosDaRoom.push(usuario);',
        '    }',
        `    this.${fieldName}[roomId] = usuariosDaRoom;`,
        '    return usuariosDaRoom;',
        '  }',
      ];
    }

    if (isLeaveRoomMethod(methodName)) {
      const fieldName = inferBroadcastField(fields);
      return [
        '',
        '  leaveRoom(roomId: string, usuario: Record<string, unknown>): Array<Record<string, unknown>> {',
        `    const usuariosDaRoom = this.${fieldName}[roomId] ?? [];`,
        '    const usuariosConectados = usuariosDaRoom.filter((atual) => atual !== usuario);',
        `    this.${fieldName}[roomId] = usuariosConectados;`,
        '    return usuariosConectados;',
        '  }',
      ];
    }

    if (isBroadcastMethod(methodName)) {
      const fieldName = inferBroadcastField(fields);
      return [
        '',
        `  ${toCamelCaseIdentifier(methodName)}(roomId: string, mensagem: string): Array<Record<string, unknown>> {`,
        `    const usuariosDaRoom = this.${fieldName}[roomId] ?? [];`,
        '    return usuariosDaRoom.map((usuario) => {',
        "      const participante = usuario as { send?: (conteudo: string) => void; enviar?: (conteudo: string) => void };",
        "      if (typeof participante.send === 'function') {",
        '        participante.send(mensagem);',
        "      } else if (typeof participante.enviar === 'function') {",
        '        participante.enviar(mensagem);',
        '      }',
        '      return usuario;',
        '    });',
        '  }',
      ];
    }

    const argument = genericClassMethodArgument(methodName);
    return [
      '',
      `  ${toCamelCaseIdentifier(methodName)}(${argument}: unknown): unknown {`,
      '    return ' + argument + ';',
      '  }',
    ];
  }

  function renderPythonClassMethod(methodName, fields) {
    if (isJoinRoomMethod(methodName)) {
      const fieldName = inferBroadcastField(fields);
      return [
        '',
        '    def join_room(self, room_id, usuario):',
        `        usuarios_da_room = self.${fieldName}.setdefault(room_id, [])`,
        '        if usuario not in usuarios_da_room:',
        '            usuarios_da_room.append(usuario)',
        '        return usuarios_da_room',
      ];
    }

    if (isLeaveRoomMethod(methodName)) {
      const fieldName = inferBroadcastField(fields);
      return [
        '',
        '    def leave_room(self, room_id, usuario):',
        `        usuarios_da_room = self.${fieldName}.get(room_id, [])`,
        '        usuarios_conectados = [atual for atual in usuarios_da_room if atual is not usuario]',
        `        self.${fieldName}[room_id] = usuarios_conectados`,
        '        return usuarios_conectados',
      ];
    }

    if (isBroadcastMethod(methodName)) {
      const fieldName = inferBroadcastField(fields);
      return [
        '',
        '    def broadcast(self, room_id, mensagem):',
        `        usuarios_da_room = self.${fieldName}.get(room_id, [])`,
        '        for usuario in usuarios_da_room:',
        '            if hasattr(usuario, "send"):',
        '                usuario.send(mensagem)',
        '            elif hasattr(usuario, "enviar"):',
        '                usuario.enviar(mensagem)',
        '        return usuarios_da_room',
      ];
    }

    const argument = genericClassMethodArgument(methodName);
    return [
      '',
      `    def ${toSnakeCaseIdentifier(methodName)}(self, ${argument}):`,
      `        return ${argument}`,
    ];
  }

  function pythonClassConstructorDefaultValue(field) {
    const kind = classifyStructureField(field);
    if (kind === 'mapping' || kind === 'collection') {
      return 'None';
    }
    return structureFieldDefaultValue(field, '.py');
  }

  function pythonClassFieldAssignment(field) {
    const kind = classifyStructureField(field);
    if (kind === 'mapping') {
      return `${field} or {}`;
    }
    if (kind === 'collection') {
      return `${field} or []`;
    }
    return field;
  }

  function renderRubyClassMethod(methodName, fields) {
    if (isJoinRoomMethod(methodName)) {
      const fieldName = inferBroadcastField(fields);
      return [
        '',
        '  def join_room(room_id, usuario)',
        `    usuarios_da_room = @${fieldName}.fetch(room_id, [])`,
        '    usuarios_da_room << usuario unless usuarios_da_room.include?(usuario)',
        `    @${fieldName}[room_id] = usuarios_da_room`,
        '    usuarios_da_room',
        '  end',
      ];
    }

    if (isLeaveRoomMethod(methodName)) {
      const fieldName = inferBroadcastField(fields);
      return [
        '',
        '  def leave_room(room_id, usuario)',
        `    usuarios_da_room = @${fieldName}.fetch(room_id, [])`,
        '    usuarios_conectados = usuarios_da_room.reject { |atual| atual.equal?(usuario) }',
        `    @${fieldName}[room_id] = usuarios_conectados`,
        '    usuarios_conectados',
        '  end',
      ];
    }

    if (isBroadcastMethod(methodName)) {
      const fieldName = inferBroadcastField(fields);
      return [
        '',
        '  def broadcast(room_id, mensagem)',
        `    usuarios_da_room = @${fieldName}.fetch(room_id, [])`,
        '    usuarios_da_room.each do |usuario|',
        '      if usuario.respond_to?(:send)',
        '        usuario.send(mensagem)',
        '      elsif usuario.respond_to?(:enviar)',
        '        usuario.enviar(mensagem)',
        '      end',
        '    end',
        '    usuarios_da_room',
        '  end',
      ];
    }

    const argument = genericClassMethodArgument(methodName);
    return [
      '',
      `  def ${toSnakeCaseIdentifier(methodName)}(${argument})`,
      `    ${argument}`,
      '  end',
    ];
  }

  function renderLuaClassMethod(methodName, fields, className) {
    if (isJoinRoomMethod(methodName)) {
      const fieldName = inferBroadcastField(fields);
      return [
        '',
        `function ${className}:join_room(room_id, usuario)`,
        `  local usuarios_da_room = self.${fieldName}[room_id] or {}`,
        '  local usuario_ja_conectado = false',
        '  for _, atual in ipairs(usuarios_da_room) do',
        '    if atual == usuario then',
        '      usuario_ja_conectado = true',
        '      break',
        '    end',
        '  end',
        '  if not usuario_ja_conectado then',
        '    table.insert(usuarios_da_room, usuario)',
        '  end',
        `  self.${fieldName}[room_id] = usuarios_da_room`,
        '  return usuarios_da_room',
        'end',
      ];
    }

    if (isLeaveRoomMethod(methodName)) {
      const fieldName = inferBroadcastField(fields);
      return [
        '',
        `function ${className}:leave_room(room_id, usuario)`,
        `  local usuarios_da_room = self.${fieldName}[room_id] or {}`,
        '  local usuarios_conectados = {}',
        '  for _, atual in ipairs(usuarios_da_room) do',
        '    if atual ~= usuario then',
        '      table.insert(usuarios_conectados, atual)',
        '    end',
        '  end',
        `  self.${fieldName}[room_id] = usuarios_conectados`,
        '  return usuarios_conectados',
        'end',
      ];
    }

    if (isBroadcastMethod(methodName)) {
      const fieldName = inferBroadcastField(fields);
      return [
        '',
        `function ${className}:broadcast(room_id, mensagem)`,
        `  local usuarios_da_room = self.${fieldName}[room_id] or {}`,
        '  for _, usuario in ipairs(usuarios_da_room) do',
        '    if type(usuario.send) == "function" then',
        '      usuario:send(mensagem)',
        '    elseif type(usuario.enviar) == "function" then',
        '      usuario:enviar(mensagem)',
        '    end',
        '  end',
        '  return usuarios_da_room',
        'end',
      ];
    }

    const argument = genericClassMethodArgument(methodName);
    return [
      '',
      `function ${className}:${toSnakeCaseIdentifier(methodName)}(${argument})`,
      `  return ${argument}`,
      'end',
    ];
  }

  function renderVimClassMethod(methodName, fields, className) {
    const snakeClassName = toSnakeCaseIdentifier(className);
    if (isJoinRoomMethod(methodName)) {
      const fieldName = inferBroadcastField(fields);
      return [
        '',
        `function! s:${snakeClassName}_join_room(instancia, room_id, usuario) abort`,
        `  let l:usuarios_da_room = get(a:instancia.${fieldName}, a:room_id, [])`,
        '  if index(l:usuarios_da_room, a:usuario) < 0',
        '    call add(l:usuarios_da_room, a:usuario)',
        '  endif',
        `  let a:instancia.${fieldName}[a:room_id] = l:usuarios_da_room`,
        '  return l:usuarios_da_room',
        'endfunction',
      ];
    }

    if (isLeaveRoomMethod(methodName)) {
      const fieldName = inferBroadcastField(fields);
      return [
        '',
        `function! s:${snakeClassName}_leave_room(instancia, room_id, usuario) abort`,
        `  let l:usuarios_da_room = get(a:instancia.${fieldName}, a:room_id, [])`,
        '  let l:usuarios_conectados = filter(copy(l:usuarios_da_room), "v:val isnot# a:usuario")',
        `  let a:instancia.${fieldName}[a:room_id] = l:usuarios_conectados`,
        '  return l:usuarios_conectados',
        'endfunction',
      ];
    }

    if (isBroadcastMethod(methodName)) {
      const fieldName = inferBroadcastField(fields);
      return [
        '',
        `function! s:${snakeClassName}_broadcast(instancia, room_id, mensagem) abort`,
        `  let l:usuarios_da_room = get(a:instancia.${fieldName}, a:room_id, [])`,
        '  for l:usuario in l:usuarios_da_room',
        "    if type(l:usuario) == v:t_dict && has_key(l:usuario, 'send') && type(l:usuario.send) == v:t_func",
        "      call call(l:usuario.send, [a:mensagem], l:usuario)",
        "    elseif type(l:usuario) == v:t_dict && has_key(l:usuario, 'enviar') && type(l:usuario.enviar) == v:t_func",
        "      call call(l:usuario.enviar, [a:mensagem], l:usuario)",
        '    endif',
        '  endfor',
        '  return l:usuarios_da_room',
        'endfunction',
      ];
    }

    const argument = genericClassMethodArgument(methodName);
    return [
      '',
      `function! s:${snakeClassName}_${toSnakeCaseIdentifier(methodName)}(${argument}) abort`,
      `  return a:${argument}`,
      'endfunction',
    ];
  }

  function renderShellClassMethod(methodName, fields, className) {
    const snakeClassName = toSnakeCaseIdentifier(className);
    if (isJoinRoomMethod(methodName)) {
      return [
        '',
        `${snakeClassName}_join_room() {`,
        "  local room_id=${1:-room_principal}",
        "  local usuario=${2:-usuario}",
        "  local room_var=\"ROOM_$(printf '%s' \"$room_id\" | tr '[:lower:]-' '[:upper:]_')\"",
        '  local usuarios_da_room="${!room_var:-}"',
        '  case "${usuarios_da_room}" in',
        '    *"${usuario}"*) ;;',
        '    "") printf -v "${room_var}" "%s" "${usuario}" ;;',
        '    *) printf -v "${room_var}" "%s\\n%s" "${usuarios_da_room}" "${usuario}" ;;',
        '  esac',
        '  printf \'%s\\n\' "${!room_var}"',
        '}',
      ];
    }

    if (isLeaveRoomMethod(methodName)) {
      return [
        '',
        `${snakeClassName}_leave_room() {`,
        "  local room_id=${1:-room_principal}",
        "  local usuario=${2:-usuario}",
        "  local room_var=\"ROOM_$(printf '%s' \"$room_id\" | tr '[:lower:]-' '[:upper:]_')\"",
        '  local usuarios_da_room="${!room_var:-}"',
        '  local usuarios_conectados=""',
        '  while IFS= read -r atual; do',
        '    [ -n "$atual" ] || continue',
        '    [ "$atual" = "$usuario" ] && continue',
        '    if [ -z "$usuarios_conectados" ]; then',
        '      usuarios_conectados="$atual"',
        '    else',
        '      usuarios_conectados="${usuarios_conectados}"$\'\\n\'"$atual"',
        '    fi',
        '  done <<EOF',
        '${usuarios_da_room}',
        'EOF',
        '  printf -v "${room_var}" "%s" "${usuarios_conectados}"',
        '  printf \'%s\\n\' "${!room_var}"',
        '}',
      ];
    }

    if (isBroadcastMethod(methodName)) {
      return [
        '',
        `${snakeClassName}_broadcast() {`,
        "  local room_id=${1:-room_principal}",
        "  local mensagem=${2:-mensagem}",
        "  local room_var=\"ROOM_$(printf '%s' \"$room_id\" | tr '[:lower:]-' '[:upper:]_')\"",
        '  local usuarios_da_room="${!room_var:-}"',
        '  while IFS= read -r usuario; do',
        '    [ -n "$usuario" ] || continue',
        '    printf \'%s\\n\' "${usuario}:${mensagem}"',
        '  done <<EOF',
        '${usuarios_da_room}',
        'EOF',
        '}',
      ];
    }

    return [
      '',
      `${snakeClassName}_${toSnakeCaseIdentifier(methodName)}() {`,
      ...genericClassMethodBody(methodName, '.sh'),
      '}',
    ];
  }

  function generateGoClassSnippet(className, fields, methods) {
    const normalizedMethods = uniqueNormalizedMethodNames(methods);
    return [
      `type ${className} struct {`,
      ...fields.map((field) => `  ${toPascalCaseIdentifier(field)} ${structureFieldType(field, '.go')}`),
      '}',
      '',
      ...normalizedMethods.flatMap((methodName) => {
        if (isJoinRoomMethod(methodName)) {
          const fieldName = toPascalCaseIdentifier(inferBroadcastField(fields));
          return [
            `func (service *${className}) JoinRoom(roomID string, usuario string) []string {`,
            `  usuariosDaRoom := service.${fieldName}[roomID]`,
            '  for _, atual := range usuariosDaRoom {',
            '    if atual == usuario {',
            '      return usuariosDaRoom',
            '    }',
            '  }',
            '  usuariosDaRoom = append(usuariosDaRoom, usuario)',
            `  service.${fieldName}[roomID] = usuariosDaRoom`,
            '  return usuariosDaRoom',
            '}',
            '',
          ];
        }
        if (isLeaveRoomMethod(methodName)) {
          const fieldName = toPascalCaseIdentifier(inferBroadcastField(fields));
          return [
            `func (service *${className}) LeaveRoom(roomID string, usuario string) []string {`,
            `  usuariosDaRoom := service.${fieldName}[roomID]`,
            '  usuariosConectados := make([]string, 0, len(usuariosDaRoom))',
            '  for _, atual := range usuariosDaRoom {',
            '    if atual != usuario {',
            '      usuariosConectados = append(usuariosConectados, atual)',
            '    }',
            '  }',
            `  service.${fieldName}[roomID] = usuariosConectados`,
            '  return usuariosConectados',
            '}',
            '',
          ];
        }
        if (isBroadcastMethod(methodName)) {
          const fieldName = toPascalCaseIdentifier(inferBroadcastField(fields));
          return [
            `func (service *${className}) Broadcast(roomID string, mensagem string) []string {`,
            `  usuariosDaRoom := service.${fieldName}[roomID]`,
            '  _ = mensagem',
            '  return append([]string{}, usuariosDaRoom...)',
            '}',
            '',
          ];
        }
        const argument = genericClassMethodArgument(methodName);
        return [
          `func (service *${className}) ${toPascalCaseIdentifier(methodName)}(${argument} string) string {`,
          `  return ${argument}`,
          '}',
          '',
        ];
      }).slice(0, -1),
    ].join('\n');
  }

  function generateRustClassSnippet(className, fields, methods) {
    const normalizedMethods = uniqueNormalizedMethodNames(methods);
    const constructorArgument = inferBroadcastField(fields);
    return [
      `pub struct ${className} {`,
      ...fields.map((field) => `    pub ${toSnakeCaseIdentifier(field)}: ${structureFieldType(field, '.rs')},`),
      '}',
      '',
      `impl ${className} {`,
      `    pub fn new(${toSnakeCaseIdentifier(constructorArgument)}: ${structureFieldType(constructorArgument, '.rs')}) -> Self {`,
      '        Self {',
      ...fields.map((field) => {
        const normalizedField = toSnakeCaseIdentifier(field);
        const assignedValue = normalizedField === toSnakeCaseIdentifier(constructorArgument)
          ? normalizedField
          : structureFieldDefaultValue(field, '.rs');
        return `            ${normalizedField}: ${assignedValue},`;
      }),
      '        }',
      '    }',
      ...normalizedMethods.flatMap((methodName) => {
        if (isJoinRoomMethod(methodName)) {
          const fieldName = toSnakeCaseIdentifier(inferBroadcastField(fields));
          return [
            '',
            '    pub fn join_room(&mut self, room_id: &str, usuario: String) -> Vec<String> {',
            `        let usuarios_da_room = self.${fieldName}.entry(room_id.to_string()).or_default();`,
            '        if !usuarios_da_room.iter().any(|atual| atual == &usuario) {',
            '            usuarios_da_room.push(usuario);',
            '        }',
            '        usuarios_da_room.clone()',
            '    }',
          ];
        }
        if (isLeaveRoomMethod(methodName)) {
          const fieldName = toSnakeCaseIdentifier(inferBroadcastField(fields));
          return [
            '',
            '    pub fn leave_room(&mut self, room_id: &str, usuario: &str) -> Vec<String> {',
            `        let usuarios_da_room = self.${fieldName}.entry(room_id.to_string()).or_default();`,
            '        usuarios_da_room.retain(|atual| atual != usuario);',
            '        usuarios_da_room.clone()',
            '    }',
          ];
        }
        if (isBroadcastMethod(methodName)) {
          const fieldName = toSnakeCaseIdentifier(inferBroadcastField(fields));
          return [
            '',
            '    pub fn broadcast(&self, room_id: &str, mensagem: &str) -> Vec<String> {',
            '        let _ = mensagem;',
            `        self.${fieldName}.get(room_id).cloned().unwrap_or_default()`,
            '    }',
          ];
        }
        const argument = genericClassMethodArgument(methodName);
        return [
          '',
          `    pub fn ${toSnakeCaseIdentifier(methodName)}(&self, ${argument}: String) -> String {`,
          `        ${argument}`,
          '    }',
        ];
      }),
      '}',
    ].join('\n');
  }

  function generateCClassSnippet(className, fields, methods) {
    const normalizedMethods = uniqueNormalizedMethodNames(methods);
    if (normalizedMethods.some((methodName) => isBroadcastMethod(methodName))) {
      return [
        `typedef int (*${className}BroadcastFn)(void* usuario, const char* mensagem);`,
        '',
        `typedef struct ${className} {`,
        '  void** usuarios_conectados_a_rooms;',
        '  int usuarios_conectados_a_rooms_count;',
        `  ${className}BroadcastFn enviar_para_usuario;`,
        `} ${className};`,
        '',
        `int ${className}_join_room(${className}* self, const char* room_id, void* usuario) {`,
        '  if (self == NULL || usuario == NULL) {',
        '    return 0;',
        '  }',
        '  (void) room_id;',
        '  (void) usuario;',
        '  return self->usuarios_conectados_a_rooms_count;',
        '}',
        '',
        `int ${className}_leave_room(${className}* self, const char* room_id, void* usuario) {`,
        '  if (self == NULL || usuario == NULL) {',
        '    return 0;',
        '  }',
        '  (void) room_id;',
        '  (void) usuario;',
        '  return self->usuarios_conectados_a_rooms_count;',
        '}',
        '',
        `int ${className}_broadcast(${className}* self, const char* room_id, const char* mensagem) {`,
        '  if (self == NULL || self->enviar_para_usuario == NULL) {',
          '    return 0;',
        '  }',
        '  (void) room_id;',
        '  int enviados = 0;',
        '  for (int index = 0; index < self->usuarios_conectados_a_rooms_count; index += 1) {',
        '    enviados += self->enviar_para_usuario(self->usuarios_conectados_a_rooms[index], mensagem);',
        '  }',
        '  return enviados;',
        '}',
      ].join('\n');
    }

    return generateStructSnippet(`struct ${className} com ${fields.join(', ')}`, '.c');
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

  function semanticIdentityForIntent(intent) {
    if (!intent || typeof intent !== 'object') {
      return null;
    }

    if (!intent.kind || !intent.name) {
      return null;
    }

    return {
      category: 'structured',
      kind: String(intent.kind),
      name: String(intent.name),
    };
  }

  function structuredTaskAlreadyApplied(lines, commentIndex, generatedTask, ext) {
    const snippet = typeof generatedTask === 'string'
      ? generatedTask
      : String(generatedTask && generatedTask.snippet || '');
    const semanticIdentity = generatedTask && typeof generatedTask === 'object'
      ? generatedTask.semanticIdentity || semanticIdentityForIntent(generatedTask.structuredIntent)
      : null;

    if (!semanticIdentity || semanticIdentity.category !== 'structured') {
      return false;
    }

    const content = Array.isArray(lines)
      ? lines.filter((_, index) => index !== commentIndex).join('\n')
      : '';
    if (!content) {
      return false;
    }

    return structuredIdentityExistsInText(content, semanticIdentity, ext, snippet);
  }

  function structuredIdentityExistsInText(content, semanticIdentity, ext, snippet) {
    const lowerExt = String(ext || '').toLowerCase();
    const name = String(semanticIdentity.name || '').trim();
    if (!name) {
      return false;
    }

    const escapedName = escapeRegExp(name);
    const snakeName = toSnakeCaseIdentifier(name);
    const escapedSnakeName = escapeRegExp(snakeName);

    const patterns = [];
    if (semanticIdentity.kind === 'enum') {
      if (['.ts', '.tsx'].includes(lowerExt)) {
        patterns.push(new RegExp(`\\benum\\s+${escapedName}\\b`));
      } else if (['.js', '.jsx', '.mjs', '.cjs'].includes(lowerExt)) {
        patterns.push(new RegExp(`\\b(?:const|let|var)\\s+${escapedName}\\s*=\\s*Object\\.freeze`));
      } else if (isPythonLikeExtension(lowerExt)) {
        patterns.push(new RegExp(`\\bclass\\s+${escapedName}\\s*\\(Enum\\)`));
      } else if (['.ex', '.exs'].includes(lowerExt)) {
        patterns.push(new RegExp(`@type\\s+${escapedSnakeName}\\s+::`));
      } else if (isGoExtension(lowerExt)) {
        patterns.push(new RegExp(`\\btype\\s+${escapedName}\\s+string\\b`));
      } else if (isRustExtension(lowerExt)) {
        patterns.push(new RegExp(`\\bpub\\s+enum\\s+${escapedName}\\b`));
      } else if (lowerExt === '.rb') {
        patterns.push(new RegExp(`\\b${escapedName}\\s*=\\s*\\{`));
      } else if (lowerExt === '.lua') {
        patterns.push(new RegExp(`\\blocal\\s+${escapedName}\\s*=\\s*\\{`));
      } else if (lowerExt === '.vim') {
        patterns.push(new RegExp(`\\blet\\s+s:${escapedSnakeName}\\s*=\\s*\\{`));
      } else if (lowerExt === '.sh') {
        patterns.push(new RegExp(`\\breadonly\\s+${escapeRegExp(snakeName.toUpperCase())}_`));
      } else if (lowerExt === '.c') {
        patterns.push(new RegExp(`\\btypedef\\s+enum\\s+${escapedName}\\b`));
      }
    }

    if (semanticIdentity.kind === 'class') {
      if (['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'].includes(lowerExt)) {
        patterns.push(new RegExp(`\\bclass\\s+${escapedName}\\b`));
      } else if (isPythonLikeExtension(lowerExt)) {
        patterns.push(new RegExp(`\\bclass\\s+${escapedName}\\b`));
      } else if (['.ex', '.exs'].includes(lowerExt)) {
        patterns.push(new RegExp(`\\bdefmodule\\s+${escapedName}\\b`));
      } else if (isGoExtension(lowerExt) || isRustExtension(lowerExt) || lowerExt === '.c') {
        patterns.push(new RegExp(`\\b(?:type|typedef\\s+struct|pub\\s+struct)\\s+${escapedName}\\b`));
      } else if (lowerExt === '.rb') {
        patterns.push(new RegExp(`\\bclass\\s+${escapedName}\\b`));
      } else if (lowerExt === '.lua') {
        patterns.push(new RegExp(`\\blocal\\s+${escapedName}\\s*=\\s*\\{`));
      } else if (lowerExt === '.vim') {
        patterns.push(new RegExp(`\\bfunction!\\s+s:${escapedSnakeName}_new\\(`));
      } else if (lowerExt === '.sh') {
        patterns.push(new RegExp(`\\bcreate_${escapedSnakeName}\\s*\\(\\)`));
      }
    }

    if (semanticIdentity.kind === 'interface') {
      if (['.ts', '.tsx'].includes(lowerExt)) {
        patterns.push(new RegExp(`\\binterface\\s+${escapedName}\\b`));
      } else if (['.js', '.jsx', '.mjs', '.cjs'].includes(lowerExt)) {
        patterns.push(new RegExp(`@typedef\\s+\\{Object\\}\\s+${escapedName}`));
      } else if (isPythonLikeExtension(lowerExt)) {
        patterns.push(new RegExp(`\\bclass\\s+${escapedName}\\s*\\(TypedDict\\)`));
      } else if (['.ex', '.exs'].includes(lowerExt)) {
        patterns.push(new RegExp(`@type\\s+${escapedSnakeName}\\s+::`));
      } else if (isGoExtension(lowerExt)) {
        patterns.push(new RegExp(`\\btype\\s+${escapedName}\\s+interface\\b`));
      } else if (isRustExtension(lowerExt)) {
        patterns.push(new RegExp(`\\bpub\\s+trait\\s+${escapedName}\\b`));
      } else if (lowerExt === '.rb') {
        patterns.push(new RegExp(`\\bmodule\\s+${escapedName}\\b`));
      } else if (lowerExt === '.lua') {
        patterns.push(new RegExp(`\\blocal\\s+${escapedName}\\s*=\\s*\\{`));
      } else if (lowerExt === '.vim') {
        patterns.push(new RegExp(`\\blet\\s+s:${escapedSnakeName}_contract\\s*=\\s*\\{`));
      } else if (lowerExt === '.sh') {
        patterns.push(new RegExp(`\\b${escapedSnakeName}_validar\\s*\\(\\)`));
      } else if (lowerExt === '.c') {
        patterns.push(new RegExp(`\\btypedef\\s+struct\\s+${escapedName}Contract\\b`));
      }
    }

    if (semanticIdentity.kind === 'struct') {
      if (['.ts', '.tsx'].includes(lowerExt)) {
        patterns.push(new RegExp(`\\btype\\s+${escapedName}\\s*=\\s*\\{`));
      } else if (['.js', '.jsx', '.mjs', '.cjs'].includes(lowerExt)) {
        patterns.push(new RegExp(`\\bfunction\\s+create${escapedName}\\b`));
      } else if (isPythonLikeExtension(lowerExt)) {
        patterns.push(new RegExp(`@dataclass\\(frozen=true\\)|@dataclass\\(frozen=True\\)|@dataclass`));
        patterns.push(new RegExp(`\\bclass\\s+${escapedName}\\b`));
      } else if (['.ex', '.exs'].includes(lowerExt)) {
        patterns.push(new RegExp(`\\bdefmodule\\s+${escapedName}\\b`));
      } else if (isGoExtension(lowerExt)) {
        patterns.push(new RegExp(`\\btype\\s+${escapedName}\\s+struct\\b`));
      } else if (isRustExtension(lowerExt)) {
        patterns.push(new RegExp(`\\bpub\\s+struct\\s+${escapedName}\\b`));
      } else if (lowerExt === '.rb') {
        patterns.push(new RegExp(`\\b${escapedName}\\s*=\\s*Struct\\.new\\(`));
      } else if (lowerExt === '.lua') {
        patterns.push(new RegExp(`\\blocal\\s+${escapedName}\\s*=\\s*\\{`));
      } else if (lowerExt === '.vim') {
        patterns.push(new RegExp(`\\blet\\s+s:${escapedSnakeName}\\s*=\\s*\\{`));
      } else if (lowerExt === '.sh') {
        patterns.push(new RegExp(`\\bbuild_${escapedSnakeName}\\s*\\(\\)`));
      } else if (lowerExt === '.c') {
        patterns.push(new RegExp(`\\btypedef\\s+struct\\s+${escapedName}\\b`));
      }
    }

    if (semanticIdentity.kind === 'module') {
      if (['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'].includes(lowerExt)) {
        patterns.push(new RegExp(`\\bconst\\s+${escapedName}\\s*=\\s*\\{`));
      } else if (isPythonLikeExtension(lowerExt)) {
        patterns.push(new RegExp(`\\bclass\\s+${escapedName}\\b`));
      } else if (['.ex', '.exs'].includes(lowerExt)) {
        patterns.push(new RegExp(`\\bdefmodule\\s+${escapedName}\\b`));
      } else if (isGoExtension(lowerExt)) {
        patterns.push(new RegExp(`\\btype\\s+${escapedName}\\s+struct\\s*\\{\\}`));
      } else if (isRustExtension(lowerExt)) {
        patterns.push(new RegExp(`\\bpub\\s+mod\\s+${escapedSnakeName}\\b`));
      } else if (lowerExt === '.rb') {
        patterns.push(new RegExp(`\\bmodule\\s+${escapedName}\\b`));
      } else if (lowerExt === '.lua') {
        patterns.push(new RegExp(`\\blocal\\s+${escapedName}\\s*=\\s*\\{`));
      } else if (lowerExt === '.vim') {
        patterns.push(new RegExp(`\\bfunction!\\s+s:${escapedSnakeName}_`));
      } else if (lowerExt === '.sh') {
        patterns.push(new RegExp(`\\b${escapedSnakeName}_listar\\s*\\(\\)`));
      } else if (lowerExt === '.c') {
        patterns.push(new RegExp(`\\b${escapedSnakeName}_listar\\s*\\(`));
      }
    }

    if (semanticIdentity.kind === 'object') {
      if (['.js', '.jsx', '.mjs', '.cjs'].includes(lowerExt)) {
        patterns.push(new RegExp(`\\bconst\\s+${escapeRegExp(name)}\\s*=\\s*\\{`));
      } else if (isPythonLikeExtension(lowerExt)) {
        patterns.push(new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*\\{`));
      } else if (['.ex', '.exs'].includes(lowerExt)) {
        patterns.push(new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*%\\{`));
      } else if (isGoExtension(lowerExt)) {
        patterns.push(new RegExp(`\\b${escapeRegExp(toCamelCaseIdentifier(name))}\\s*:=\\s*map\\[string\\]any\\{`));
      } else if (isRustExtension(lowerExt)) {
        patterns.push(new RegExp(`\\blet\\s+${escapedSnakeName}\\s*=\\s*std::collections::HashMap::from`));
      } else if (lowerExt === '.rb') {
        patterns.push(new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*\\{`));
      } else if (lowerExt === '.lua') {
        patterns.push(new RegExp(`\\blocal\\s+${escapeRegExp(name)}\\s*=\\s*\\{`));
      } else if (lowerExt === '.vim') {
        patterns.push(new RegExp(`\\blet\\s+${escapeRegExp(name)}\\s*=\\s*\\{`));
      } else if (lowerExt === '.sh') {
        patterns.push(new RegExp(`\\b${escapeRegExp(toSnakeCaseIdentifier(name).toUpperCase())}_`));
      } else if (lowerExt === '.c') {
        patterns.push(new RegExp(`\\btypedef\\s+struct\\s+${toPascalCaseIdentifier(name)}\\b`));
      }
    }

    if (patterns.length === 0 && snippet) {
      const firstNonEmpty = String(snippet)
        .split('\n')
        .map((line) => line.trim())
        .find(Boolean);
      return Boolean(firstNonEmpty) && content.includes(firstNonEmpty);
    }

    return patterns.some((pattern) => pattern.test(content));
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
      ? splitNaturalList(normalizeFieldSegment(segmentMatch[1])).map((item) => sanitizeNaturalIdentifier(item)).filter(Boolean)
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
      ? splitNaturalList(normalizeFieldSegment(segmentMatch[1])).map((item) => sanitizeNaturalIdentifier(item)).filter(Boolean)
      : [];
    return fields.length > 0 ? fields : ['id', 'nome', 'status'];
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

  function inferModuleFunctions(instruction) {
    const segmentMatch = String(instruction || '').match(
      /\b(?:funcoes?|funções|acoes?|ações|rotas?)\b\s+(.+)$/i,
    );
    const functions = segmentMatch
      ? splitNaturalList(segmentMatch[1]).map((item) => sanitizeNaturalIdentifier(item)).filter(Boolean)
      : [];
    return functions.length > 0 ? functions : ['listar', 'criar'];
  }

  function generateStructModuleSnippet(name, fields, methods = []) {
    const normalizedMethods = uniqueNormalizedMethodNames(methods);
    const broadcastField = inferBroadcastField(fields);
    return [
      `defmodule ${name} do`,
      `  defstruct ${fields.map((field) => `${field}: ${structureFieldDefaultValue(field, '.ex')}`).join(', ')}`,
      ...normalizedMethods.flatMap((methodName) => {
        if (isJoinRoomMethod(methodName)) {
          return [
            '',
            `  def join_room(%__MODULE__{${broadcastField}: usuarios_conectados_a_rooms} = broadcaster, room_id, usuario) do`,
            '    usuarios_da_room = Map.get(usuarios_conectados_a_rooms, room_id, [])',
            '    usuarios_conectados = if usuario in usuarios_da_room, do: usuarios_da_room, else: usuarios_da_room ++ [usuario]',
            '',
            '    %__MODULE__{broadcaster | ' + broadcastField + ': Map.put(usuarios_conectados_a_rooms, room_id, usuarios_conectados)}',
            '  end',
          ];
        }
        if (isLeaveRoomMethod(methodName)) {
          return [
            '',
            `  def leave_room(%__MODULE__{${broadcastField}: usuarios_conectados_a_rooms} = broadcaster, room_id, usuario) do`,
            '    usuarios_da_room = Map.get(usuarios_conectados_a_rooms, room_id, [])',
            '    usuarios_conectados = Enum.reject(usuarios_da_room, &(&1 == usuario))',
            '',
            '    %__MODULE__{broadcaster | ' + broadcastField + ': Map.put(usuarios_conectados_a_rooms, room_id, usuarios_conectados)}',
            '  end',
          ];
        }
        if (isBroadcastMethod(methodName)) {
          return [
            '',
            `  def broadcast(%__MODULE__{${broadcastField}: usuarios_conectados_a_rooms}, room_id, mensagem) do`,
            '    usuarios_da_room = Map.get(usuarios_conectados_a_rooms, room_id, [])',
            '',
            '    Enum.each(usuarios_da_room, fn usuario ->',
            '      cond do',
            "        is_map(usuario) and is_function(Map.get(usuario, :send), 1) -> usuario.send.(mensagem)",
            "        is_map(usuario) and is_function(Map.get(usuario, :enviar), 1) -> usuario.enviar.(mensagem)",
            '        true -> :ok',
            '      end',
            '    end)',
            '',
            '    usuarios_da_room',
            '  end',
          ];
        }
        const argument = genericClassMethodArgument(methodName);
        return [
          '',
          `  def ${toSnakeCaseIdentifier(methodName)}(${argument}) do`,
          `    ${argument}`,
          '  end',
        ];
      }),
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

  function normalizeFieldSegment(value) {
    return String(value || '')
      .replace(/^(?:campos?|atributos?|propriedades|props?|chaves?|keys?)\b[:\s-]*/i, '')
      .trim();
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
    if (/(usuarios?_conectados?_a_rooms?|usuarios?_por_room|rooms?_por_usuario|salas?_por_usuario)/.test(value)) {
      return 'mapping';
    }
    if (/(_ids|_itens|_items|_usuarios|_users|^usuarios$|^users$|^itens$|^items$|^salas$|^rooms$)/.test(value)) {
      return 'collection';
    }
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
      if (kind === 'mapping') {
        return 'Record<string, Array<Record<string, unknown>>>';
      }
      if (kind === 'collection') {
        return 'string[]';
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
      if (kind === 'mapping') {
        return 'dict[str, list[object]]';
      }
      if (kind === 'collection') {
        return 'list[str]';
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
      if (kind === 'mapping') {
        return 'map()';
      }
      if (kind === 'collection') {
        return 'list(String.t())';
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
      if (kind === 'mapping') {
        return 'map[string][]string';
      }
      if (kind === 'collection') {
        return '[]string';
      }
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
      if (kind === 'mapping') {
        return 'std::collections::HashMap<String, Vec<String>>';
      }
      if (kind === 'collection') {
        return 'Vec<String>';
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
      if (kind === 'mapping') {
        return 'void*';
      }
      if (kind === 'collection') {
        return 'char**';
      }
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
    if (kind === 'mapping') {
      return '{}';
    }
    if (kind === 'collection') {
      return '[]';
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

    if (kind === 'mapping') {
      if (['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.go', '.lua'].includes(lowerExt)) {
        return '{}';
      }
      if (isPythonLikeExtension(lowerExt)) {
        return '{}';
      }
      if (['.ex', '.exs'].includes(lowerExt)) {
        return '%{}';
      }
      if (lowerExt === '.rb') {
        return '{}';
      }
      if (lowerExt === '.vim') {
        return '{}';
      }
      if (lowerExt === '.rs') {
        return 'std::collections::HashMap::new()';
      }
      if (lowerExt === '.c') {
        return 'NULL';
      }
      return '{}';
    }

    if (kind === 'collection') {
      if (['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.go', '.lua'].includes(lowerExt)) {
        return '[]';
      }
      if (isPythonLikeExtension(lowerExt)) {
        return '[]';
      }
      if (['.ex', '.exs'].includes(lowerExt)) {
        return '[]';
      }
      if (lowerExt === '.rb') {
        return '[]';
      }
      if (lowerExt === '.vim') {
        return '[]';
      }
      if (lowerExt === '.rs') {
        return 'Vec::new()';
      }
      if (lowerExt === '.c') {
        return 'NULL';
      }
      return '[]';
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
    structuredTaskAlreadyApplied,
  };
}

module.exports = {
  createStructuredGenerators,
};
