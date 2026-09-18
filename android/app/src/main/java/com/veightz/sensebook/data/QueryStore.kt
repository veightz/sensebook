package com.veightz.sensebook.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject
import java.time.Instant
import java.util.TimeZone
import java.util.UUID

/** 查询事件独立于词典缓存；每次查询先落地，结果完成后更新同一条记录。 */
class QueryStore private constructor(context: Context) : SQLiteOpenHelper(context, "sensebook_queries.db", null, 1) {
    private val app = context.applicationContext
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE events(id TEXT PRIMARY KEY, json TEXT NOT NULL)")
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    @Synchronized fun installationId(): String {
        val p = app.getSharedPreferences("sensebook_device", Context.MODE_PRIVATE)
        return p.getString("id", null) ?: UUID.randomUUID().toString().also { p.edit().putString("id", it).commit() }
    }
    @Synchronized fun begin(selected: String, sourceApp: String): String {
        val id = UUID.randomUUID().toString()
        put(JSONObject().put("id", id).put("installation_id", installationId())
            .put("selected_text", selected.take(12000)).put("context", "").put("source_url", "")
            .put("source_title", "").put("source_app", sourceApp).put("platform", "android")
            .put("mode", "sense").put("status", "pending").put("explanation", "")
            .put("from_cache", false).put("occurred_at", Instant.now().toString())
            .put("timezone", TimeZone.getDefault().id).put("origin", "query").put("revision", UUID.randomUUID().toString()))
        return id
    }
    @Synchronized fun finish(id: String, explanation: String, status: String) {
        val event = get(id) ?: return
        if (event.optBoolean("deleted")) return
        put(event.put("explanation", explanation.take(20000)).put("status", status).put("revision", UUID.randomUUID().toString()))
    }
    @Synchronized fun get(id: String): JSONObject? = readableDatabase.rawQuery("SELECT json FROM events WHERE id=?", arrayOf(id)).use { if (it.moveToFirst()) JSONObject(it.getString(0)) else null }
    @Synchronized fun list(): List<JSONObject> = readableDatabase.rawQuery("SELECT json FROM events", null).use { c ->
        buildList { while (c.moveToNext()) { val e = JSONObject(c.getString(0)); if (!e.optBoolean("deleted")) add(e) } }.sortedByDescending { it.optString("occurred_at") }
    }
    @Synchronized fun acknowledge(id: String, revision: String, accountId: String) {
        val e = get(id) ?: return
        if (!e.optBoolean("deleted")) put(e.put("synced_revision", revision).put("account_id", accountId))
    }
    @Synchronized fun removeRemote(id: String) { put(JSONObject().put("id", id).put("deleted", true)) }
    private fun put(e: JSONObject) {
        writableDatabase.insertWithOnConflict("events", null, ContentValues().apply { put("id", e.getString("id")); put("json", e.toString()) }, SQLiteDatabase.CONFLICT_REPLACE)
    }
    @Synchronized fun importLegacy() {
        val prefs = app.getSharedPreferences("sensebook_entries", Context.MODE_PRIVATE)
        val arr = org.json.JSONArray(prefs.getString("entries", "[]"))
        for (i in 0 until arr.length()) {
            val e = arr.getJSONObject(i); val id = "legacy_" + e.optString("id")
            if (id.length < 8 || get(id) != null) continue
            put(JSONObject().put("id", id).put("installation_id", installationId()).put("selected_text", e.optString("word"))
                .put("context", "").put("source_url", e.optString("source_url")).put("source_app", e.optString("source_app"))
                .put("source_title", "").put("platform", "android").put("mode", "legacy").put("status", "ready")
                .put("explanation", listOf(e.optString("ai_word_sense"), e.optString("ai_sentence_gloss")).filter { it.isNotBlank() }.joinToString("\n\n"))
                .put("occurred_at", e.optString("created_at", Instant.now().toString())).put("timezone", TimeZone.getDefault().id)
                .put("origin", "legacy").put("revision", UUID.randomUUID().toString()))
        }
    }
    companion object {
        @Volatile private var instance: QueryStore? = null
        fun get(context: Context): QueryStore = instance ?: synchronized(this) { instance ?: QueryStore(context.applicationContext).also { instance = it } }
    }
}
