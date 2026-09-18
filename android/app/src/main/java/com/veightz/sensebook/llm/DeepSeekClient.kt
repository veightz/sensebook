package com.veightz.sensebook.llm

import com.veightz.sensebook.settings.DeepSeekSettings
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets

/**
 * OpenAI-compatible chat/completions client (DeepSeek P0).
 * Reuses userscript enrich prompt split: ai_word_sense / ai_sentence_gloss.
 */
object DeepSeekClient {

    data class EnrichResult(
        val aiWordSense: String,
        val aiSentenceGloss: String,
        val stub: Boolean = false
    )

    private val ENRICH_SYSTEM_PROMPT =
        "你是简洁的语境词汇助教。根据用户给出的选中词、句子与来源页，用中文解释。" +
            "输出必须严格拆成两部分，禁止把中心词（head）的词义焊进修饰语（modifier）的独立义项：" +
            "1) ai_word_sense＝独立义项：只解释选中词本身（词性+本义/常见义），不要夹带搭配对象的意思；" +
            "2) ai_sentence_gloss＝句内搭配效果：说明该词与句中相邻词（如修饰语+中心词）组合后的语气/程度/修辞效果；可略提整句大意，但重点是搭配而非干译整句。" +
            "短例（选中 fantastic，句中有 fantastic speed）：" +
            "错误 ai_word_sense「极快的速度」（把 speed 焊进了 fantastic）；" +
            "正确 ai_word_sense「adj. 极好的；出色的；了不起的」；" +
            "正确 ai_sentence_gloss「与 speed 搭配时强调速度之惊人/极快；在本句中…」。" +
            "只输出 JSON：{\"ai_word_sense\":\"…\",\"ai_sentence_gloss\":\"…\"}。不要 Markdown 或其它文字。"

    fun stubEnrich(word: String, sentence: String): EnrichResult {
        return EnrichResult(
            aiWordSense = "[本地 stub] 「$word」独立义项占位（未配置 LLM API Key）",
            aiSentenceGloss = "[本地 stub] 搭配效果占位（未配置 LLM）：与句中相邻词的组合语气待生成；句摘：「${sentence.take(60)}」",
            stub = true
        )
    }

    /**
     * Contextual 词义/搭配效果 (same enrich prompt as userscript 存本并释义 / 语境释义).
     * @throws Exception on network / HTTP / parse failure when a key is configured
     */
    fun enrich(
        settings: DeepSeekSettings.Snapshot,
        word: String,
        sentence: String,
        source: String = ""
    ): EnrichResult {
        if (!settings.hasKey) {
            return stubEnrich(word, sentence.ifBlank { word })
        }
        val userPrompt = buildString {
            appendLine("选中词：${word.ifBlank { sentence }}")
            appendLine("句子：${sentence.ifBlank { word }}")
            appendLine("来源：${source}")
            append("请分别给出：ai_word_sense＝选中词的独立义项（勿把中心词意思焊进修饰语）；ai_sentence_gloss＝句内搭配效果（修饰语+中心词等组合语气）。")
        }
        val messages = JSONArray()
            .put(JSONObject().put("role", "system").put("content", ENRICH_SYSTEM_PROMPT))
            .put(JSONObject().put("role", "user").put("content", userPrompt))

        val content = chatCompletions(settings, messages, jsonResponse = true)
        return parseEnrichJson(content)
    }

    /** Plain translate path for full-sentence fallback when enrich isn't ideal. */
    fun translate(settings: DeepSeekSettings.Snapshot, text: String): String {
        if (!settings.hasKey) {
            return "[本地翻译占位] $text\n（请先在 DeepSeek 设置中填写 API Key）"
        }
        val messages = JSONArray()
            .put(
                JSONObject().put("role", "system")
                    .put("content", "你是简洁、准确的中文翻译助手。只输出中文译文，不要解释。")
            )
            .put(
                JSONObject().put("role", "user")
                    .put("content", "请将下面文本翻译成自然的中文：\n$text")
            )
        return chatCompletions(settings, messages, jsonResponse = false).trim()
    }

    private fun chatCompletions(
        settings: DeepSeekSettings.Snapshot,
        messages: JSONArray,
        jsonResponse: Boolean
    ): String {
        val base = settings.baseUrl.trimEnd('/')
        val url = URL("$base/chat/completions")
        val thinking = if (settings.thinkingEnabled) {
            JSONObject().put("type", "enabled")
        } else {
            JSONObject().put("type", "disabled")
        }
        fun bodyWith(format: Boolean): JSONObject {
            val b = JSONObject()
                .put("model", settings.model)
                .put("temperature", 0.2)
                .put("thinking", thinking)
                .put("messages", messages)
            if (settings.thinkingEnabled) {
                b.put("reasoning_effort", "high")
            }
            if (format) {
                b.put("response_format", JSONObject().put("type", "json_object"))
            }
            return b
        }

        var conn = post(url, settings.apiKey, bodyWith(jsonResponse))
        var code = conn.responseCode
        var raw = readBody(conn)
        // Some providers reject response_format — retry without (keep thinking flag)
        if (jsonResponse && code >= 400) {
            val errText = raw
            if (code == 400 ||
                errText.contains("response_format", true) ||
                errText.contains("json_object", true) ||
                errText.contains("unsupported", true)
            ) {
                conn = post(url, settings.apiKey, bodyWith(false))
                code = conn.responseCode
                raw = readBody(conn)
            }
        }
        if (code !in 200..299) {
            val msg = try {
                JSONObject(raw).optJSONObject("error")?.optString("message")
                    ?.takeIf { it.isNotBlank() }
                    ?: JSONObject(raw).optString("message").takeIf { it.isNotBlank() }
            } catch (_: Exception) {
                null
            } ?: "LLM HTTP $code"
            throw IllegalStateException(msg)
        }
        val root = JSONObject(raw)
        val content = root.optJSONArray("choices")
            ?.optJSONObject(0)
            ?.optJSONObject("message")
            ?.optString("content")
        if (content.isNullOrBlank()) throw IllegalStateException("LLM 返回空内容")
        return content
    }

    private fun post(url: URL, apiKey: String, body: JSONObject): HttpURLConnection {
        val conn = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 20_000
            readTimeout = 60_000
            doOutput = true
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("Authorization", "Bearer $apiKey")
        }
        OutputStreamWriter(conn.outputStream, StandardCharsets.UTF_8).use { it.write(body.toString()) }
        return conn
    }

    private fun readBody(conn: HttpURLConnection): String {
        val stream = try {
            if (conn.responseCode in 200..299) conn.inputStream else conn.errorStream
        } catch (_: Exception) {
            conn.errorStream ?: conn.inputStream
        } ?: return ""
        return BufferedReader(InputStreamReader(stream, StandardCharsets.UTF_8)).use { it.readText() }
    }

    private fun parseEnrichJson(content: String): EnrichResult {
        var text = content.trim()
        val fence = Regex("^```(?:json)?\\s*([\\s\\S]*?)```$", RegexOption.IGNORE_CASE)
            .find(text)
        if (fence != null) text = fence.groupValues[1].trim()
        val obj = JSONObject(text)
        return EnrichResult(
            aiWordSense = obj.optString("ai_word_sense").trim(),
            aiSentenceGloss = obj.optString("ai_sentence_gloss").trim(),
            stub = false
        )
    }
}
