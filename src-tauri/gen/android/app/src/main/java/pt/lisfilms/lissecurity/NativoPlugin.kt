package pt.lisfilms.lissecurity

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.util.Base64
import android.view.View
import android.view.WindowManager
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.Executors

/*
 * A camada Android do LisSecurity.
 *
 * Só o Rust chama estes comandos (nativo.rs): o JavaScript da interface não tem permissão
 * para este plugin. Aqui não se decide nada de segurança — não se cifra, não se interpreta
 * o cofre: lê-se e escreve-se bytes que a pessoa escolheu, mexe-se na área de transferência,
 * avisa-se o Rust do ciclo de vida da app e guarda-se a chave da biometria no Keystore.
 */

@InvokeArg
class ArgsTipos {
  var tipos: List<String> = listOf("*/*")
}

@InvokeArg
class ArgsUri {
  var uri: String = ""
  var maximo: Long = 0
}

@InvokeArg
class ArgsEscrever {
  var uri: String = ""
  var dados: String = ""
}

@InvokeArg
class ArgsCriar {
  var nome: String = ""
  var mime: String = "application/octet-stream"
}

@InvokeArg
class ArgsPasta {
  var pasta: String = ""
}

@InvokeArg
class ArgsGravarNaPasta {
  var pasta: String = ""
  var nome: String = ""
  var dados: String = ""
}

@InvokeArg
class ArgsPartilhar {
  var nome: String = ""
  var dados: String = ""
}

@InvokeArg
class ArgsCopiar {
  var texto: String = ""
  var segundos: Int = 30
}

@InvokeArg
class ArgsUrl {
  var url: String = ""
}

@InvokeArg
class ArgsAtivo {
  var ativo: Boolean = true
}

@InvokeArg
class ArgsBiometria {
  var idCofre: String = ""
  var chave: String? = null
}

/** Estado partilhado com a Activity. */
object EstadoApp {
  /**
   * A app abriu ela própria outra janela do sistema (seletor de ficheiros, folha de partilha,
   * biometria): sair para essa janela não conta como «sair da app» e não bloqueia o cofre.
   */
  @Volatile var emAtividadeExterna = false
}

@TauriPlugin
class NativoPlugin(private val atividade: Activity) : Plugin(atividade) {
  private val trabalho = Executors.newSingleThreadExecutor()
  private var webView: WebView? = null
  @Volatile private var margens = JSObject()

  override fun load(webView: WebView) {
    this.webView = webView
    Ponte.registarFioPrincipal()
    if (Diagnostico.webViewEmSoftware(atividade.intent)) webView.setLayerType(View.LAYER_TYPE_SOFTWARE, null)
    // teste ponta-a-ponta: só com -PdepurarWebView=true (nunca nas compilações publicadas)
    if (BuildConfig.DEPURAR_WEBVIEW) WebView.setWebContentsDebuggingEnabled(true)
    // os ficheiros partilhados numa sessão anterior (cifrados) saem da cache
    File(atividade.cacheDir, "partilha").deleteRecursively()
    // margens do sistema → variáveis CSS (a app desenha-se por baixo das barras)
    ViewCompat.setOnApplyWindowInsetsListener(webView) { v, insets ->
      val barras = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val teclado = insets.getInsets(WindowInsetsCompat.Type.ime())
      val d = v.resources.displayMetrics.density
      val m = JSObject()
      m.put("topo", barras.top / d)
      m.put("direita", barras.right / d)
      m.put("baixo", barras.bottom / d)
      m.put("esquerda", barras.left / d)
      m.put("teclado", teclado.bottom / d)
      margens = m
      // antes de a página existir não há documento: a interface pede as margens ao arrancar
      val js = "(function(m){var d=document.documentElement;if(!d)return;var r=d.style;" +
        "r.setProperty('--sistema-topo',m.topo+'px');r.setProperty('--sistema-direita',m.direita+'px');" +
        "r.setProperty('--sistema-baixo',m.baixo+'px');r.setProperty('--sistema-esquerda',m.esquerda+'px');" +
        "r.setProperty('--sistema-teclado',m.teclado+'px');" +
        "window.dispatchEvent(new CustomEvent('lis-margens',{detail:m}));})($m)"
      v.post { webView.evaluateJavascript(js, null) }
      insets
    }
    ViewCompat.requestApplyInsets(webView)
  }

  override fun onStop(activity: AppCompatActivity) {
    if (!EstadoApp.emAtividadeExterna) Ponte.aoSairDaApp()
  }

  override fun onResume(activity: AppCompatActivity) {
    EstadoApp.emAtividadeExterna = false
    AreaTransferencia.aoVoltar(activity)
  }

