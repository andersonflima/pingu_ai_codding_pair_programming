#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { analyzeText } = require('../lib/analyzer');
const { buildIssueConfidenceReport } = require('../lib/issue-confidence');
const { loadProjectMemory, summarizeProjectMemory } = require('../lib/project-memory');

function resolveTargetFile(argv) {
  const candidate = String(argv[2] || '').trim();
  if (!candidate) {
    throw new Error('Uso: node scripts/issue_confidence_report.js <arquivo>');
  }
  return path.resolve(candidate);
}

function main() {
  const targetFile = resolveTargetFile(process.argv);
  const contents = fs.readFileSync(targetFile, 'utf8');
  const issues = analyzeText(targetFile, contents, { maxLineLength: 120 });
  const report = buildIssueConfidenceReport(issues);
  const projectMemory = loadProjectMemory(targetFile);

  process.stdout.write(`${JSON.stringify({
    file: targetFile,
    project: summarizeProjectMemory(projectMemory),
    report,
    issues: issues.map((issue) => ({
      line: issue.line,
      kind: issue.kind,
      severity: issue.severity,
      confidence: issue.confidence,
      autofixPriority: issue.autofixPriority,
      message: issue.message,
    })),
  }, null, 2)}\n`);
}

main();
