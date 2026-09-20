import Foundation

/// Bundled EN→ZH dict (same JSON shape as userscript/dict & Android assets).
final class LocalDict {
    static let shared: LocalDict = {
        LocalDict.loadBundled()
    }()

    struct Entry {
        let gloss: String
        let pos: String?
        let phonetic: String?
    }

    struct LookupHit {
        let entry: Entry
        let dictVersion: String
        let dictCount: Int
    }

    private let version: String
    private let count: Int
    private let entries: [String: Entry]

    private init(version: String, count: Int, entries: [String: Entry]) {
        self.version = version
        self.count = count
        self.entries = entries
    }

    var dictVersion: String { version }
    var dictCount: Int { count }

    func lookup(_ raw: String) -> LookupHit? {
        guard let key = Self.normalize(raw) else { return nil }
        if let hit = entries[key] ?? stemLookup(key) {
            return LookupHit(entry: hit, dictVersion: version, dictCount: count)
        }
        return nil
    }

    private func stemLookup(_ key: String) -> Entry? {
        var candidates: [String] = []
        if key.hasSuffix("ies"), key.count > 4 {
            candidates.append(String(key.dropLast(3)) + "y")
        }
        if key.hasSuffix("es"), key.count > 3 {
            candidates.append(String(key.dropLast(2)))
        }
        if key.hasSuffix("s"), !key.hasSuffix("ss"), key.count > 2 {
            candidates.append(String(key.dropLast(1)))
        }
        if key.hasSuffix("ed"), key.count > 3 {
            candidates.append(String(key.dropLast(2)))
            if key.count > 4 {
                let chars = Array(key)
                if chars[chars.count - 3] == chars[chars.count - 4] {
                    candidates.append(String(key.dropLast(3)))
                }
            }
        }
        if key.hasSuffix("ing"), key.count > 4 {
            candidates.append(String(key.dropLast(3)))
            candidates.append(String(key.dropLast(3)) + "e")
        }
        for c in candidates {
            if let e = entries[c] { return e }
        }
        return nil
    }

    /// Single Latin token, length ≤ 20 — same short-word gate as userscript / Android.
    static func isShortWord(_ raw: String) -> Bool {
        normalize(raw) != nil
    }

    static func normalize(_ raw: String) -> String? {
        let t = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if t.isEmpty || t.count > 20 { return nil }
        if t.contains(where: { $0.isWhitespace }) { return nil }
        guard t.allSatisfy({ ($0 >= "a" && $0 <= "z") || $0 == "'" || $0 == "-" }) else { return nil }
        return t.trimmingCharacters(in: CharacterSet(charactersIn: "'-"))
    }

    private static func loadBundled() -> LocalDict {
        let url =
            Bundle.main.url(forResource: "en-zh-common", withExtension: "json", subdirectory: "dict")
            ?? Bundle.main.url(forResource: "en-zh-common", withExtension: "json")
        guard let url,
              let data = try? Data(contentsOf: url),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return LocalDict(version: "missing", count: 0, entries: [:])
        }
        let version = root["version"] as? String ?? "unknown"
        let count = root["count"] as? Int ?? 0
        let entriesJson = root["entries"] as? [String: Any] ?? [:]
        var map: [String: Entry] = [:]
        map.reserveCapacity(entriesJson.count)
        for (k, v) in entriesJson {
            guard let obj = v as? [String: Any] else { continue }
            let gloss = (obj["g"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !gloss.isEmpty else { continue }
            let pos = (obj["p"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let phonetic = ((obj["ph"] as? String) ?? (obj["phonetic"] as? String))?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            map[k.lowercased()] = Entry(
                gloss: gloss,
                pos: (pos?.isEmpty == false) ? pos : nil,
                phonetic: (phonetic?.isEmpty == false) ? phonetic : nil
            )
        }
        return LocalDict(version: version, count: count > 0 ? count : map.count, entries: map)
    }
}
