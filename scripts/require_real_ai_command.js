'use strict';

const { spawnSync } = require('child_process');

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com';
const DEFAULT_OPENAI_MODEL = 'gpt-5-codex';
const DEFAULT_OPENAI_TIMEOUT_MS = 30000;
const GENERIC_LIVE_UNAVAILABLE_MESSAGE = 'OpenAI Codex indisponivel para validacao live neste ambiente.';
let cachedLiveValidationState = null;

function readTimeoutMs(env = process.env) {
  const timeout = Number.parseInt(String(env.PINGU_OPENAI_TIMEOUT_MS || ''), 10);
  return Number.isFinite(timeout) && timeout > 0
    ? timeout
    : DEFAULT_OPENAI_TIMEOUT_MS;
}

function readProbeCacheKey(env = process.env) {
  return [
    String(env.OPENAI_API_KEY || '').trim(),
    String(env.PINGU_OPENAI_MODEL || DEFAULT_OPENAI_MODEL).trim(),
    String(env.OPENAI_BASE_URL || env.PINGU_OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL).trim(),
    String(readTimeoutMs(env)),
  ].join('|');
}

function buildProbeRequestBody(env = process.env) {
  const model = String(env.PINGU_OPENAI_MODEL || env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL;
  return JSON.stringify({
    model,
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: 'Retorne JSON valido com {"ok":true}.',
          },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'live_validation_probe',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok'],
          properties: {
            ok: { type: 'boolean' },
          },
        },
      },
    },
  });
}

function cacheLiveValidationState(state, env = process.env) {
  cachedLiveValidationState = {
    ...state,
    cacheKey: readProbeCacheKey(env),
  };
  return cachedLiveValidationState;
}

function probeLiveOpenAiValidation(env = process.env) {
  const apiKey = String(env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    return cacheLiveValidationState({
      enabled: true,
      available: false,
      reason: 'missing_api_key',
      message: 'OPENAI_API_KEY e obrigatoria para executar validacao live com OpenAI Codex.',
    }, env);
  }

  const cacheKey = readProbeCacheKey(env);
  if (cachedLiveValidationState && cachedLiveValidationState.cacheKey === cacheKey) {
    return cachedLiveValidationState;
  }

  const timeoutMs = readTimeoutMs(env);
  const baseUrl = String(env.OPENAI_BASE_URL || env.PINGU_OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL).trim() || DEFAULT_OPENAI_BASE_URL;
  const endpoint = new URL('/v1/responses', baseUrl).toString();

  try {
    const result = spawnSync('curl', [
      '--silent',
      '--show-error',
      '-X',
      'POST',
      endpoint,
      '-H',
      `Authorization: Bearer ${apiKey}`,
      '-H',
      'Content-Type: application/json',
      '-H',
      'Accept: application/json',
      '--data-binary',
      '@-',
    ], {
      encoding: 'utf8',
      input: buildProbeRequestBody(env),
      timeout: timeoutMs + 1000,
      maxBuffer: 1024 * 1024,
      env,
    });

    if (result.error || result.status !== 0) {
      return cacheLiveValidationState({
        enabled: true,
        available: false,
        reason: 'openai_unavailable',
        message: GENERIC_LIVE_UNAVAILABLE_MESSAGE,
      }, env);
    }

    const stdout = String(result.stdout || '').trim();
    if (!stdout) {
      return cacheLiveValidationState({
        enabled: true,
        available: false,
        reason: 'openai_unavailable',
        message: GENERIC_LIVE_UNAVAILABLE_MESSAGE,
      }, env);
    }

    const parsed = JSON.parse(stdout);
    if (parsed && parsed.error) {
      return cacheLiveValidationState({
        enabled: true,
        available: false,
        reason: 'openai_unavailable',
        message: GENERIC_LIVE_UNAVAILABLE_MESSAGE,
      }, env);
    }

    const hasStructuredOutput = typeof parsed.output_text === 'string'
      ? parsed.output_text.trim().length > 0
      : Array.isArray(parsed.output);

    if (!hasStructuredOutput) {
      return cacheLiveValidationState({
        enabled: true,
        available: false,
        reason: 'openai_unavailable',
        message: GENERIC_LIVE_UNAVAILABLE_MESSAGE,
      }, env);
    }

    return cacheLiveValidationState({
      enabled: true,
      available: true,
      reason: 'ok',
      message: 'Validacao live com OpenAI Codex disponivel.',
    }, env);
  } catch (error) {
    return cacheLiveValidationState({
      enabled: true,
      available: false,
      reason: 'openai_unavailable',
      message: GENERIC_LIVE_UNAVAILABLE_MESSAGE,
    }, env);
  }
}

function hasLiveOpenAiValidation(env = process.env) {
  return probeLiveOpenAiValidation(env).available;
}

function requireLiveOpenAiValidation(contextLabel = 'validation', env = process.env) {
  const state = probeLiveOpenAiValidation(env);
  const timeout = readTimeoutMs(env);
  if (state.available) {
    process.env.PINGU_OPENAI_TIMEOUT_MS = String(timeout);
    return state;
  }

  throw new Error(
    `[${contextLabel}] ${state.message}`,
  );
}

module.exports = {
  hasLiveOpenAiValidation,
  probeLiveOpenAiValidation,
  requireLiveOpenAiValidation,
};
