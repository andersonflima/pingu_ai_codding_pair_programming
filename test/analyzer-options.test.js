'use strict';

const assert = require('assert/strict');
const test = require('node:test');
const {
  filterIssuesByFocusRange,
  intersectsFocusRange,
  isLightAnalysisMode,
  normalizeAnalysisMode,
  normalizeFocusedLineRange,
  readDocumentationMaxLines,
  shouldAnalyzeDocumentationIssues,
  shouldAnalyzeFlowComments,
  shouldRunLightAnalysisDeepPass,
} = require('../lib/analyzer-options');

test('analyzer options normalize modes, limits and focus ranges', () => {
  assert.equal(normalizeAnalysisMode('light'), 'light');
  assert.equal(normalizeAnalysisMode('unknown'), 'full');
  assert.equal(isLightAnalysisMode('LIGHT'), true);

  assert.equal(readDocumentationMaxLines({ PINGU_DOCUMENTATION_MAX_LINES: '0' }), 0);
  assert.equal(shouldAnalyzeDocumentationIssues(new Array(3), { PINGU_DOCUMENTATION_MAX_LINES: '2' }), false);
  assert.equal(shouldAnalyzeFlowComments(new Array(3), { PINGU_FLOW_COMMENT_MAX_LINES: '0' }), true);
  assert.equal(shouldRunLightAnalysisDeepPass(new Array(3), 'light', { PINGU_LIGHT_ANALYSIS_DEEP_PASS_MAX_LINES: '2' }), false);

  const focusRange = normalizeFocusedLineRange({ focusStartLine: 2, focusEndLine: 8 }, 5);
  assert.deepEqual(focusRange, { start: 2, end: 5 });
  assert.equal(intersectsFocusRange(focusRange, 1, 2), true);
  assert.equal(intersectsFocusRange(focusRange, 6, 8), false);
  assert.deepEqual(
    filterIssuesByFocusRange([{ line: 1 }, { line: 3 }, { line: 9 }], focusRange),
    [{ line: 3 }],
  );
});
