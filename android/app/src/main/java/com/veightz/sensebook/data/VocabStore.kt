package com.veightz.sensebook.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Local vocab list (SharedPreferences JSON), aligned with userscript `sensebook_entries` fields.
 * DeepSeek enrich / sync come later.
 */
object VocabStore {
    private const val PREFS = "sensebook_entries"
    private const val KEY = "entries"

    fun add(context: Context, word: String, sentence: String = "") {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val arr = JSONArray(prefs.getString(KEY, "[]"))
        val entry = JSONObject()
            .put("id", UUID.randomUUID().toString())
            .put("word", word)
            .put("sentence", sentence)
            .put("status", "pending_ai")
            .put("created_at", java.time.Instant.now().toString())
        arr.put(entry)
        prefs.edit().putString(KEY, arr.toString()).apply()
    }

    fun count(context: Context): Int {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return JSONArray(prefs.getString(KEY, "[]")).length()
    }
}
