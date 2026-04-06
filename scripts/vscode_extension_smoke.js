#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { hasLiveOpenAiValidation } = require('./require_real_ai_command');

const repoRoot = path.resolve(__dirname, '..');

class MockPosition {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}

class MockRange {
  constructor(startLineOrPosition, startCharacter, endLine, endCharacter) {
    if (startLineOrPosition instanceof MockPosition) {
      this.start = startLineOrPosition;
      this.end = startCharacter;
      return;
    }

    this.start = new MockPosition(startLineOrPosition, startCharacter);
    this.end = new MockPosition(endLine, endCharacter);
  }
}

class MockDiagnostic {
  constructor(range, message, severity) {
    this.range = range;
    this.message = message;
    this.severity = severity;
    this.source = '';
    this.code = '';
  }
}

class MockEventEmitter {
  constructor() {
    this.listeners = new Set();
    this.event = (listener) => {
      this.listeners.add(listener);
      return createDisposable(() => {
        this.listeners.delete(listener);
      });
    };
  }

  fire(value) {
    this.listeners.forEach((listener) => listener(value));
  }

  dispose() {
    this.listeners.clear();
  }
}

class MockWorkspaceEdit {
  constructor() {
    this.edits = [];
  }

  replace(uri, range, text) {
    this.edits.push({ type: 'replace', uri, range, text });
  }

  insert(uri, position, text) {
    this.edits.push({ type: 'insert', uri, position, text });
  }

  delete(uri, range) {
    this.edits.push({ type: 'delete', uri, range });
  }
}

class MockDocument {
  constructor(filePath, text) {
    this.uri = createUri(filePath);
    this.fileName = this.uri.fsPath;
    this.isClosed = false;
    this._text = String(text || '');
  }

  getText() {
    return this._text;
  }

  setText(nextText) {
    this._text = String(nextText || '');
  }

  get lineCount() {
    return splitDocumentLines(this._text).length;
  }

  lineAt(index) {
    const lines = splitDocumentLines(this._text);
    const safeIndex = Math.max(0, Math.min(index, lines.length - 1));
    const lineText = lines[safeIndex];
    return {
      text: lineText,
      range: new MockRange(safeIndex, 0, safeIndex, lineText.length),
    };
  }
}

function createDisposable(dispose) {
  return {
    dispose: typeof dispose === 'function' ? dispose : () => {},
  };
}

function createUri(filePath) {
  const fsPath = path.resolve(filePath);
  return {
    fsPath,
    scheme: 'file',
    toString() {
      return `file://${fsPath}`;
    },
  };
}

function splitDocumentLines(text) {
  return String(text || '').replace(/\r\n/g, '\n').split('\n');
}

function offsetAt(text, position) {
  const lines = splitDocumentLines(text);
  let offset = 0;
  for (let index = 0; index < position.line; index += 1) {
    offset += (lines[index] || '').length;
    offset += 1;
  }
  return offset + position.character;
}

function applyTextOperation(text, operation) {
  const source = String(text || '');
  if (operation.type === 'insert') {
    const offset = offsetAt(source, operation.position);
    return source.slice(0, offset) + operation.text + source.slice(offset);
  }

  const startOffset = offsetAt(source, operation.range.start);
  const endOffset = offsetAt(source, operation.range.end);
  if (operation.type === 'replace') {
    return source.slice(0, startOffset) + operation.text + source.slice(endOffset);
  }

  if (operation.type === 'delete') {
    return source.slice(0, startOffset) + source.slice(endOffset);
  }

  return source;
}

