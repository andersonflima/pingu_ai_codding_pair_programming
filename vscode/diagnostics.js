'use strict';

function mapSeverity(vscode, severity) {
  switch (severity) {
    case 'error':
      return vscode.DiagnosticSeverity.Error;
    case 'warning':
      return vscode.DiagnosticSeverity.Warning;
    default:
      return vscode.DiagnosticSeverity.Information;
  }
}

function createDiagnostic(vscode, document, issue) {
  const lineIndex = Math.max(0, Math.min(document.lineCount - 1, Number(issue.line || 1) - 1));
  const line = document.lineAt(lineIndex);
  const range = new vscode.Range(lineIndex, 0, lineIndex, line.text.length);
  const severity = mapSeverity(vscode, issue.severity);
  const suffix = issue.suggestion ? ` | ${issue.suggestion}` : '';
  const diagnostic = new vscode.Diagnostic(
    range,
    `${issue.kind}: ${issue.message}${suffix}`,
    severity,
  );
  diagnostic.source = 'realtime-dev-agent';
  diagnostic.code = issue.kind;
  return diagnostic;
}

function publishDiagnostics(vscode, diagnostics, issuesByUri, document, issues) {
  issuesByUri.set(document.uri.toString(), Array.isArray(issues) ? [...issues] : []);
  diagnostics.set(document.uri, issues.map((issue) => createDiagnostic(vscode, document, issue)));
}

module.exports = {
  createDiagnostic,
  mapSeverity,
  publishDiagnostics,
};
