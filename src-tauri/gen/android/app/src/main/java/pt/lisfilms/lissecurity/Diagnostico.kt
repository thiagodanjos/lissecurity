package pt.lisfilms.lissecurity

import android.content.Intent

/**
 * Interruptores do teste ponta-a-ponta no emulador, para isolar problemas da emulação gráfica.
 * Só existem nos APK de teste (`-PdepurarWebView=true`): nos publicados `DEPURAR_WEBVIEW` é falso
 * e estas funções devolvem sempre `false`, sejam quais forem os extras com que a app é aberta.
 */
object Diagnostico {
  /** `am start … --ez teste_sem_flag_secure true`: sem FLAG_SECURE. */
  fun semEcraProtegido(intent: Intent?): Boolean =
    BuildConfig.DEPURAR_WEBVIEW && intent?.getBooleanExtra("teste_sem_flag_secure", false) == true

  /** `am start … --ez teste_webview_software true`: a WebView desenha sem GPU. */
  fun webViewEmSoftware(intent: Intent?): Boolean =
    BuildConfig.DEPURAR_WEBVIEW && intent?.getBooleanExtra("teste_webview_software", false) == true
}
