#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

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

async function run() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'realtime-dev-agent-vscode-'));
  fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
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
  const nestedTestContextFile = path.join(workspaceRoot, 'tests', 'src', 'context-from-test.js');
  fs.writeFileSync(commentFile, '//: funcao soma\n', 'utf8');
  fs.writeFileSync(contextFile, '// ** bff para crud de usuario\n', 'utf8');
  fs.writeFileSync(terminalFile, '// * rodar testes\n', 'utf8');
  fs.writeFileSync(blockedTerminalFile, '// * commit: feat: smoke bloqueado\n', 'utf8');
  fs.writeFileSync(followUpFile, 'function revisarPedido() {\n  // TODO: revisar fluxo principal\n  return true;\n}\n', 'utf8');
  fs.writeFileSync(nestedTestContextFile, '// ** bff para crud de pedido\n', 'utf8');
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

    const commentDocument = await vscode.__mock.openFile(commentFile);
    vscode.__mock.setActiveDocument(commentDocument);
    await vscode.__mock.commands.get('realtimeDevAgent.analyzeCurrentFile')();
    const commentResult = fs.readFileSync(commentFile, 'utf8');

    const contextDocument = await vscode.__mock.openFile(contextFile);
    vscode.__mock.setActiveDocument(contextDocument);
    await vscode.__mock.commands.get('realtimeDevAgent.analyzeCurrentFile')();
    const contextResult = fs.readFileSync(contextFile, 'utf8');
    const contextBlueprintFile = path.join(workspaceRoot, '.realtime-dev-agent', 'contexts', 'bff-crud-usuario.md');
    const scaffoldEntityFile = path.join(workspaceRoot, 'src', 'domain', 'entities', 'usuario.js');
    const gitignoreFile = path.join(workspaceRoot, '.gitignore');

    const terminalDocument = await vscode.__mock.openFile(terminalFile);
    vscode.__mock.setActiveDocument(terminalDocument);
    await vscode.__mock.commands.get('realtimeDevAgent.analyzeCurrentFile')();
    const terminalResult = fs.readFileSync(terminalFile, 'utf8');
    const terminalOutputFile = path.join(workspaceRoot, 'terminal-smoke-ok.txt');
    const terminalLog = vscode.__mock.terminals.map((terminal) => terminal.output).join('\n');

    await vscode.workspace.getConfiguration().update('terminalRiskMode', 'safe');
    const blockedTerminalDocument = await vscode.__mock.openFile(blockedTerminalFile);
    vscode.__mock.setActiveDocument(blockedTerminalDocument);
    await vscode.__mock.commands.get('realtimeDevAgent.analyzeCurrentFile')();
    const blockedTerminalResult = fs.readFileSync(blockedTerminalFile, 'utf8');
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

    const nestedTestContextDocument = await vscode.__mock.openFile(nestedTestContextFile);
    vscode.__mock.setActiveDocument(nestedTestContextDocument);
    await vscode.__mock.commands.get('realtimeDevAgent.analyzeCurrentFile')();
    const rootContextFromTestFile = path.join(workspaceRoot, '.realtime-dev-agent', 'contexts', 'bff-crud-pedido.md');
    const nestedContextFromTestFile = path.join(workspaceRoot, 'tests', '.realtime-dev-agent', 'contexts', 'bff-crud-pedido.md');

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
      contextRootResolution: {
        writesContextAtProjectRoot: fs.existsSync(rootContextFromTestFile),
        avoidsNestedTestsContext: !fs.existsSync(nestedContextFromTestFile),
      },
    };

    assert(summary.commentTask.applied, 'VS Code smoke: comment_task nao aplicou o snippet esperado.');
    assert(summary.commentTask.removedTrigger, 'VS Code smoke: comment_task nao removeu a linha gatilho.');
    assert(summary.contextFile.removedTrigger, 'VS Code smoke: context_file nao removeu a linha gatilho.');
    assert(summary.contextFile.createdContextFile, 'VS Code smoke: context_file nao criou o blueprint em .realtime-dev-agent/contexts/.');
    assert(summary.contextFile.createdScaffoldEntity, 'VS Code smoke: context_file nao criou o scaffold da entidade.');
    assert(summary.contextFile.updatedGitignore, 'VS Code smoke: context_file nao atualizou o .gitignore.');
    assert(summary.terminalTask.removedTrigger, 'VS Code smoke: terminal_task nao removeu a linha gatilho apos sucesso.');
    assert(summary.terminalTask.createdOutputFile, 'VS Code smoke: terminal_task nao executou o script de teste esperado.');
    assert(summary.terminalTask.sawTerminalReady, 'VS Code smoke: terminal_task nao sinalizou readiness do terminal.');
    assert(summary.terminalTask.sawTerminalOutput, 'VS Code smoke: terminal_task nao transmitiu o output do comando.');
    assert(summary.terminalRisk.preservedTrigger, 'VS Code smoke: modo de risco removeu o gatilho de um comando bloqueado.');
    assert(summary.terminalRisk.blockedByRiskMode, 'VS Code smoke: modo de risco nao sinalizou o bloqueio do comando.');
    assert(summary.followUp.diagnosticsCount > 0, 'VS Code smoke: follow-up nao encontrou diagnostico elegivel.');
    assert(summary.followUp.hasFollowUpAction, 'VS Code smoke: follow-up nao expôs code action.');
    assert(summary.followUp.insertedFollowUp, 'VS Code smoke: follow-up nao inseriu comentario acionavel.');
    assert(summary.scopedAutoFix.correctedUndefinedVariable, 'VS Code smoke: undefined_variable nao corrigiu a referencia digitada errado.');
    assert(summary.scopedAutoFix.removedTypoReference, 'VS Code smoke: typo no escopo da funcao permaneceu apos auto-fix.');
    assert(summary.scopedAutoFix.createdBehaviorTest, 'VS Code smoke: unit_test nao gerou teste de comportamento para a funcao corrigida.');
    assert(summary.contextRootResolution.writesContextAtProjectRoot, 'VS Code smoke: context_file disparado dentro de tests/ nao escreveu o contexto na raiz do projeto.');
    assert(summary.contextRootResolution.avoidsNestedTestsContext, 'VS Code smoke: context_file recriou .realtime-dev-agent dentro de tests/.');

    console.log(JSON.stringify({
      ok: true,
      workspaceRoot,
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
