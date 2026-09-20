import Foundation

/// OpenAI-compatible chat/completions client (DeepSeek P0).
/// Prompts aligned with userscript / Android: ai_word_sense / ai_sentence_gloss.
enum DeepSeekClient {
    struct EnrichResult: Sendable {
        let aiWordSense: String
        let aiSentenceGloss: String
        let stub: Bool
    }

    struct SettingsSnapshot: Sendable {
        let baseURL: String
        let model: String
        let apiKey: String
        let thinkingEnabled: Bool
        var hasKey: Bool { !apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    private static let enrichSystemPrompt =
        "你是简洁的语境词汇助教。根据用户给出的选中词、句子与来源页，用中文解释。"
        + "输出必须严格拆成两部分，禁止把中心词（head）的词义焊进修饰语（modifier）的独立义项："
        + "1) ai_word_sense＝独立义项：只解释选中词本身（词性+本义/常见义），不要夹带搭配对象的意思；"
        + "2) ai_sentence_gloss＝句内搭配效果：说明该词与句中相邻词（如修饰语+中心词）组合后的语气/程度/修辞效果；可略提整句大意，但重点是搭配而非干译整句。"
        + "短例（选中 fantastic，句中有 fantastic speed）："
        + "错误 ai_word_sense「极快的速度」（把 speed 焊进了 fantastic）；"
        + "正确 ai_word_sense「adj. 极好的；出色的；了不起的」；"
        + "正确 ai_sentence_gloss「与 speed 搭配时强调速度之惊人/极快；在本句中…」。"
        + "只输出 JSON：{\"ai_word_sense\":\"…\",\"ai_sentence_gloss\":\"…\"}。不要 Markdown 或其它文字。"

    static func stubEnrich(word: String, sentence: String) -> EnrichResult {
        EnrichResult(
            aiWordSense: "[本地 stub] 「\(word)」独立义项占位（未配置 LLM API Key）",
            aiSentenceGloss: "[本地 stub] 搭配效果占位（未配置 LLM）：与句中相邻词的组合语气待生成；句摘：「\(sentence.prefix(60))」",
            stub: true
        )
    }

    static func enrich(
        settings: SettingsSnapshot,
        word: String,
        sentence: String,
        source: String = ""
    ) async throws -> EnrichResult {
        if !settings.hasKey {
            return stubEnrich(word: word, sentence: sentence.isEmpty ? word : sentence)
        }
        let userPrompt = """
        选中词：\(word.isEmpty ? sentence : word)
        句子：\(sentence.isEmpty ? word : sentence)
        来源：\(source)
        请分别给出：ai_word_sense＝选中词的独立义项（勿把中心词意思焊进修饰语）；ai_sentence_gloss＝句内搭配效果（修饰语+中心词等组合语气）。
        """
        let messages: [[String: String]] = [
            ["role": "system", "content": enrichSystemPrompt],
            ["role": "user", "content": userPrompt]
        ]
        let content = try await chatCompletions(settings: settings, messages: messages, jsonResponse: true)
        return try parseEnrichJSON(content)
    }

    static func translate(settings: SettingsSnapshot, text: String) async throws -> String {
        if !settings.hasKey {
            return "[本地翻译占位] \(text)\n（请先在 DeepSeek 设置中填写 API Key）"
        }
        let messages: [[String: String]] = [
            ["role": "system", "content": "你是简洁、准确的中文翻译助手。只输出中文译文，不要解释。"],
            ["role": "user", "content": "请将下面文本翻译成自然的中文：\n\(text)"]
        ]
        return try await chatCompletions(settings: settings, messages: messages, jsonResponse: false)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: - HTTP

    private static func chatCompletions(
        settings: SettingsSnapshot,
        messages: [[String: String]],
        jsonResponse: Bool
    ) async throws -> String {
        let base = settings.baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: "\(base)/chat/completions") else {
            throw NSError(domain: "Sensebook", code: 1, userInfo: [NSLocalizedDescriptionKey: "无效 Base URL"])
        }

        func body(withFormat: Bool) -> [String: Any] {
            var b: [String: Any] = [
                "model": settings.model,
                "temperature": 0.2,
                "thinking": ["type": settings.thinkingEnabled ? "enabled" : "disabled"],
                "messages": messages
            ]
            if settings.thinkingEnabled {
                b["reasoning_effort"] = "high"
            }
            if withFormat {
                b["response_format"] = ["type": "json_object"]
            }
            return b
        }

        var (code, raw) = try await post(url: url, apiKey: settings.apiKey, body: body(withFormat: jsonResponse))
        if jsonResponse, code >= 400 {
            let errText = String(data: raw, encoding: .utf8) ?? ""
            if code == 400
                || errText.localizedCaseInsensitiveContains("response_format")
                || errText.localizedCaseInsensitiveContains("json_object")
                || errText.localizedCaseInsensitiveContains("unsupported")
            {
                (code, raw) = try await post(url: url, apiKey: settings.apiKey, body: body(withFormat: false))
            }
        }

        guard (200...299).contains(code) else {
            let text = String(data: raw, encoding: .utf8) ?? ""
            if let obj = try? JSONSerialization.jsonObject(with: raw) as? [String: Any] {
                if let err = obj["error"] as? [String: Any],
                   let msg = err["message"] as? String, !msg.isEmpty {
                    throw NSError(domain: "Sensebook", code: code, userInfo: [NSLocalizedDescriptionKey: msg])
                }
                if let msg = obj["message"] as? String, !msg.isEmpty {
                    throw NSError(domain: "Sensebook", code: code, userInfo: [NSLocalizedDescriptionKey: msg])
                }
            }
            throw NSError(domain: "Sensebook", code: code, userInfo: [NSLocalizedDescriptionKey: "LLM HTTP \(code): \(text.prefix(200))"])
        }

        guard let root = try JSONSerialization.jsonObject(with: raw) as? [String: Any],
              let choices = root["choices"] as? [[String: Any]],
              let first = choices.first,
              let message = first["message"] as? [String: Any],
              let content = message["content"] as? String,
              !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            throw NSError(domain: "Sensebook", code: 2, userInfo: [NSLocalizedDescriptionKey: "LLM 返回空内容"])
        }
        return content
    }

    private static func post(url: URL, apiKey: String, body: [String: Any]) async throws -> (Int, Data) {
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 60
        req.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? -1
        return (code, data)
    }

    private static func parseEnrichJSON(_ content: String) throws -> EnrichResult {
        var text = content.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.hasPrefix("```") {
            let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
            if lines.count >= 3 {
                text = lines.dropFirst().dropLast().joined(separator: "\n")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }
        guard let data = text.data(using: .utf8),
              let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            throw NSError(domain: "Sensebook", code: 3, userInfo: [NSLocalizedDescriptionKey: "无法解析模型 JSON"])
        }
        return EnrichResult(
            aiWordSense: (obj["ai_word_sense"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
            aiSentenceGloss: (obj["ai_sentence_gloss"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
            stub: false
        )
    }
}
