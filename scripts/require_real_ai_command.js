'use strict';

function requireRealAiCommand(contextLabel = 'validation') {
  const configuredCommand = String(process.env.PINGU_COMMENT_TASK_AI_CMD || '').trim();
  if (!configuredCommand) {
    throw new Error(
      `[${contextLabel}] PINGU_COMMENT_TASK_AI_CMD e obrigatorio. Configure um comando real de IA para executar esta validacao.`,
    );
  }

  if (/mock_comment_task_ai\.js/i.test(configuredCommand)) {
    throw new Error(
      `[${contextLabel}] comando mock de IA bloqueado. Configure um provedor real em PINGU_COMMENT_TASK_AI_CMD.`,
    );
  }

  const timeout = Number.parseInt(String(process.env.PINGU_COMMENT_TASK_AI_TIMEOUT_MS || ''), 10);
  if (!Number.isFinite(timeout) || timeout <= 0) {
    process.env.PINGU_COMMENT_TASK_AI_TIMEOUT_MS = '30000';
  }
}

module.exports = {
  requireRealAiCommand,
};
