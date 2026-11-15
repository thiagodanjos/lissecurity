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
//!
//! **Android**: não há Google Drive «montado» como pasta. A pessoa escolhe uma pasta no seletor
//! do sistema (no telemóvel, num cartão, ou de outra app que a ofereça) e a app guarda a
//! permissão de escrita; as cópias vão para lá diretamente. Para o Google Drive há a cópia
//! manual («Guardar como…» e «Partilhar»), porque a app do Drive não oferece pastas a outras
//! apps. A pasta fica no cofre: se for de outro aparelho (um caminho do Windows num telemóvel
//! ou o contrário), as cópias automáticas param até se escolher uma pasta neste.

use std::path::Path;
#[cfg(desktop)]
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::time::Duration;

use lissecurity_core::agora_ms;
use lissecurity_core::analise::data_hora;
#[cfg(desktop)]
use lissecurity_core::armazenamento::escrever_atomico;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::estado::{trancar, ErroUi, Estado, R};

#[cfg(desktop)]
pub const SUBPASTA: &str = "LisSecurity";
pub const PREFIXO_AUTO: &str = "LisSecurity-auto-";
const ESPERA: Duration = Duration::from_secs(15);

/// A pasta guardada no cofre serve neste aparelho?
pub fn pasta_deste_aparelho(pasta: &str) -> bool {
    let p = pasta.trim();
    if cfg!(target_os = "android") {
        p.starts_with("content://")
    } else {
        !p.is_empty() && !p.starts_with("content://") && Path::new(p).is_absolute()
    }
}

/// Onde as cópias ficam, para mostrar (caminho no computador, nome da pasta no Android).
pub fn destino(app: &AppHandle, pasta: &str) -> String {
    #[cfg(target_os = "android")]
    return crate::nativo::info_pasta(app, pasta).map(|(nome, _)| nome).unwrap_or_else(|_| "Pasta escolhida".into());
    #[cfg(desktop)]
    {
        let _ = app;
        Path::new(pasta).join(SUBPASTA).display().to_string()
    }
}

/// Escolher a pasta das cópias automáticas.
pub fn escolher_pasta(app: &AppHandle, titulo: &str) -> R<Option<String>> {
    #[cfg(target_os = "android")]
    {
        let _ = titulo;
        Ok(crate::nativo::escolher_pasta(app)?.and_then(|d| d.uri))
    }
    #[cfg(desktop)]
    {
        use tauri_plugin_dialog::DialogExt;
        let p = app.dialog().file().set_title(titulo).blocking_pick_folder();
        Ok(p.and_then(|p| p.into_path().ok()).map(|p| p.display().to_string()))
    }
}

/// Confirma que se pode escrever na pasta antes de ligar as cópias automáticas.
pub fn validar_pasta(app: &AppHandle, pasta: &str) -> R<()> {
    if !pasta_deste_aparelho(pasta) {
        return Err(ErroUi::novo("invalido", "Escolhe uma pasta neste aparelho."));
    }
    #[cfg(target_os = "android")]
    {
        let (_, acessivel) = crate::nativo::info_pasta(app, pasta)?;
        if !acessivel {
            return Err(ErroUi::novo("invalido", "A app deixou de ter acesso a essa pasta. Escolhe-a outra vez."));
        }
        Ok(())
    }
    #[cfg(desktop)]
    {
        let _ = app;
        if !Path::new(pasta).is_dir() {
            return Err(ErroUi::novo("invalido", "Escolhe uma pasta que exista (por exemplo, a do Google Drive)."));
        }
        std::fs::create_dir_all(Path::new(pasta).join(SUBPASTA)).map_err(|_| ErroUi::novo("io", "Não foi possível escrever nessa pasta."))
    }
}

