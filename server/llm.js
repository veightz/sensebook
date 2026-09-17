/**
 * Optional OpenAI-compatible LLM client.
 * If OPENAI_COMPATIBLE_BASE_URL + API_KEY are unset, returns stubs.
 */

export const ENRICH_SYSTEM_PROMPT =
  '你是简洁的语境词汇助教。根据用户给出的选中词、句子与来源页，用中文解释。' +
  '输出必须严格拆成两部分，禁止把中心词（head）的词义焊进修饰语（modifier）的独立义项：' +
  '1) ai_word_sense＝独立义项：只解释选中词本身（词性+本义/常见义），不要夹带搭配对象的意思；' +
  '2) ai_sentence_gloss＝句内搭配效果：说明该词与句中相邻词（如修饰语+中心词）组合后的语气/程度/修辞效果；可略提整句大意，但重点是搭配而非干译整句。' +
  '短例（选中 fantastic，句中有 fantastic speed）：' +
  '错误 ai_word_sense「极快的速度」（把 speed 焊进了 fantastic）；' +
  '正确 ai_word_sense「adj. 极好的；出色的；了不起的」；' +
  '正确 ai_sentence_gloss「与 speed 搭配时强调速度之惊人/极快；在本句中…」。' +
  '只输出 JSON：{"ai_word_sense":"…","ai_sentence_gloss":"…"}。不要 Markdown 或其它文字。';

export function buildEnrichUserPrompt({ word, sentence, source_url }) {
  return [
    `选中词：${word || ''}`,
    `句子：${sentence || ''}`,
    `来源：${source_url || ''}`,
    '请分别给出：ai_word_sense＝选中词的独立义项（勿把中心词意思焊进修饰语）；ai_sentence_gloss＝句内搭配效果（修饰语+中心词等组合语气）。',
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
      ai_sentence_gloss: `[stub] 搭配效果占位：「${(sentence || '').slice(0, 80)}${(sentence || '').length > 80 ? '…' : ''}」`,
      ai_word_sense: `[stub] 「${word}」独立义项占位（配置 OPENAI_COMPATIBLE_* 后启用真实 AI）`,
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
