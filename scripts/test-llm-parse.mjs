/**
 * Smoke tests for enrich prompt / JSON parse (no real API key).
 */
import assert from 'node:assert/strict';
import {
  buildEnrichUserPrompt,
  parseEnrichJson,
  parseJsonContent,
  ENRICH_SYSTEM_PROMPT,
} from '../server/llm.js';

function test(name, fn) {
  try {
    fn();
    console.log('ok -', name);
  } catch (e) {
    console.error('FAIL -', name);
    throw e;
  }
}

test('system prompt mentions JSON keys', () => {
  assert.match(ENRICH_SYSTEM_PROMPT, /ai_sentence_gloss/);
  assert.match(ENRICH_SYSTEM_PROMPT, /ai_word_sense/);
});

test('buildEnrichUserPrompt includes word/sentence/source', () => {
  const p = buildEnrichUserPrompt({
    word: 'apple',
    sentence: 'I ate an apple.',
    source_url: 'https://example.com',
  });
  assert.match(p, /apple/);
  assert.match(p, /I ate an apple/);
  assert.match(p, /example\.com/);
});

test('parseEnrichJson plain object', () => {
  const r = parseEnrichJson(
    '{"ai_sentence_gloss":"我吃了苹果。","ai_word_sense":"n. 苹果"}'
  );
  assert.equal(r.ai_sentence_gloss, '我吃了苹果。');
  assert.equal(r.ai_word_sense, 'n. 苹果');
});

test('parseEnrichJson markdown fence', () => {
  const r = parseEnrichJson(
    '```json\n{"ai_sentence_gloss":"句意","ai_word_sense":"词义"}\n```'
  );
  assert.equal(r.ai_sentence_gloss, '句意');
  assert.equal(r.ai_word_sense, '词义');
});

test('parseEnrichJson rejects empty', () => {
  assert.throws(() => parseEnrichJson(null), /empty/i);
});

test('parseJsonContent for translate shape', () => {
  const r = parseJsonContent('{"translation":"你好"}');
  assert.equal(r.translation, '你好');
});

console.log('All smoke tests passed.');
