//! # lissecurity-core
//!
//! Tudo o que decide a segurança do LisSecurity vive aqui, sem interface nem sistema
//! operativo, para poder ser testado e revisto isoladamente:
//!
//! * [`cripto`] — Argon2id, XChaCha20-Poly1305, HKDF, chaves que se apagam da memória.
//! * [`formato`] — o ficheiro `.lissec` (cabeçalho versionado, ranhuras de chave, dados).
//! * [`cofre`] — abrir, gravar, trocar senha, chave de recuperação.
//! * [`armazenamento`] — gravação atómica, versão anterior, trinco de instância única.
//! * [`modelo`] — registos (senhas, bancos, cartões, notas) e definições.
//! * [`vista`] — o que a interface pode ver (resumos e vistas mascaradas).
//! * [`gerador`] / [`analise`] — gerador de senhas e alertas locais.
//!
//! Ver `docs/SEGURANCA.md` na raiz do projeto para o modelo de ameaças.

#![forbid(unsafe_code)]

pub mod aleatorio;
pub mod analise;
pub mod armazenamento;
pub mod cofre;
pub mod cripto;
pub mod erro;
pub mod financas;
pub mod formato;
pub mod gerador;
pub mod importacao;
pub mod modelo;
pub mod operacoes;
pub mod recuperacao;
pub mod totp;
pub mod vista;

pub use erro::{Erro, Resultado};

/// Instante atual em milissegundos desde 1970 (UTC).
pub fn agora_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}
