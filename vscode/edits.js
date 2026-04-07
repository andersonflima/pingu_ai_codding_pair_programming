'use strict';

const {
  captureFileSnapshot,
  collectAffectedFilePaths,
  evaluateAutofixGuard,
  restoreFileSnapshot,
} = require('../lib/autofix-guard');
const { resolvePreferredInsertBeforeLine } = require('../lib/snippet-placement');

const DOCUMENTATION_KINDS = new Set([
  'class_doc',
  'flow_comment',
  'function_comment',
  'function_doc',
  'moduledoc',
  'variable_doc',
]);
const DEFAULT_LARGE_FILE_LINE_THRESHOLD = 260;
const DEFAULT_DOCUMENTATION_MAX_PER_PASS = 0;
const DEFAULT_DOCUMENTATION_MAX_PER_PASS_LARGE_FILE = 4;

function createEditRuntime(deps) {
  const {
    fs,
    path,
    vscode,
    analyzeDocument,
    collectIssues,
    configuredRealtimeAutoFixMaxPerPass = () => 0,
    configuredAutoFixKinds,
    fixPriorityForKind,
    autoFixNoOpReason = () => '',
    isAutoFixEnabled,
    mustClearKindsForIssue,
    resolveIssueAction,
    semanticPriorityForIssue = (issue) => Number(issue && issue.autofixPriority || fixPriorityForKind(issue && issue.kind)),
  } = deps;

  function readNumericEnv(name, fallback) {
    const parsed = Number.parseInt(String(process.env[name] || fallback), 10);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return parsed;
  }

  function documentationLimitForDocument(document) {
    const baseLimit = Math.max(0, readNumericEnv('PINGU_AUTOFIX_DOC_MAX_PER_PASS', DEFAULT_DOCUMENTATION_MAX_PER_PASS));
    const largeFileThreshold = Math.max(0, readNumericEnv('PINGU_AUTOFIX_LARGE_FILE_LINE_THRESHOLD', DEFAULT_LARGE_FILE_LINE_THRESHOLD));
    const largeFileLimit = Math.max(0, readNumericEnv('PINGU_AUTOFIX_DOC_MAX_PER_PASS_LARGE_FILE', DEFAULT_DOCUMENTATION_MAX_PER_PASS_LARGE_FILE));
    const isLargeFile = largeFileThreshold > 0 && Number(document && document.lineCount || 0) > largeFileThreshold;

    if (!isLargeFile) {
      return baseLimit;
    }
    if (baseLimit <= 0) {
      return largeFileLimit;
    }
    if (largeFileLimit <= 0) {
      return baseLimit;
    }
    return Math.min(baseLimit, largeFileLimit);
  }

  function limitDocumentationCandidates(document, issues) {
    const limit = documentationLimitForDocument(document);
    if (limit <= 0) {
      return issues;
    }

    let documentationCount = 0;
    return issues.filter((issue) => {
      if (!DOCUMENTATION_KINDS.has(String(issue && issue.kind || '').trim())) {
        return true;
      }
      if (documentationCount >= limit) {
        return false;
      }
      documentationCount += 1;
      return true;
    });
  }

  function realtimeAutoFixLimit(document, trigger) {
    const normalizedTrigger = String(trigger || '').trim();
    if (!normalizedTrigger || normalizedTrigger === 'manual') {
      return 0;
    }

    const configured = Number(configuredRealtimeAutoFixMaxPerPass(document.uri, normalizedTrigger));
    if (!Number.isFinite(configured)) {
      return 0;
    }
    return Math.max(0, Math.trunc(configured));
  }

  function limitAutomaticPassCandidates(document, issues, trigger) {
    const limit = realtimeAutoFixLimit(document, trigger);
    if (limit <= 0 || !Array.isArray(issues) || issues.length <= limit) {
      return issues;
    }
    return issues.slice(0, limit);
  }

  function issueActionIdentity(issue) {
    const action = resolveIssueAction(issue);
    if (action.op === 'write_file') {
      return String(action.target_file || '');
    }
    if (action.op === 'run_command') {
      return String(action.command || '');
    }
    if (action.range && typeof action.text === 'string') {
      return JSON.stringify({
        range: action.range,
        text: action.text,
      });
    }
    return String(issue && issue.snippet || '');
  }

  function issueKey(document, issue) {
    return [
      document.uri.toString(),
      Number(issue.line || 1),
      issue.kind || '',
      issue.message || '',
      issueActionIdentity(issue),
    ].join('|');
  }

  function issueLineIndex(issue) {
    return Math.max(0, Number(issue.line || 1) - 1);
  }

  function issueIntersectsRange(issue, range) {
    if (!range) {
      return true;
    }
    const lineIndex = issueLineIndex(issue);
    const startLine = Number(range.start && range.start.line || 0);
    const endLine = Number(range.end && range.end.line || startLine);
    return lineIndex >= startLine && lineIndex <= endLine;
  }

  function issueTriggerText(document, issue) {
    const lineIndex = issueLineIndex(issue);
    if (lineIndex >= document.lineCount) {
      return '';
    }
    return document.lineAt(lineIndex).text;
  }

  function lineDeleteRange(document, lineIndex) {
    const start = new vscode.Position(lineIndex, 0);
    if (lineIndex < document.lineCount - 1) {
      return new vscode.Range(start, new vscode.Position(lineIndex + 1, 0));
    }
    return new vscode.Range(start, new vscode.Position(lineIndex, document.lineAt(lineIndex).text.length));
  }

  function lineReplaceRange(document, lineIndex) {
    return document.lineAt(lineIndex).range;
  }

  function resolveActionRange(document, action) {
    const range = action && action.range;
    if (!range || typeof range !== 'object') {
      return null;
    }

    const startLine = Math.max(0, Number(range.start && range.start.line || 0));
    const startCharacter = Math.max(0, Number(range.start && range.start.character || 0));
    const endLine = Math.max(startLine, Number(range.end && range.end.line || startLine));
    const endCharacter = Math.max(0, Number(range.end && range.end.character || 0));

    return new vscode.Range(
      new vscode.Position(startLine, startCharacter),
      new vscode.Position(endLine, endCharacter),
    );
  }

  function resolveTriggerDeleteRange(document, issue, triggerText) {
    const lineIndex = issueLineIndex(issue);
    if (lineIndex < document.lineCount && document.lineAt(lineIndex).text === triggerText) {
      return lineDeleteRange(document, lineIndex);
    }

    if (!triggerText) {
      return undefined;
    }

    const targetIndex = Array.from({ length: document.lineCount }, (_, index) => index)
      .find((index) => document.lineAt(index).text === triggerText);
    if (typeof targetIndex !== 'number') {
      return undefined;
    }

    return lineDeleteRange(document, targetIndex);
  }

  async function removeTriggerLine(document, issue, triggerText) {
    const liveDocument = await vscode.workspace.openTextDocument(document.uri);
    const range = resolveTriggerDeleteRange(liveDocument, issue, triggerText);
    if (!range) {
      return false;
    }

    const edit = new vscode.WorkspaceEdit();
    edit.delete(liveDocument.uri, range);
    return vscode.workspace.applyEdit(edit);
  }

  async function removeTriggerResidue(document, triggerText) {
    if (!triggerText) {
      return false;
    }

    const liveDocument = await vscode.workspace.openTextDocument(document.uri);
    for (let index = 0; index < liveDocument.lineCount; index += 1) {
      if (liveDocument.lineAt(index).text !== triggerText) {
        continue;
      }
      const edit = new vscode.WorkspaceEdit();
      edit.delete(liveDocument.uri, lineDeleteRange(liveDocument, index));
      return vscode.workspace.applyEdit(edit);
    }

    return false;
  }

  function splitSnippetLines(snippet) {
    return String(snippet || '').replace(/\r\n/g, '\n').split('\n');
  }

  function detectIndent(text) {
    const match = /^\s*/.exec(String(text || ''));
    return match ? match[0] : '';
  }

  function issueIndent(action, kind, currentLine) {
    const rawIndent = String(action.indent || detectIndent(currentLine));
    if (String(kind || '') === 'tabs') {
      return rawIndent.replace(/\t/g, '  ');
    }
    return rawIndent;
  }

  function commonIndentLength(lines) {
    const nonEmpty = lines.filter((line) => String(line || '').trim() !== '');
    if (nonEmpty.length === 0) {
      return 0;
    }

    return nonEmpty.reduce((smallest, line) => {
      const indentLength = detectIndent(line).length;
      return smallest === null ? indentLength : Math.min(smallest, indentLength);
    }, null) || 0;
  }

  function normalizeSnippetLines(snippetLines, indent) {
    const normalized = Array.isArray(snippetLines) ? [...snippetLines] : [String(snippetLines || '')];
    const commonIndent = commonIndentLength(normalized);
    return normalized.map((line) => {
      const value = String(line || '');
      if (value === '') {
        return '';
      }
      const withoutCommonIndent = commonIndent > 0 ? value.slice(commonIndent) : value;
      return `${indent}${withoutCommonIndent}`;
    });
  }

  function documentBlockEquals(document, startLine, snippetLines) {
    if (startLine < 0 || startLine + snippetLines.length > document.lineCount) {
      return false;
    }

    for (let offset = 0; offset < snippetLines.length; offset += 1) {
      if (document.lineAt(startLine + offset).text !== snippetLines[offset]) {
        return false;
      }
    }

    return true;
  }

  function snippetExistsNearby(document, lineIndex, snippetLines, action, op) {
    if (!snippetLines.length || document.lineCount === 0) {
      return false;
    }

    const resolvedInsertBeforeLine = op === 'insert_before'
      ? resolvePreferredInsertBeforeLine(
        Array.from({ length: document.lineCount }, (_, index) => document.lineAt(index).text),
        lineIndex,
        snippetLines,
      )
      : lineIndex;
    const insertionLine = op === 'insert_after' ? lineIndex + 1 : resolvedInsertBeforeLine;
    const lookahead = Math.max(
      0,
      Number(action.lookahead ?? action.dedupeLookahead ?? (snippetLines.length + 4)) || 0,
    );
    const lookbehind = Math.max(
      0,
      Number(action.lookbehind ?? action.dedupeLookbehind ?? (snippetLines.length + 4)) || 0,
    );
    const startLine = Math.max(0, insertionLine - lookbehind);
    const endLine = Math.min(document.lineCount - snippetLines.length, insertionLine + lookahead);

    for (let cursor = startLine; cursor <= endLine; cursor += 1) {
      if (documentBlockEquals(document, cursor, snippetLines)) {
        return true;
      }
    }

    return false;
  }

  async function applyWriteFileIssue(document, issue, snippetLines) {
    const action = resolveIssueAction(issue);
    const targetFile = String(action.target_file || '').trim();
    if (!targetFile) {
      return false;
    }

    const targetDir = path.dirname(targetFile);
    if (action.mkdir_p) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    fs.writeFileSync(targetFile, snippetLines.join('\n'), 'utf8');

    if (action.remove_trigger) {
      const triggerText = issueTriggerText(document, issue);
      await removeTriggerLine(document, issue, triggerText);
    }

    return true;
  }

  async function applySnippetIssue(document, issue) {
    const liveDocument = await vscode.workspace.openTextDocument(document.uri);
    const action = resolveIssueAction(issue);
    const op = String(action.op || '');
    const kind = String(issue.kind || '');
    const lineIndex = issueLineIndex(issue);
    const boundedLineIndex = Math.max(0, Math.min(lineIndex, Math.max(liveDocument.lineCount - 1, 0)));
    const triggerText = issueTriggerText(liveDocument, issue);

    if (op === 'write_file') {
      const snippetLines = splitSnippetLines(issue.snippet || '');
      return applyWriteFileIssue(liveDocument, issue, snippetLines);
    }

    if (op === 'run_command') {
      return false;
    }

    if (liveDocument.lineCount === 0) {
      return false;
    }

    const currentLine = liveDocument.lineAt(boundedLineIndex).text;
    if (kind === 'undefined_variable' && isImportLikeLine(currentLine) && !isValidatedImportBindingIssue(issue)) {
      return false;
    }
    const indent = issueIndent(action, kind, currentLine);
    const snippetRaw = kind === 'trailing_whitespace' || kind === 'syntax_extra_delimiter'
      ? ''
      : String(issue.snippet || '');
    const rawSnippetLines = splitSnippetLines(snippetRaw);
    const snippetLines = normalizeSnippetLines(rawSnippetLines, indent);
    const snippetText = snippetLines.join('\n');

    if (op === 'replace_line') {
      const replacementRange = resolveActionRange(liveDocument, action);
      const replacementText = replacementRange && typeof action.text === 'string'
        ? String(action.text || '')
        : snippetText;
      if (snippetLines.length === 1 && currentLine === snippetLines[0]) {
        return false;
      }

      const edit = new vscode.WorkspaceEdit();
      const replaceRange = replacementRange || (kind === 'syntax_extra_delimiter'
        ? lineDeleteRange(liveDocument, boundedLineIndex)
        : lineReplaceRange(liveDocument, boundedLineIndex));
      edit.replace(liveDocument.uri, replaceRange, replacementText);
      const applied = await vscode.workspace.applyEdit(edit);
      if (applied && kind === 'comment_task') {
        await removeTriggerResidue(liveDocument, triggerText);
      }
      return applied;
    }

    if (snippetExistsNearby(liveDocument, boundedLineIndex, snippetLines, action, op)) {
      return false;
    }

    const edit = new vscode.WorkspaceEdit();
    if (op === 'insert_after') {
      const insertionPosition = boundedLineIndex >= liveDocument.lineCount - 1
        ? new vscode.Position(boundedLineIndex, liveDocument.lineAt(boundedLineIndex).text.length)
        : new vscode.Position(boundedLineIndex + 1, 0);
      const insertionText = boundedLineIndex >= liveDocument.lineCount - 1
        ? `\n${snippetText}`
        : `${snippetText}\n`;
      edit.insert(liveDocument.uri, insertionPosition, insertionText);
    } else {
      const insertBeforeLineIndex = resolvePreferredInsertBeforeLine(
        Array.from({ length: liveDocument.lineCount }, (_, index) => liveDocument.lineAt(index).text),
        boundedLineIndex,
        snippetLines,
      );
      edit.insert(liveDocument.uri, new vscode.Position(insertBeforeLineIndex, 0), `${snippetText}\n`);
    }
    return vscode.workspace.applyEdit(edit);
  }

  function isImportLikeLine(line) {
    const content = String(line || '').trim();
    if (!content) {
      return false;
    }

    return /^\s*import\b/.test(content)
      || /^\s*export\s+(?:\{|\*\s+from\b)/.test(content)
      || /^\s*from\b.+\bimport\b/.test(content)
      || /^\s*(?:const|let|var)\b.+?=\s*require\s*\(/.test(content)
      || /^\s*(?:alias|use|require)\b/.test(content)
      || /^\s*require_relative\b/.test(content)
      || /^\s*#include\b/.test(content);
  }

  function isValidatedImportBindingIssue(issue) {
    if (String(issue && issue.kind || '') !== 'undefined_variable') {
      return false;
    }
    return /^Import '([^']+)' nao exportado por /.test(String(issue && issue.message || ''));
  }

  function shiftIssueForBatch(issue, lineShift) {
    if (!lineShift) {
      return issue;
    }

    const shifted = {
      ...issue,
      line: Number(issue && issue.line || 1) + lineShift,
    };
    const action = resolveIssueAction(issue);
    if (action && action.range && typeof action.range === 'object') {
      shifted.action = {
        ...action,
        range: {
          start: {
            ...(action.range.start || {}),
            line: Number(action.range.start && action.range.start.line || 0) + lineShift,
          },
          end: {
            ...(action.range.end || {}),
            line: Number(action.range.end && action.range.end.line || 0) + lineShift,
          },
        },
      };
    }
    return shifted;
  }

  function lineDeltaForIssue(issue) {
    const action = resolveIssueAction(issue);
    const op = String(action.op || '');
    if (op === 'write_file' || op === 'run_command') {
      return 0;
    }

    const snippetLines = splitSnippetLines(issue && issue.snippet || '');
    const snippetLineCount = snippetLines.length === 1 && snippetLines[0] === ''
      ? 0
      : snippetLines.length;
    if (op === 'insert_before' || op === 'insert_after') {
      return snippetLineCount;
    }
    if (op === 'replace_line') {
      const range = action.range || {};
      const startLine = Number(range.start && range.start.line || 0);
      const endLine = Number(range.end && range.end.line || startLine);
      const replacedLines = Math.max(1, endLine - startLine + 1);
      return snippetLineCount - replacedLines;
    }
    return 0;
  }

  function issueShiftAdjustment(issue) {
    const delta = lineDeltaForIssue(issue);
    if (delta === 0) {
      return null;
    }
    const action = resolveIssueAction(issue);
    return {
      line: Number(issue && issue.line || 1),
      delta,
      inclusive: action.op === 'insert_before' || action.op === 'replace_line',
    };
  }

  function cumulativeLineShift(originLine, adjustments) {
    return (Array.isArray(adjustments) ? adjustments : []).reduce((shift, adjustment) => {
      if (!adjustment || typeof adjustment !== 'object') {
        return shift;
      }
      const line = Number(adjustment.line || 1);
      if (originLine > line || (adjustment.inclusive && originLine === line)) {
        return shift + Number(adjustment.delta || 0);
      }
      return shift;
    }, 0);
  }

  function compareFixCandidates(left, right) {
    const leftPriority = Number(left && left.autofixPriority || semanticPriorityForIssue(left));
    const rightPriority = Number(right && right.autofixPriority || semanticPriorityForIssue(right));
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    const leftLine = Number(left.line || 1);
    const rightLine = Number(right.line || 1);
    if (leftLine !== rightLine) {
      return rightLine - leftLine;
    }

    return issueActionIdentity(left).localeCompare(issueActionIdentity(right));
  }

  function resolveMustClearKinds(issue) {
    if (typeof mustClearKindsForIssue === 'function') {
      return mustClearKindsForIssue(issue);
    }
    const kind = String(issue && issue.kind || '').trim();
    return kind ? [kind] : [];
  }

  async function buildGuardFileEntries(document, filePaths) {
    const liveDocument = await vscode.workspace.openTextDocument(document.uri);
    return (Array.isArray(filePaths) ? filePaths : []).map((filePath) => {
      const normalizedPath = path.resolve(String(filePath || ''));
      if (normalizedPath === path.resolve(document.uri.fsPath)) {
        return {
          path: normalizedPath,
          contents: liveDocument.getText(),
        };
      }
      return {
        path: normalizedPath,
        contents: fs.existsSync(normalizedPath) ? fs.readFileSync(normalizedPath, 'utf8') : '',
      };
    });
  }

  async function applyAutoFixes(document, issues, options = {}) {
    if (!isAutoFixEnabled(document.uri)) {
      return false;
    }

    const allowedKinds = new Set(configuredAutoFixKinds(document.uri));
    const seen = new Set();
    const baselineIssues = Array.isArray(issues) ? issues : [];
    const candidates = baselineIssues.filter((issue) => {
      const action = resolveIssueAction(issue);
      const kind = String(issue.kind || '');
      if (action.op === 'run_command') {
        return false;
      }
      if (!allowedKinds.has(kind)) {
        return false;
      }
      if (!issue.snippet && action.op !== 'write_file' && kind !== 'trailing_whitespace' && kind !== 'syntax_extra_delimiter') {
        return false;
      }
      if (String(autoFixNoOpReason(issue, { autoMode: true }) || '').trim()) {
        return false;
      }

      const identity = issueKey(document, issue);
      if (seen.has(identity)) {
        return false;
      }
      seen.add(identity);
      return true;
    });

    if (candidates.length === 0) {
      return false;
    }

    candidates.sort(compareFixCandidates);
    const boundedCandidates = limitAutomaticPassCandidates(
      document,
      limitDocumentationCandidates(document, candidates),
      options.trigger,
    );

    const inlineCandidates = boundedCandidates.filter((issue) => resolveIssueAction(issue).op !== 'write_file');
    const deferredWriteCandidates = boundedCandidates.filter((issue) => resolveIssueAction(issue).op === 'write_file');
    const batch = inlineCandidates.length > 0 ? inlineCandidates : deferredWriteCandidates;
    const affectedFiles = collectAffectedFilePaths(document.uri.fsPath, batch, resolveIssueAction);
    const snapshot = captureFileSnapshot(affectedFiles);

    let applied = false;
    const appliedIssues = [];
    const lineAdjustments = [];
    for (const issue of batch) {
      const originLine = Number(issue && issue.line || 1);
      const lineShift = cumulativeLineShift(originLine, lineAdjustments);
      const shiftedIssue = shiftIssueForBatch(issue, lineShift);
      const changed = await applySnippetIssue(document, shiftedIssue);
      if (changed) {
        applied = true;
        appliedIssues.push(shiftedIssue);
        const adjustment = issueShiftAdjustment(shiftedIssue);
        if (adjustment) {
          lineAdjustments.push(adjustment);
        }
      }
    }

    if (!applied) {
      return false;
    }

    const refreshedDocument = await vscode.workspace.openTextDocument(document.uri);
    const refreshedIssues = typeof collectIssues === 'function'
      ? await collectIssues(refreshedDocument)
      : [];
    const guardResult = evaluateAutofixGuard({
      appliedIssues,
      beforeIssues: baselineIssues,
      afterIssues: refreshedIssues,
      fileEntries: await buildGuardFileEntries(refreshedDocument, affectedFiles),
      resolveMustClearKinds,
    });
    if (!guardResult.ok) {
      restoreFileSnapshot(snapshot);
      return false;
    }

    await analyzeDocument(refreshedDocument, 'autofix', {
      issues: refreshedIssues,
      skipAutoFix: true,
      skipTerminalTasks: true,
    });
    return true;
  }

  return {
    applyAutoFixes,
    detectIndent,
    issueIndent,
    issueActionIdentity,
    issueIntersectsRange,
    issueKey,
    issueLineIndex,
    issueTriggerText,
    lineDeleteRange,
    lineReplaceRange,
    normalizeSnippetLines,
    removeTriggerLine,
    removeTriggerResidue,
    splitSnippetLines,
  };
}

module.exports = {
  createEditRuntime,
};
