'use strict';

function isLiveOpenAiValidationEnabled() {
  return /^(?:1|true|yes)$/i.test(String(process.env.PINGU_VALIDATE_WITH_OPENAI || '').trim());
}

function hasLiveOpenAiValidation() {
  const openAiKey = String(process.env.OPENAI_API_KEY || '').trim();
  return isLiveOpenAiValidationEnabled() && openAiKey.length > 0;
}

function requireLiveOpenAiValidation(contextLabel = 'validation') {
  const openAiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (isLiveOpenAiValidationEnabled() && openAiKey) {
    const timeout = Number.parseInt(String(process.env.PINGU_OPENAI_TIMEOUT_MS || ''), 10);
    if (!Number.isFinite(timeout) || timeout <= 0) {
      process.env.PINGU_OPENAI_TIMEOUT_MS = '30000';
    }
    return;
  }

  const timeout = Number.parseInt(String(process.env.PINGU_OPENAI_TIMEOUT_MS || ''), 10);
  if (!Number.isFinite(timeout) || timeout <= 0) {
    process.env.PINGU_OPENAI_TIMEOUT_MS = '30000';
  }

  throw new Error(
    `[${contextLabel}] OPENAI_API_KEY e obrigatoria com PINGU_VALIDATE_WITH_OPENAI=1 para executar esta validacao live com Codex.`,
  );
}

module.exports = {
  hasLiveOpenAiValidation,
  requireLiveOpenAiValidation,
};