function createMockVscode(workspaceRoot) {
  const configurationValues = new Map();
  const documents = new Map();
  const commands = new Map();
  const diagnostics = new Map();
  const terminals = [];
  const outputLines = [];
  const codeActionProviders = [];
  const workspaceListeners = {
    onDidChangeConfiguration: [],
    onDidSaveTextDocument: [],
    onDidChangeTextDocument: [],
    onDidOpenTextDocument: [],
    onDidCloseTextDocument: [],
  };
  const windowListeners = {
    onDidCloseTerminal: [],
    onDidChangeActiveTextEditor: [],
  };

  const workspace = {
    getConfiguration() {
      return {
        get(key, defaultValue) {
          return configurationValues.has(key) ? configurationValues.get(key) : defaultValue;
        },
        async update(key, value) {
          configurationValues.set(key, value);
        },
      };
    },
    getWorkspaceFolder(uri) {
      if (!uri || !String(uri.fsPath || '').startsWith(workspaceRoot)) {
        return undefined;
      }
      return { uri: { fsPath: workspaceRoot } };
    },
    openTextDocument(target) {
      const uri = typeof target === 'string'
        ? createUri(target)
        : target;
      const key = uri.toString();
      if (documents.has(key)) {
        return Promise.resolve(documents.get(key));
      }
      const contents = fs.existsSync(uri.fsPath) ? fs.readFileSync(uri.fsPath, 'utf8') : '';
      const document = new MockDocument(uri.fsPath, contents);
      documents.set(key, document);
      return Promise.resolve(document);
    },
    async applyEdit(edit) {
      const operationsByUri = new Map();
      edit.edits.forEach((operation) => {
        const key = operation.uri.toString();
        if (!operationsByUri.has(key)) {
          operationsByUri.set(key, []);
        }
        operationsByUri.get(key).push(operation);
      });

      operationsByUri.forEach((operations, key) => {
        const document = documents.get(key);
        if (!document) {
          return;
        }
        const orderedOperations = [...operations].sort((left, right) => {
          const leftPosition = left.type === 'insert' ? left.position : left.range.start;
          const rightPosition = right.type === 'insert' ? right.position : right.range.start;
          const leftOffset = offsetAt(document.getText(), leftPosition);
          const rightOffset = offsetAt(document.getText(), rightPosition);
          return rightOffset - leftOffset;
        });

        let nextText = document.getText();
        orderedOperations.forEach((operation) => {
          nextText = applyTextOperation(nextText, operation);
        });

        document.setText(nextText);
        fs.mkdirSync(path.dirname(document.fileName), { recursive: true });
        fs.writeFileSync(document.fileName, document.getText(), 'utf8');
      });

      return true;
    },
    onDidChangeConfiguration(listener) {
      workspaceListeners.onDidChangeConfiguration.push(listener);
      return createDisposable();
    },
    onDidSaveTextDocument(listener) {
      workspaceListeners.onDidSaveTextDocument.push(listener);
      return createDisposable();
    },
    onDidChangeTextDocument(listener) {
      workspaceListeners.onDidChangeTextDocument.push(listener);
      return createDisposable();
    },
    onDidOpenTextDocument(listener) {
      workspaceListeners.onDidOpenTextDocument.push(listener);
      return createDisposable();
    },
    onDidCloseTextDocument(listener) {
      workspaceListeners.onDidCloseTextDocument.push(listener);
      return createDisposable();
    },
  };

  const window = {
    activeTextEditor: null,
    visibleTextEditors: [],
    createOutputChannel() {
      return {
        appendLine(line) {
          outputLines.push(String(line || ''));
        },
        show() {},
        dispose() {},
      };
    },
    createStatusBarItem() {
      return {
        text: '',
        tooltip: '',
        command: '',
        show() {},
        dispose() {},
      };
    },
    createTerminal(options) {
      const terminal = {
        options,
        output: '',
        shown: false,
        show() {
          if (terminal.shown) {
            return;
          }
          terminal.shown = true;
          if (options && options.pty && typeof options.pty.onDidWrite === 'function') {
            options.pty.onDidWrite((chunk) => {
              terminal.output += String(chunk || '');
            });
          }
          if (options && options.pty && typeof options.pty.open === 'function') {
            options.pty.open();
          }
        },
        dispose() {
          windowListeners.onDidCloseTerminal.forEach((listener) => listener(terminal));
        },
      };
      terminals.push(terminal);
      return terminal;
    },
    onDidCloseTerminal(listener) {
      windowListeners.onDidCloseTerminal.push(listener);
      return createDisposable();
    },
    onDidChangeActiveTextEditor(listener) {
      windowListeners.onDidChangeActiveTextEditor.push(listener);
      return createDisposable();
    },
  };

  const vscode = {
    Position: MockPosition,
    Range: MockRange,
    Diagnostic: MockDiagnostic,
    DiagnosticSeverity: {
      Error: 0,
      Warning: 1,
      Information: 2,
      Hint: 3,
    },
    StatusBarAlignment: {
      Right: 2,
    },
    WorkspaceEdit: MockWorkspaceEdit,
    EventEmitter: MockEventEmitter,
    languages: {
      createDiagnosticCollection() {
        return {
          set(uri, items) {
            diagnostics.set(uri.toString(), items);
          },
          delete(uri) {
            diagnostics.delete(uri.toString());
          },
          dispose() {
            diagnostics.clear();
          },
        };
      },
      registerCodeActionsProvider(selector, provider) {
        const entry = { selector, provider };
        codeActionProviders.push(entry);
        return createDisposable(() => {
          const index = codeActionProviders.indexOf(entry);
          if (index >= 0) {
            codeActionProviders.splice(index, 1);
          }
        });
      },
    },
    CodeActionKind: {
      QuickFix: 'quickfix',
    },
    commands: {
      registerCommand(name, handler) {
        commands.set(name, handler);
        return createDisposable(() => {
          commands.delete(name);
        });
      },
    },
    workspace,
    window,
    __mock: {
      commands,
      documents,
      diagnostics,
      terminals,
      outputLines,
      codeActionProviders,
      async openFile(filePath) {
        const absoluteFile = path.resolve(filePath);
        const contents = fs.readFileSync(absoluteFile, 'utf8');
        const document = new MockDocument(absoluteFile, contents);
        documents.set(document.uri.toString(), document);
        workspaceListeners.onDidOpenTextDocument.forEach((listener) => listener(document));
        return document;
      },
      setActiveDocument(document) {
        const editor = { document };
        window.activeTextEditor = editor;
        window.visibleTextEditors = [editor];
        windowListeners.onDidChangeActiveTextEditor.forEach((listener) => listener(editor));
      },
    },
  };

  return vscode;
}

