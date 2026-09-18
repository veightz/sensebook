package com.veightz.sensebook.settings

import android.content.Context

/**
 * Placeholder prefs for DeepSeek (OpenAI-compatible). UI to edit lands next milestone.
 * Never log or commit the raw API key.
 */
object DeepSeekSettings {
    private const val PREFS = "sensebook_llm"
    private const val KEY_BASE = "sensebook_llm_base_url"
    private const val KEY_API = "sensebook_llm_api_key"
    private const val KEY_MODEL = "sensebook_llm_model"

    const val DEFAULT_BASE = "https://api.deepseek.com/v1"
    const val DEFAULT_MODEL = "deepseek-flash"

    data class Snapshot(
        val baseUrl: String,
        val model: String,
        val maskedKey: String,
        val hasKey: Boolean
    )

    fun snapshot(context: Context): Snapshot {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val key = p.getString(KEY_API, "").orEmpty()
        return Snapshot(
            baseUrl = p.getString(KEY_BASE, DEFAULT_BASE) ?: DEFAULT_BASE,
            model = p.getString(KEY_MODEL, DEFAULT_MODEL) ?: DEFAULT_MODEL,
            maskedKey = mask(key),
            hasKey = key.isNotBlank()
        )
    }

    private fun mask(key: String): String {
        if (key.isBlank()) return "（未设置）"
        if (key.length <= 8) return "****"
        return key.take(4) + "…" + key.takeLast(4)
    }
}
