'use strict';

const crypto = require('crypto');
const readline = require('readline');

function fingerprintRuntimeEnvironment(env = {}) {
  const relevant = {
    OPENAI_API_KEY: hashSecret(env.OPENAI_API_KEY),
    OPENAI_BASE_URL: String(env.OPENAI_BASE_URL || env.PINGU_OPENAI_BASE_URL || '').trim(),
    PINGU_OPENAI_BASE_URL: String(env.PINGU_OPENAI_BASE_URL || '').trim(),
    PINGU_OPENAI_MODEL: String(env.PINGU_OPENAI_MODEL || '').trim(),
    PINGU_OPENAI_TIMEOUT_MS: String(env.PINGU_OPENAI_TIMEOUT_MS || '').trim(),
  };
  return crypto.createHash('sha1').update(JSON.stringify(relevant)).digest('hex');
}

function hashSecret(secret) {
  const value = String(secret || '').trim();
  if (!value) {
    return '';
  }
  return crypto.createHash('sha1').update(value).digest('hex');
}

function createRuntimeAgentClient(options = {}) {
  const spawn = options.spawn;
  const nodePath = String(options.nodePath || 'node').trim() || 'node';
  const scriptPath = String(options.scriptPath || '').trim();
  const cwd = String(options.cwd || '').trim() || process.cwd();
  const env = options.env || process.env;
  const onStderr = typeof options.onStderr === 'function' ? options.onStderr : null;

  let child = null;
  let lineReader = null;
  let nextRequestId = 1;
  let disposed = false;
  let pending = new Map();

  function ensureStarted() {
    if (disposed) {
      throw new Error('Runtime client descartado');
    }

    if (child && !child.killed) {
      return child;
    }

    child = spawn(nodePath, [scriptPath, '--serve'], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    lineReader = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    lineReader.on('line', handleResponseLine);
    child.stderr.on('data', (chunk) => {
      if (onStderr) {
        onStderr(String(chunk || ''));
      }
    });
    child.on('error', handleClientFailure);
    child.on('close', () => {
      handleClientFailure(new Error('Runtime do agente encerrou a conexao'));
    });
    return child;
  }

  function handleResponseLine(line) {
    let message = null;
    try {
      message = JSON.parse(String(line || '').trim());
    } catch (_error) {
      return;
    }

    const requestId = Number(message && message.id);
    if (!Number.isFinite(requestId) || !pending.has(requestId)) {
      return;
    }

    const resolver = pending.get(requestId);
    pending.delete(requestId);
    if (message && message.ok === false) {
      resolver.reject(new Error(String(message.error || 'Falha ao executar request no runtime')));
      return;
    }
    resolver.resolve(message);
  }

  function handleClientFailure(error) {
    const failure = error instanceof Error
      ? error
      : new Error(String(error || 'Falha no runtime do agente'));
    const pendingResolvers = Array.from(pending.values());
    pending = new Map();
    if (lineReader) {
      lineReader.close();
      lineReader = null;
    }
    child = null;
    pendingResolvers.forEach((resolver) => {
      resolver.reject(failure);
    });
  }

  function request(message) {
    const runtime = ensureStarted();
    const requestId = nextRequestId;
    nextRequestId += 1;

    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      try {
        runtime.stdin.write(`${JSON.stringify({ ...message, id: requestId })}\n`);
      } catch (error) {
        pending.delete(requestId);
        reject(error);
      }
    });
  }

  function requestAnalysis(payload) {
    return request({
      command: 'analyze',
      ...payload,
    }).then((response) => Array.isArray(response && response.issues) ? response.issues : []);
  }

  function dispose() {
    disposed = true;
    if (lineReader) {
      lineReader.close();
      lineReader = null;
    }
    if (child && !child.killed) {
      child.kill();
    }
    child = null;
    const pendingResolvers = Array.from(pending.values());
    pending = new Map();
    pendingResolvers.forEach((resolver) => {
      resolver.reject(new Error('Runtime client descartado'));
    });
  }

  return {
    dispose,
    request,
    requestAnalysis,
  };
}

module.exports = {
  createRuntimeAgentClient,
  fingerprintRuntimeEnvironment,
};
