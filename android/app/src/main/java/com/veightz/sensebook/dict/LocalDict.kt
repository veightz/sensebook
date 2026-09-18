package com.veightz.sensebook.dict

import android.content.Context
import org.json.JSONObject
import java.util.Locale
import java.util.concurrent.atomic.AtomicReference

/**
 * Bundled EN→ZH dict (same JSON shape as userscript/dict).
 * Asset: assets/dict/en-zh-common.json (half10k trial copy for MVP size).
 */
class LocalDict private constructor(
    private val version: String,
    private val count: Int,
    private val entries: Map<String, Entry>
) {
    data class Entry(
        val gloss: String,
        val pos: String? = null,
        /** Not present in current ECDICT subset; reserved for easy show-if-available. */
        val phonetic: String? = null
    )

    data class LookupResult(
        val hit: Entry?,
        val dictVersion: String,
        val dictCount: Int
    )

    fun lookup(raw: String): LookupResult {
        val key = normalize(raw) ?: return LookupResult(null, version, count)
        val hit = entries[key]
            ?: stemLookup(key)
        return LookupResult(hit, version, count)
    }

    private fun stemLookup(key: String): Entry? {
        // Light stems aligned with userscript: -s / -ed / -ing
        val candidates = buildList {
            if (key.endsWith("ies") && key.length > 4) add(key.dropLast(3) + "y")
            if (key.endsWith("es") && key.length > 3) add(key.dropLast(2))
            if (key.endsWith("s") && !key.endsWith("ss") && key.length > 2) add(key.dropLast(1))
            if (key.endsWith("ed") && key.length > 3) {
                add(key.dropLast(2))
                if (key.length > 4 && key[key.length - 3] == key[key.length - 4]) {
                    add(key.dropLast(3)) // stopped → stop
                }
            }
            if (key.endsWith("ing") && key.length > 4) {
                add(key.dropLast(3))
                add(key.dropLast(3) + "e")
            }
        }
        for (c in candidates) {
            entries[c]?.let { return it }
        }
        return null
    }

    companion object {
        private const val ASSET_PATH = "dict/en-zh-common.json"
        private val cached = AtomicReference<LocalDict?>(null)

        fun get(context: Context): LocalDict {
            cached.get()?.let { return it }
            synchronized(this) {
                cached.get()?.let { return it }
                val loaded = load(context.applicationContext)
                cached.set(loaded)
                return loaded
            }
        }

        private fun load(context: Context): LocalDict {
            context.assets.open(ASSET_PATH).bufferedReader().use { reader ->
                val root = JSONObject(reader.readText())
                val version = root.optString("version", "unknown")
                val count = root.optInt("count", 0)
                val entriesJson = root.getJSONObject("entries")
                val map = HashMap<String, Entry>(entriesJson.length())
                val keys = entriesJson.keys()
                while (keys.hasNext()) {
                    val k = keys.next()
                    val obj = entriesJson.getJSONObject(k)
                    val gloss = obj.optString("g", "")
                    if (gloss.isBlank()) continue
                    val pos = obj.optString("p").takeIf { it.isNotBlank() }
                    val phonetic = obj.optString("ph").takeIf { it.isNotBlank() }
                        ?: obj.optString("phonetic").takeIf { it.isNotBlank() }
                    map[k.lowercase(Locale.ROOT)] = Entry(gloss, pos, phonetic)
                }
                return LocalDict(version, if (count > 0) count else map.size, map)
            }
        }

        /** Single Latin token, length ≤ 20 — same short-word gate as userscript. */
        fun normalize(raw: String): String? {
            val t = raw.trim().lowercase(Locale.ROOT)
            if (t.isEmpty() || t.length > 20 || t.any { it.isWhitespace() }) return null
            if (!t.all { it in 'a'..'z' || it == '\'' || it == '-' }) return null
            return t.trim('\'', '-')
        }
    }
}
