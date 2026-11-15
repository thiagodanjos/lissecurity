package pt.lisfilms.lissecurity

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Sem capturas de ecrã nem pré-visualização nas apps recentes desde o primeiro frame. As
    // definições da app podem desligar isto depois (proteção contra capturas).
    if (!Diagnostico.semEcraProtegido(intent)) {
      window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
    }
    // a interface desenha-se por baixo das barras do sistema e usa as margens que o plugin lhe dá
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }
}
