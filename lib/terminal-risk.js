'use strict';

const RISK_LEVEL_RANK = Object.freeze({
  safe: 0,
  workspace_write: 1,
  destructive: 2,
});

const RISK_MODE_RANK = Object.freeze({
  safe: 0,
  workspace_write: 1,
  all: 2,
  destructive: 2,
});

const DESTRUCTIVE_PATTERNS = Object.freeze([
  {
    category: 'filesystem_destroy',
    summary: 'remove arquivos ou diretorios recursivamente',
    pattern: /\brm\s+-rf\b/,
  },
  {
    category: 'git_history_rewrite',
    summary: 'reescreve o estado do git de forma destrutiva',
    pattern: /\bgit\s+reset\s+--hard\b|\bgit\s+clean\s+-f[dDxX]*/i,
  },
  {
    category: 'system_admin',
    summary: 'usa privilegios elevados ou altera o sistema',
    pattern: /\bsudo\b|\bmkfs\b|\bdd\b|\bshutdown\b|\breboot\b|\bhalt\b|\bpoweroff\b/i,
  },
  {
    category: 'infra_destroy',
    summary: 'destroi recursos de infraestrutura',
    pattern: /\bterraform\s+destroy\b|\bdocker\s+system\s+prune\b|\bkubectl\s+delete\b/i,
  },
]);

const WORKSPACE_WRITE_PATTERNS = Object.freeze([
  {
    category: 'git_write',
    summary: 'altera o estado do repositorio',
    pattern: /\bgit\s+(add|commit|merge|rebase|checkout|switch|stash|pull|push)\b/i,
  },
  {
    category: 'dependency_write',
    summary: 'instala, remove ou atualiza dependencias',
    pattern: /\b(?:npm|pnpm|yarn|bun)\s+(install|add|remove|uninstall|update|upgrade)\b|\bpip\s+install\b|\bmix\s+deps\.get\b|\bgo\s+mod\s+tidy\b|\bcargo\s+(add|fetch)\b/i,
  },
  {
    category: 'build_or_test',
    summary: 'gera artefatos ou executa comandos de validacao com efeito colateral local',
    pattern: /\b(?:npm|pnpm|yarn|bun)\s+run\s+(test|build|format|lint|dev|start)\b|\bmix\s+(test|compile|format|run)\b|\bgo\s+(test|build|run)\b|\bcargo\s+(test|build|run|fmt|clippy)\b|\bpython\s+-m\s+(pytest|py_compile)\b|\bctest\b|\bmake\s+test\b/i,
  },
  {
    category: 'script_execution',
    summary: 'executa scripts ou binarios locais que podem escrever no workspace',
    pattern: /\b(?:node|python|ruby|lua|bash|sh|elixir|nvim)\b/i,
  },
  {
    category: 'workspace_edit',
    summary: 'altera arquivos do projeto',
    pattern: /\bgofmt\s+-w\b|\bsed\s+-i\b|\b(?:cp|mv|mkdir|touch|tee)\b|(?:^|[^\d])>>?\s*[^\s]/i,
  },
]);

function normalizeTerminalRiskLevel(level) {
  const normalized = String(level || '').trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(RISK_LEVEL_RANK, normalized)) {
    return normalized;
  }
  return 'safe';
}

function normalizeTerminalRiskMode(mode) {
  const normalized = String(mode || '').trim().toLowerCase();
  if (normalized === 'destructive') {
    return 'all';
  }
  if (Object.prototype.hasOwnProperty.call(RISK_MODE_RANK, normalized)) {
    return normalized;
  }
  return 'workspace_write';
}

function resolveRiskMatch(command, patterns) {
  return patterns.find((entry) => entry.pattern.test(command)) || null;
}

function classifyTerminalCommandRisk(command) {
  const normalizedCommand = String(command || '').trim();
  const lowerCommand = normalizedCommand.toLowerCase();
  if (!normalizedCommand) {
    return {
      level: 'safe',
      category: 'empty',
      summary: 'comando vazio',
    };
  }

  const destructiveMatch = resolveRiskMatch(lowerCommand, DESTRUCTIVE_PATTERNS);
  if (destructiveMatch) {
    return {
      level: 'destructive',
      category: destructiveMatch.category,
      summary: destructiveMatch.summary,
    };
  }

  const workspaceWriteMatch = resolveRiskMatch(lowerCommand, WORKSPACE_WRITE_PATTERNS);
  if (workspaceWriteMatch) {
    return {
      level: 'workspace_write',
      category: workspaceWriteMatch.category,
      summary: workspaceWriteMatch.summary,
    };
  }

  return {
    level: 'safe',
    category: 'read_only',
    summary: 'comando de leitura ou consulta',
  };
}

function resolveTerminalRisk(actionOrPayload) {
  const command = typeof actionOrPayload === 'string'
    ? actionOrPayload
    : String(actionOrPayload && actionOrPayload.command || '');
  const classified = classifyTerminalCommandRisk(command);
  const declaredRisk = actionOrPayload && typeof actionOrPayload === 'object' && actionOrPayload.risk && typeof actionOrPayload.risk === 'object'
    ? actionOrPayload.risk
    : {};

  return {
    level: normalizeTerminalRiskLevel(declaredRisk.level || classified.level),
    category: String(declaredRisk.category || classified.category),
    summary: String(declaredRisk.summary || classified.summary),
  };
}

function enrichTerminalActionRisk(action) {
  if (!action || typeof action !== 'object') {
    return action;
  }

  return {
    ...action,
    risk: resolveTerminalRisk(action),
  };
}

function isTerminalRiskAllowed(mode, level) {
  const normalizedMode = normalizeTerminalRiskMode(mode);
  const normalizedLevel = normalizeTerminalRiskLevel(level);
  return RISK_LEVEL_RANK[normalizedLevel] <= RISK_MODE_RANK[normalizedMode];
}

function terminalRiskBlockMessage(command, mode, risk) {
  const normalizedMode = normalizeTerminalRiskMode(mode);
  const resolvedRisk = resolveTerminalRisk({
    command,
    risk,
  });
  return `Comando bloqueado pelo modo de risco "${normalizedMode}": ${String(command || '').trim()} (${resolvedRisk.level} - ${resolvedRisk.summary})`;
}

module.exports = {
  classifyTerminalCommandRisk,
  enrichTerminalActionRisk,
  isTerminalRiskAllowed,
  normalizeTerminalRiskLevel,
  normalizeTerminalRiskMode,
  resolveTerminalRisk,
  terminalRiskBlockMessage,
};
