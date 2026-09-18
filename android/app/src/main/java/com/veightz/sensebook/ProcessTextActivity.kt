package com.veightz.sensebook

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.google.android.material.checkbox.MaterialCheckBox
import com.google.android.material.textfield.TextInputEditText
import com.veightz.sensebook.data.VocabStore
import com.veightz.sensebook.data.QueryStore
import com.veightz.sensebook.sync.QuerySync
import com.veightz.sensebook.databinding.ActivityProcessTextBinding
import com.veightz.sensebook.dict.LocalDict
import com.veightz.sensebook.llm.DeepSeekClient
import com.veightz.sensebook.settings.DeepSeekSettings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Entry point for [Intent.ACTION_PROCESS_TEXT] from the system text-selection menu.
 *
 * Dual-out (aligned with userscript):
 * - Short word: local dict (fast) + DeepSeek enrich (词义 / 搭配效果) in parallel
 * - Full sentence / multi-word: model enrich only
 */
class ProcessTextActivity : AppCompatActivity() {

    private lateinit var binding: ActivityProcessTextBinding
    private var selected: String = ""
    private var sourceApp: String = ""
    private var lastSense: String = ""
    private var lastCollocation: String = ""
    private var isShortWord: Boolean = false
    private var queryGen: Int = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityProcessTextBinding.inflate(layoutInflater)
        setContentView(binding.root)