fn nome_automatico(agora: i64) -> String {
    let (a, m, d, h, min) = data_hora(agora);
    let seg = (agora / 1000).rem_euclid(60);
    format!("{PREFIXO_AUTO}{a:04}-{m:02}-{d:02}_{h:02}{min:02}{seg:02}")
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
        if !pasta_deste_aparelho(&cfg.pasta) {
            return Err(ErroUi::novo("invalido", "A pasta das cópias automáticas é de outro aparelho. Escolhe uma pasta aqui."));
        }
        let agora = agora_ms();
        let base = nome_automatico(agora);
        let bytes = s.cofre.serializar(agora)?;
        #[cfg(desktop)]
        let caminho = {
            let pasta = Path::new(&cfg.pasta).join(SUBPASTA);
            std::fs::create_dir_all(&pasta).map_err(|_| {
                ErroUi::novo("io", "Não foi possível criar a pasta das cópias. Confirma se o Google Drive (ou o disco) está disponível.")
            })?;
            let mut caminho = pasta.join(format!("{base}.lissec"));
            let mut n = 2;
            while caminho.exists() {
                caminho = pasta.join(format!("{base}-{n}.lissec"));
                n += 1;
            }
            escrever_atomico(&caminho, &bytes, |b| s.cofre.verificar_gravado(b))?;
            drop(g);
            podar(&pasta, cfg.manter.clamp(3, 100) as usize);
            caminho.display().to_string()
        };
        #[cfg(target_os = "android")]
        let caminho = {
            use crate::nativo;
            let doc = nativo::gravar_na_pasta(app, &cfg.pasta, &format!("{base}.lissec"), &bytes)?;
            let uri = doc.uri.clone().unwrap_or_default();
            let verificado = nativo::ler(app, &uri, (bytes.len() as u64) * 2).and_then(|b| s.cofre.verificar_gravado(&b).map_err(ErroUi::from));
            drop(g);
            if let Err(e) = verificado {
                let _ = nativo::apagar(app, &uri);
                return Err(e);
            }
            podar_android(app, &cfg.pasta, cfg.manter.clamp(3, 100) as usize);
            doc.nome
        };
        Ok(CopiaFeita { caminho, em: agora, bytes: bytes.len() })
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

/// Android: o mesmo que `podar`, na pasta escolhida no seletor.
#[cfg(target_os = "android")]
fn podar_android(app: &AppHandle, pasta: &str, manter: usize) {
    let Ok(lista) = crate::nativo::listar_pasta(app, pasta) else { return };
    let mut auto: Vec<_> = lista.into_iter().filter(|d| d.nome.starts_with(PREFIXO_AUTO) && d.nome.ends_with(".lissec")).collect();
    auto.sort_by(|a, b| b.nome.cmp(&a.nome));
    for velho in auto.into_iter().skip(manter) {
        if let Some(uri) = velho.uri {
            let _ = crate::nativo::apagar(app, &uri);
        }
    }
}

/// Apaga as cópias automáticas mais antigas, deixando `manter`. Só toca em ficheiros
/// `LisSecurity-auto-*.lissec` desta pasta.
#[cfg(desktop)]
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

/// Ficheiros `.lissec` da pasta das cópias (sem os abrir). No Android, cada um fica registado
/// como escolhido, para poder ser testado ou restaurado.
pub fn listar(app: &AppHandle, pasta: &str) -> Vec<CopiaEncontrada> {
    if !pasta_deste_aparelho(pasta) {
        return Vec::new();
    }
    #[cfg(target_os = "android")]
    {
        let Ok(lista) = crate::nativo::listar_pasta(app, pasta) else { return Vec::new() };
        let mut v: Vec<CopiaEncontrada> = lista
            .into_iter()
            .filter(|d| d.nome.ends_with(".lissec"))
            .filter_map(|d| {
                let uri = d.uri?;
                trancar(&app.state::<Estado>().escolhidos).insert(uri.clone());
                Some(CopiaEncontrada { automatica: d.nome.starts_with(PREFIXO_AUTO), caminho: uri, nome: d.nome, bytes: d.tamanho, modificado: d.modificado })
            })
            .collect();
        v.sort_by_key(|c| std::cmp::Reverse(c.modificado));
        v.truncate(300);
        v
    }
    #[cfg(desktop)]
    {
        let _ = app;
        listar_pasta(Path::new(pasta))
    }
}

#[cfg(desktop)]
fn listar_pasta(pasta: &Path) -> Vec<CopiaEncontrada> {
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
/// (No Android não há nenhuma: escolhe-se a pasta no seletor do sistema.)
#[cfg(mobile)]
pub fn pastas_nuvem() -> Vec<PastaNuvem> {
    Vec::new()
}

#[cfg(desktop)]
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
