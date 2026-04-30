'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildInstalledLibraryContext,
  collectExternalJavaScriptImports,
  normalizePackageName,
} = require('../lib/installed-library-context');

function createTempProject() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-lib-context-'));
  fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'node_modules', '@tanstack', 'react-query'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify({
    dependencies: {
      '@tanstack/react-query': '^5.0.0',
    },
  }));
  fs.writeFileSync(path.join(projectRoot, 'node_modules', '@tanstack', 'react-query', 'package.json'), JSON.stringify({
    name: '@tanstack/react-query',
    version: '5.62.1',
    description: 'Hooks for managing server state in React',
    types: 'build/index.d.ts',
  }));
  fs.mkdirSync(path.join(projectRoot, 'node_modules', '@tanstack', 'react-query', 'build'), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, 'node_modules', '@tanstack', 'react-query', 'build', 'index.d.ts'),
    "export { useQuery } from './use-query';\nexport { useMutation } from './use-mutation';\n",
  );
  fs.writeFileSync(
    path.join(projectRoot, 'node_modules', '@tanstack', 'react-query', 'build', 'use-query.d.ts'),
    [
      'export declare function useQuery<TData>(options: UseQueryOptions<TData>): UseQueryResult<TData>;',
      'export interface UseQueryResult<TData> { data: TData | undefined; }',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(projectRoot, 'node_modules', '@tanstack', 'react-query', 'build', 'use-mutation.d.ts'),
    'export declare function useMutation<TData>(options: UseMutationOptions<TData>): UseMutationResult<TData>;\n',
  );
  return projectRoot;
}

test('normalizePackageName keeps external packages and ignores local or builtin modules', () => {
  assert.equal(normalizePackageName('@tanstack/react-query/build'), '@tanstack/react-query');
  assert.equal(normalizePackageName('lodash/fp'), 'lodash');
  assert.equal(normalizePackageName('./local'), '');
  assert.equal(normalizePackageName('node:path'), '');
});

test('collectExternalJavaScriptImports returns imported external symbols in buffer order', () => {
  const imports = collectExternalJavaScriptImports([
    "import { useQuery as useServerQuery } from '@tanstack/react-query';",
    "const { z } = require('zod');",
    "import localValue from './local';",
  ].join('\n'));

  assert.deepEqual(imports, [
    {
      specifier: '@tanstack/react-query',
      packageName: '@tanstack/react-query',
      importedSymbols: ['useQuery'],
    },
    {
      specifier: 'zod',
      packageName: 'zod',
      importedSymbols: ['z'],
    },
  ]);
});

test('buildInstalledLibraryContext summarizes installed imported library API', () => {
  const projectRoot = createTempProject();
  const sourceFile = path.join(projectRoot, 'src', 'component.tsx');
  const lines = [
    "import { useQuery } from '@tanstack/react-query';",
    '',
    'export function Component() {',
    "  return useQuery({ queryKey: ['users'], queryFn: fetchUsers });",
    '}',
  ];
  fs.writeFileSync(sourceFile, lines.join('\n'));

  const context = buildInstalledLibraryContext({ sourceFile, lines, ext: '.tsx' });

  assert.equal(context.libraries.length, 1);
  assert.equal(context.libraries[0].packageName, '@tanstack/react-query');
  assert.equal(context.libraries[0].version, '5.62.1');
  assert.equal(context.libraries[0].range, '^5.0.0');
  assert.deepEqual(context.libraries[0].importedSymbols, ['useQuery']);
  assert.deepEqual(context.libraries[0].entrypoints, ['build/index.d.ts', 'build/use-query.d.ts']);
  assert.match(context.libraries[0].publicApi.join('\n'), /useQuery<TData>/);
  assert.doesNotMatch(context.libraries[0].publicApi.join('\n'), /useMutation/);
});
