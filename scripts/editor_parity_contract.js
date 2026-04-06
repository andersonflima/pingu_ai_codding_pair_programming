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
  const vscodeSmoke = readSource(repoRoot, 'scripts/vscode_extension_smoke.js');
  const nvimSmoke = readSource(repoRoot, 'scripts/nvim_functional_smoke.js');
  const zedLsp = readSource(repoRoot, 'zed-extension/server/realtime_dev_agent_lsp.js');
  const issueConfidence = readSource(repoRoot, 'lib/issue-confidence.js');
  const projectMemory = readSource(repoRoot, 'lib/project-memory.js');
  const generation = readSource(repoRoot, 'lib/generation.js');
  const followUp = readSource(repoRoot, 'lib/follow-up.js');
  const commentTaskAi = readSource(repoRoot, 'lib/comment-task-ai.js');
  const autofixGuard = readSource(repoRoot, 'lib/autofix-guard.js');
  const issueKinds = JSON.parse(readSource(repoRoot, 'config/issue-kinds.json'));

  const checks = [
    buildCheck(
      'parity:shared:semantic-orchestration',
      'shared',
      'semantic_priority_noop_confidence',
      includesAll(issueConfidence, [
        'function semanticPriorityForIssue(issue)',
        'function autoFixNoOpReason(issue, options = {})',
        'function buildIssueConfidenceReport(issues = [])',
        'languages: {}',
      ]),
      'O runtime compartilhado precisa expor prioridade semantica, no-op defensivo e relatorio de confianca por kind e por linguagem.',
    ),
    buildCheck(
      'parity:shared:project-memory',
      'shared',
      'project_memory',
      includesAll(projectMemory, [
        'function loadProjectMemory(file)',
        'architecture',
        'entity',
        'sourceRoot',
      ])
        && includesAll(generation, [
          'projectMemory: loadProjectMemory(',
        ])
        && includesAll(commentTaskAi, [
          'projectMemory: loadProjectMemory(sourceFile)',
        ])
        && includesAll(followUp, [
          'const projectMemory = loadProjectMemory(',
          'function withProjectContext(baseInstruction)',
        ]),
      'O agente precisa carregar memoria local do repo para contextualizar geracao, comentarios e follow-up.',
    ),
    buildCheck(
      'parity:shared:batch-guard-policy',
      'shared',
      'batch_guard_policy',
      includesAll(autofixGuard, [
        'function classifyAutofixBatch(appliedIssues, fileEntries = [])',
        'requiresRuntimeValidation',
        'batchProfile',
      ]),
      'O guard compartilhado precisa distinguir lote documental, estrutural e rewrite para validar apenas quando faz sentido.',
    ),
    buildCheck(
      'parity:architecture:large-file-advisory-only',
      'shared',
      'advisory_only_diagnostics',
      issueKinds.large_file
        && issueKinds.large_file.autoFixDefault === false
        && issueKinds.large_file.supportsQuickFix === false
        && issueKinds.large_file.supportsFollowUp === false,
      'large_file precisa continuar apenas como diagnostico consultivo, sem quick fix ou follow-up automatico.',
    ),
    buildCheck(
      'parity:lazyvim:always-active',
      'lazyvim',
      'continuous_analysis',
      includesAll(vimPlugin, [
        "let g:realtime_dev_agent_realtime_on_change = 1",
        "let g:realtime_dev_agent_start_on_editor_enter = 1",
        "let g:realtime_dev_agent_review_on_open = 0",
        "let g:realtime_dev_agent_open_window_on_start = 0",
      ]),
      'LazyVim precisa iniciar o agente automaticamente e manter analise continua sem reabrir review nem painel em toda navegacao.',
    ),
    buildCheck(
      'parity:lazyvim:preserve-visual-flow',
      'lazyvim',
      'buffer_navigation',
      includesAll(vimInternal, [
        'function! s:focus_issue_target_file(file) abort',
        "execute 'silent! keepalt keepjumps buffer ' . l:target_buf",
      ]),
      'LazyVim precisa navegar para o arquivo alvo por buffer, sem recarregar o arquivo com :edit durante aplicacao e navegacao do painel.',
    ),
    buildCheck(
      'parity:lazyvim:stable-autofix-batch',
      'lazyvim',
      'batch_visual_stability',
      includesAll(vimPlugin, [
        "let g:realtime_dev_agent_auto_fix_visual_mode = 'preserve'",
      ])
        && includesAll(vimInternal, [
          'function! s:start_auto_fix_visual_batch(bufnr) abort',
          'function! s:end_auto_fix_visual_batch(context) abort',
          "let &lazyredraw = 1",
        ]),
      'LazyVim precisa aplicar auto-fix em lote com modo visual estavel, preservando a view e redesenhando uma vez no final.',
    ),
    buildCheck(
      'parity:lazyvim:near-cursor-batch-scope',
      'lazyvim',
      'local_autofix_scope',
      includesAll(vimPlugin, [
        "let g:realtime_dev_agent_auto_fix_scope = 'near_cursor'",
        "let g:realtime_dev_agent_auto_fix_near_cursor_radius = 24",
        "let g:realtime_dev_agent_auto_fix_cluster_gap = 8",
      ])
        && includesAll(vimInternal, [
          'function! s:auto_fix_scope() abort',
          'function! s:build_auto_fix_clusters(items) abort',
          'function! s:select_auto_fix_candidates_by_scope(items) abort',
        ]),
      'LazyVim precisa limitar o auto-fix automatico ao trecho mais proximo do cursor, em vez de aplicar o arquivo inteiro por ciclo.',
    ),
    buildCheck(
      'parity:lazyvim:autofix-core',
      'lazyvim',
      'comment_context_tests',
      includesAll(vimPlugin, [
        "\\ 'comment_task',",
        "let g:realtime_dev_agent_target_scope = 'current_file'",
        "let g:realtime_dev_agent_auto_fix_local_cursor_context_only = 1",
      ])
        && !String(vimPlugin || '').includes("\\ 'context_file',")
        && !String(vimPlugin || '').includes("\\ 'unit_test',")
        && !String(vimPlugin || '').includes("\\ 'terminal_task',")
        && includesAll(vimInternal, [
          'function! s:target_scope() abort',
          'function! s:issue_targets_active_scope(item, current_file) abort',
          'function! s:limit_cursor_context_auto_fix_candidates(items) abort',
        ]),
      'LazyVim precisa priorizar o arquivo atual com auto-fix seguro por padrao, deixando acoes multi-arquivo e terminal como opt-in.',
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
      'parity:lazyvim:autofix-guard',
      'lazyvim',
      'autofix_guard',
      includesAll(vimInternal, [
        'function! s:collect_analysis_for_buffer(',
        'function! s:restore_file_snapshot(',
        'function! s:run_autofix_guard(',
      ]),
      'LazyVim precisa validar o lote aplicado e restaurar snapshot quando a guarda reprovar.',
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
      'parity:vscode:autofix-guard',
      'vscode',
      'autofix_guard',
      includesAll(vscodeEdits, [
        'evaluateAutofixGuard(',
        'captureFileSnapshot(',
        'restoreFileSnapshot(',
        'function isImportLikeLine(line)',
        'function isValidatedImportBindingIssue(issue)',
      ]),
      'VS Code precisa validar must-clear e sintaxe antes de manter o autofix.',
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
      'parity:vscode:representative-languages',
      'vscode',
      'representative_language_smoke',
      includesAll(vscodeSmoke, [
        "path.join(workspaceRoot, 'src', 'billing.c')",
        "path.join(workspaceRoot, 'docker', 'Dockerfile')",
        "path.join(workspaceRoot, 'src', 'billing.go')",
        "path.join(workspaceRoot, 'lib', 'billing_import_use_block.ex')",
        "path.join(workspaceRoot, 'src', 'billing.lua')",
        "path.join(workspaceRoot, 'docs', 'api.md')",
        "path.join(workspaceRoot, 'src', 'pedido.py')",
        "path.join(workspaceRoot, 'diagrams', 'authentication.mmd')",
        "path.join(workspaceRoot, 'src', 'billing.rs')",
        "path.join(workspaceRoot, 'lib', 'billing.rb')",
        "path.join(workspaceRoot, 'scripts', 'run.sh')",
        "path.join(workspaceRoot, 'infra', 'main.tf')",
        "path.join(workspaceRoot, 'config', 'app.toml')",
        "path.join(workspaceRoot, 'autoload', 'billing.vim')",
        "path.join(workspaceRoot, 'config', 'app.yaml')",
      ]),
      'VS Code precisa exercitar todas as linguagens ativas com smoke representativo.',
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
      'parity:lazyvim:representative-languages',
      'lazyvim',
      'representative_language_smoke',
      includesAll(nvimSmoke, [
        "runCase('c-missing-delimiter', buildCMissingDelimiterCase)",
        "runCase('dockerfile-workdir', buildDockerfileWorkdirCase)",
        "runCase('go-function-doc', buildGoFunctionDocCase)",
        "runCase('elixir-import-use-preserved', buildElixirImportUsePreservedCase)",
        "runCase('lua-function-doc', buildLuaFunctionDocCase)",
        "runCase('python-structured-comments', buildPythonStructuredCommentsCase)",
        "runCase('markdown-title', buildMarkdownTitleCase)",
        "runCase('mermaid-missing-delimiter', buildMermaidMissingDelimiterCase)",
        "runCase('rust-function-doc', buildRustFunctionDocCase)",
        "runCase('ruby-function-doc', buildRubyFunctionDocCase)",
        "runCase('shell-missing-quote', buildShellMissingQuoteCase)",
        "runCase('terraform-required-version', buildTerraformRequiredVersionCase)",
        "runCase('toml-missing-quote', buildTomlMissingQuoteCase)",
        "runCase('vim-function-doc', buildVimFunctionDocCase)",
        "runCase('yaml-missing-quote', buildYamlMissingQuoteCase)",
      ]),
      'LazyVim precisa exercitar todas as linguagens ativas com smoke representativo.',
    ),
    buildCheck(
      'parity:zed:quickfix-core',
      'zed',
      'comment_context_tests',
      includesAll(zedLsp, [
        'function buildQuickFixCodeAction(',
        'function buildWorkspaceEdit(',
        "command: 'realtimeDevAgent.applyIssueFix'",
        'return resolveIssueAction(issue);',
      ])
        && issueKinds.comment_task.defaultAction.op === 'replace_line'
        && issueKinds.context_file.defaultAction.op === 'write_file'
        && issueKinds.unit_test.defaultAction.op === 'write_file',
      'Zed precisa aplicar comment_task, context_file e unit_test via quick fix.',
    ),
    buildCheck(
      'parity:zed:quickfix-guard',
      'zed',
      'autofix_guard',
      includesAll(zedLsp, [
        'executeIssueFix(',
        'requestApplyEdit(',
        'buildSnapshotRestoreEdit(',
        'evaluateAutofixGuard(',
        'function isImportLikeLine(line) {',
        'function isValidatedImportBindingIssue(issue) {',
      ]),
      'Zed precisa aplicar quickfix com validacao e rollback programatico.',
    ),
    buildCheck(
      'parity:zed:terminal-task',
      'zed',
      'terminal_task',
      includesAll(zedLsp, [
        'executeCommandProvider',
        "commands: ['realtimeDevAgent.runTerminalTask', 'realtimeDevAgent.applyIssueFix']",
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
