package pt.lisfilms.lissecurity

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import android.os.SystemClock

/**
 * Área de transferência com exposição mínima, no Android:
 *
 * - o texto vai marcado como sensível (`EXTRA_IS_SENSITIVE`): o Android 13+ não o mostra na
 *   pré-visualização e os teclados que respeitam a marca não o guardam no histórico;
 * - a limpeza fica agendada duas vezes: com a app viva (Handler) e num alarme do sistema
 *   (`LimparAreaTransferencia`), que corre mesmo que o Android tenha parado a app;
 * - com a app à frente confirma-se que o conteúdo ainda é o nosso antes de limpar; em segundo
 *   plano o Android não deixa nenhuma app ler a área de transferência, por isso limpa-se sem
 *   confirmar (pode apagar algo copiado entretanto por outra app — preferível a deixar uma
 *   senha lá esquecida).
 *
 * Nunca se guarda o texto: só a hora em que deve ser limpo (em `SharedPreferences`, para o
 * alarme saber o que fazer se a app tiver sido terminada).
 */
object AreaTransferencia {
  private const val ROTULO = "LisSecurity"
  private const val PREFS = "area_transferencia"
  private const val CHAVE_ATE = "limpar_ate"
  private val principal = Handler(Looper.getMainLooper())
  @Volatile private var copia = 0L

  private fun gestor(ctx: Context) = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager

  fun copiar(ctx: Context, texto: String, segundos: Int) {
    val clip = ClipData.newPlainText(ROTULO, texto)
    clip.description.extras = PersistableBundle().apply {
      if (Build.VERSION.SDK_INT >= 33) putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true)
      else putBoolean("android.content.extra.IS_SENSITIVE", true)
    }
    gestor(ctx).setPrimaryClip(clip)
    val esta = ++copia
    val ms = segundos.coerceIn(5, 600) * 1000L
    val ate = SystemClock.elapsedRealtime() + ms
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putLong(CHAVE_ATE, ate).apply()
    principal.postDelayed({ if (esta == copia) limparSeVencido(ctx) }, ms)
    agendarAlarme(ctx, ate)
  }

  private fun agendarAlarme(ctx: Context, ate: Long) {
    val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val pi = PendingIntent.getBroadcast(
      ctx, 0, Intent(ctx, LimparAreaTransferencia::class.java),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    // janela de 1 min: não precisa da permissão de alarmes exatos e não acorda o telemóvel à toa
    am.setWindow(AlarmManager.ELAPSED_REALTIME, ate, 60_000L, pi)
  }

  /** Limpa se o prazo já passou (chamado pelo Handler, pelo alarme e ao voltar à app). */
  fun limparSeVencido(ctx: Context) {
    val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val ate = prefs.getLong(CHAVE_ATE, 0L)
    if (ate == 0L || SystemClock.elapsedRealtime() < ate) return
    prefs.edit().remove(CHAVE_ATE).apply()
    limparSeNosso(ctx)
  }

  fun aoVoltar(ctx: Context) = limparSeVencido(ctx)

  /** Com a app à frente, só limpa o que é nosso; em segundo plano não dá para confirmar. */
  private fun limparSeNosso(ctx: Context) {
    val g = gestor(ctx)
    val descricao = try { g.primaryClipDescription } catch (_: Exception) { null }
    if (descricao != null && descricao.label != ROTULO) return
    limparAgora(ctx)
  }

  fun limparAgora(ctx: Context) {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(CHAVE_ATE).apply()
    val g = gestor(ctx)
    try {
      if (Build.VERSION.SDK_INT >= 28) g.clearPrimaryClip() else g.setPrimaryClip(ClipData.newPlainText("", ""))
    } catch (_: Exception) {}
  }
}

/** O alarme da limpeza (não exportado: só o próprio sistema, a pedido da app, o chama). */
class LimparAreaTransferencia : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    AreaTransferencia.limparSeVencido(context.applicationContext)
  }
}
