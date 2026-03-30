'use strict';

function createCodeActionRuntime(deps) {
  const {
    buildFollowUpComment,
    issueIntersectsRange,
    issueLineIndex,
    isEnabled,
    issuesByUri,
    supportsDocument,
    supportsFollowUp,
    vscode,
  } = deps;

  function buildFollowUpCodeAction(document, issue) {
    if (!supportsFollowUp(issue.kind)) {
      return null;
    }

    const followUpComment = buildFollowUpComment(document.fileName, issue);
    if (!followUpComment) {
      return null;
    }

    const lineIndex = issueLineIndex(issue);
    const boundedLineIndex = Math.max(0, Math.min(lineIndex, Math.max(document.lineCount - 1, 0)));
    const edit = new vscode.WorkspaceEdit();
    if (boundedLineIndex >= document.lineCount - 1) {
      edit.insert(
        document.uri,
        new vscode.Position(boundedLineIndex, document.lineAt(boundedLineIndex).text.length),
        `\n${followUpComment}`,
      );
    } else {
      edit.insert(
        document.uri,
        new vscode.Position(boundedLineIndex + 1, 0),
        `${followUpComment}\n`,
      );
    }

    return {
      title: 'Pingu - Dev Agent: Insert actionable follow-up',
      kind: vscode.CodeActionKind && vscode.CodeActionKind.QuickFix
        ? vscode.CodeActionKind.QuickFix
        : 'quickfix',
      edit,
    };
  }

  function provideCodeActions(document, range) {
    if (!supportsDocument(document) || !isEnabled(document.uri)) {
      return [];
    }
    const issues = issuesByUri.get(document.uri.toString()) || [];
    return issues
      .filter((issue) => issueIntersectsRange(issue, range))
      .map((issue) => buildFollowUpCodeAction(document, issue))
      .filter(Boolean);
  }

  return {
    buildFollowUpCodeAction,
    provideCodeActions,
  };
}

module.exports = {
  createCodeActionRuntime,
};
