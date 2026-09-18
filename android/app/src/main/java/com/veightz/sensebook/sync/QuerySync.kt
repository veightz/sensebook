package com.veightz.sensebook.sync

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.veightz.sensebook.data.QueryStore
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/** 设备授权与翻译 Key 分开保存；同步失败不会影响查询。 */
object QuerySync {
    private val busy = AtomicBoolean(false)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    fun enqueue(c: Context) { val app=c.applicationContext; scope.launch { runCatching { sync(app) } } }
    private fun prefs(c: Context) = EncryptedSharedPreferences.create(c.applicationContext, "sensebook_sync",
        MasterKey.Builder(c.applicationContext).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV, EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
    fun config(c: Context): JSONObject? = prefs(c).getString("config", null)?.let { JSONObject(it) }
    fun disable(c: Context) { config(c)?.let { prefs(c).edit().putString("config", it.put("enabled", false).toString()).commit() } }
    fun connect(c: Context, text: String, includeHistory: Boolean) {
        val data = JSONObject(text); val url = URL(data.getString("endpoint"))
        require(url.protocol == "https" && url.userInfo == null) { "同步网站必须使用 HTTPS" }
        require(Regex("sb_[a-f0-9]{64}").matches(data.getString("token"))) { "连接配置不正确" }
        data.put("endpoint", "${url.protocol}://${url.authority}")
        val me = request(data, "/sync/me")
        require(me.getString("account_id") == data.getString("account_id") && me.getString("device_id") == data.getString("device_id")) { "账号或设备不匹配" }
        if (includeHistory) QueryStore.get(c).importLegacy()
        data.put("enabled", true).put("include_history", includeHistory).put("since", Instant.now().toString())
        prefs(c).edit().putString("config", data.toString()).commit()
    }
    fun sync(c: Context) {
        if (!busy.compareAndSet(false, true)) return
        try {
            val cfg = config(c) ?: return
            if (!cfg.optBoolean("enabled")) return
            val store = QueryStore.get(c)
            fun active() { check(config(c)?.let { it.optBoolean("enabled") && it.optString("token") == cfg.getString("token") } == true) { "同步已关闭" } }
            active()
            val me = request(cfg, "/sync/me")
            check(me.getString("account_id") == cfg.getString("account_id")) { "账号不匹配" }
            val pending = store.list().filter {
                (it.optString("account_id").isBlank() || it.optString("account_id") == cfg.getString("account_id")) &&
                    (cfg.optBoolean("include_history") || it.getString("occurred_at") >= cfg.getString("since")) && it.optString("revision") != it.optString("synced_revision")
            }
            // 每批两条可避免长原句/中文解释超出 API 体积上限。
            pending.chunked(2).forEach { batch ->
                active()
                val result = request(cfg, "/sync/events", JSONObject().put("events", JSONArray(batch)))
                val deleted = result.getJSONArray("deleted")
                val deletedIds = (0 until deleted.length()).map { deleted.getString(it) }.toSet()
                batch.forEach { e -> if (e.getString("id") in deletedIds) store.removeRemote(e.getString("id")) else store.acknowledge(e.getString("id"), e.getString("revision"), cfg.getString("account_id")) }
            }
            var after = 0L
            do {
                active()
                val result = request(cfg, "/sync/deletions?after=$after")
                val deleted = result.getJSONArray("deleted")
                for (i in 0 until deleted.length()) { val e = deleted.getJSONObject(i); store.removeRemote(e.getString("id")); after = e.getLong("seq") }
            } while (result.optBoolean("has_more"))
            active()
            prefs(c).edit().putString("config", cfg.put("last_sync", Instant.now().toString()).put("error", "").toString()).commit()
        } catch (e: Exception) {
            config(c)?.let { prefs(c).edit().putString("config", it.put("error", e.message ?: "同步失败").toString()).commit() }
            throw e
        } finally { busy.set(false) }
    }
    private fun request(cfg: JSONObject, path: String, body: JSONObject? = null): JSONObject {
        val conn = URL(cfg.getString("endpoint") + path).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 15000; conn.readTimeout = 30000; conn.instanceFollowRedirects = false
            conn.setRequestProperty("Authorization", "Bearer " + cfg.getString("token"))
            if (body != null) { conn.requestMethod = "POST"; conn.doOutput = true; conn.setRequestProperty("Content-Type", "application/json"); conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) } }
            check(conn.responseCode in 200..299) { if (conn.responseCode == 401) "设备连接失效，请重新连接" else "同步失败（${conn.responseCode}），记录保留在本机" }
            return JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
        } finally { conn.disconnect() }
    }
}