  // ───────────────────────── ficheiros (Storage Access Framework) ─────────────────────────

  private fun nomeETamanho(uri: Uri): Pair<String, Long> {
    var nome = ""
    var tamanho = 0L
    try {
      atividade.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
        if (c.moveToFirst()) {
          nome = c.getString(0) ?: ""
          if (!c.isNull(1)) tamanho = c.getLong(1)
        }
      }
    } catch (_: Exception) {}
    return Pair(nome, tamanho)
  }

  private fun documento(uri: Uri): JSObject {
    val (nome, tamanho) = nomeETamanho(uri)
    val o = JSObject()
    o.put("uri", uri.toString())
    o.put("nome", nome)
    o.put("tamanho", tamanho)
    return o
  }

  @Command
  fun escolherFicheiro(invoke: Invoke) {
    val a = invoke.parseArgs(ArgsTipos::class.java)
    val i = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "*/*"
      if (a.tipos.isNotEmpty() && a.tipos != listOf("*/*")) putExtra(Intent.EXTRA_MIME_TYPES, a.tipos.toTypedArray())
    }
    EstadoApp.emAtividadeExterna = true
    startActivityForResult(invoke, i, "aoEscolherFicheiro")
  }

  @ActivityCallback
  fun aoEscolherFicheiro(invoke: Invoke, r: ActivityResult) {
    val uri = r.data?.data
    if (r.resultCode != Activity.RESULT_OK || uri == null) {
      invoke.resolve(JSObject())
      return
    }
    invoke.resolve(documento(uri))
  }

  @Command
  fun lerFicheiro(invoke: Invoke) {
    val a = invoke.parseArgs(ArgsUri::class.java)
    trabalho.execute {
      var bytes: ByteArray? = null
      try {
        val maximo = if (a.maximo > 0) a.maximo else Long.MAX_VALUE
        atividade.contentResolver.openInputStream(Uri.parse(a.uri)).use { entrada ->
          if (entrada == null) throw IllegalStateException()
          val saida = ByteArrayOutputStream()
          val bloco = ByteArray(64 * 1024)
          var total = 0L
          while (true) {
            val n = entrada.read(bloco)
            if (n < 0) break
            total += n
            if (total > maximo) {
              java.util.Arrays.fill(bloco, 0)
              invoke.reject("O ficheiro é demasiado grande (máximo ${maximo / (1024 * 1024)} MB).", "grande")
              return@execute
            }
            saida.write(bloco, 0, n)
          }
          java.util.Arrays.fill(bloco, 0)
          bytes = saida.toByteArray()
        }
        val o = JSObject()
        o.put("dados", Base64.encodeToString(bytes, Base64.NO_WRAP))
        invoke.resolve(o)
      } catch (_: SecurityException) {
        invoke.reject("A app deixou de ter acesso a este ficheiro. Escolhe-o outra vez.", "io")
      } catch (_: Exception) {
        invoke.reject("Não foi possível ler o ficheiro.", "io")
      } finally {
        bytes?.let { java.util.Arrays.fill(it, 0) }
      }
    }
  }

  private fun escreverBytes(uri: Uri, b64: String) {
    val bytes = Base64.decode(b64, Base64.NO_WRAP)
    try {
      val saida = try {
        atividade.contentResolver.openOutputStream(uri, "wt")
      } catch (_: Exception) {
        atividade.contentResolver.openOutputStream(uri, "w")
      }
      saida.use { s ->
        if (s == null) throw IllegalStateException()
        s.write(bytes)
        s.flush()
      }
    } finally {
      java.util.Arrays.fill(bytes, 0)
    }
  }

  @Command
  fun escreverFicheiro(invoke: Invoke) {
    val a = invoke.parseArgs(ArgsEscrever::class.java)
    trabalho.execute {
      try {
        escreverBytes(Uri.parse(a.uri), a.dados)
        invoke.resolve(JSObject())
      } catch (_: Exception) {
        invoke.reject("Não foi possível gravar o ficheiro.", "io")
      }
    }
  }

  @Command
  fun criarFicheiro(invoke: Invoke) {
    val a = invoke.parseArgs(ArgsCriar::class.java)
    val i = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = a.mime
      putExtra(Intent.EXTRA_TITLE, a.nome)
    }
    EstadoApp.emAtividadeExterna = true
    startActivityForResult(invoke, i, "aoCriarFicheiro")
  }

  @ActivityCallback
  fun aoCriarFicheiro(invoke: Invoke, r: ActivityResult) {
    val uri = r.data?.data
    if (r.resultCode != Activity.RESULT_OK || uri == null) {
      invoke.resolve(JSObject())
      return
    }
    invoke.resolve(documento(uri))
  }

  @Command
  fun apagarFicheiro(invoke: Invoke) {
    val a = invoke.parseArgs(ArgsUri::class.java)
    trabalho.execute {
      val ok = try {
        DocumentsContract.deleteDocument(atividade.contentResolver, Uri.parse(a.uri))
      } catch (_: Exception) {
        false
      }
      val o = JSObject()
      o.put("apagado", ok)
      invoke.resolve(o)
    }
  }

  // ───────────────────────── pasta das cópias automáticas ─────────────────────────

  @Command
  fun escolherPasta(invoke: Invoke) {
    val i = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
    }
    EstadoApp.emAtividadeExterna = true
    startActivityForResult(invoke, i, "aoEscolherPasta")
  }

  @ActivityCallback
  fun aoEscolherPasta(invoke: Invoke, r: ActivityResult) {
    val arvore = r.data?.data
    if (r.resultCode != Activity.RESULT_OK || arvore == null) {
      invoke.resolve(JSObject())
      return
    }
    try {
      atividade.contentResolver.takePersistableUriPermission(arvore, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
    } catch (_: Exception) {
      invoke.reject("Essa pasta não deixa outras apps guardarem lá ficheiros. Escolhe outra.", "io")
      return
    }
    val o = JSObject()
    o.put("uri", arvore.toString())
    o.put("nome", nomePasta(arvore))
    invoke.resolve(o)
  }

  private fun raiz(arvore: Uri): Uri = DocumentsContract.buildDocumentUriUsingTree(arvore, DocumentsContract.getTreeDocumentId(arvore))

  private fun nomePasta(arvore: Uri): String {
    return try {
      atividade.contentResolver.query(raiz(arvore), arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) c.getString(0) else null
      } ?: "Pasta escolhida"
    } catch (_: Exception) {
      "Pasta escolhida"
    }
  }

  private fun temPermissao(arvore: Uri): Boolean =
    atividade.contentResolver.persistedUriPermissions.any { it.uri == arvore && it.isWritePermission }

  @Command
  fun infoPasta(invoke: Invoke) {
    val a = invoke.parseArgs(ArgsPasta::class.java)
    val arvore = Uri.parse(a.pasta)
    val o = JSObject()
    o.put("nome", nomePasta(arvore))
    o.put("acessivel", temPermissao(arvore))
    invoke.resolve(o)
  }

  @Command
  fun listarPasta(invoke: Invoke) {
    val a = invoke.parseArgs(ArgsPasta::class.java)
    trabalho.execute {
      try {
        val arvore = Uri.parse(a.pasta)
        val filhos = DocumentsContract.buildChildDocumentsUriUsingTree(arvore, DocumentsContract.getTreeDocumentId(arvore))
        val lista = JSArray()
        atividade.contentResolver.query(
          filhos,
          arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_SIZE,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
          ),
          null, null, null,
        )?.use { c ->
          while (c.moveToNext()) {
            if (c.getString(4) == DocumentsContract.Document.MIME_TYPE_DIR) continue
            val o = JSObject()
            o.put("uri", DocumentsContract.buildDocumentUriUsingTree(arvore, c.getString(0)).toString())
            o.put("nome", c.getString(1) ?: "")
            o.put("tamanho", if (c.isNull(2)) 0 else c.getLong(2))
            o.put("modificado", if (c.isNull(3)) 0 else c.getLong(3))
            lista.put(o)
          }
        }
        val o = JSObject()
        o.put("ficheiros", lista)
        invoke.resolve(o)
      } catch (_: Exception) {
        invoke.reject("Não foi possível ver a pasta das cópias.", "io")
      }
    }
  }

  @Command
  fun gravarNaPasta(invoke: Invoke) {
    val a = invoke.parseArgs(ArgsGravarNaPasta::class.java)
    trabalho.execute {
      var criado: Uri? = null
      try {
        val arvore = Uri.parse(a.pasta)
        if (!temPermissao(arvore)) {
          invoke.reject("A app deixou de ter acesso à pasta das cópias. Escolhe-a outra vez.", "io")
          return@execute
        }
        criado = DocumentsContract.createDocument(atividade.contentResolver, raiz(arvore), "application/octet-stream", a.nome)
          ?: throw IllegalStateException()
        escreverBytes(criado, a.dados)
        invoke.resolve(documento(criado))
      } catch (_: Exception) {
        criado?.let { try { DocumentsContract.deleteDocument(atividade.contentResolver, it) } catch (_: Exception) {} }
        invoke.reject("Não foi possível gravar a cópia na pasta escolhida.", "io")
      }
    }
  }

  // ───────────────────────── partilhar ─────────────────────────

  @Command
  fun partilhar(invoke: Invoke) {
    val a = invoke.parseArgs(ArgsPartilhar::class.java)
    try {
      val pasta = File(atividade.cacheDir, "partilha").apply { mkdirs() }
      val nome = a.nome.replace(Regex("[^A-Za-z0-9._-]"), "_")
      val ficheiro = File(pasta, nome)
      val bytes = Base64.decode(a.dados, Base64.NO_WRAP)
      ficheiro.writeBytes(bytes)
      val uri = FileProvider.getUriForFile(atividade, "${atividade.packageName}.fileprovider", ficheiro)
      val envio = Intent(Intent.ACTION_SEND).apply {
        type = "application/octet-stream"
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_TITLE, nome)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      EstadoApp.emAtividadeExterna = true
      atividade.startActivity(Intent.createChooser(envio, "Guardar a cópia cifrada em…"))
      invoke.resolve(JSObject())
    } catch (_: Exception) {
      EstadoApp.emAtividadeExterna = false
      invoke.reject("Não foi possível abrir a partilha do Android.", "io")
    }
  }

  // ───────────────────────── sistema ─────────────────────────

  @Command
  fun copiar(invoke: Invoke) {
    val a = invoke.parseArgs(ArgsCopiar::class.java)
    try {
      AreaTransferencia.copiar(atividade, a.texto, a.segundos)
      invoke.resolve(JSObject())
    } catch (_: Exception) {
      invoke.reject("Não foi possível usar a área de transferência.", "sistema")
    }
  }

  @Command
  fun limparAreaTransferencia(invoke: Invoke) {
    AreaTransferencia.limparAgora(atividade)
    invoke.resolve(JSObject())
  }

  @Command
  fun abrirEndereco(invoke: Invoke) {
    val a = invoke.parseArgs(ArgsUrl::class.java)
    val uri = Uri.parse(a.url)
    if (uri.scheme != "https" && uri.scheme != "http") {
      invoke.reject("Só se abrem endereços web.", "sistema")
      return
    }
    try {
      atividade.startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
      invoke.resolve(JSObject())
    } catch (_: ActivityNotFoundException) {
      invoke.reject("Não há nenhum navegador instalado.", "sistema")
    }
  }

  @Command
  fun protecaoEcra(invoke: Invoke) {
    val a = invoke.parseArgs(ArgsAtivo::class.java)
    atividade.runOnUiThread {
      if (a.ativo && Diagnostico.semEcraProtegido(atividade.intent)) return@runOnUiThread
      if (a.ativo) atividade.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
      else atividade.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }
    invoke.resolve(JSObject())
  }

  @Command
  fun paraSegundoPlano(invoke: Invoke) {
    atividade.runOnUiThread { atividade.moveTaskToBack(true) }
    invoke.resolve(JSObject())
  }

  @Command
  fun margens(invoke: Invoke) {
    invoke.resolve(margens)
  }

  // ───────────────────────── biometria ─────────────────────────

  @Command
  fun biometriaEstado(invoke: Invoke) {
    val a = invoke.parseArgs(ArgsBiometria::class.java)
    invoke.resolve(Biometria.estado(atividade, a.idCofre))
  }

  @Command
  fun biometriaAtivar(invoke: Invoke) {
    val a = invoke.parseArgs(ArgsBiometria::class.java)
    val chave = a.chave
    if (chave.isNullOrEmpty()) {
      invoke.reject("Falta a chave.", "biometria")
      return
    }
    EstadoApp.emAtividadeExterna = true
    Biometria.ativar(atividade as AppCompatActivity, a.idCofre, chave, invoke)
  }

  @Command
  fun biometriaRenovar(invoke: Invoke) {
    val a = invoke.parseArgs(ArgsBiometria::class.java)
    val o = JSObject()
    o.put("renovada", Biometria.renovar(atividade, a.idCofre, a.chave ?: ""))
    invoke.resolve(o)
  }

  @Command
  fun biometriaDesbloquear(invoke: Invoke) {
    val a = invoke.parseArgs(ArgsBiometria::class.java)
    Biometria.desbloquear(atividade as AppCompatActivity, a.idCofre, invoke)
  }

  @Command
  fun biometriaDesativar(invoke: Invoke) {
    Biometria.desativar(atividade)
    invoke.resolve(JSObject())
  }
}
