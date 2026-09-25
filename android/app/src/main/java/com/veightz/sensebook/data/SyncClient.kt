package com.veightz.sensebook.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Shared sync protocol with the browser userscript and Cloudflare Worker. Call on Dispatchers.IO. */
object SyncClient {
    private const val PREFS = "sensebook_sync"
    private const val DEFAULT_API_URL = "https://sensebook-sync.veightz3161.workers.dev"

    data class Account(val apiUrl: String, val email: String, val userId: String, val token: String)
    data class Result(val uploaded: Int, val downloaded: Int)

    private fun prefs(context: Context) = EncryptedSharedPreferences.create(
        context.applicationContext,
        PREFS,
        MasterKey.Builder(context.applicationContext).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    fun account(context: Context): Account? {
        val p = prefs(context)
        val token = p.getString("token", "").orEmpty()
        if (token.isBlank()) return null
        return Account(p.getString("api_url", "").orEmpty(), p.getString("email", "").orEmpty(),
            p.getString("user_id", "").orEmpty(), token)
    }

    fun savedApiUrl(context: Context): String = prefs(context).getString("api_url", DEFAULT_API_URL).orEmpty()
    fun savedEmail(context: Context): String = prefs(context).getString("email", "").orEmpty()

    fun logout(context: Context) {
        prefs(context).edit().remove("token").apply()
    }

    private fun checkedUrl(raw: String): String {
        val url = URL(raw.trim().trimEnd('/'))
        val local = url.host in setOf("10.0.2.2", "127.0.0.1", "localhost")
        require(url.protocol == "https" || (local && url.protocol == "http")) {
            "同步地址必须使用 HTTPS（本机联调除外）"
        }
        require(url.path.isNullOrBlank() || url.path == "/") { "请输入服务根地址" }
        require(url.userInfo == null && url.query == null && url.ref == null) { "请输入不带账号、参数的服务根地址" }
        return url.toString().trimEnd('/')
    }

    private fun request(base: String, path: String, method: String = "GET", token: String = "", body: JSONObject? = null): Pair<Int, JSONObject> {
        val connection = (URL(base + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15000
            readTimeout = 20000
            setRequestProperty("Accept", "application/json")
            if (token.isNotBlank()) setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
        }
        return try {
            val status = connection.responseCode
            val content = (if (status in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader()?.use { it.readText() }.orEmpty()
            status to runCatching { JSONObject(content) }.getOrDefault(JSONObject())
        } finally {
            connection.disconnect()
        }
    }

    fun authenticate(context: Context, rawUrl: String, email: String, password: String, register: Boolean): Account {
        val apiUrl = checkedUrl(rawUrl)
        val (status, response) = request(apiUrl, if (register) "/auth/register" else "/auth/login", "POST",
            body = JSONObject().put("email", email.trim()).put("password", password))
        if (status !in 200..299) throw IllegalStateException(response.optString("error", "登录失败：HTTP $status"))
        val user = response.getJSONObject("user")
        val id = user.getString("id")
        val p = prefs(context)
        val owner = p.getString("user_id", "").orEmpty()
        require(owner.isBlank() || owner == id) { "本机词库已关联另一账号；请先导出并清理后再切换账号" }
        val account = Account(apiUrl, user.getString("email"), id, response.getString("token"))
        p.edit().putString("api_url", apiUrl).putString("email", account.email)
            .putString("user_id", id).putString("token", account.token)
            .apply()
        return account
    }

    private fun sameContent(a: JSONObject, b: JSONObject): Boolean {
        val fields = listOf("word", "sentence", "translation", "ai_word_sense", "ai_sentence_gloss",
            "source_url", "source_app", "tags", "status", "deleted_at", "review_due_at",
            "review_interval_days", "review_repetitions", "review_last_at")
        return fields.all { field ->
            val left = if (field in setOf("review_interval_days", "review_repetitions")) a.optInt(field).toString()
                else if (a.isNull(field)) if (field == "tags") "[]" else "" else a.opt(field)?.toString().orEmpty()
            val right = if (field in setOf("review_interval_days", "review_repetitions")) b.optInt(field).toString()
                else if (b.isNull(field)) if (field == "tags") "[]" else "" else b.opt(field)?.toString().orEmpty()
            left == right
        }
    }

    @Synchronized
    fun sync(context: Context): Result {
        val account = account(context) ?: throw IllegalStateException("请先登录同步账号")
        val p = prefs(context)
        var uploaded = 0
        var downloaded = 0
        val pending = VocabStore.all(context, true).filter { it.optBoolean("sync_dirty") || it.optInt("sync_revision") == 0 }
        for (original in pending) {
            val id = original.optString("id")
            val current = VocabStore.all(context, true).firstOrNull { it.optString("id") == id } ?: continue
            val base = current.optInt("sync_revision").takeIf { it > 0 }
            val payload = JSONObject().put("entry", current).put("base_revision", base ?: JSONObject.NULL)
            val (status, data) = request(account.apiUrl, "/sync/entries/$id", "PUT", account.token, payload)
            if (status == 409 && data.has("entry")) {
                val remote = data.getJSONObject("entry")
                val latest = VocabStore.all(context, true).firstOrNull { it.optString("id") == id } ?: current
                if (sameContent(latest, remote)) VocabStore.replaceRemote(context, remote, true)
                else VocabStore.saveConflictCopy(context, latest, remote)
                continue
            }
            if (status !in 200..299) throw IllegalStateException(data.optString("error", "上传失败：HTTP $status"))
            val remote = data.getJSONObject("entry")
            val latest = VocabStore.all(context, true).firstOrNull { it.optString("id") == id }
            if (latest != null && latest.optString("updated_at") != current.optString("updated_at")) {
                VocabStore.acknowledgeWithNewerLocal(context, id, remote.optInt("revision"))
            } else {
                VocabStore.replaceRemote(context, remote, true)
            }
            uploaded++
        }
        var cursor = p.getLong("cursor", 0L)
        repeat(200) { page ->
            val (status, data) = request(account.apiUrl, "/sync/changes?after=$cursor&limit=200", token = account.token)
            if (status !in 200..299) throw IllegalStateException(data.optString("error", "下载失败：HTTP $status"))
            val changes = data.getJSONArray("changes")
            for (index in 0 until changes.length()) {
                if (VocabStore.replaceRemote(context, changes.getJSONObject(index).getJSONObject("entry"))) downloaded++
            }
            cursor = data.optLong("cursor", cursor)
            p.edit().putLong("cursor", cursor).apply()
            if (!data.optBoolean("has_more")) return Result(uploaded, downloaded)
            if (page == 199) throw IllegalStateException("同步数据过多，请再次同步")
        }
        return Result(uploaded, downloaded)
    }
}
