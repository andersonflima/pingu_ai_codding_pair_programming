'use strict';

const {
  isTerminalRiskAllowed,
  normalizeTerminalRiskMode,
  resolveTerminalRisk,
  terminalRiskBlockMessage,
} = require('../lib/terminal-risk');

function createTerminalRuntime(deps) {
  const {
    path,
    spawn,
    vscode,
    analyzeDocument,
    getTerminalRiskMode,
    isTerminalActionsEnabled,
    issueActionIdentity,
    issueKey,
    issueLineIndex,
    issueTriggerText,
    output,
    removeTriggerLine,
    resolveIssueAction,
  } = deps;

  const pendingTerminalTasks = new Map();
  const activeTerminalSessions = new Map();
  const attemptedTerminalTasks = new Map();
  const pendingTerminalTaskStaleMs = 30 * 1000;

  function shouldAutoApplyTerminalTasks(trigger) {
    const normalizedTrigger = String(trigger || '').trim();
    return ['save', 'autofix', 'manual', 'terminal'].includes(normalizedTrigger);
  }

  function clearTerminalAttempts(uri) {
    const prefix = `${uri.toString()}|`;
    Array.from(attemptedTerminalTasks.keys()).forEach((key) => {
      if (key.startsWith(prefix)) {
        attemptedTerminalTasks.delete(key);
      }
    });
  }

  function handleTerminalClosed(terminal) {
    Array.from(activeTerminalSessions.entries()).forEach(([key, session]) => {
      if (session.terminal === terminal) {
        activeTerminalSessions.delete(key);
      }
    });
  }

  function isTerminalIssue(issue) {
    const action = resolveIssueAction(issue);
    return Boolean(
      issue
      && issue.kind === 'terminal_task'
      && action
      && action.op === 'run_command'
      && typeof action.command === 'string'
      && action.command.trim() !== ''
    );
  }

  function terminalIssueFingerprint(document, issue) {
    return [
      document.uri.toString(),
      Number(issue.line || 1),
      issueActionIdentity(issue),
      issueTriggerText(document, issue),
    ].join('|');
  }

  function recyclePendingTerminalTask(key) {
    const pendingEntry = pendingTerminalTasks.get(key);
    if (!pendingEntry) {
      return false;
    }
    if (!pendingEntry.finishedAt) {
      return false;
    }
    if (Date.now() - Number(pendingEntry.finishedAt || 0) < pendingTerminalTaskStaleMs) {
      return false;
    }

    pendingTerminalTasks.delete(key);
    return true;
  }

  function terminalText(value) {
    return String(value || '').replace(/\r?\n/g, '\r\n');
  }

  function resolveActionRisk(uri, action) {
    const mode = normalizeTerminalRiskMode(
      typeof getTerminalRiskMode === 'function' ? getTerminalRiskMode(uri) : 'workspace_write',
    );
    const risk = resolveTerminalRisk(action);
    return {
      mode,
      risk,
      allowed: isTerminalRiskAllowed(mode, risk.level),
    };
  }

  function createTerminalSession(cwd) {
    const writeEmitter = new vscode.EventEmitter();
    const closeEmitter = new vscode.EventEmitter();
    const session = {
      child: null,
      terminal: null,
      busy: false,
      onDidWrite: writeEmitter.event,
      onDidClose: closeEmitter.event,
      open: () => {
        writeEmitter.fire(terminalText(`[RealtimeDevAgent] terminal conectado em ${cwd || process.cwd()}\n`));
      },
      close: () => {
        if (session.child && !session.child.killed) {
          session.child.kill('SIGTERM');
        }
        closeEmitter.fire();
      },
      handleInput: (data) => {
        if (data === '\x03' && session.child && !session.child.killed) {
          session.child.kill('SIGINT');
          writeEmitter.fire('^C\r\n');
        }
      },
      async run(command) {
        if (session.busy) {
          writeEmitter.fire(terminalText('[RealtimeDevAgent] terminal ocupado, aguardando a execucao atual finalizar.\n'));
          return 1;
        }

        session.busy = true;
        writeEmitter.fire(terminalText(`\n[RealtimeDevAgent] command: ${command}\n\n`));

        const exitCode = await new Promise((resolve) => {
          const child = spawn('/bin/sh', ['-lc', command], {
            cwd,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          session.child = child;

          child.stdout.on('data', (chunk) => {
            writeEmitter.fire(terminalText(String(chunk)));
          });

          child.stderr.on('data', (chunk) => {
            writeEmitter.fire(terminalText(String(chunk)));
          });

          child.on('error', (error) => {
            writeEmitter.fire(terminalText(`[RealtimeDevAgent] falha ao iniciar comando: ${error.message}\n`));
            resolve(1);
          });

          child.on('close', (code) => {
            resolve(typeof code === 'number' ? code : 1);
          });
        });

        session.child = null;
        session.busy = false;
        writeEmitter.fire(terminalText(`\n[RealtimeDevAgent] exit code: ${exitCode}\n`));
        writeEmitter.fire(terminalText('[RealtimeDevAgent] terminal pronto para o proximo comando.\n'));
        return exitCode;
      },
    };

    session.terminal = vscode.window.createTerminal({
      name: 'Pingu - Dev Agent',
      pty: session,
      isTransient: false,
    });

    return session;
  }

  async function applyTerminalTask(document, issue) {
    const key = issueKey(document, issue);
    const fingerprint = terminalIssueFingerprint(document, issue);
    const action = resolveIssueAction(issue);
    const command = String(action.command || '').trim();
    if (!command) {
      return false;
    }

    const actionRisk = resolveActionRisk(document.uri, action);
    if (!actionRisk.allowed) {
      output.appendLine(`[RealtimeDevAgent] ${terminalRiskBlockMessage(command, actionRisk.mode, actionRisk.risk)}`);
      output.show(true);
      return false;
    }

    if (pendingTerminalTasks.has(key) && !recyclePendingTerminalTask(key)) {
      output.appendLine(`[RealtimeDevAgent] Acao de terminal ja esta em execucao no VS Code: ${command}`);
      return true;
    }

    if (attemptedTerminalTasks.has(fingerprint)) {
      return true;
    }

    const cwd = String(action.cwd || '').trim()
      || (vscode.workspace.getWorkspaceFolder(document.uri)
        ? vscode.workspace.getWorkspaceFolder(document.uri).uri.fsPath
        : path.dirname(document.fileName));
    const triggerText = issueTriggerText(document, issue);
    const terminalKey = cwd || '__default__';
    let session = activeTerminalSessions.get(terminalKey);
    if (!session || !session.terminal) {
      session = createTerminalSession(cwd);
      activeTerminalSessions.set(terminalKey, session);
    }

    pendingTerminalTasks.set(key, {
      startedAt: Date.now(),
    });
    attemptedTerminalTasks.set(fingerprint, {
      startedAt: Date.now(),
    });
    session.terminal.show(false);
    output.appendLine(`[RealtimeDevAgent] Executando no terminal do VS Code: ${command}`);

    try {
      const exitCode = await session.run(command);
      if (exitCode !== 0) {
        output.appendLine(`[RealtimeDevAgent] Acao de terminal falhou com codigo ${exitCode}`);
        output.show(true);
        return true;
      }

      const removed = await removeTriggerLine(document, issue, triggerText);
      if (removed) {
        const refreshedDocument = await vscode.workspace.openTextDocument(document.uri);
        await analyzeDocument(refreshedDocument, 'terminal');
      }
      return true;
    } finally {
      pendingTerminalTasks.set(key, {
        finishedAt: Date.now(),
      });
    }
  }

  async function applyTerminalTasks(document, issues, options = {}) {
    if (!isTerminalActionsEnabled(document.uri)) {
      return false;
    }
    if (!shouldAutoApplyTerminalTasks(options.trigger)) {
      return false;
    }

    const terminalIssue = issues.find((issue) => isTerminalIssue(issue));
    if (!terminalIssue) {
      return false;
    }

    return applyTerminalTask(document, terminalIssue);
  }

  return {
    applyTerminalTasks,
    clearTerminalAttempts,
    handleTerminalClosed,
    isTerminalIssue,
  };
}

module.exports = {
  createTerminalRuntime,
};
