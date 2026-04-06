#!/usr/bin/env node
'use strict';

const { requireLiveOpenAiValidation } = require('./require_real_ai_command');

try {
  const state = requireLiveOpenAiValidation('live-openai-preflight');
  console.log(JSON.stringify({
    ok: true,
    message: state.message,
  }, null, 2));
} catch (error) {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
}
