'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createCommentTaskAiTools } = require('../lib/comment-task-ai');

function buildAiTools(overrides = {}) {
  return createCommentTaskAiTools({
    analysisExtension: (value) => value,
    bestPracticesFor: () => [],
    getCapabilityProfile: () => null,
    ...overrides,
  });
}

test('hasOpenAiConfiguration uses process env directly without shell fallback', () => {
  const calls = [];
  const tools = buildAiTools({
    spawnSync: (...args) => {
      calls.push(args);
      return { stdout: '', status: 0 };
    },
  });

  const result = tools.hasOpenAiConfiguration({
    OPENAI_API_KEY: 'sk-direct',
    SHELL: '/bin/zsh',
  });

  assert.equal(result, true);
  assert.equal(calls.length, 0);
});

test('hasOpenAiConfiguration falls back to login shell and caches the lookup', () => {
  const calls = [];
  const tools = buildAiTools({
    spawnSync: (...args) => {
      calls.push(args);
      return {
        stdout: '__PINGU_ENV_BEGIN__sk-shell__PINGU_ENV_END__',
        status: 0,
      };
    },
  });

  const env = {
    SHELL: '/bin/zsh',
    HOME: '/tmp/pingu-home',
    USER: 'pingu',
  };

  assert.equal(tools.hasOpenAiConfiguration(env), true);
  assert.equal(tools.hasOpenAiConfiguration(env), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/bin/zsh');
  assert.deepEqual(calls[0][1], [
    '-lc',
    'command printf \'__PINGU_ENV_BEGIN__%s__PINGU_ENV_END__\' "$OPENAI_API_KEY"',
  ]);
});

test('resolveAiGeneratedTask includes installed library context in payload', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-ai-lib-context-'));
  const sourceFile = path.join(projectRoot, 'src', 'component.tsx');
  fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'node_modules', 'zod'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({
    dependencies: {
      zod: '^3.23.0',
    },
  }));
  fs.writeFileSync(path.join(projectRoot, 'node_modules', 'zod', 'package.json'), JSON.stringify({
    name: 'zod',
    version: '3.23.8',
    types: 'index.d.ts',
  }));
  fs.writeFileSync(
    path.join(projectRoot, 'node_modules', 'zod', 'index.d.ts'),
    'export declare const z: ZodTypeFactory;\nexport declare function string(): ZodString;\n',
  );

  const lines = [
    "import { z } from 'zod';",
    '//:: criar schema de usuario',
  ];
  fs.writeFileSync(sourceFile, lines.join('\n'));

  let capturedRequestBody = null;
  const tools = buildAiTools({
    analysisExtension: () => '.tsx',
    spawnSync: (_command, _args, options) => {
      capturedRequestBody = JSON.parse(options.input);
      return {
        status: 0,
        stdout: JSON.stringify({
          output_text: JSON.stringify({
            snippet: 'const UserSchema = z.object({ name: z.string() });',
            message: '',
            suggestion: '',
            dependencies: [],
            action: {
              op: '',
              target_file: '',
              mkdir_p: false,
              remove_trigger: false,
              command: '',
              description: '',
            },
          }),
        }),
      };
    },
  });

  const result = tools.resolveAiGeneratedTask({
    instruction: 'criar schema de usuario',
    ext: '.tsx',
    lines,
    sourceFile,
    marker: '::',
    lineIndex: 1,
  }, {
    OPENAI_API_KEY: 'sk-test',
  });

  const payload = JSON.parse(capturedRequestBody.input[1].content[0].text);
  assert.equal(result.snippet, 'const UserSchema = z.object({ name: z.string() });');
  assert.equal(payload.installedLibraryContext.libraries.length, 1);
  assert.equal(payload.installedLibraryContext.libraries[0].packageName, 'zod');
  assert.equal(payload.installedLibraryContext.libraries[0].version, '3.23.8');
  assert.deepEqual(payload.installedLibraryContext.libraries[0].importedSymbols, ['z']);
  assert.match(payload.installedLibraryContext.libraries[0].publicApi.join('\n'), /declare const z/);
});
