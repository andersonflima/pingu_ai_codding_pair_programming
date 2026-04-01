'use strict';

const { spawnSync } = require('child_process');

function createCommentTaskAiTools(deps = {}) {
  const {
    analysisExtension,
    bestPracticesFor,
    getCapabilityProfile,
  } = deps;

  function readConfiguredCommand(env = process.env) {
    return String(env.PINGU_COMMENT_TASK_AI_CMD || '').trim();
  }
  function hasConfiguredAiCommand(env = process.env) {
    return readConfiguredCommand(env).length > 0;
  }

  function readTimeoutMs(env = process.env) {
    const parsed = Number.parseInt(String(env.PINGU_COMMENT_TASK_AI_TIMEOUT_MS || '4000'), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 4000;
  }

  function normalizeAiTaskResult(rawResult) {
    if (!rawResult) {
      return null;
    }
    if (typeof rawResult === 'string') {
      return rawResult.trim() ? { snippet: rawResult } : null;
    }
    if (typeof rawResult !== 'object') {
      return null;
    }
    const snippet = String(rawResult.snippet || '').trim();
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

  function resolveAiGeneratedTask(request, env = process.env) {
    const configuredCommand = readConfiguredCommand(env);
    if (!configuredCommand) {
      return null;
    }

    const shell = String(env.SHELL || '/bin/sh');
    const instruction = String(request && request.instruction || '');
    const effectiveInstruction = String(request && request.effectiveInstruction || instruction);
    const ext = String(request && request.ext || '');
    const lines = Array.isArray(request && request.lines) ? request.lines : [];
    const sourceFile = String(request && request.sourceFile || '');
    const activeBlueprint = request && request.activeBlueprint ? request.activeBlueprint : null;
    const semanticIntent = request && request.semanticIntent ? request.semanticIntent : null;
    const intentIR = request && request.intentIR ? request.intentIR : null;
    const normalizedExt = analysisExtension(ext);
    const payload = {
      instruction,
      effectiveInstruction,
      extension: normalizedExt,
      sourceFile,
      content: lines.join('\n'),
      activeBlueprint,
      languageProfile: summarizeCapabilityProfile(sourceFile),
      bestPractices: bestPracticesFor(normalizedExt),
      semanticIntent,
      intentIR,
      mode: 'comment_task',
    };

    try {
      const result = spawnSync(shell, ['-lc', configuredCommand], {
        encoding: 'utf8',
        input: JSON.stringify(payload),
        timeout: readTimeoutMs(env),
        maxBuffer: 1024 * 1024,
        env,
      });
      if (result.error || result.status !== 0) {
        return null;
      }
      const stdout = String(result.stdout || '').trim();
      if (!stdout) {
        return null;
      }
      return normalizeAiTaskResult(JSON.parse(stdout));
    } catch (_error) {
      return null;
    }
  }

  return {
    hasConfiguredAiCommand,
    resolveAiGeneratedTask,
  };
}

module.exports = {
  createCommentTaskAiTools,
};