function installMockVscode(vscode) {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === 'vscode') {
      return vscode;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  return () => {
    Module._load = originalLoad;
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function writeFile(targetFile, content) {
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.writeFileSync(targetFile, content, 'utf8');
}

function writeMockUndefinedVariableAnalyzer(workspaceRoot, issueMessage, issueSuggestion, snippetText, lineNumber = 2, triggerText = 'createHashh') {
  const analyzerFile = path.join(workspaceRoot, `mock-analyzer-${Math.random().toString(36).slice(2)}.js`);
  writeFile(
    analyzerFile,
    [
      '#!/usr/bin/env node',
      '\'use strict\';',
      'const args = process.argv.slice(2);',
      'const sourceIndex = args.indexOf(\'--source-path\');',
      'const sourceFile = sourceIndex >= 0 ? String(args[sourceIndex + 1] || \'\') : \'\';',
      `const lineNumber = ${JSON.stringify(lineNumber)};`,
      `const issueMessage = ${JSON.stringify(issueMessage)};`,
      `const issueSuggestion = ${JSON.stringify(issueSuggestion)};`,
      `const snippetText = ${JSON.stringify(snippetText)};`,
      `const triggerText = ${JSON.stringify(triggerText)};`,
      'let source = \'\';',
      'process.stdin.setEncoding(\'utf8\');',
      'process.stdin.on(\'data\', (chunk) => { source += String(chunk || \'\'); });',
      'process.stdin.on(\'end\', () => {',
      'if (!sourceFile) {',
      '  process.stdout.write(\'[]\');',
      '  return;',
      '}',
      'if (triggerText && !source.includes(triggerText)) {',
      '  process.stdout.write(\'[]\');',
      '  return;',
      '}',
      'const issues = [{',
      '  file: sourceFile,',
      '  line: lineNumber,',
      '  severity: \'error\',',
      '  kind: \'undefined_variable\',',
      '  message: issueMessage,',
      '  suggestion: issueSuggestion,',
      '  snippet: snippetText,',
      '  action: { op: \'replace_line\' },',
      '}];',
      'process.stdout.write(JSON.stringify(issues));',
      '});',
    ].join('\n'),
  );
  return analyzerFile;
}

function representativeLanguageCases(workspaceRoot) {
  return [
    {
      key: 'cMissingDelimiter',
      failureMessage: 'VS Code smoke: c syntax_missing_delimiter nao fechou o bloco esperado.',
      filePath: path.join(workspaceRoot, 'src', 'billing.c'),
      content: [
        'int soma(int valor) {',
        '  return valor + 1;',
      ].join('\n'),
      isValid: (contents) => String(contents || '').trimEnd().endsWith('}'),
    },
    {
      key: 'dockerfileWorkdir',
      failureMessage: 'VS Code smoke: dockerfile_workdir nao inseriu WORKDIR /app.',
      filePath: path.join(workspaceRoot, 'docker', 'Dockerfile'),
      content: [
        'FROM node:20',
        'COPY . .',
      ].join('\n'),
      isValid: (contents) => String(contents || '').includes('WORKDIR /app'),
    },
    {
      key: 'goFunctionDoc',
      failureMessage: 'VS Code smoke: go function_doc nao inseriu a documentacao esperada.',
      filePath: path.join(workspaceRoot, 'src', 'billing.go'),
      content: [
        'func Soma(valor int) int {',
        '  return valor + 1',
        '}',
      ].join('\n'),
      isValid: (contents) => String(contents || '').includes('comportamento principal'),
    },
    {
      key: 'luaFunctionDoc',
      failureMessage: 'VS Code smoke: lua function_doc nao inseriu a documentacao esperada.',
      filePath: path.join(workspaceRoot, 'src', 'billing.lua'),
      content: [
        'local function soma(valor)',
        '  return valor + 1',
        'end',
      ].join('\n'),
      isValid: (contents) => String(contents || '').includes('Orquestra o comportamento principal'),
    },
    {
      key: 'markdownTitle',
      failureMessage: 'VS Code smoke: markdown_title nao inseriu o H1 esperado.',
      filePath: path.join(workspaceRoot, 'docs', 'api.md'),
      content: 'conteudo sem titulo\n',
      isValid: (contents) => String(contents || '').includes('# Titulo do documento'),
    },
    {
      key: 'pythonStructuredComments',
      failureMessage: 'VS Code smoke: python nao inseriu documentacao de classe, metodo e comentario de variavel.',
      filePath: path.join(workspaceRoot, 'src', 'pedido.py'),
      content: [
        'from dataclasses import dataclass',
        '',
        '@dataclass',
        'class Pedido:',
        '    room_id: str',
        '    chat_state: dict[str, str]',
        '',
        '    def total(',
        '        self,',
        '        valor: int,',
        '    ) -> int:',
        '        subtotal = valor + 1',
        '        return subtotal',
        '',
        '    @classmethod',
        '    def from_payload(',
        '        cls,',
        '        payload: dict[str, str],',
        '    ) -> "Pedido":',
        '        state = payload["chat_state"]',
        '        return cls(chat_state=state)',
      ].join('\n'),
      isValid: (contents) => {
        const normalized = String(contents || '');
        return /class Pedido:\n\s+"""/.test(normalized)
          && /def total\([\s\S]+?\) -> int:\n\s+"""/.test(normalized)
          && /@classmethod\n\s+def from_payload\([\s\S]+?\) -> "Pedido":\n\s+"""/.test(normalized)
          && !/# .+\n    room_id: str/.test(normalized)
          && /# .+\n    chat_state: dict\[str, str\]/.test(normalized)
          && normalized.includes('# Calcula subtotal para suportar o restante do fluxo.');
      },
    },
    {
      key: 'elixirImportUsePreserved',
      failureMessage: 'VS Code smoke: elixir nao preservou use/import only ao corrigir o arquivo.',
      filePath: path.join(workspaceRoot, 'lib', 'billing_import_use_block.ex'),
      content: [
        'defmodule BillingImportUseBlock do',
        '  use RoomState',
        '',
        '  def build do',
        '    import RoomState,',
        '      only: [',
        '        create_empty_state: 0,',
        '        create_invite: 0,',
        '        create_room: 2',
        '      ]',
        '',
        '    state = create_empty_state()',
        '    invite = create_invite()',
        '    room = create_room(state, invite)',
        '    room',
        '  end',
        'end',
      ].join('\n'),
      isValid: (contents) => {
        const normalized = String(contents || '');
        return normalized.includes('  use RoomState')
          && normalized.includes('        create_empty_state: 0,')
          && normalized.includes('        create_invite: 0,');
      },
    },
    {
      key: 'mermaidMissingDelimiter',
      failureMessage: 'VS Code smoke: mermaid syntax_missing_delimiter nao fechou o delimitador esperado.',
      filePath: path.join(workspaceRoot, 'diagrams', 'authentication.mmd'),
      content: [
        'flowchart LR',
        '  A[Inicio --> B[Fim]',
      ].join('\n'),
      isValid: (contents) => String(contents || '').includes('  ]'),
    },
    {
      key: 'rustFunctionDoc',
      failureMessage: 'VS Code smoke: rust function_doc nao inseriu a documentacao esperada.',
      filePath: path.join(workspaceRoot, 'src', 'billing.rs'),
      content: [
        'pub fn soma(valor: i32) -> i32 {',
        '    valor + 1',
        '}',
      ].join('\n'),
      isValid: (contents) => String(contents || '').includes('Orquestra o comportamento principal'),
    },
    {
      key: 'rubyFunctionDoc',
      failureMessage: 'VS Code smoke: ruby function_doc nao inseriu a documentacao esperada.',
      filePath: path.join(workspaceRoot, 'lib', 'billing.rb'),
      content: [
        'def soma(valor)',
        '  valor + 1',
        'end',
      ].join('\n'),
      isValid: (contents) => String(contents || '').includes('comportamento principal'),
    },
    {
      key: 'shellTabs',
      failureMessage: 'VS Code smoke: shell tabs nao converteu tabs em espacos.',
      filePath: path.join(workspaceRoot, 'scripts', 'run.sh'),
      content: '\techo ok\n',
      isValid: (contents) => String(contents || '').includes('  echo ok') && !String(contents || '').includes('\t'),
    },
    {
      key: 'terraformRequiredVersion',
      failureMessage: 'VS Code smoke: terraform_required_version nao inseriu o bloco de versao.',
      filePath: path.join(workspaceRoot, 'infra', 'main.tf'),
      content: 'resource "aws_s3_bucket" "example" {}\n',
      isValid: (contents) => String(contents || '').includes('required_version = ">= 1.5.0"'),
    },
    {
      key: 'tomlMissingQuote',
      failureMessage: 'VS Code smoke: toml syntax_missing_quote nao fechou a aspa.',
      filePath: path.join(workspaceRoot, 'config', 'app.toml'),
      content: 'host = "localhost\n',
      isValid: (contents) => String(contents || '').includes('host = "localhost"'),
    },
    {
      key: 'vimFunctionDoc',
      failureMessage: 'VS Code smoke: vim function_doc nao inseriu a documentacao esperada.',
      filePath: path.join(workspaceRoot, 'autoload', 'billing.vim'),
      content: [
        'function! Soma(valor)',
        '  return a:valor + 1',
        'endfunction',
      ].join('\n'),
      isValid: (contents) => String(contents || '').includes('Orquestra o comportamento principal'),
    },
    {
      key: 'yamlMissingQuote',
      failureMessage: 'VS Code smoke: yaml syntax_missing_quote nao fechou a aspa.',
      filePath: path.join(workspaceRoot, 'config', 'app.yaml'),
      content: 'name: "api\n',
      isValid: (contents) => String(contents || '').includes('name: "api"'),
    },
  ];
}

async function analyzeDocumentFile(vscode, filePath) {
  const document = await vscode.__mock.openFile(filePath);
  vscode.__mock.setActiveDocument(document);
  await vscode.__mock.commands.get('realtimeDevAgent.analyzeCurrentFile')();
  return fs.readFileSync(filePath, 'utf8');
}

async function run() {
  const realAiAvailable = hasLiveOpenAiValidation();
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'realtime-dev-agent-vscode-'));
  fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, 'infra'), { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, 'config'), { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, 'docker'), { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, 'diagrams'), { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, 'autoload'), { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, 'tests', 'src'), { recursive: true });

  fs.writeFileSync(
    path.join(workspaceRoot, 'package.json'),
    JSON.stringify({
      name: 'realtime-dev-agent-smoke',
      private: true,
      scripts: {
        test: 'node ./write-terminal-output.js',
      },
    }, null, 2),
    'utf8',
  );
  fs.writeFileSync(
    path.join(workspaceRoot, 'write-terminal-output.js'),
    [
      'const fs = require("fs");',
      'fs.writeFileSync("terminal-smoke-ok.txt", "terminal-smoke-ok\\n", "utf8");',
      'console.log("terminal-smoke-ok");',
    ].join('\n'),
    'utf8',
  );

  const commentFile = path.join(workspaceRoot, 'src', 'comment.js');
  const contextFile = path.join(workspaceRoot, 'src', 'context.js');
  const terminalFile = path.join(workspaceRoot, 'src', 'terminal.js');
  const blockedTerminalFile = path.join(workspaceRoot, 'src', 'blocked-terminal.js');
  const followUpFile = path.join(workspaceRoot, 'src', 'follow-up.js');
  const autofixFile = path.join(workspaceRoot, 'src', 'math.js');
  const importGenericFile = path.join(workspaceRoot, 'src', 'billing_import_guard_generic.js');
  const importValidatedFile = path.join(workspaceRoot, 'src', 'billing_import_guard_validated.js');
  const nestedTestContextFile = path.join(workspaceRoot, 'tests', 'src', 'context-from-test.js');
  const representativeCases = representativeLanguageCases(workspaceRoot);
  fs.writeFileSync(commentFile, '//: funcao soma\n', 'utf8');
  fs.writeFileSync(contextFile, '// ** bff para crud de usuario\n', 'utf8');
  fs.writeFileSync(terminalFile, '// * rodar testes\n', 'utf8');
  fs.writeFileSync(blockedTerminalFile, '// * commit: feat: smoke bloqueado\n', 'utf8');
  fs.writeFileSync(followUpFile, 'function revisarPedido() {\n  // TODO: revisar fluxo principal\n  return true;\n}\n', 'utf8');
  fs.writeFileSync(nestedTestContextFile, '// ** bff para crud de pedido\n', 'utf8');
  fs.writeFileSync(importGenericFile, 'function buildHasher() {\n  const { createHashh } = require(\'./hash\');\n  return createHash(\'sha256\');\n}\n', 'utf8');
  fs.writeFileSync(importValidatedFile, 'function buildHasher() {\n  const { createHashh } = require(\'./hash\');\n  return createHash(\'sha256\');\n}\n', 'utf8');
  fs.writeFileSync(path.join(workspaceRoot, 'src', 'hash.js'), 'function createHash(value) {\n  return value;\n}\nmodule.exports = { createHash };\n', 'utf8');
  representativeCases.forEach((entry) => {
    fs.mkdirSync(path.dirname(entry.filePath), { recursive: true });
    fs.writeFileSync(entry.filePath, entry.content, 'utf8');
  });
  fs.writeFileSync(
    autofixFile,
    [
      '/**',
      ' * Soma um valor base com a constante local.',
      ' * @param {number} a Valor de entrada do calculo.',
      ' * @returns {number} Resultado numerico final.',
      ' */',
      'function soma_dois(a) {',
      '  const dois = 10;',
      '  return a + doiis;',
      '}',
      '',
      'module.exports = { soma_dois };',
    ].join('\n'),
    'utf8',
  );

  const vscode = createMockVscode(workspaceRoot);
  const restoreLoad = installMockVscode(vscode);

  try {
    const extension = require(path.join(repoRoot, 'vscode', 'extension.js'));
    const context = {
      extensionPath: repoRoot,
      subscriptions: [],
    };
    extension.activate(context);

    const commentResult = await analyzeDocumentFile(vscode, commentFile);

    const contextResult = await analyzeDocumentFile(vscode, contextFile);
    const contextBlueprintFile = path.join(workspaceRoot, '.realtime-dev-agent', 'contexts', 'bff-crud-usuario.md');
    const scaffoldEntityFile = path.join(workspaceRoot, 'src', 'domain', 'entities', 'usuario.js');
    const gitignoreFile = path.join(workspaceRoot, '.gitignore');

    const terminalResult = await analyzeDocumentFile(vscode, terminalFile);
    const terminalOutputFile = path.join(workspaceRoot, 'terminal-smoke-ok.txt');
    const terminalLog = vscode.__mock.terminals.map((terminal) => terminal.output).join('\n');

    await vscode.workspace.getConfiguration().update('terminalRiskMode', 'safe');
    const blockedTerminalResult = await analyzeDocumentFile(vscode, blockedTerminalFile);
    const blockedTerminalLogs = vscode.__mock.outputLines.join('\n');

    await vscode.workspace.getConfiguration().update('autoFixEnabled', false);
    const followUpDocument = await vscode.__mock.openFile(followUpFile);
    vscode.__mock.setActiveDocument(followUpDocument);
    await vscode.__mock.commands.get('realtimeDevAgent.analyzeCurrentFile')();
    const followUpDiagnostics = vscode.__mock.diagnostics.get(followUpDocument.uri.toString()) || [];
    const codeActionProvider = vscode.__mock.codeActionProviders[0] && vscode.__mock.codeActionProviders[0].provider;
    const followUpActions = await Promise.resolve(codeActionProvider.provideCodeActions(
      followUpDocument,
      new MockRange(1, 0, 1, 40),
      { diagnostics: followUpDiagnostics },
    ));
    const followUpAction = Array.isArray(followUpActions)
      ? followUpActions.find((action) => action && action.title === 'Pingu - Dev Agent: Insert actionable follow-up')
      : null;
    if (followUpAction && followUpAction.edit) {
      await vscode.workspace.applyEdit(followUpAction.edit);
    }
    const followUpResult = fs.readFileSync(followUpFile, 'utf8');

    await vscode.workspace.getConfiguration().update('autoFixEnabled', true);
    const autofixDocument = await vscode.__mock.openFile(autofixFile);
    vscode.__mock.setActiveDocument(autofixDocument);
    await vscode.__mock.commands.get('realtimeDevAgent.analyzeCurrentFile')();
    const autofixResult = fs.readFileSync(autofixFile, 'utf8');
    const autofixTestFile = path.join(workspaceRoot, 'tests', 'src', 'math.test.js');
    const autofixTestContents = fs.existsSync(autofixTestFile)
      ? fs.readFileSync(autofixTestFile, 'utf8')
      : '';

    const genericImportAnalyzer = writeMockUndefinedVariableAnalyzer(
      workspaceRoot,
      'Variavel \'createHashh\' nao declarada',
      'Substitua por \'createHash\' para manter coerencia do escopo atual.',
      '  const { createHash } = require(\'./hash\');',
    );
    await vscode.workspace.getConfiguration().update('scriptPath', genericImportAnalyzer);
    const genericImportResult = await analyzeDocumentFile(vscode, importGenericFile);

    const validatedImportAnalyzer = writeMockUndefinedVariableAnalyzer(
      workspaceRoot,
      'Import \'createHashh\' nao exportado por \'./hash\'',
      'Substitua por \'createHash\' para alinhar com a origem importada.',
      '  const { createHash } = require(\'./hash\');',
    );
    await vscode.workspace.getConfiguration().update('scriptPath', validatedImportAnalyzer);
    const validatedImportResult = await analyzeDocumentFile(vscode, importValidatedFile);
    await vscode.workspace.getConfiguration().update('scriptPath', '');

    await analyzeDocumentFile(vscode, nestedTestContextFile);
    const rootContextFromTestFile = path.join(workspaceRoot, '.realtime-dev-agent', 'contexts', 'bff-crud-pedido.md');
    const nestedContextFromTestFile = path.join(workspaceRoot, 'tests', '.realtime-dev-agent', 'contexts', 'bff-crud-pedido.md');
    const representativeLanguages = {};
    for (const entry of representativeCases) {
      const contents = await analyzeDocumentFile(vscode, entry.filePath);
      representativeLanguages[entry.key] = entry.isValid(contents);
    }

    const summary = {
      commentTask: {
        applied: commentResult.includes('function soma(a, b)'),
        removedTrigger: !commentResult.includes('funcao soma'),
      },
      contextFile: {
        removedTrigger: !contextResult.includes('bff para crud de usuario'),
        createdContextFile: fs.existsSync(contextBlueprintFile),
        createdScaffoldEntity: fs.existsSync(scaffoldEntityFile),
        updatedGitignore: fs.existsSync(gitignoreFile)
          && fs.readFileSync(gitignoreFile, 'utf8').includes('.realtime-dev-agent/'),
      },
      terminalTask: {
        removedTrigger: !terminalResult.includes('rodar testes'),
        createdOutputFile: fs.existsSync(terminalOutputFile),
        sawTerminalReady: terminalLog.includes('terminal pronto para o proximo comando.'),
        sawTerminalOutput: terminalLog.includes('terminal-smoke-ok'),
      },
      terminalRisk: {
        preservedTrigger: blockedTerminalResult.includes('commit: feat: smoke bloqueado'),
        blockedByRiskMode: blockedTerminalLogs.includes('Comando bloqueado pelo modo de risco'),
      },
      followUp: {
        diagnosticsCount: followUpDiagnostics.length,
        hasFollowUpAction: Boolean(followUpAction),
        insertedFollowUp: followUpResult.includes('// : Use um ticket ou comentario estruturado'),
      },
      scopedAutoFix: {
        correctedUndefinedVariable: autofixResult.includes('return a + dois;'),
        removedTypoReference: !autofixResult.includes('doiis'),
        createdBehaviorTest: autofixTestContents.includes('assert.equal(subject.soma_dois(5), 15);'),
      },
      importGuard: {
        preservedGenericImportBinding: genericImportResult.includes('const { createHashh } = require(\'./hash\');'),
        appliedValidatedImportBinding: validatedImportResult.includes('const { createHash } = require(\'./hash\');'),
      },
      contextRootResolution: {
        writesContextAtProjectRoot: fs.existsSync(rootContextFromTestFile),
        avoidsNestedTestsContext: !fs.existsSync(nestedContextFromTestFile),
      },
      representativeLanguages,
    };

    assert(summary.terminalTask.removedTrigger, 'VS Code smoke: terminal_task nao removeu a linha gatilho apos sucesso.');
    assert(summary.terminalTask.createdOutputFile, 'VS Code smoke: terminal_task nao executou o script de teste esperado.');
    assert(summary.terminalTask.sawTerminalReady, 'VS Code smoke: terminal_task nao sinalizou readiness do terminal.');
    assert(summary.terminalTask.sawTerminalOutput, 'VS Code smoke: terminal_task nao transmitiu o output do comando.');
    assert(summary.terminalRisk.preservedTrigger, 'VS Code smoke: modo de risco removeu o gatilho de um comando bloqueado.');
    assert(summary.terminalRisk.blockedByRiskMode, 'VS Code smoke: modo de risco nao sinalizou o bloqueio do comando.');
    assert(summary.scopedAutoFix.correctedUndefinedVariable, 'VS Code smoke: undefined_variable nao corrigiu a referencia digitada errado.');
    assert(summary.scopedAutoFix.removedTypoReference, 'VS Code smoke: typo no escopo da funcao permaneceu apos auto-fix.');
    assert(summary.importGuard.preservedGenericImportBinding, 'VS Code smoke: issue generico nao deveria reescrever binding de import.');
    assert(summary.importGuard.appliedValidatedImportBinding, 'VS Code smoke: import validado pela origem deveria continuar aplicando.');
    representativeCases.forEach((entry) => {
      assert(summary.representativeLanguages[entry.key], entry.failureMessage);
    });
    if (realAiAvailable) {
      assert(summary.commentTask.applied, 'VS Code smoke: comment_task nao aplicou o snippet esperado.');
      assert(summary.commentTask.removedTrigger, 'VS Code smoke: comment_task nao removeu a linha gatilho.');
      assert(summary.contextFile.removedTrigger, 'VS Code smoke: context_file nao removeu a linha gatilho.');
      assert(summary.contextFile.createdContextFile, 'VS Code smoke: context_file nao criou o blueprint em .realtime-dev-agent/contexts/.');
      assert(summary.contextFile.createdScaffoldEntity, 'VS Code smoke: context_file nao criou o scaffold da entidade.');
      assert(summary.contextFile.updatedGitignore, 'VS Code smoke: context_file nao atualizou o .gitignore.');
      assert(summary.followUp.diagnosticsCount > 0, 'VS Code smoke: follow-up nao encontrou diagnostico elegivel.');
      assert(summary.followUp.hasFollowUpAction, 'VS Code smoke: follow-up nao expôs code action.');
      assert(summary.followUp.insertedFollowUp, 'VS Code smoke: follow-up nao inseriu comentario acionavel.');
      assert(summary.scopedAutoFix.createdBehaviorTest, 'VS Code smoke: unit_test nao gerou teste de comportamento para a funcao corrigida.');
      assert(summary.contextRootResolution.writesContextAtProjectRoot, 'VS Code smoke: context_file disparado dentro de tests/ nao escreveu o contexto na raiz do projeto.');
      assert(summary.contextRootResolution.avoidsNestedTestsContext, 'VS Code smoke: context_file recriou .realtime-dev-agent dentro de tests/.');
    }

    console.log(JSON.stringify({
      ok: true,
      workspaceRoot,
      hasLiveOpenAiValidation: realAiAvailable,
      summary,
    }, null, 2));
  } finally {
    restoreLoad();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  MockRange,
  assert,
  createMockVscode,
  createUri,
  installMockVscode,
  run,
  splitDocumentLines,
};
