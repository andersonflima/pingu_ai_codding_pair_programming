'use strict';

const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { loadProjectMemory } = require('./project-memory');

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com';
const DEFAULT_OPENAI_MODEL = 'gpt-5-codex';
const DEFAULT_AI_TIMEOUT_MS = 30000;
const AI_RESPONSE_CACHE_MAX_ENTRIES = 128;
const AI_FAILURE_CACHE_TTL_MS = 15000;
const aiResponseCache = new Map();
const aiResponseCacheOrder = [];
const aiFailureCache = new Map();
const OPENAI_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['snippet', 'message', 'suggestion', 'dependencies', 'action'],
  properties: {
    snippet: { type: 'string' },
    message: { type: 'string' },
    suggestion: { type: 'string' },
    dependencies: {
      type: 'array',
      items: { type: 'string' },
    },
    action: {
      type: 'object',
      additionalProperties: false,
      required: ['op', 'target_file', 'mkdir_p', 'remove_trigger', 'command', 'description'],
      properties: {
        op: { type: 'string' },
        target_file: { type: 'string' },
        mkdir_p: { type: 'boolean' },
        remove_trigger: { type: 'boolean' },
        command: { type: 'string' },
        description: { type: 'string' },
      },
    },
  },
};

function createCommentTaskAiTools(deps = {}) {
  const {
    analysisExtension,
    bestPracticesFor,
    getCapabilityProfile,
  } = deps;

  function readOpenAiApiKey(env = process.env) {
    return String(env.OPENAI_API_KEY || '').trim();
  }

  function readOpenAiModel(env = process.env) {
    const configured = String(env.PINGU_OPENAI_MODEL || env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL).trim();
    return configured || DEFAULT_OPENAI_MODEL;
  }

  function readOpenAiBaseUrl(env = process.env) {
    const configured = String(env.OPENAI_BASE_URL || env.PINGU_OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL).trim();
    return configured || DEFAULT_OPENAI_BASE_URL;
  }

  function hasOpenAiConfiguration(env = process.env) {
    return readOpenAiApiKey(env).length > 0;
  }

  function readTimeoutMs(env = process.env) {
    const parsed = Number.parseInt(String(env.PINGU_OPENAI_TIMEOUT_MS || DEFAULT_AI_TIMEOUT_MS), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AI_TIMEOUT_MS;
  }

  function touchAiResponseCacheKey(key) {
    const index = aiResponseCacheOrder.indexOf(key);
    if (index >= 0) {
      aiResponseCacheOrder.splice(index, 1);
    }
    aiResponseCacheOrder.push(key);
  }

  function pruneAiResponseCache() {
    while (aiResponseCacheOrder.length > AI_RESPONSE_CACHE_MAX_ENTRIES) {
      const staleKey = aiResponseCacheOrder.shift();
      aiResponseCache.delete(staleKey);
    }
  }

  function cloneAiResult(result) {
    return result ? JSON.parse(JSON.stringify(result)) : null;
  }

  function aiResponseCacheKey(payload, env) {
    return crypto.createHash('sha1')
      .update(JSON.stringify(payload || {}))
      .update('\0')
      .update(readOpenAiModel(env))
      .update('\0')
      .update(readOpenAiBaseUrl(env))
      .update('\0')
      .update(crypto.createHash('sha1').update(readOpenAiApiKey(env)).digest('hex'))
      .digest('hex');
  }

  function readCachedAiResponse(cacheKey) {
    if (!aiResponseCache.has(cacheKey)) {
      return null;
    }
    touchAiResponseCacheKey(cacheKey);
    return cloneAiResult(aiResponseCache.get(cacheKey));
  }

  function storeCachedAiResponse(cacheKey, result) {
    aiFailureCache.delete(cacheKey);
    aiResponseCache.set(cacheKey, cloneAiResult(result));
    touchAiResponseCacheKey(cacheKey);
    pruneAiResponseCache();
    return cloneAiResult(result);
  }

  function readCachedAiFailure(cacheKey) {
    const cachedAt = Number(aiFailureCache.get(cacheKey) || 0);
    if (!cachedAt) {
      return false;
    }
    if (Date.now() - cachedAt > AI_FAILURE_CACHE_TTL_MS) {
      aiFailureCache.delete(cacheKey);
      return false;
    }
    return true;
  }

  function storeCachedAiFailure(cacheKey) {
    if (!cacheKey) {
      return null;
    }
    aiFailureCache.set(cacheKey, Date.now());
    return null;
  }

  function sanitizeIssueFixSnippet(rawSnippet) {
    const source = String(rawSnippet || '').replace(/\r\n/g, '\n');
    return source
      .split('\n')
      .map((line) => line.replace(/\s*(?:#|\/\/|--|"|\/\*+|\*)\s*pingu\s*-\s*correction\s*:.*$/i, ''))
      .filter((line) => line.trim() !== '')
      .join('\n');
  }

  function normalizeAiTaskResult(rawResult, mode = 'comment_task') {
    if (!rawResult) {
      return null;
    }
    if (typeof rawResult === 'string') {
      const snippet = mode === 'issue_fix' ? sanitizeIssueFixSnippet(rawResult) : rawResult;
      return snippet.trim() ? { snippet } : null;
    }
    if (typeof rawResult !== 'object') {
      return null;
    }
    const rawSnippet = String(rawResult.snippet || '');
    const snippet = (mode === 'issue_fix' ? sanitizeIssueFixSnippet(rawSnippet) : rawSnippet).trim();
    if (!snippet) {
      return null;
    }
    return {
      ...rawResult,
      snippet,
      dependencies: Array.isArray(rawResult.dependencies) ? rawResult.dependencies : [],
    };
  }

  function summarizeCapabilityProfile(sourceFile) {
    if (typeof getCapabilityProfile !== 'function') {
      return null;
    }
    const profile = getCapabilityProfile(sourceFile);
    if (!profile) {
      return null;
    }
    return {
      id: profile.id,
      commentTaskIntents: Array.isArray(profile.commentTaskIntents) ? profile.commentTaskIntents : [],
      editorFeatures: Array.isArray(profile.editorFeatures) ? profile.editorFeatures : [],
      offlineCapabilities: Array.isArray(profile.offlineCapabilities) ? profile.offlineCapabilities : [],
      unitTestStyle: profile.unitTestStyle || 'none',
    };
  }

  function buildBasePayload(request, mode) {
    const instruction = String(request && request.instruction || '');
    const effectiveInstruction = String(request && request.effectiveInstruction || instruction);
    const ext = String(request && request.ext || '');
    const lines = Array.isArray(request && request.lines) ? request.lines : [];
    const sourceFile = String(request && request.sourceFile || '');
    const activeBlueprint = request && request.activeBlueprint ? request.activeBlueprint : null;
    const semanticIntent = request && request.semanticIntent ? request.semanticIntent : null;
    const intentIR = request && request.intentIR ? request.intentIR : null;
    const normalizedExt = analysisExtension(ext);

    return {
      ...request,
      instruction,
      effectiveInstruction,
      extension: normalizedExt,
      sourceFile,
      content: lines.join('\n'),
      activeBlueprint,
      projectMemory: loadProjectMemory(sourceFile),
      languageProfile: summarizeCapabilityProfile(sourceFile),
      bestPractices: bestPracticesFor(normalizedExt),
      semanticIntent,
      intentIR,
      mode,
      outputRules: mode === 'issue_fix'
        ? {
          returnOnlyCode: true,
          minimalDiff: true,
          forbidNarrativeComments: true,
          forbiddenMarkers: ['pingu - correction'],
        }
        : undefined,
    };
  }

  function extractStructuredTextFromResponse(response) {
    if (response && typeof response.output_text === 'string' && response.output_text.trim()) {
      return response.output_text.trim();
    }

    const outputItems = Array.isArray(response && response.output) ? response.output : [];
    const fragments = outputItems.flatMap((item) => {
      const contentItems = Array.isArray(item && item.content) ? item.content : [];
      return contentItems
        .map((content) => {
          if (!content || typeof content !== 'object') {
            return '';
          }
          if (typeof content.text === 'string') {
            return content.text;
          }
          if (typeof content.output_text === 'string') {
            return content.output_text;
          }
          return '';
        })
        .filter((fragment) => fragment.trim().length > 0);
    });

    return fragments.join('\n').trim();
  }

  function buildSystemInstruction(mode) {
    const modeRule = mode === 'issue_fix'
      ? 'Retorne somente o trecho final corrigido, minimo e diretamente aplicavel no campo snippet.'
      : mode === 'unit_test'
        ? 'Retorne testes completos e executaveis no campo snippet.'
        : mode === 'context_resolution'
          ? 'Retorne um documento de contexto consolidado e diretamente utilizavel no campo snippet.'
          : 'Retorne implementacao diretamente aplicavel no campo snippet.';

    return [
      'Voce eh o runtime interno do Pingu para geracao de codigo com OpenAI Codex.',
      'Responda estritamente com JSON valido conforme o schema fornecido.',
      'Nao use markdown, nao use cercas de codigo, nao use texto fora do JSON.',
      'Preencha snippet com codigo puro.',
      'Use dependencies somente quando realmente necessario.',
      'Se action nao for necessaria, retorne action com strings vazias e booleans false.',
      'Ao gerar documentacao ou comentarios, use o contexto ao redor para explicar responsabilidade, contrato, efeitos e motivacao real do trecho; evite comentarios genericos ou tautologicos.',
      'Nao use formulas vagas como "comportamento principal", "responsabilidade principal", "etapa atual" ou "proxima etapa do fluxo".',
      'Se o payload trouxer domainTerms, cite pelo menos um termo concreto desses na documentacao ou comentario quando isso for pertinente.',
      'Prefira mencionar efeitos concretos, estruturas de dominio, contratos de retorno e transicoes de estado observaveis no payload.',
      'Nunca altere import, use, require, alias, include ou bindings equivalentes sem validacao explicita da origem do simbolo no proprio payload.',
      modeRule,
    ].join(' ');
  }

  function buildOpenAiRequestBody(payload, env = process.env) {
    return {
      model: readOpenAiModel(env),
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: buildSystemInstruction(payload && payload.mode),
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: JSON.stringify(payload),
            },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'pingu_ai_task',
          strict: true,
          schema: OPENAI_OUTPUT_SCHEMA,
        },
      },
    };
  }

  function resolveOpenAiPayload(payload, env = process.env) {
    const apiKey = readOpenAiApiKey(env);
    if (!apiKey) {
      return null;
    }

    const cacheKey = aiResponseCacheKey(payload, env);
    const cachedResponse = readCachedAiResponse(cacheKey);
    if (cachedResponse) {
      return cachedResponse;
    }
    if (readCachedAiFailure(cacheKey)) {
      return null;
    }

    const timeoutMs = readTimeoutMs(env);
    const endpoint = new URL('/v1/responses', readOpenAiBaseUrl(env)).toString();
    const requestBody = JSON.stringify(buildOpenAiRequestBody(payload, env));

    try {
      const result = spawnSync('curl', [
        '--silent',
        '--show-error',
        '--fail',
        '--max-time',
        String(Math.max(1, Math.ceil(timeoutMs / 1000))),
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
        input: requestBody,
        timeout: timeoutMs + 1000,
        maxBuffer: 2 * 1024 * 1024,
        env,
      });

      if (result.error || result.status !== 0) {
        return storeCachedAiFailure(cacheKey);
      }

      const stdout = String(result.stdout || '').trim();
      if (!stdout) {
        return storeCachedAiFailure(cacheKey);
      }

      const parsed = JSON.parse(stdout);
      const rawText = extractStructuredTextFromResponse(parsed);
      if (!rawText) {
        return storeCachedAiFailure(cacheKey);
      }

      const normalizedResult = normalizeAiTaskResult(JSON.parse(rawText), payload && payload.mode);
      if (!normalizedResult) {
        return storeCachedAiFailure(cacheKey);
      }
      return storeCachedAiResponse(cacheKey, normalizedResult);
    } catch (_error) {
      return storeCachedAiFailure(cacheKey);
    }
  }

  function resolveAiPayload(payload, env = process.env) {
    return resolveOpenAiPayload(payload, env);
  }

  function resolveAiGeneratedTask(request, env = process.env) {
    return resolveAiPayload(buildBasePayload(request, 'comment_task'), env);
  }

  function resolveAiIssueFix(request, env = process.env) {
    return resolveAiPayload(buildBasePayload(request, 'issue_fix'), env);
  }

  function resolveAiGeneratedUnitTests(request, env = process.env) {
    return resolveAiPayload(buildBasePayload(request, 'unit_test'), env);
  }

  function resolveAiContextResolution(request, env = process.env) {
    return resolveAiPayload(buildBasePayload(request, 'context_resolution'), env);
  }

  return {
    hasOpenAiConfiguration,
    resolveAiContextResolution,
    resolveAiGeneratedTask,
    resolveAiGeneratedUnitTests,
    resolveAiIssueFix,
  };
}

module.exports = {
  createCommentTaskAiTools,
};
