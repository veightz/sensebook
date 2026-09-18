package com.veightz.sensebook.settings

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * On-device DeepSeek (OpenAI-compatible) settings.
 * API key lives only in EncryptedSharedPreferences — never commit keys.
 * Defaults align with userscript: deepseek-flash, thinking OFF.
 */
object DeepSeekSettings {
    private const val TAG = "DeepSeekSettings"
    private const val PREFS_ENCRYPTED = "sensebook_llm"
    private const val PREFS_LEGACY = "sensebook_llm_legacy"

    private const val KEY_BASE = "sensebook_llm_base_url"
    private const val KEY_API = "sensebook_llm_api_key"
    private const val KEY_MODEL = "sensebook_llm_model"
    private const val KEY_THINKING = "sensebook_llm_thinking"

    const val DEFAULT_BASE = "https://api.deepseek.com/v1"
    const val DEFAULT_MODEL = "deepseek-flash"

    data class Snapshot(
        val baseUrl: String,
        val model: String,
        val apiKey: String,
        val thinkingEnabled: Boolean,
        val maskedKey: String,
        val hasKey: Boolean
    )

    @Volatile
    private var prefsCache: SharedPreferences? = null

    private fun prefs(context: Context): SharedPreferences {
        prefsCache?.let { return it }
        synchronized(this) {
            prefsCache?.let { return it }
            val app = context.applicationContext
            val created = try {
                val masterKey = MasterKey.Builder(app)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build()
                EncryptedSharedPreferences.create(
                    app,
                    PREFS_ENCRYPTED,
                    masterKey,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
                ).also { migrateLegacyIfNeeded(app, it) }
            } catch (e: Exception) {
                Log.w(TAG, "EncryptedSharedPreferences unavailable; using private prefs", e)
                app.getSharedPreferences(PREFS_LEGACY, Context.MODE_PRIVATE)
            }
            prefsCache = created
            return created
        }
    }

    /** One-shot migrate from early plaintext prefs file name. */
    private fun migrateLegacyIfNeeded(app: Context, encrypted: SharedPreferences) {
        if (encrypted.contains(KEY_API) || encrypted.contains(KEY_BASE)) return
        val legacy = app.getSharedPreferences("sensebook_llm_plain", Context.MODE_PRIVATE)
        val key = legacy.getString(KEY_API, null) ?: return
        encrypted.edit()
            .putString(KEY_API, key)
            .putString(KEY_BASE, legacy.getString(KEY_BASE, DEFAULT_BASE))
            .putString(KEY_MODEL, legacy.getString(KEY_MODEL, DEFAULT_MODEL))
            .putBoolean(KEY_THINKING, legacy.getBoolean(KEY_THINKING, false))
            .apply()
        legacy.edit().clear().apply()
    }

    fun snapshot(context: Context): Snapshot {
        val p = prefs(context)
        val key = p.getString(KEY_API, "").orEmpty()
        return Snapshot(
            baseUrl = p.getString(KEY_BASE, DEFAULT_BASE)?.trim()?.ifEmpty { DEFAULT_BASE }
                ?: DEFAULT_BASE,
            model = p.getString(KEY_MODEL, DEFAULT_MODEL)?.trim()?.ifEmpty { DEFAULT_MODEL }
                ?: DEFAULT_MODEL,
            apiKey = key,
            thinkingEnabled = p.getBoolean(KEY_THINKING, false),
            maskedKey = mask(key),
            hasKey = key.isNotBlank()
        )
    }

    fun save(
        context: Context,
        apiKey: String,
        baseUrl: String,
        model: String,
        thinkingEnabled: Boolean
    ) {
        val base = baseUrl.trim().trimEnd('/').ifEmpty { DEFAULT_BASE }
        val mod = model.trim().ifEmpty { DEFAULT_MODEL }
        prefs(context).edit()
            .putString(KEY_API, apiKey.trim())
            .putString(KEY_BASE, base)
            .putString(KEY_MODEL, mod)
            .putBoolean(KEY_THINKING, thinkingEnabled)
            .apply()
    }

    fun hasKey(context: Context): Boolean = snapshot(context).hasKey

    private fun mask(key: String): String {
        if (key.isBlank()) return "（未设置）"
        if (key.length <= 8) return "****"
        return key.take(4) + "…" + key.takeLast(4)
    }
}
