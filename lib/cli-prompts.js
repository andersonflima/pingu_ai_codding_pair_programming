'use strict';

const fs = require('fs');
const path = require('path');
const { analyzeText } = require('./analyzer');
const { evaluateAutofixGuard } = require('./autofix-guard');
const { resolveIssueAction } = require('./issue-kinds');

const PROMPT_KINDS = new Set(['comment_task', 'context_file']);
const LOCAL_OPS = new Set(['delete_line', 'insert_after', 'insert_before', 'replace_line']);

function promptFile(file, options = {}) {
  const originalText = fs.readFileSync(file, 'utf8');
  const plan = createCliPromptPlan(file, originalText, options);
  if (!options.write) {
    return {
      ok: true,
      file,
      mode: 'plan',
      plan,
      appliedIssues: [],
      writtenFiles: [],
      guard: null,
    };
  }

  return applyCliPromptPlan(file, originalText, plan, options);
}

function createCliPromptPlan(file, text, options = {}) {
  const issues = analyzeText(file, text, {
    maxLineLength: options.maxLineLength,
    analysisMode: options.analysisMode || 'full',
    focusStartLine: options.focusStartLine,
    focusEndLine: options.focusEndLine,
  });
  const candidates = issues
    .map((issue, index) => normalizePromptCandidate(issue, index))
    .filter((candidate) => isApplicablePromptCandidate(candidate, options));

  return {
    file,
    issues,
    candidates,
  };
}

function applyCliPromptPlan(file, originalText, plan, options = {}) {
  const snapshot = capturePromptSnapshot(file, plan.candidates);
  const sourceState = {
    file,
    hadFinalNewline: /\n$/.test(String(originalText || '')),
    lines: splitEditableLines(originalText),
    touched: false,
  };
  const writtenFiles = [];
  const appliedIssues = [];
  const rejectedIssues = [];

  orderedPromptCandidates(plan.candidates).forEach((candidate) => {
    const result = applyPromptCandidate(sourceState, candidate.issue);
    if (!result.ok) {
      rejectedIssues.push(candidate.issue);
      return;
    }
    if (result.writtenFile) {
      writtenFiles.push(result.writtenFile);
    }
    appliedIssues.push(candidate.issue);
  });

  const nextSourceText = joinEditableLines(sourceState.lines, sourceState.hadFinalNewline);
  if (sourceState.touched) {
    fs.writeFileSync(file, nextSourceText, 'utf8');
    writtenFiles.push(file);
  }

  const afterIssues = analyzeText(file, nextSourceText, {
    maxLineLength: options.maxLineLength,
    analysisMode: options.analysisMode || 'light',
  });
  const guard = evaluateAutofixGuard({
    appliedIssues,
    beforeIssues: plan.issues,
    afterIssues,
    fileEntries: Array.from(new Set([file, ...writtenFiles]))
      .filter((targetFile) => fs.existsSync(targetFile))
      .map((targetFile) => ({ path: targetFile, contents: fs.readFileSync(targetFile, 'utf8') })),
  });

  if (!guard.ok) {
    restorePromptSnapshot(snapshot);
    return {
      ok: false,
      file,
      mode: 'write',
      plan,
      appliedIssues: [],
      rejectedIssues: appliedIssues,
      writtenFiles: [],
      guard,
    };
  }

  return {
    ok: true,
    file,
    mode: 'write',
    plan,
    appliedIssues,
    rejectedIssues,
    writtenFiles: Array.from(new Set(writtenFiles)),
    guard,
  };
}

function normalizePromptCandidate(issue, index) {
  const action = resolveIssueAction(issue);
  return {
    index,
    issue: {
      ...issue,
      action,
    },
    action,
  };
}

function isApplicablePromptCandidate(candidate, options = {}) {
  const issue = candidate && candidate.issue;
  const action = candidate && candidate.action;
  const kind = String(issue && issue.kind || '').trim();
  const op = String(action && action.op || '').trim();
  if (!PROMPT_KINDS.has(kind)) {
    return false;
  }
  if (op === 'run_command') {
    return Boolean(options.allowTerminal);
  }
  if (op === 'write_file') {
    return Boolean(action && action.target_file) && String(issue && issue.snippet || '').length > 0;
  }
  if (!LOCAL_OPS.has(op)) {
    return false;
  }
  if (op !== 'delete_line' && !String(issue && issue.snippet || '').length) {
    return false;
  }
  return true;
}

function orderedPromptCandidates(candidates) {
  return [...(Array.isArray(candidates) ? candidates : [])].sort((left, right) => {
    const leftAction = left.issue && left.issue.action ? left.issue.action : {};
    const rightAction = right.issue && right.issue.action ? right.issue.action : {};
    const leftWrite = String(leftAction.op || '') === 'write_file' ? 1 : 0;
    const rightWrite = String(rightAction.op || '') === 'write_file' ? 1 : 0;
    if (leftWrite !== rightWrite) {
      return rightWrite - leftWrite;
    }
    const lineDiff = Number(right.issue.line || 0) - Number(left.issue.line || 0);
    if (lineDiff !== 0) {
      return lineDiff;
    }
    return Number(right.index || 0) - Number(left.index || 0);
  });
}

