package pt.lisfilms.lissecurity

/**
 * Chamadas diretas da Activity para o Rust (biblioteca `liblissecurity_lib.so`, já carregada
 * pela TauriActivity). Implementadas em `src-tauri/src/nativo.rs`.
 */
object Ponte {
  /** A app deixou de estar visível: o Rust bloqueia o cofre se a política o pedir. */
  @JvmStatic external fun aoSairDaApp()

  /**
   * Chamado quando o plugin carrega (no fio principal, com a biblioteca já carregada): diz ao
   * Rust qual é o fio principal do Android, onde não pode esperar por respostas da camada Kotlin.
   */
  @JvmStatic external fun registarFioPrincipal()
}
