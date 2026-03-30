'use strict';

const path = require('path');
const registry = require('../config/issue-kinds.json');

const FALLBACK_KIND = Object.freeze({
  defaultAction: Object.freeze({ op: 'insert_before' }),
  autoFixDefault: false,
  autoFixPriority: 999,
  supportsQuickFix: true,
  supportsFollowUp: true,
});

function issueKindsConfigPath() {
  return path.join(__dirname, '..', 'config', 'issue-kinds.json');
}

function cloneAction(action) {
  if (!action || typeof action !== 'object') {
    return { op: 'insert_before' };
  }
  return { ...action };
}

function issueKindConfig(kind) {
  const key = String(kind || '');
  const configured = registry[key];
  if (!configured || typeof configured !== 'object') {
    return {
      ...FALLBACK_KIND,
      defaultAction: cloneAction(FALLBACK_KIND.defaultAction),
    };
  }

  return {
    ...FALLBACK_KIND,
    ...configured,
    defaultAction: cloneAction(configured.defaultAction || FALLBACK_KIND.defaultAction),
  };
}

function defaultActionForKind(kind) {
  return cloneAction(issueKindConfig(kind).defaultAction);
}

function resolveIssueAction(issue) {
  const action = issue && issue.action;
  if (action && typeof action === 'object' && String(action.op || '').trim() !== '') {
    return action;
  }
  return defaultActionForKind(issue && issue.kind);
}

function fixPriorityForKind(kind) {
  return Number(issueKindConfig(kind).autoFixPriority || FALLBACK_KIND.autoFixPriority);
}

function defaultAutoFixKinds() {
  return Object.keys(registry)
    .filter((kind) => issueKindConfig(kind).autoFixDefault)
    .sort((left, right) => {
      const leftPriority = fixPriorityForKind(left);
      const rightPriority = fixPriorityForKind(right);
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      return left.localeCompare(right);
    });
}

function supportsQuickFix(kind) {
  return issueKindConfig(kind).supportsQuickFix !== false;
}

function supportsFollowUp(kind) {
  return issueKindConfig(kind).supportsFollowUp !== false;
}

function issueKindRegistry() {
  return registry;
}

module.exports = {
  defaultActionForKind,
  defaultAutoFixKinds,
  fixPriorityForKind,
  issueKindConfig,
  issueKindRegistry,
  issueKindsConfigPath,
  resolveIssueAction,
  supportsFollowUp,
  supportsQuickFix,
};
