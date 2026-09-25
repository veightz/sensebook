package com.veightz.sensebook.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.UUID

/**
 * Local vocab list (SharedPreferences JSON), aligned with userscript `sensebook_entries` fields.
 */
object VocabStore {
    private const val PREFS = "sensebook_entries"
    private const val KEY = "entries"

    data class AddRequest(
        val word: String,
        val sentence: String = "",
        /** Page URL when known; on Android PROCESS_TEXT often empty. */
        val sourceUrl: String = "",
        /** Referring package / app label when available (e.g. com.android.chrome). */
        val sourceApp: String = "",
        val aiWordSense: String = "",
        val aiSentenceGloss: String = "",
        val status: String = "pending_ai"
    )

    @Synchronized
    fun add(context: Context, req: AddRequest): String {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val arr = JSONArray(prefs.getString(KEY, "[]"))
        val sentence = req.sentence.ifBlank { req.word }
        for (index in 0 until arr.length()) {
            val existing = arr.optJSONObject(index) ?: continue
            if ((existing.isNull("deleted_at") || existing.optString("deleted_at").isBlank()) &&
                existing.optString("word").equals(req.word.trim(), ignoreCase = true) &&
                existing.optString("sentence") == sentence &&
                existing.optString("source_url") == req.sourceUrl) {
                if (req.aiWordSense.isNotBlank() || req.aiSentenceGloss.isNotBlank()) {
                    existing.put("ai_word_sense", req.aiWordSense)
                        .put("ai_sentence_gloss", req.aiSentenceGloss)
                        .put("status", req.status)
                        .put("updated_at", Instant.now().toString())
                        .put("sync_dirty", true)
                    prefs.edit().putString(KEY, arr.toString()).apply()
                }
                return existing.optString("id")
            }
        }
        val status = when {
            req.status.isNotBlank() -> req.status
            req.aiWordSense.isNotBlank() || req.aiSentenceGloss.isNotBlank() -> "ready"
            else -> "pending_ai"
        }
        val id = UUID.randomUUID().toString()
        val now = Instant.now().toString()
        val entry = JSONObject()
            .put("id", id)
            .put("word", req.word)
            .put("sentence", sentence)
            .put("source_url", req.sourceUrl)
            .put("source_app", req.sourceApp)
            .put("ai_word_sense", req.aiWordSense)
            .put("ai_sentence_gloss", req.aiSentenceGloss)
            .put("status", status)
            .put("created_at", now)
            .put("updated_at", now)
            .put("tags", JSONArray())
            .put("review_interval_days", 0)
            .put("review_repetitions", 0)
            .put("sync_dirty", true)
        arr.put(entry)
        prefs.edit().putString(KEY, arr.toString()).apply()
        return id
    }

    @Synchronized
    fun all(context: Context, includeDeleted: Boolean = false): List<JSONObject> {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val array = runCatching { JSONArray(prefs.getString(KEY, "[]")) }.getOrDefault(JSONArray())
        return (0 until array.length()).mapNotNull { array.optJSONObject(it) }
            .filter { includeDeleted || it.isNull("deleted_at") || it.optString("deleted_at").isBlank() }
            .map { JSONObject(it.toString()) }
    }

