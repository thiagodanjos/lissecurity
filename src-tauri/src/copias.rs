//! Cópias de segurança automáticas para uma pasta — pensado para a pasta do **Google Drive
//! para computador** (ou OneDrive/Dropbox), que a sincroniza com a nuvem.
//!
//! Porquê uma pasta sincronizada e não a API do Google: a app continua sem internet e sem
//! guardar nenhum token da conta Google; quem envia o ficheiro é o programa do Google Drive.
//! O que chega ao Drive é o mesmo ficheiro `.lissec` cifrado — sem a senha mestra (ou a chave
//! de recuperação) não se lê, e só o LisSecurity o sabe abrir.
//!
//! * Depois de cada alteração, espera 15 s sem alterações novas e grava
//!   `LisSecurity/LisSecurity-auto-AAAA-MM-DD_HHMMSS.lissec` (atómico, relido e decifrado).
//! * Mantém as N mais recentes; as cópias manuais nunca são apagadas.

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::Duration;

use lissecurity_core::agora_ms;
use lissecurity_core::analise::data_hora;
use lissecurity_core::armazenamento::escrever_atomico;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::estado::{trancar, ErroUi, Estado, R};

pub const SUBPASTA: &str = "LisSecurity";
pub const PREFIXO_AUTO: &str = "LisSecurity-auto-";
const ESPERA: Duration = Duration::from_secs(15);

pub fn destino(pasta: &str) -> PathBuf {
    Path::new(pasta).join(SUBPASTA)
}

/// Pede uma cópia automática; várias alterações seguidas dão uma só cópia.
pub fn agendar(app: &AppHandle) {
    let estado = app.state::<Estado>();
    let n = estado.copia_auto.pedido.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(ESPERA);
        let estado = app.state::<Estado>();
        if estado.copia_auto.pedido.load(Ordering::SeqCst) != n {
            return; // há um pedido mais recente
        }
        let _ = fazer(&app);
    });
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CopiaFeita {
    pub caminho: String,
    pub em: i64,
    pub bytes: usize,
}

/// Grava já uma cópia automática (com o cofre aberto) e apaga as antigas a mais.
pub fn fazer(app: &AppHandle) -> R<CopiaFeita> {
    let estado = app.state::<Estado>();
    let resultado = (|| {
        let mut g = trancar(&estado.sessao);
        let s = g.as_mut().ok_or_else(ErroUi::bloqueado)?;
        let cfg = s.cofre.dados.copias.clone();
        if cfg.pasta.trim().is_empty() {
            return Err(ErroUi::novo("invalido", "Escolhe primeiro a pasta das cópias automáticas."));
        }
        let pasta = destino(&cfg.pasta);
        std::fs::create_dir_all(&pasta).map_err(|_| {
            ErroUi::novo("io", "Não foi possível criar a pasta das cópias. Confirma se o Google Drive (ou o disco) está disponível.")
        })?;
        let agora = agora_ms();
        let (a, m, d, h, min) = data_hora(agora);
        let seg = (agora / 1000).rem_euclid(60);
        let base = format!("{PREFIXO_AUTO}{a:04}-{m:02}-{d:02}_{h:02}{min:02}{seg:02}");
        let mut caminho = pasta.join(format!("{base}.lissec"));
        let mut n = 2;
        while caminho.exists() {
            caminho = pasta.join(format!("{base}-{n}.lissec"));
            n += 1;
        }
        let bytes = s.cofre.serializar(agora)?;
        escrever_atomico(&caminho, &bytes, |b| s.cofre.verificar_gravado(b))?;
        drop(g);
        podar(&pasta, cfg.manter.clamp(3, 100) as usize);
        Ok(CopiaFeita { caminho: caminho.display().to_string(), em: agora, bytes: bytes.len() })
    })();
    match &resultado {
        Ok(c) => {
            *trancar(&estado.copia_auto.ultimo_ok) = Some(c.em);
            *trancar(&estado.copia_auto.ultimo_erro) = None;
            let _ = app.emit("lis://copia", true);
        }
        Err(e) if e.codigo != "bloqueado" => {
            *trancar(&estado.copia_auto.ultimo_erro) = Some(e.mensagem.clone());
            let _ = app.emit("lis://copia", false);
        }
        Err(_) => {}
    }
    resultado
}

