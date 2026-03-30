#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function readSource(repoRoot, relativeFile) {
  return fs.readFileSync(path.join(repoRoot, relativeFile), 'utf8');
}

function includesAll(source, fragments) {
  return fragments.every((fragment) => String(source || '').includes(fragment));
}

function buildCheck(name, editor, feature, ok, details) {
  return {
    name,
    editor,
    feature,
    ok,
    details,
  };
}

function runEditorParityContract(repoRoot) {
  const vimPlugin = readSource(repoRoot, 'vim/plugin/realtime_dev_agent.vim');
  const vimInternal = readSource(repoRoot, 'vim/autoload/realtime_dev_agent/internal.vim');
  const vscodeExtension = readSource(repoRoot, 'vscode/extension.js');
  const vscodeEdits = readSource(repoRoot, 'vscode/edits.js');
  const vscodeTerminal = readSource(repoRoot, 'vscode/terminal.js');
  const vscodeCodeActions = readSource(repoRoot, 'vscode/code-actions.js');
  const zedLsp = readSource(repoRoot, 'zed-extension/server/realtime_dev_agent_lsp.js');
  const issueKinds = JSON.parse(readSource(repoRoot, 'config/issue-kinds.json'));

  const checks = [
    buildCheck(
      'parity:lazyvim:always-active',
      'lazyvim',
      'continuous_analysis',
      includesAll(vimPlugin, [
        "let g:realtime_dev_agent_realtime_on_change = 1",
        "let g:realtime_dev_agent_review_on_open = 1",
        "let g:realtime_dev_agent_start_on_editor_enter = 1",
      ]),
      'LazyVim precisa iniciar o agente automaticamente e manter analise continua.',
    ),
    buildCheck(
      'parity:lazyvim:autofix-core',
      'lazyvim',
      'comment_context_tests',
      includesAll(vimPlugin, [
        "\\ 'comment_task',",
        "\\ 'context_file',",
        "\\ 'unit_test',",
        "\\ 'terminal_task',",
      ]),
      'LazyVim precisa autoaplicar comment_task, context_file, unit_test e terminal_task.',
    ),
    buildCheck(
      'parity:lazyvim:terminal-routing',
      'lazyvim',
      'terminal_task',
      issueKinds.terminal_task
        && issueKinds.terminal_task.defaultAction
        && issueKinds.terminal_task.defaultAction.op === 'run_command'
        && includesAll(vimInternal, [
          "function! s:apply_issue_run_command_toggleterm(",
          "function! s:apply_issue_run_command_vscode(",
          "function! s:apply_issue_run_command_native(",
        ]),
      'LazyVim precisa rotear terminal_task para VS Code terminal, ToggleTerm e fallback nativo.',
    ),
    buildCheck(
      'parity:vscode:always-active',
      'vscode',
      'continuous_analysis',
      includesAll(vscodeExtension, [
        'vscode.workspace.onDidSaveTextDocument(',
        'vscode.workspace.onDidChangeTextDocument(',
        'vscode.workspace.onDidOpenTextDocument(',
        'vscode.window.onDidChangeActiveTextEditor(',
      ]),
      'VS Code precisa analisar ao abrir, focar, editar e salvar.',
    ),
    buildCheck(
      'parity:vscode:autofix-core',
      'vscode',
      'comment_context_tests',
      includesAll(vscodeExtension, [
        'createEditRuntime(',
        'configuredAutoFixKinds(',
      ])
        && includesAll(vscodeEdits, [
          'function createEditRuntime(',
          'async function applyAutoFixes(',
          'async function applyWriteFileIssue(',
        ])
        && issueKinds.comment_task.defaultAction.op === 'replace_line'
        && issueKinds.context_file.defaultAction.op === 'write_file'
        && issueKinds.unit_test.defaultAction.op === 'write_file',
      'VS Code precisa expor auto-fix e acoes para comment_task, context_file e unit_test.',
    ),
    buildCheck(
      'parity:vscode:terminal-stream',
      'vscode',
      'terminal_task',
      includesAll(vscodeExtension, [
        'createTerminalRuntime(',
        'terminalRuntime.applyTerminalTasks(',
      ])
        && includesAll(vscodeTerminal, [
          'function createTerminalRuntime(',
          'function createTerminalSession(cwd) {',
          'terminal conectado em',
          'terminal pronto para o proximo comando.',
          'async function applyTerminalTask(document, issue) {',
        ]),
      'VS Code precisa executar terminal_task com sessao persistente e output em tempo real.',
    ),
    buildCheck(
      'parity:vscode:follow-up',
      'vscode',
      'follow_up',
      includesAll(vscodeExtension, [
        'registerCodeActionsProvider',
        'codeActionRuntime.provideCodeActions',
      ])
        && includesAll(vscodeCodeActions, [
          'function buildFollowUpCodeAction(document, issue) {',
          'Insert actionable follow-up',
        ]),
      'VS Code precisa expor follow-up acionavel por code action.',
    ),
    buildCheck(
      'parity:zed:always-active',
      'zed',
      'continuous_analysis',
      includesAll(zedLsp, [
        'codeActionProvider: true',
        "if (message.method === 'textDocument/didOpen') {",
        "if (message.method === 'textDocument/didChange') {",
        "if (message.method === 'textDocument/didSave') {",
      ]),
      'Zed precisa manter diagnosticos ativos no ciclo didOpen/didChange/didSave.',
    ),
    buildCheck(
      'parity:zed:quickfix-core',
      'zed',
      'comment_context_tests',
      includesAll(zedLsp, [
        'function buildWorkspaceEdit(',
        'return resolveIssueAction(issue);',
      ])
        && issueKinds.comment_task.defaultAction.op === 'replace_line'
        && issueKinds.context_file.defaultAction.op === 'write_file'
        && issueKinds.unit_test.defaultAction.op === 'write_file',
      'Zed precisa aplicar comment_task, context_file e unit_test via quick fix.',
    ),
    buildCheck(
      'parity:zed:terminal-task',
      'zed',
      'terminal_task',
      includesAll(zedLsp, [
        'executeCommandProvider',
        "commands: ['realtimeDevAgent.runTerminalTask']",
        "if (message.method === 'workspace/executeCommand') {",
        "command: 'realtimeDevAgent.runTerminalTask'",
        'function executeTerminalTask(payload) {',
        'terminal conectado em',
        'terminal pronto para o proximo comando.',
      ]),
      'Zed precisa expor terminal_task como code action executavel com logs em tempo real.',
    ),
    buildCheck(
      'parity:zed:follow-up',
      'zed',
      'follow_up',
      includesAll(zedLsp, [
        'buildFollowUpCodeAction(',
        'Insert actionable follow-up',
        'buildFollowUpWorkspaceEdit(',
      ]),
      'Zed precisa expor follow-up acionavel por code action.',
    ),
  ];

  return checks;
}

module.exports = {
  runEditorParityContract,
};
