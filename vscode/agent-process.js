'use strict';

function runAgent({ spawn, nodePath, scriptPath, sourcePath, text, maxLineLength, cwd, env }) {
  return new Promise((resolve, reject) => {
    const args = [
      scriptPath,
      '--stdin',
      '--source-path',
      sourcePath,
      '--format',
      'json',
      '--max-line-length',
      String(maxLineLength),
    ];
    const child = spawn(nodePath, args, {
      cwd,
      env: env || process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      reject(error);
    });
    child.on('close', (code) => {
      const payload = stdout.trim();
      if (!payload) {
        if (code === 0) {
          resolve([]);
          return;
        }
        reject(new Error(stderr || `Pingu - Dev Agent terminou com codigo ${code}`));
        return;
      }

      try {
        const issues = JSON.parse(payload);
        resolve(Array.isArray(issues) ? issues : []);
      } catch (error) {
        reject(new Error(stderr || error.message || 'Falha ao interpretar a resposta do agente'));
      }
    });

    child.stdin.end(text);
  });
}

module.exports = {
  runAgent,
};
