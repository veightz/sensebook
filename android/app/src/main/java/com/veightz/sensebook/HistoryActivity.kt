package com.veightz.sensebook

import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.veightz.sensebook.data.QueryStore
import com.veightz.sensebook.sync.QuerySync
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** 个人版入口：本地历史始终可读，网站负责完整回顾。 */
class HistoryActivity : AppCompatActivity() {
    private lateinit var status: TextView
    private lateinit var records: LinearLayout
    private fun text(value: String, size: Float = 14f) = TextView(this).apply { text = value; textSize = size; setTextColor(Color.rgb(43,75,55)); setPadding(0,12,0,12) }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(32,32,32,32); setBackgroundColor(Color.rgb(247,249,242)) }
        val scroll = ScrollView(this).apply { addView(root) }; setContentView(scroll)
        root.addView(text("Sensebook · 查询记录", 24f)); root.addView(text("在其他应用中选中文字 → Sensebook，即可查询。无需登录，回顾和同步由你选择。"))
        status = text(""); root.addView(status)
        val config = EditText(this).apply { hint = "粘贴个人网站生成的连接配置"; minLines = 2; inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD }
        root.addView(config)
        val models = CheckBox(this).apply { text = "自动使用账号默认模型"; isChecked = true }; root.addView(models)
        val syncRecords = CheckBox(this).apply { text = "开启查询记录同步" }; root.addView(syncRecords)
        runCatching { QuerySync.config(applicationContext) }.getOrNull()?.let { models.isChecked=it.optBoolean("model_sync",true); syncRecords.isChecked=it.optBoolean("sync_records",true) }
        val include = CheckBox(this).apply { text = "同步已有查询（含旧生词本导入）" }; root.addView(include)
        fun button(label: String, action: () -> Unit) { root.addView(Button(this).apply { text = label; setOnClickListener { action() } }) }
        button("连接账号并应用设置") { val raw = config.text.toString(); val old = include.isChecked; val recordsOn=syncRecords.isChecked; val modelsOn=models.isChecked; work { QuerySync.connect(applicationContext,raw,old,recordsOn,modelsOn); QuerySync.sync(applicationContext) }; config.text.clear() }
        button("立即同步 / 重试") { work { QuerySync.sync(applicationContext) } }
        button("断开账号连接") { work { QuerySync.disable(applicationContext) } }
        button("打开回顾网站") { try { val url=QuerySync.config(applicationContext)?.optString("endpoint"); if(!url.isNullOrBlank())startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(url)))else status.text="请先粘贴网站的连接配置" } catch(e:Exception){status.text=e.message} }
        root.addView(text("最近查询",20f)); records = LinearLayout(this).apply { orientation=LinearLayout.VERTICAL }; root.addView(records)
        refresh()
        QuerySync.enqueue(applicationContext)
    }
    private fun work(action: () -> Unit) { status.text="处理中…"; lifecycleScope.launch { val error=withContext(Dispatchers.IO){runCatching { action() }.exceptionOrNull()}; refresh(); if(error!=null)status.text=error.message } }
    private fun refresh() {
        lifecycleScope.launch {
            val result=withContext(Dispatchers.IO){runCatching { QueryStore.get(applicationContext).list() to QuerySync.config(applicationContext) }}
            result.onSuccess { (events,cfg) ->
                status.text="本地 ${events.size} 条 · " + if(cfg?.optBoolean("enabled")==true){if(cfg.optString("error").isNotBlank())"同步待重试：${cfg.optString("error")}" else "同步已开启"}else "同步未开启"
                if(cfg?.optString("model_error")?.isNotBlank()==true)status.append("\n"+cfg.optString("model_error"))
                else if(cfg?.optString("cloud_model_name")?.isNotBlank()==true)status.append("\n账号模型："+cfg.optString("cloud_model_name"))
                records.removeAllViews()
                events.take(100).forEach { e -> records.addView(text(e.optString("selected_text"),20f)); records.addView(text(e.optString("explanation").ifBlank { if(e.optString("status")=="failed")"本次查询未完成" else "暂无解释" })); records.addView(text("${e.optString("occurred_at")} · ${e.optString("source_app")}",11f)) }
                if(events.size>100)records.addView(text("这里只展示最近 100 条，全部记录仍保存在本机。"))
            }.onFailure { status.text=it.message }
        }
    }
}
