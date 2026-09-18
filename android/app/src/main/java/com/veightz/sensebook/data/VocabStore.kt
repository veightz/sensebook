package com.veightz.sensebook.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
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

    fun add(context: Context, word: String, sentence: String = "") {
        add(context, AddRequest(word = word, sentence = sentence))
    }

    fun add(context: Context, req: AddRequest) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val arr = JSONArray(prefs.getString(KEY, "[]"))
        val status = when {
            req.status.isNotBlank() -> req.status
            req.aiWordSense.isNotBlank() || req.aiSentenceGloss.isNotBlank() -> "ready"
            else -> "pending_ai"
        }
        val entry = JSONObject()
            .put("id", UUID.randomUUID().toString())
            .put("word", req.word)
            .put("sentence", req.sentence)
            .put("source_url", req.sourceUrl)
            .put("source_app", req.sourceApp)
            .put("ai_word_sense", req.aiWordSense)
            .put("ai_sentence_gloss", req.aiSentenceGloss)
            .put("status", status)
            .put("created_at", java.time.Instant.now().toString())
        arr.put(entry)
        prefs.edit().putString(KEY, arr.toString()).apply()
    }

    fun count(context: Context): Int {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return JSONArray(prefs.getString(KEY, "[]")).length()
    }
}
