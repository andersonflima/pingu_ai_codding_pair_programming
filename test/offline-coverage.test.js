'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { offlineCoverageReport, REQUIRED_OFFLINE_FEATURES } = require('../lib/offline-coverage');

test('offline coverage reaches every required feature for mapped languages', () => {
  const report = offlineCoverageReport();

  assert.equal(report.ok, true);
  assert.equal(report.percent, 100);
  assert.deepEqual(report.requiredFeatures, [...REQUIRED_OFFLINE_FEATURES]);
  assert.ok(report.languages.length > 0);
  report.languages.forEach((language) => {
    assert.equal(language.ok, true, language.id);
    assert.deepEqual(
      language.features.map((feature) => feature.feature),
      [...REQUIRED_OFFLINE_FEATURES],
    );
  });
});
