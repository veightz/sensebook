package com.veightz.sensebook

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.veightz.sensebook.data.VocabStore
import com.veightz.sensebook.databinding.ActivityProcessTextBinding
import com.veightz.sensebook.dict.LocalDict
import com.veightz.sensebook.settings.DeepSeekSettings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Entry point for [Intent.ACTION_PROCESS_TEXT] from the system text-selection menu.
 * Shows selected text + local gloss; model / save / DeepSeek settings are stubbed for milestone 1.
 */
class ProcessTextActivity : AppCompatActivity() {

    private lateinit var binding: ActivityProcessTextBinding
    private var selected: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityProcessTextBinding.inflate(layoutInflater)
        setContentView(binding.root)

        selected = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)
            ?.toString()
            ?.trim()
            .orEmpty()

        binding.selectedText.text = selected.ifEmpty { "—" }
        binding.localGloss.text = getString(R.string.local_loading)
        binding.modelGloss.text = getString(R.string.placeholder_model)
        binding.phoneticRow.text = formatPhoneticPos(null, null)

        binding.btnSaveVocab.setOnClickListener { saveVocab() }
        binding.btnDeepSeekSettings.setOnClickListener { showDeepSeekPlaceholder() }

        if (selected.isNotEmpty()) {
            lookupLocal(selected)
        } else {
            binding.localGloss.text = getString(R.string.local_miss)
        }
    }

    private fun lookupLocal(raw: String) {
        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) {
                LocalDict.get(applicationContext).lookup(raw)
            }
            binding.dictMeta.text = getString(
                R.string.dict_meta,
                result.dictVersion,
                result.dictCount
            )
            if (result.hit != null) {
                binding.localGloss.text = result.hit.gloss
                binding.phoneticRow.text = formatPhoneticPos(result.hit.phonetic, result.hit.pos)
            } else {
                binding.localGloss.text = getString(R.string.local_miss)
                binding.phoneticRow.text = formatPhoneticPos(null, null)
            }
            // Model dual-out: wire DeepSeek in a later milestone (do not block local path).
        }
    }

    private fun formatPhoneticPos(phonetic: String?, pos: String?): String {
        val ph = phonetic?.takeIf { it.isNotBlank() } ?: getString(R.string.placeholder_phonetic)
        val p = pos?.takeIf { it.isNotBlank() } ?: "—"
        return "${getString(R.string.phonetic_label)} $ph · ${getString(R.string.pos_label)} $p"
    }

    private fun saveVocab() {
        if (selected.isBlank()) return
        VocabStore.add(applicationContext, selected)
        Toast.makeText(this, R.string.saved_toast, Toast.LENGTH_SHORT).show()
    }

    private fun showDeepSeekPlaceholder() {
        val prefs = DeepSeekSettings.snapshot(applicationContext)
        AlertDialog.Builder(this)
            .setTitle(R.string.deepseek_stub_title)
            .setMessage(
                getString(R.string.deepseek_stub_message) +
                    "\n\nBase: ${prefs.baseUrl}\nModel: ${prefs.model}\nKey: ${prefs.maskedKey}"
            )
            .setPositiveButton(R.string.ok, null)
            .show()
    }
}