/// Apaga as cópias automáticas mais antigas, deixando `manter`. Só toca em ficheiros
/// `LisSecurity-auto-*.lissec` desta pasta.
fn podar(pasta: &Path, manter: usize) {
    let Ok(entradas) = std::fs::read_dir(pasta) else { return };
    let mut auto: Vec<PathBuf> = entradas
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            let nome = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            nome.starts_with(PREFIXO_AUTO) && nome.ends_with(".lissec") && p.is_file()
        })
        .collect();
    auto.sort();
    auto.reverse();
    for velho in auto.into_iter().skip(manter) {
        let _ = std::fs::remove_file(velho);
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CopiaEncontrada {
    pub caminho: String,
    pub nome: String,
    pub bytes: u64,
    pub modificado: i64,
    pub automatica: bool,
}

/// Ficheiros `.lissec` numa pasta e na subpasta `LisSecurity` (sem os abrir).
pub fn listar(pasta: &Path) -> Vec<CopiaEncontrada> {
    let mut v = Vec::new();
    for p in [pasta.to_path_buf(), pasta.join(SUBPASTA)] {
        let Ok(entradas) = std::fs::read_dir(&p) else { continue };
        for e in entradas.flatten() {
            let caminho = e.path();
            let nome = e.file_name().to_string_lossy().to_string();
            if !nome.ends_with(".lissec") || !caminho.is_file() {
                continue;
            }
            let meta = e.metadata().ok();
            let modificado = meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            v.push(CopiaEncontrada {
                caminho: caminho.display().to_string(),
                automatica: nome.starts_with(PREFIXO_AUTO),
                nome,
                bytes: meta.map(|m| m.len()).unwrap_or(0),
                modificado,
            });
        }
    }
    v.sort_by_key(|c| std::cmp::Reverse(c.modificado));
    v.truncate(300);
    v
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PastaNuvem {
    pub servico: String,
    pub caminho: String,
}

/// Procura as pastas do Google Drive para computador, OneDrive, Dropbox e iCloud.
pub fn pastas_nuvem() -> Vec<PastaNuvem> {
    let mut v: Vec<PastaNuvem> = Vec::new();
    let mut juntar = |servico: &str, p: PathBuf| {
        if p.is_dir() && !v.iter().any(|x| Path::new(&x.caminho) == p) {
            v.push(PastaNuvem { servico: servico.into(), caminho: p.display().to_string() });
        }
    };
    let casa = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from);
    // Google Drive para computador monta uma unidade (normalmente G:) com "O meu disco"
    #[cfg(windows)]
    for letra in b'D'..=b'Z' {
        let raiz = PathBuf::from(format!("{}:\\", letra as char));
        for nome in ["O meu disco", "Meu Drive", "My Drive", "Mi unidad", "Mon Drive"] {
            juntar("Google Drive", raiz.join(nome));
        }
    }
    if let Some(casa) = &casa {
        for nome in
            ["Google Drive/O meu disco", "Google Drive/Meu Drive", "Google Drive/My Drive", "Google Drive", "GoogleDrive", "My Drive"]
        {
            juntar("Google Drive", casa.join(nome));
        }
        juntar("Dropbox", casa.join("Dropbox"));
        juntar("iCloud Drive", casa.join("iCloudDrive"));
    }
    for var in ["OneDrive", "OneDriveConsumer"] {
        if let Some(p) = std::env::var_os(var) {
            juntar("OneDrive", PathBuf::from(p));
        }
    }
    if let Some(casa) = &casa {
        juntar("OneDrive", casa.join("OneDrive"));
    }
    v
}
