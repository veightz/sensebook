import Combine
import Foundation

/// DeepSeek / app preferences. API key lives in Keychain; other fields in UserDefaults.
final class AppSettings: ObservableObject {
    static let shared = AppSettings()

    static let defaultBaseURL = "https://api.deepseek.com/v1"
    static let defaultModel = "deepseek-flash"

    private let defaults = UserDefaults.standard
    private enum Keys {
        static let baseURL = "sensebook_llm_base_url"
        static let model = "sensebook_llm_model"
        static let thinking = "sensebook_llm_thinking"
    }

    @Published var baseURL: String
    @Published var model: String
    @Published var thinkingEnabled: Bool
    @Published var apiKeyField: String
    @Published var hasKey: Bool

    private init() {
        let base = defaults.string(forKey: Keys.baseURL)?.trimmingCharacters(in: .whitespacesAndNewlines)
        baseURL = (base?.isEmpty == false) ? base! : Self.defaultBaseURL
        let mod = defaults.string(forKey: Keys.model)?.trimmingCharacters(in: .whitespacesAndNewlines)
        model = (mod?.isEmpty == false) ? mod! : Self.defaultModel
        thinkingEnabled = defaults.bool(forKey: Keys.thinking) // default false
        let key = KeychainStore.loadAPIKey()
        apiKeyField = key
        hasKey = !key.isEmpty
    }

    func snapshot() -> DeepSeekClient.SettingsSnapshot {
        DeepSeekClient.SettingsSnapshot(
            baseURL: baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/")).isEmpty
                ? Self.defaultBaseURL
                : baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
                    .trimmingCharacters(in: CharacterSet(charactersIn: "/")),
            model: {
                let m = model.trimmingCharacters(in: .whitespacesAndNewlines)
                return m.isEmpty ? Self.defaultModel : m
            }(),
            apiKey: KeychainStore.loadAPIKey(),
            thinkingEnabled: thinkingEnabled
        )
    }

    func save(apiKey: String, baseURL: String, model: String, thinkingEnabled: Bool) throws {
        let base = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let mod = model.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedBase = base.isEmpty ? Self.defaultBaseURL : base
        let resolvedModel = mod.isEmpty ? Self.defaultModel : mod

        try KeychainStore.saveAPIKey(apiKey.trimmingCharacters(in: .whitespacesAndNewlines))
        defaults.set(resolvedBase, forKey: Keys.baseURL)
        defaults.set(resolvedModel, forKey: Keys.model)
        defaults.set(thinkingEnabled, forKey: Keys.thinking)

        self.baseURL = resolvedBase
        self.model = resolvedModel
        self.thinkingEnabled = thinkingEnabled
        self.apiKeyField = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        self.hasKey = !self.apiKeyField.isEmpty
    }

    func clearAPIKey() throws {
        KeychainStore.deleteAPIKey()
        apiKeyField = ""
        hasKey = false
    }

    static func maskKey(_ key: String) -> String {
        if key.isEmpty { return "（未设置）" }
        if key.count <= 8 { return "****" }
        return String(key.prefix(4)) + "…" + String(key.suffix(4))
    }
}