        selected = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)
            ?.toString()
            ?.trim()
            .orEmpty()

        sourceApp = resolveSourceApp()
        if (sourceApp.isNotBlank()) {
            binding.sourceRow.visibility = View.VISIBLE
            binding.sourceRow.text = getString(R.string.source_app_fmt, sourceApp)
        }

        binding.selectedText.text = selected.ifEmpty { "—" }
        binding.localGloss.text = getString(R.string.local_loading)
        binding.modelWordSense.text = getString(R.string.model_loading)
        binding.modelSentenceGloss.text = getString(R.string.model_loading)
        binding.phoneticRow.text = formatPhoneticPos(null, null)

        val historyButton = android.widget.Button(this).apply {
            text = "查询记录与同步（可选）"
            setOnClickListener { startActivity(Intent(this@ProcessTextActivity, HistoryActivity::class.java)) }
        }
        (binding.btnSaveVocab.parent as? android.view.ViewGroup)?.addView(historyButton)
        binding.btnSaveVocab.setOnClickListener { saveVocab() }
        binding.btnDeepSeekSettings.setOnClickListener { showDeepSeekSettings() }

        if (selected.isEmpty()) {
            binding.localGloss.text = getString(R.string.local_miss)
            binding.modelWordSense.text = getString(R.string.model_no_text)
            binding.modelSentenceGloss.text = "—"
            return
        }

        isShortWord = LocalDict.normalize(selected) != null
        runDualOut(selected)
    }

    /** PROCESS_TEXT rarely exposes a page URL; capture calling package when present. */
    private fun resolveSourceApp(): String {
        callingPackage?.takeIf { it.isNotBlank() }?.let { return it }
        referrer?.host?.takeIf { it.isNotBlank() }?.let { return it }
        return ""
    }

    private fun runDualOut(raw: String) {
        val gen = ++queryGen
        val eventId = QueryStore.get(applicationContext).begin(raw, sourceApp)
        val settings = DeepSeekSettings.snapshot(applicationContext)

        if (isShortWord) {
            lifecycleScope.launch {
                val result = withContext(Dispatchers.IO) {
                    LocalDict.get(applicationContext).lookup(raw)
                }
                if (gen != queryGen) return@launch
                binding.dictMeta.text = getString(
                    R.string.dict_meta,
                    result.dictVersion,
                    result.dictCount
                )
                if (result.hit != null) {
                    binding.localGloss.text = result.hit.gloss
                    binding.phoneticRow.text =
                        formatPhoneticPos(result.hit.phonetic, result.hit.pos)
                } else {
                    binding.localGloss.text = getString(R.string.local_miss)
                    binding.phoneticRow.text = formatPhoneticPos(null, null)
                }
            }
        } else {
            binding.localGloss.text = getString(R.string.local_sentence_skip)
            binding.phoneticRow.text = formatPhoneticPos(null, null)
        }

        lifecycleScope.launch {
            val modelResult = withContext(Dispatchers.IO) {
                try {
                    Result.success(
                        DeepSeekClient.enrich(
                            settings = settings,
                            word = raw,
                            sentence = raw,
                            source = sourceApp
                        )
                    )
                } catch (e: Exception) {
                    Result.failure(e)
                }
            }
            // 即便用户已切换查询，已发起的请求仍保存真实结果。
            withContext(Dispatchers.IO) {
                modelResult.fold(
                    onSuccess = { result -> QueryStore.get(applicationContext).finish(eventId, listOf(result.aiWordSense, result.aiSentenceGloss).filter { it.isNotBlank() }.joinToString("\n\n"), if (result.stub) "stub" else "ready") },
                    onFailure = { QueryStore.get(applicationContext).finish(eventId, "", "failed") }
                )
            }
            QuerySync.enqueue(applicationContext)
            if (gen != queryGen) return@launch
            modelResult.fold(
                onSuccess = { enrich ->
                    lastSense = enrich.aiWordSense
                    lastCollocation = enrich.aiSentenceGloss
                    val color = if (enrich.stub) {
                        getColor(R.color.sensebook_muted)
                    } else {
                        getColor(R.color.sensebook_on_surface)
                    }
                    binding.modelWordSense.setTextColor(color)
                    binding.modelSentenceGloss.setTextColor(color)
                    binding.modelWordSense.text =
                        enrich.aiWordSense.ifBlank { getString(R.string.model_empty) }
                    binding.modelSentenceGloss.text =
                        enrich.aiSentenceGloss.ifBlank { getString(R.string.model_empty) }
                },
                onFailure = { e ->
                    lastSense = ""
                    lastCollocation = ""
                    val msg = getString(R.string.model_error, e.message ?: e.toString())
                    binding.modelWordSense.setTextColor(getColor(android.R.color.holo_red_dark))
                    binding.modelSentenceGloss.setTextColor(getColor(android.R.color.holo_red_dark))
                    binding.modelWordSense.text = msg
                    binding.modelSentenceGloss.text = "—"
                }
            )
        }
    }

    private fun formatPhoneticPos(phonetic: String?, pos: String?): String {
        val ph = phonetic?.takeIf { it.isNotBlank() } ?: getString(R.string.placeholder_phonetic)
        val p = pos?.takeIf { it.isNotBlank() } ?: "—"
        return "${getString(R.string.phonetic_label)} $ph · ${getString(R.string.pos_label)} $p"
    }

    private fun saveVocab() {
        if (selected.isBlank()) return
        val status =
            if (lastSense.isNotBlank() || lastCollocation.isNotBlank()) "ready" else "pending_ai"
        VocabStore.add(
            applicationContext,
            VocabStore.AddRequest(
                word = selected,
                sentence = selected,
                sourceUrl = "",
                sourceApp = sourceApp,
                aiWordSense = lastSense,
                aiSentenceGloss = lastCollocation,
                status = status
            )
        )
        Toast.makeText(this, R.string.saved_toast, Toast.LENGTH_SHORT).show()
    }

    private fun showDeepSeekSettings() {
        val snap = DeepSeekSettings.snapshot(applicationContext)
        val view = LayoutInflater.from(this).inflate(R.layout.dialog_deepseek_settings, null)
        val inputKey = view.findViewById<TextInputEditText>(R.id.inputApiKey)
        val inputBase = view.findViewById<TextInputEditText>(R.id.inputBaseUrl)
        val inputModel = view.findViewById<TextInputEditText>(R.id.inputModel)
        val checkThinking = view.findViewById<MaterialCheckBox>(R.id.checkThinking)
        val keyStatus = view.findViewById<android.widget.TextView>(R.id.keyStatus)

        inputBase.setText(snap.baseUrl)
        inputModel.setText(snap.model)
        checkThinking.isChecked = snap.thinkingEnabled
        keyStatus.text = getString(R.string.deepseek_key_status, snap.maskedKey)
        if (snap.hasKey) {
            inputKey.hint = snap.maskedKey
        }

        AlertDialog.Builder(this)
            .setTitle(R.string.deepseek_settings_title)
            .setView(view)
            .setPositiveButton(R.string.save) { _, _ ->
                val typedKey = inputKey.text?.toString().orEmpty()
                val keyToSave = when {
                    typedKey.isNotBlank() -> typedKey
                    snap.hasKey -> snap.apiKey
                    else -> ""
                }
                DeepSeekSettings.save(
                    context = applicationContext,
                    apiKey = keyToSave,
                    baseUrl = inputBase.text?.toString().orEmpty(),
                    model = inputModel.text?.toString().orEmpty(),
                    thinkingEnabled = checkThinking.isChecked
                )
                Toast.makeText(this, R.string.deepseek_saved, Toast.LENGTH_SHORT).show()
                if (selected.isNotBlank()) {
                    binding.modelWordSense.text = getString(R.string.model_loading)
                    binding.modelSentenceGloss.text = getString(R.string.model_loading)
                    runDualOut(selected)
                }
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }
}