function applyPromptCandidate(sourceState, issue) {
  const action = resolveIssueAction(issue);
  const op = String(action && action.op || '').trim();
  if (op === 'write_file') {
    return applyPromptWriteFile(sourceState, issue, action);
  }
  return applyPromptLocalAction(sourceState, issue, action);
}

function applyPromptWriteFile(sourceState, issue, action) {
  const targetFile = path.resolve(String(action.target_file || ''));
  if (!targetFile) {
    return { ok: false };
  }
  const snippet = String(issue && issue.snippet || '');
  const targetText = normalizeSnippetText(snippet);
  if (path.resolve(sourceState.file) === targetFile) {
    sourceState.lines = splitEditableLines(removeTriggerFromText(targetText, issue));
    sourceState.touched = true;
    return {
      ok: true,
      writtenFile: targetFile,
    };
  }
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.writeFileSync(targetFile, targetText, 'utf8');
  if (action.remove_trigger) {
    removeSourceTriggerLine(sourceState, issue);
  }
  return {
    ok: true,
    writtenFile: targetFile,
  };
}

function removeTriggerFromText(text, issue) {
  const lineNumber = Number(issue && issue.line || 0);
  const triggerText = String(issue && (issue.triggerText || issue._trigger_line) || '').trim();
  const lines = splitEditableLines(text);
  if (!triggerText) {
    return text;
  }
  const directIndex = lineNumber > 0 ? lineNumber - 1 : -1;
  if (directIndex >= 0 && directIndex < lines.length && lines[directIndex].trim() === triggerText) {
    lines.splice(directIndex, 1);
    return lines.join('\n');
  }
  const foundIndex = lines.findIndex((line) => line.trim() === triggerText);
  if (foundIndex >= 0) {
    lines.splice(foundIndex, 1);
    return lines.join('\n');
  }
  return text;
}

function applyPromptLocalAction(sourceState, issue, action) {
  const op = String(action && action.op || '').trim();
  const lineNumber = Number(issue && issue.line || 0);
  const index = lineNumber - 1;
  if (!Number.isInteger(index) || index < 0 || index >= sourceState.lines.length) {
    return { ok: false };
  }

  const snippetLines = splitEditableLines(issue && issue.snippet);
  if (op === 'delete_line') {
    sourceState.lines.splice(index, 1);
  } else if (op === 'replace_line') {
    sourceState.lines.splice(index, 1, ...snippetLines);
  } else if (op === 'insert_before') {
    sourceState.lines.splice(index, 0, ...snippetLines);
  } else if (op === 'insert_after') {
    sourceState.lines.splice(index + 1, 0, ...snippetLines);
  } else {
    return { ok: false };
  }

  if (action.remove_trigger && op !== 'replace_line' && op !== 'delete_line') {
    removeSourceTriggerLine(sourceState, issue);
  }
  if (sourceState.lines.length === 0) {
    sourceState.lines.push('');
  }
  sourceState.touched = true;
  return { ok: true };
}

function removeSourceTriggerLine(sourceState, issue) {
  const lineNumber = Number(issue && issue.line || 0);
  const index = lineNumber - 1;
  if (!Number.isInteger(index) || index < 0 || index >= sourceState.lines.length) {
    return false;
  }
  sourceState.lines.splice(index, 1);
  if (sourceState.lines.length === 0) {
    sourceState.lines.push('');
  }
  sourceState.touched = true;
  return true;
}

function capturePromptSnapshot(file, candidates) {
  const files = new Set([path.resolve(file)]);
  (Array.isArray(candidates) ? candidates : []).forEach((candidate) => {
    const action = candidate && candidate.action ? candidate.action : {};
    if (String(action.op || '') === 'write_file' && action.target_file) {
      files.add(path.resolve(String(action.target_file)));
    }
  });

  return Array.from(files).map((targetFile) => ({
    file: targetFile,
    exists: fs.existsSync(targetFile),
    text: fs.existsSync(targetFile) ? fs.readFileSync(targetFile, 'utf8') : '',
  }));
}

function restorePromptSnapshot(snapshot) {
  (Array.isArray(snapshot) ? snapshot : []).forEach((entry) => {
    if (!entry || !entry.file) {
      return;
    }
    if (!entry.exists) {
      fs.rmSync(entry.file, { force: true });
      return;
    }
    fs.mkdirSync(path.dirname(entry.file), { recursive: true });
    fs.writeFileSync(entry.file, entry.text, 'utf8');
  });
}

function normalizeSnippetText(snippet) {
  return String(snippet || '').replace(/\r\n/g, '\n');
}

function splitEditableLines(text) {
  const lines = normalizeSnippetText(text).split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.length > 0 ? lines : [''];
}

function joinEditableLines(lines, finalNewline) {
  const body = (Array.isArray(lines) && lines.length > 0 ? lines : ['']).join('\n');
  return finalNewline ? `${body}\n` : body;
}

module.exports = {
  createCliPromptPlan,
  promptFile,
};
