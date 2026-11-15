package pt.lisfilms.lissecurity

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.appcompat.app.AppCompatActivity
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import java.io.File
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.PublicKey
import java.security.spec.MGF1ParameterSpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource

/**
 * Desbloqueio com impressão digital ou rosto, feito com o Android Keystore.
 *
 * - Um par RSA-2048 é gerado DENTRO do Keystore (no hardware seguro, quando o telemóvel o tem).
 *   A chave privada nunca sai de lá e só decifra depois de uma autenticação biométrica FORTE
 *   (classe 3) feita para essa operação; é invalidada se se registar uma impressão digital nova.
 * - A chave do cofre (32 bytes) fica guardada cifrada com a chave pública (RSA-OAEP, SHA-256),
 *   num ficheiro da área privada da app que não entra nas cópias do Android (`noBackupFilesDir`).
 * - Desbloquear = BiometricPrompt com o Cipher da chave privada → a chave do cofre volta ao Rust.
 * - Quando a chave do cofre muda, volta-se a cifrar com a pública sem pedir nada (`renovar`).
 *
 * Formato do ficheiro: versão (1) ‖ id do cofre (16) ‖ chave do cofre cifrada (256).
 */
object Biometria {
  private const val ALIAS = "lissecurity-biometria-v1"
  private const val FICHEIRO = "biometria.bin"
  private const val VERSAO: Byte = 1
  private const val TRANSFORMACAO = "RSA/ECB/OAEPWithSHA-256AndMGF1Padding"
  // o Keystore só aceita MGF1 com SHA-1 em muitas versões do Android; o OAEP continua SHA-256
  private val OAEP = OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA1, PSource.PSpecified.DEFAULT)

  private fun keystore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
  private fun ficheiro(ctx: Context) = File(ctx.noBackupFilesDir, FICHEIRO)

  private fun hexParaBytes(h: String): ByteArray = ByteArray(h.length / 2) { i -> h.substring(i * 2, i * 2 + 2).toInt(16).toByte() }

  /** Por que não dá para usar biometria neste aparelho (em português), ou null se dá. */
  private fun indisponivel(ctx: Context): String? = when (BiometricManager.from(ctx).canAuthenticate(BIOMETRIC_STRONG)) {
    BiometricManager.BIOMETRIC_SUCCESS -> null
    BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> "Ainda não registaste nenhuma impressão digital (ou rosto de classe forte) nas definições do Android."
    BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE -> "Este aparelho não tem leitor biométrico de classe forte."
    BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE -> "O leitor biométrico não está disponível agora."
    BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED -> "O Android pede uma atualização de segurança antes de usar a biometria."
    else -> "A biometria não está disponível neste aparelho."
  }

  private data class Guardado(val id: ByteArray, val cifrado: ByteArray)

  private fun ler(ctx: Context): Guardado? {
    val f = ficheiro(ctx)
    if (!f.exists()) return null
    val b = f.readBytes()
    if (b.size < 18 || b[0] != VERSAO) return null
    return Guardado(b.copyOfRange(1, 17), b.copyOfRange(17, b.size))
  }

  private fun gravar(ctx: Context, id: ByteArray, cifrado: ByteArray) {
    val tmp = File(ctx.noBackupFilesDir, "$FICHEIRO.tmp")
    tmp.writeBytes(byteArrayOf(VERSAO) + id + cifrado)
    if (!tmp.renameTo(ficheiro(ctx))) {
      ficheiro(ctx).delete()
      tmp.renameTo(ficheiro(ctx))
    }
  }

  fun estado(ctx: Context, idCofre: String): JSObject {
    val o = JSObject()
    val motivo = indisponivel(ctx)
    o.put("disponivel", motivo == null)
    if (motivo != null) o.put("motivo", motivo)
    val g = try { ler(ctx) } catch (_: Exception) { null }
    val ativa = g != null && idCofre.isNotEmpty() && g.id.contentEquals(hexParaBytes(idCofre)) && keystore().containsAlias(ALIAS)
    o.put("ativa", ativa)
    return o
  }

  private fun gerarPar() {
    val ks = keystore()
    if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS)
    val construtor = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_DECRYPT or KeyProperties.PURPOSE_ENCRYPT)
      .setKeySize(2048)
      .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA1)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
      .setUserAuthenticationRequired(true)
      .setInvalidatedByBiometricEnrollment(true)
    autenticacaoPorUso(construtor)
    val spec = construtor.build()
    KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, "AndroidKeyStore").apply { initialize(spec) }.generateKeyPair()
  }

  /** Autenticação biométrica forte a cada uso da chave privada. */
  @Suppress("DEPRECATION")
  private fun autenticacaoPorUso(b: KeyGenParameterSpec.Builder) {
    if (Build.VERSION.SDK_INT >= 30) b.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
    else b.setUserAuthenticationValidityDurationSeconds(-1)
  }

  /** A parte pública, fora do Keystore: cifrar com ela não precisa de autenticação. */
  private fun publica(): PublicKey {
    val p = keystore().getCertificate(ALIAS).publicKey
    return KeyFactory.getInstance(p.algorithm).generatePublic(X509EncodedKeySpec(p.encoded))
  }

  private fun cifrar(chave: ByteArray): ByteArray =
    Cipher.getInstance(TRANSFORMACAO).apply { init(Cipher.ENCRYPT_MODE, publica(), OAEP) }.doFinal(chave)

  private fun cifraParaDecifrar(): Cipher {
    val privada = keystore().getKey(ALIAS, null) as PrivateKey
    return Cipher.getInstance(TRANSFORMACAO).apply { init(Cipher.DECRYPT_MODE, privada, OAEP) }
  }

  private fun pedir(
    atividade: AppCompatActivity,
    titulo: String,
    subtitulo: String,
    cifra: Cipher,
    invoke: Invoke,
    aoAutenticar: (Cipher) -> Unit,
  ) {
    atividade.runOnUiThread {
      val info = BiometricPrompt.PromptInfo.Builder()
        .setTitle(titulo)
        .setSubtitle(subtitulo)
        .setNegativeButtonText("Usar a senha mestra")
        .setAllowedAuthenticators(BIOMETRIC_STRONG)
        .setConfirmationRequired(false)
        .build()
      val prompt = BiometricPrompt(atividade, ContextCompat.getMainExecutor(atividade), object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
          val c = result.cryptoObject?.cipher
          if (c == null) {
            invoke.reject("A biometria não devolveu a chave.", "biometria")
            return
          }
          try {
            aoAutenticar(c)
          } catch (_: Exception) {
            invoke.reject("Não foi possível usar a chave guardada.", "biometria")
          }
        }

        override fun onAuthenticationError(codigo: Int, mensagem: CharSequence) {
          when (codigo) {
            BiometricPrompt.ERROR_NEGATIVE_BUTTON, BiometricPrompt.ERROR_USER_CANCELED, BiometricPrompt.ERROR_CANCELED ->
              invoke.reject("Cancelado.", "cancelado")
            BiometricPrompt.ERROR_LOCKOUT, BiometricPrompt.ERROR_LOCKOUT_PERMANENT ->
              invoke.reject("Demasiadas tentativas. Usa a senha mestra.", "biometria_bloqueada")
            else -> invoke.reject(mensagem.toString(), "biometria")
          }
        }
        // onAuthenticationFailed (dedo não reconhecido): o próprio diálogo deixa tentar outra vez
      })
      prompt.authenticate(info, BiometricPrompt.CryptoObject(cifra))
    }
  }

  /** Ativar: gera o par, cifra a chave e confirma com uma autenticação que tudo funciona. */
  fun ativar(atividade: AppCompatActivity, idCofre: String, chaveB64: String, invoke: Invoke) {
    indisponivel(atividade)?.let {
      invoke.reject(it, "sem_biometria")
      return
    }
    val chave = Base64.decode(chaveB64, Base64.NO_WRAP)
    try {
      gerarPar()
      val cifrado = cifrar(chave)
      pedir(atividade, "Ativar o desbloqueio com biometria", "Confirma que és tu", cifraParaDecifrar(), invoke) { c ->
        val volta = c.doFinal(cifrado)
        val igual = volta.contentEquals(chave)
        java.util.Arrays.fill(volta, 0)
        java.util.Arrays.fill(chave, 0)
        if (!igual) {
          invoke.reject("A verificação falhou. Tenta outra vez.", "biometria")
          return@pedir
        }
        gravar(atividade, hexParaBytes(idCofre), cifrado)
        invoke.resolve(JSObject())
      }
    } catch (_: Exception) {
      java.util.Arrays.fill(chave, 0)
      desativar(atividade)
      invoke.reject("Não foi possível criar a chave no Keystore deste aparelho.", "biometria")
    }
  }

  /** Depois de a chave do cofre mudar: volta a cifrá-la, sem pedir nada. */
  fun renovar(ctx: Context, idCofre: String, chaveB64: String): Boolean {
    if (ler(ctx) == null || !keystore().containsAlias(ALIAS) || chaveB64.isEmpty()) return false
    val chave = Base64.decode(chaveB64, Base64.NO_WRAP)
    return try {
      gravar(ctx, hexParaBytes(idCofre), cifrar(chave))
      true
    } catch (_: Exception) {
      desativar(ctx)
      false
    } finally {
      java.util.Arrays.fill(chave, 0)
    }
  }

  fun desbloquear(atividade: AppCompatActivity, idCofre: String, invoke: Invoke) {
    indisponivel(atividade)?.let {
      invoke.reject(it, "sem_biometria")
      return
    }
    val g = ler(atividade)
    if (g == null || !g.id.contentEquals(hexParaBytes(idCofre)) || !keystore().containsAlias(ALIAS)) {
      invoke.reject("O desbloqueio com biometria não está ativo para este cofre.", "sem_biometria")
      return
    }
    val cifra = try {
      cifraParaDecifrar()
    } catch (_: KeyPermanentlyInvalidatedException) {
      // impressão digital nova (ou biometria removida): por segurança, tem de se ativar outra vez
      desativar(atividade)
      invoke.reject("Registaste uma impressão digital nova, por isso o desbloqueio com biometria foi desligado. Entra com a senha mestra e ativa-o outra vez.", "biometria_invalidada")
      return
    } catch (_: Exception) {
      invoke.reject("Não foi possível usar a chave guardada.", "biometria")
      return
    }
    pedir(atividade, "Desbloquear o LisSecurity", "Usa a impressão digital ou o rosto", cifra, invoke) { c ->
      val chave = c.doFinal(g.cifrado)
      val o = JSObject()
      o.put("chave", Base64.encodeToString(chave, Base64.NO_WRAP))
      java.util.Arrays.fill(chave, 0)
      invoke.resolve(o)
    }
  }

  fun desativar(ctx: Context) {
    try { ficheiro(ctx).delete() } catch (_: Exception) {}
    try { keystore().deleteEntry(ALIAS) } catch (_: Exception) {}
  }
}
