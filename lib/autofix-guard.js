'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { analysisExtension } = require('./language-capabilities');
const { mustClearKindsForIssue } = require('./issue-kinds');

const COMMENT_ONLY_AUTOFIX_KINDS = new Set([
  'class_doc',
  'flow_comment',
  'function_comment',
  'function_doc',
  'moduledoc',
  'variable_doc',
]);

function resolveAbsoluteFilePath(filePath) {
  const normalized = String(filePath || '').trim();
  if (!normalized) {
    return '';
  }
  return path.resolve(normalized);
}

function countIssuesByKind(issues, kind) {
  return (Array.isArray(issues) ? issues : [])
    .filter((issue) => String(issue && issue.kind || '') === String(kind || ''))
    .length;
}

function mustClearValidationFailures(
  appliedIssues,
  beforeIssues,
  afterIssues,
  resolveMustClearKinds = mustClearKindsForIssue,
) {
  const failures = [];
  (Array.isArray(appliedIssues) ? appliedIssues : []).forEach((issue) => {
    const mustClearKinds = typeof resolveMustClearKinds === 'function'
      ? resolveMustClearKinds(issue)
      : mustClearKindsForIssue(issue);
    (Array.isArray(mustClearKinds) ? mustClearKinds : []).forEach((kind) => {
      const beforeCount = countIssuesByKind(beforeIssues, kind);
      if (beforeCount <= 0) {
        return;
      }
      const afterCount = countIssuesByKind(afterIssues, kind);
      if (afterCount >= beforeCount) {
        failures.push({
          kind,
          beforeCount,
          afterCount,
        });
      }
    });
  });
  return failures;
}

function normalizeFileEntry(fileEntry) {
  if (!fileEntry || typeof fileEntry !== 'object') {
    return null;
  }
  const filePath = resolveAbsoluteFilePath(fileEntry.path || fileEntry.filePath);
  if (!filePath) {
    return null;
  }

  if (typeof fileEntry.contents === 'string') {
    return {
      path: filePath,
      contents: fileEntry.contents,
    };
  }

  if (fs.existsSync(filePath)) {
    return {
      path: filePath,
      contents: fs.readFileSync(filePath, 'utf8'),
    };
  }

  return {
    path: filePath,
    contents: '',
  };
}

function uniqueFileEntries(fileEntries) {
  const entries = Array.isArray(fileEntries) ? fileEntries : [];
  const unique = new Map();
  entries
    .map(normalizeFileEntry)
    .filter(Boolean)
    .forEach((entry) => {
      unique.set(entry.path, entry);
    });
  return Array.from(unique.values());
}

function validationCommandFor(filePath) {
  const extension = analysisExtension(filePath);
  if (extension === '.py') {
    return {
      command: 'python3',
      args: ['-m', 'py_compile'],
      label: 'python3 -m py_compile',
    };
  }

  if (['.js', '.mjs', '.cjs'].includes(extension)) {
    return {
      command: 'node',
      args: ['--check'],
      label: 'node --check',
    };
  }

  if (['.ex', '.exs'].includes(extension)) {
    return {
      command: 'elixirc',
      args: [],
      label: 'elixirc',
    };
  }

  return null;
}

function writeValidationTempCopy(tempRoot, fileEntry, index) {
  const sourcePath = String(fileEntry.path || '');
  const sourceExtension = analysisExtension(sourcePath) || path.extname(sourcePath);
  const sourceBaseName = path.basename(sourcePath) || `file-${index}${sourceExtension || ''}`;
  const baseName = sourceExtension && !sourceBaseName.endsWith(sourceExtension)
    ? `${sourceBaseName}${sourceExtension}`
    : sourceBaseName;
  const targetDirectory = path.join(tempRoot, String(index));
  const targetPath = path.join(targetDirectory, baseName || `file-${index}`);
  fs.mkdirSync(targetDirectory, { recursive: true });
  fs.writeFileSync(targetPath, String(fileEntry.contents || ''), 'utf8');
  return targetPath;
}

function validateFileEntries(fileEntries) {
  const entries = uniqueFileEntries(fileEntries);
  if (entries.length === 0) {
    return [];
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-autofix-guard-'));
  try {
    return entries.flatMap((entry, index) => {
      const validationCommand = validationCommandFor(entry.path);
      if (!validationCommand) {
        return [];
      }

      const tempFilePath = writeValidationTempCopy(tempRoot, entry, index);
      const result = spawnSync(
        validationCommand.command,
        [...validationCommand.args, tempFilePath],
        {
          cwd: path.dirname(tempFilePath),
          encoding: 'utf8',
        },
      );

      if (result.status === 0) {
        return [];
      }

      return [{
        filePath: entry.path,
        command: validationCommand.label,
        exitCode: typeof result.status === 'number' ? result.status : 1,
        stdout: String(result.stdout || '').trim(),
        stderr: String(result.stderr || '').trim(),
      }];
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function isCommentOnlyIssueBatch(appliedIssues) {
  const issues = Array.isArray(appliedIssues) ? appliedIssues : [];
  if (issues.length === 0) {
    return false;
  }

  return issues.every((issue) => COMMENT_ONLY_AUTOFIX_KINDS.has(String(issue && issue.kind || '')));
}

function evaluateAutofixGuard(options = {}) {
  const validationFailures = mustClearValidationFailures(
    options.appliedIssues,
    options.beforeIssues,
    options.afterIssues,
    options.resolveMustClearKinds,
  );
  const runtimeFailures = isCommentOnlyIssueBatch(options.appliedIssues)
    ? []
    : validateFileEntries(options.fileEntries);
  return {
    ok: validationFailures.length === 0 && runtimeFailures.length === 0,
    validationFailures,
    runtimeFailures,
  };
}

function collectAffectedFilePaths(sourceFile, issues = [], resolveIssueAction = () => ({})) {
  const affected = new Set();
  const normalizedSourceFile = resolveAbsoluteFilePath(sourceFile);
  if (normalizedSourceFile) {
    affected.add(normalizedSourceFile);
  }

  (Array.isArray(issues) ? issues : []).forEach((issue) => {
    const action = resolveIssueAction(issue);
    if (String(action && action.op || '') !== 'write_file') {
      return;
    }
    const targetFile = resolveAbsoluteFilePath(action.target_file);
    if (targetFile) {
      affected.add(targetFile);
    }
  });

  return Array.from(affected);
}

function captureFileSnapshot(filePaths) {
  const snapshot = new Map();
  (Array.isArray(filePaths) ? filePaths : []).forEach((filePath) => {
    const resolvedPath = resolveAbsoluteFilePath(filePath);
    if (!resolvedPath) {
      return;
    }
    const exists = fs.existsSync(resolvedPath);
    snapshot.set(resolvedPath, {
      exists,
      contents: exists ? fs.readFileSync(resolvedPath, 'utf8') : '',
    });
  });
  return snapshot;
}

function restoreFileSnapshot(snapshot) {
  if (!(snapshot instanceof Map)) {
    return;
  }

  snapshot.forEach((state, filePath) => {
    if (!state || !filePath) {
      return;
    }
    if (!state.exists) {
      fs.rmSync(filePath, { force: true });
      return;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, String(state.contents || ''), 'utf8');
  });
}

module.exports = {
  captureFileSnapshot,
  collectAffectedFilePaths,
  countIssuesByKind,
  evaluateAutofixGuard,
  isCommentOnlyIssueBatch,
  mustClearValidationFailures,
  restoreFileSnapshot,
  validateFileEntries,
};