    private fun save(context: Context, list: List<JSONObject>) {
        val array = JSONArray()
        list.forEach { array.put(it) }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, array.toString()).apply()
    }

    @Synchronized
    fun replaceRemote(context: Context, remote: JSONObject, force: Boolean = false): Boolean {
        val list = all(context, true).toMutableList()
        val index = list.indexOfFirst { it.optString("id") == remote.optString("id") }
        if (index >= 0 && list[index].optBoolean("sync_dirty") && !force) return false
        val entry = JSONObject(remote.toString())
            .put("sync_revision", remote.optInt("revision"))
            .put("sync_dirty", false)
        if (index >= 0) list[index] = entry else list.add(0, entry)
        save(context, list)
        return true
    }

    @Synchronized
    fun acknowledgeWithNewerLocal(context: Context, id: String, revision: Int) {
        val list = all(context, true).toMutableList()
        val entry = list.firstOrNull { it.optString("id") == id } ?: return
        entry.put("sync_revision", revision).put("sync_dirty", true)
        save(context, list)
    }

    @Synchronized
    fun saveConflictCopy(context: Context, local: JSONObject, remote: JSONObject) {
        val list = all(context, true).toMutableList()
        val index = list.indexOfFirst { it.optString("id") == local.optString("id") }
        if (index >= 0) list[index] = JSONObject(remote.toString())
            .put("sync_revision", remote.optInt("revision")).put("sync_dirty", false)
        val now = Instant.now().toString()
        val copy = JSONObject(local.toString())
            .put("id", UUID.randomUUID().toString())
            .put("created_at", now)
            .put("updated_at", now)
            .put("sync_revision", JSONObject.NULL)
            .put("sync_dirty", true)
        val tags = copy.optJSONArray("tags") ?: JSONArray()
        tags.put("同步冲突")
        copy.put("tags", tags)
        list.add(0, copy)
        save(context, list)
    }

    @Synchronized
    fun delete(context: Context, id: String) {
        val list = all(context, true).toMutableList()
        val entry = list.firstOrNull { it.optString("id") == id } ?: return
        val now = Instant.now().toString()
        entry.put("deleted_at", now).put("updated_at", now).put("sync_dirty", true)
        save(context, list)
    }

    @Synchronized
    fun edit(context: Context, id: String, word: String, sentence: String, tags: List<String>) {
        val list = all(context, true).toMutableList()
        val entry = list.firstOrNull { it.optString("id") == id } ?: return
        entry.put("word", word.trim().take(200))
            .put("sentence", sentence.trim().take(4000))
            .put("tags", JSONArray(tags.map { it.trim() }.filter { it.isNotBlank() }.take(20)))
            .put("updated_at", Instant.now().toString())
            .put("sync_dirty", true)
        save(context, list)
    }

    fun exportJson(context: Context): String = JSONObject()
        .put("format", "sensebook-entries-v1")
        .put("exported_at", Instant.now().toString())
        .put("entries", JSONArray().apply { all(context, true).forEach { put(it) } })
        .toString(2)

    @Synchronized
    fun importJson(context: Context, content: String): Int {
        val parsed = JSONObject(content)
        val imported = parsed.getJSONArray("entries")
        val list = all(context, true).toMutableList()
        val ids = list.map { it.optString("id") }.toMutableSet()
        var count = 0
        for (index in 0 until imported.length()) {
            val source = imported.optJSONObject(index) ?: continue
            if (source.optString("word").isBlank()) continue
            val id = source.optString("id").takeIf { it.matches(Regex("[a-zA-Z0-9_-]{8,80}")) }
                ?: UUID.randomUUID().toString()
            if (id in ids) continue
            val now = Instant.now().toString()
            val entry = JSONObject(source.toString())
                .put("id", id)
                .put("word", source.optString("word").take(200))
                .put("sentence", source.optString("sentence", source.optString("word")).take(4000))
                .put("created_at", source.optString("created_at").ifBlank { now })
                .put("updated_at", now)
                .put("sync_revision", JSONObject.NULL)
                .put("sync_dirty", true)
            list.add(entry)
            ids.add(id)
            count++
        }
        save(context, list)
        return count
    }

    @Synchronized
    fun review(context: Context, id: String, remembered: Boolean) {
        val list = all(context, true).toMutableList()
        val entry = list.firstOrNull { it.optString("id") == id } ?: return
        val repetitions = if (remembered) entry.optInt("review_repetitions") + 1 else 0
        val interval = if (!remembered) 1 else when (repetitions) {
            1 -> 1
            2 -> 3
            else -> (entry.optInt("review_interval_days", 3) * 2).coerceAtMost(365)
        }
        val now = Instant.now()
        entry.put("review_repetitions", repetitions)
            .put("review_interval_days", interval)
            .put("review_last_at", now.toString())
            .put("review_due_at", now.plusSeconds(interval.toLong() * 86400).toString())
            .put("updated_at", now.toString())
            .put("sync_dirty", true)
        save(context, list)
    }

    fun count(context: Context): Int = all(context).size
}
