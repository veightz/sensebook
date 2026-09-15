/**
 * Optional OpenAI-compatible LLM client.
 * If OPENAI_COMPATIBLE_BASE_URL + API_KEY are unset, returns stubs.
 */

function hasLlm() {
  return Boolean(
    process.env.OPENAI_COMPATIBLE_BASE_URL &&
      process.env.OPENAI_COMPATIBLE_API_KEY
  );
}

async function chatJson(system, user) {
  const base = process.env.OPENAI_COMPATIBLE_BASE_URL.replace(/\/$/, '');
  const model = process.env.OPENAI_COMPATIBLE_MODEL || 'gpt-4o-mini';
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_COMPATIBLE_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM error ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM returned empty content');
  return JSON.parse(content);
}

export async function enrichEntry({ word, sentence }) {
  if (!hasLlm()) {
    return {
      ai_sentence_gloss: `[stub] 句子大意：「${sentence.slice(0, 80)}${sentence.length > 80 ? '…' : ''}」`,
      ai_word_sense: `[stub] 「${word}」在此句中的义项（配置 OPENAI_COMPATIBLE_* 后启用真实 AI）`,
      stub: true,
    };
  }

  const result = await chatJson(
    '你是英语词汇助教。根据单词在句子中的用法，返回 JSON：{"ai_sentence_gloss":"整句中文释义","ai_word_sense":"该词在此句中的中文义项"}。只输出 JSON。',
    `单词：${word}\n句子：${sentence}`
  );
  return {
    ai_sentence_gloss: result.ai_sentence_gloss || '',
    ai_word_sense: result.ai_word_sense || '',
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

  const result = await chatJson(
    `你是翻译助手。将用户文本译为${target === 'zh' ? '简体中文' : target}。返回 JSON：{"translation":"..."}。只输出 JSON。`,
    text
  );
  return {
    translation: result.translation || '',
    stub: false,
  };
}

export { hasLlm };
