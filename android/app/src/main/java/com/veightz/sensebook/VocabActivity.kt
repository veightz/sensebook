package com.veightz.sensebook

import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.widget.addTextChangedListener
import androidx.lifecycle.lifecycleScope
import com.veightz.sensebook.data.SyncClient
import com.veightz.sensebook.data.VocabStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.time.Instant

/** Launcher entry for the local vocabulary book, review queue, and cross-device sync. */
class VocabActivity : AppCompatActivity() {
    private lateinit var list: LinearLayout
    private lateinit var status: TextView
    private lateinit var search: EditText
    private lateinit var dueOnly: CheckBox
    private val exportFile = registerForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri == null) return@registerForActivityResult
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    contentResolver.openOutputStream(uri)?.use { out ->
                        out.write(VocabStore.exportJson(applicationContext).toByteArray(Charsets.UTF_8))
                    } ?: error("无法写入文件")
                }
                status.text = "词条已导出"
            } catch (error: Exception) { status.text = "导出失败：${error.message}" }
        }
    }
    private val importFile = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@registerForActivityResult
        lifecycleScope.launch {
            try {
                val count = withContext(Dispatchers.IO) {
                    val content = contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }
                        ?: error("无法读取文件")
                    require(content.length <= 10 * 1024 * 1024) { "文件过大" }
                    VocabStore.importJson(applicationContext, content)
                }
                render()
                status.text = "已导入 $count 条"
                syncIfLoggedIn()
            } catch (error: Exception) { status.text = "导入失败：${error.message}" }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(20, 20, 20, 12)
        }
        val title = TextView(this).apply { text = "Sensebook 生词本"; textSize = 22f }
        root.addView(title)
        status = TextView(this).apply { textSize = 13f; text = "本地词库可离线使用" }
        root.addView(status)

        val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        actions.addView(button("账号设置") { showAccountDialog() })
        actions.addView(button("立即同步") { sync() })
        root.addView(actions)
        val files = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        files.addView(button("导出词条") { exportFile.launch("sensebook-entries.json") })
        files.addView(button("导入词条") { importFile.launch(arrayOf("application/json")) })
        root.addView(files)

        search = EditText(this).apply { hint = "搜索单词、句子或释义"; setSingleLine(true) }
        search.addTextChangedListener { render() }
        root.addView(search)
        dueOnly = CheckBox(this).apply { text = "只看待复习"; setOnCheckedChangeListener { _, _ -> render() } }
        root.addView(dueOnly)

        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(ScrollView(this).apply { addView(list) }, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)
        render()
        if (runCatching { SyncClient.account(this) }.getOrNull() != null) sync()
    }

    override fun onResume() {
        super.onResume()
        if (::list.isInitialized) render()
    }

    private fun button(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        setOnClickListener { action() }
    }

    private fun due(entry: JSONObject): Boolean {
        if (entry.isNull("review_due_at")) return true
        val time = runCatching { Instant.parse(entry.optString("review_due_at")) }.getOrNull() ?: return true
        return !time.isAfter(Instant.now())
    }

    private fun render() {
        if (!::list.isInitialized) return
        list.removeAllViews()
        val query = search.text?.toString()?.trim().orEmpty()
        val all = VocabStore.all(this)
        val visible = all.filter { entry ->
            (!dueOnly.isChecked || due(entry)) &&
                (query.isBlank() || listOf("word", "sentence", "ai_word_sense", "ai_sentence_gloss", "source_app")
                    .any { entry.optString(it).contains(query, ignoreCase = true) })
        }.sortedByDescending { it.optString("created_at") }
        status.text = "本地 ${all.size} 条 · 待复习 ${all.count(::due)} 条" +
            (runCatching { SyncClient.account(this) }.getOrNull()?.let { " · 已登录 ${it.email}" } ?: " · 未登录")
        if (visible.isEmpty()) {
            list.addView(TextView(this).apply { text = "暂无符合条件的词条。划词后点「加入生词本」。"; textSize = 14f })
        }
        visible.forEach { entry ->
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(14, 12, 14, 12)
                setBackgroundColor(0xfff1f5f9.toInt())
            }
            card.addView(TextView(this).apply { text = entry.optString("word"); textSize = 19f })
            val detail = listOf(
                entry.optString("sentence"),
                entry.optString("ai_word_sense"),
                entry.optString("ai_sentence_gloss"),
                entry.optString("source_app")
            ).filter { it.isNotBlank() && it != "null" }.joinToString("\n")
            card.addView(TextView(this).apply { text = detail; textSize = 14f })
            val reviewRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            reviewRow.addView(button("记住") { review(entry.optString("id"), true) })
            reviewRow.addView(button("没记住") { review(entry.optString("id"), false) })
            card.addView(reviewRow)
            val editRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            editRow.addView(button("编辑") { showEditDialog(entry) })
            editRow.addView(button("删除") { confirmDelete(entry) })
            card.addView(editRow)
            list.addView(card, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = 12 })
        }
    }

    private fun review(id: String, remembered: Boolean) {
        VocabStore.review(this, id, remembered)
        render()
        syncIfLoggedIn()
    }

    private fun confirmDelete(entry: JSONObject) {
        AlertDialog.Builder(this).setMessage("删除「${entry.optString("word")}」？删除会同步到其他设备。")
            .setPositiveButton("删除") { _, _ ->
                VocabStore.delete(this, entry.optString("id"))
                render()
                syncIfLoggedIn()
            }.setNegativeButton("取消", null).show()
    }

    private fun showEditDialog(entry: JSONObject) {
        val form = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(20, 8, 20, 0) }
        val word = EditText(this).apply { hint = "单词"; setText(entry.optString("word")) }
        val sentence = EditText(this).apply { hint = "语境句子"; setText(entry.optString("sentence")) }
        val tags = EditText(this).apply {
            hint = "标签（用逗号分隔）"
            val array = entry.optJSONArray("tags")
            setText((0 until (array?.length() ?: 0)).map { array!!.optString(it) }.joinToString(", "))
        }
        form.addView(word); form.addView(sentence); form.addView(tags)
        AlertDialog.Builder(this).setTitle("编辑词条").setView(form)
            .setPositiveButton("保存") { _, _ ->
                if (word.text.isNullOrBlank()) return@setPositiveButton
                VocabStore.edit(this, entry.optString("id"), word.text.toString(), sentence.text.toString(),
                    tags.text.toString().split(",", "，"))
                render()
                syncIfLoggedIn()
            }.setNegativeButton("取消", null).show()
    }

    private fun showAccountDialog() {
        val form = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(20, 8, 20, 0) }
        val url = EditText(this).apply { hint = "同步服务 HTTPS 地址"; setText(SyncClient.savedApiUrl(this@VocabActivity)) }
        val email = EditText(this).apply { hint = "邮箱"; setText(SyncClient.savedEmail(this@VocabActivity)) }
        val password = EditText(this).apply {
            hint = "密码"
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        form.addView(url); form.addView(email); form.addView(password)
        val dialog = AlertDialog.Builder(this).setTitle("跨端同步账号").setView(form)
            .setPositiveButton("登录", null).setNeutralButton("注册", null)
            .setNegativeButton("退出登录") { _, _ ->
                SyncClient.logout(this)
                render()
            }.create()
        dialog.setOnShowListener {
            fun authenticate(register: Boolean) {
                val api = url.text.toString()
                val mail = email.text.toString()
                val pass = password.text.toString()
                lifecycleScope.launch {
                    try {
                        status.text = "正在登录…"
                        withContext(Dispatchers.IO) { SyncClient.authenticate(applicationContext, api, mail, pass, register) }
                        dialog.dismiss()
                        sync()
                    } catch (error: Exception) {
                        status.text = error.message ?: "登录失败"
                    }
                }
            }
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener { authenticate(false) }
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener { authenticate(true) }
        }
        dialog.show()
    }

    private fun syncIfLoggedIn() {
        if (runCatching { SyncClient.account(this) }.getOrNull() != null) sync()
    }

    private fun sync() {
        lifecycleScope.launch {
            try {
                status.text = "同步中…"
                val result = withContext(Dispatchers.IO) { SyncClient.sync(applicationContext) }
                render()
                status.text = "同步完成：上传 ${result.uploaded}，更新 ${result.downloaded}。"
            } catch (error: Exception) {
                status.text = "同步失败：${error.message ?: error.javaClass.simpleName}"
            }
        }
    }
}
