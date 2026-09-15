/**
 * Optional OpenAI-compatible LLM client.
 * If OPENAI_COMPATIBLE_BASE_URL + API_KEY are unset, returns stubs.
 */

export const ENRICH_SYSTEM_PROMPT =
  '你是简洁的语境词汇助教。根据用户给出的单词、句子与来源页，用中文解释。' +
  '只输出 JSON 对象：{"ai_sentence_gloss":"整句中文释义（简洁）","ai_word_sense":"该词在此句中的中文义项（含词性/用法提示，简洁）"}。' +
  '不要输出 Markdown 或其它文字。';

export function buildEnrichUserPrompt({ word, sentence, source_url }) {
  return [
    `单词：${word || ''}`,
    `句子：${sentence || ''}`,
    `来源：${source_url || ''}`,
  ].join('\n');
}

/**
 * Parse LLM message content as JSON object.
 * Strips optional markdown fences.
 */
export function parseJsonContent(content) {
  if (content == null) throw new Error('LLM returned empty content');
  let text = String(content).trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fence) text = fence[1].trim();
  const obj = JSON.parse(text);
  if (!obj || typeof obj !== 'object') throw new Error('LLM JSON invalid');
  return obj;
}

/**
 * Parse enrich response into { ai_sentence_gloss, ai_word_sense }.
 */
export function parseEnrichJson(content) {
  const obj = parseJsonContent(content);
  return {
    ai_sentence_gloss: String(obj.ai_sentence_gloss ?? '').trim(),
    ai_word_sense: String(obj.ai_word_sense ?? '').trim(),
  };
}

function hasLlm() {
  return Boolean(
    process.env.OPENAI_COMPATIBLE_BASE_URL &&
      process.env.OPENAI_COMPATIBLE_API_KEY
  );
}

async function chatCompletions(messages, { useJsonFormat }) {
  const base = process.env.OPENAI_COMPATIBLE_BASE_URL.replace(/\/$/, '');
  const model = process.env.OPENAI_COMPATIBLE_MODEL || 'gpt-4o-mini';
  const body = {
    model,
    temperature: 0.2,
    messages,
  };
  if (useJsonFormat) {
    body.response_format = { type: 'json_object' };
  }
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_COMPATIBLE_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  return res;
}

async function chatRaw(system, user) {
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];

  let res = await chatCompletions(messages, { useJsonFormat: true });
  if (!res.ok) {
    const text = await res.text();
    const formatRejected =
      /response_format|json_object|unsupported|unknown.?param|invalid/i.test(text);
    if (formatRejected || res.status === 400) {
      res = await chatCompletions(messages, { useJsonFormat: false });
      if (!res.ok) {
        const text2 = await res.text();
        throw new Error(`LLM error ${res.status}: ${text2.slice(0, 200)}`);
      }
    } else {
      throw new Error(`LLM error ${res.status}: ${text.slice(0, 200)}`);
    }
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  return parseJsonContent(content);
}

export async function enrichEntry({ word, sentence, source_url }) {
  if (!hasLlm()) {
    return {
      ai_sentence_gloss: `[stub] 句子大意：「${(sentence || '').slice(0, 80)}${(sentence || '').length > 80 ? '…' : ''}」`,
      ai_word_sense: `[stub] 「${word}」在此句中的义项（配置 OPENAI_COMPATIBLE_* 后启用真实 AI）`,
      stub: true,
    };
  }

  const result = await chatRaw(
    ENRICH_SYSTEM_PROMPT,
    buildEnrichUserPrompt({ word, sentence, source_url })
  );
  return {
    ai_sentence_gloss: String(result.ai_sentence_gloss || '').trim(),
    ai_word_sense: String(result.ai_word_sense || '').trim(),
    stub: false,
  };
}

export async function translateText(text, target = 'zh') {
  if (!hasLlm()) {
    return {
      translation: `[stub 翻译→${target}] ${text.slice(0, 120)}${text.length > 120 ? '…' : ''}`,
      stub: true,
    };
  }

  const result = await chatRaw(
    `你是翻译助手。将用户文本译为${target === 'zh' ? '简体中文' : target}。返回 JSON：{"translation":"..."}。只输出 JSON。`,
    text
  );
  return {
    translation: String(result.translation || '').trim(),
    stub: false,
  };
}

export { hasLlm };
