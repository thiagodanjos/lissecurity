//! O que muda entre o computador e o Android, com a mesma forma para os comandos.
//!
//! * **Ficheiros escolhidos pela pessoa** (CSV a importar, cópias a testar ou restaurar): no
//!   computador são caminhos; no Android, documentos do seletor do sistema (`content://…`).
//!   Em ambos, só se lê o que a pessoa escolheu nesta sessão (registado em `escolhidos`).
//! * **Cópia manual**: no computador escolhe-se a pasta e grava-se atomicamente; no Android
//!   usa-se o «Guardar como…» do sistema (que inclui o Google Drive) e relê-se para confirmar.
//! * **Endereços**: o navegador do sistema, só http/https (validado antes de chegar aqui).

use tauri::{AppHandle, Manager};
use zeroize::Zeroizing;

use crate::estado::{trancar, ErroUi, Estado, R};

/// Um ficheiro escolhido: `id` é o caminho (computador) ou o URI do documento (Android).
pub struct Escolhido {
    pub id: String,
    pub nome: String,
}

#[derive(Clone, Copy)]
pub enum Tipo {
    Csv,
    Copia,
}

fn registar(app: &AppHandle, id: &str) {
    trancar(&app.state::<Estado>().escolhidos).insert(id.to_string());
}

pub fn foi_escolhido(app: &AppHandle, id: &str) -> bool {
    trancar(&app.state::<Estado>().escolhidos).contains(id)
}

pub fn esquecer(app: &AppHandle, id: &str) {
    trancar(&app.state::<Estado>().escolhidos).remove(id);
}

// ───────────────────────────── computador ─────────────────────────────

#[cfg(desktop)]
mod imp {
    use std::path::{Path, PathBuf};

    use lissecurity_core::armazenamento;
    use tauri::AppHandle;
    use tauri_plugin_dialog::DialogExt;
    use tauri_plugin_opener::OpenerExt;
    use zeroize::Zeroizing;

    use super::{Escolhido, Tipo};
    use crate::estado::{ErroUi, R};

    fn nome_de(p: &Path) -> String {
        p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
    }

    pub fn escolher_ficheiro(app: &AppHandle, titulo: &str, tipo: Tipo) -> R<Option<Escolhido>> {
        let d = app.dialog().file().set_title(titulo);
        let d = match tipo {
            Tipo::Csv => d.add_filter("Ficheiro CSV", &["csv", "txt"]),
            Tipo::Copia => d.add_filter("Cópia do LisSecurity", &["lissec"]),
        };
        Ok(d.blocking_pick_file().and_then(|f| f.into_path().ok()).map(|p| Escolhido { nome: nome_de(&p), id: p.display().to_string() }))
    }

    pub fn ler(id: &str, maximo: u64) -> R<Zeroizing<Vec<u8>>> {
        let p = PathBuf::from(id);
        let meta = std::fs::metadata(&p).map_err(|_| ErroUi::novo("io", "O ficheiro já não existe."))?;
        if meta.len() > maximo {
            return Err(ErroUi::novo("invalido", format!("O ficheiro é demasiado grande (máximo {} MB).", maximo / (1024 * 1024))));
        }
        Ok(Zeroizing::new(std::fs::read(&p).map_err(|_| ErroUi::novo("io", "Não foi possível ler o ficheiro."))?))
    }

    pub fn apagar(id: &str) -> R<()> {
        std::fs::remove_file(id).map_err(|_| ErroUi::novo("io", "Não foi possível apagar o ficheiro."))
    }

    fn caminho_livre(pasta: &Path, base: &str) -> PathBuf {
        let mut p = pasta.join(format!("{base}.lissec"));
        let mut n = 2;
        while p.exists() {
            p = pasta.join(format!("{base}-{n}.lissec"));
            n += 1;
        }
        p
    }

    /// Escolhe a pasta (o nome do ficheiro decide-se ao gravar, para não colidir).
    pub fn escolher_destino(app: &AppHandle, _base: &str) -> R<Option<Escolhido>> {
        let Some(pasta) = app.dialog().file().set_title("Escolhe a pasta para a cópia de segurança").blocking_pick_folder() else {
            return Ok(None);
        };
        let pasta = pasta.into_path().map_err(|_| ErroUi::novo("invalido", "Pasta inválida."))?;
        Ok(Some(Escolhido { nome: nome_de(&pasta), id: pasta.display().to_string() }))
    }

    /// Grava atomicamente na pasta escolhida (relido e verificado antes de dar por concluído).
    pub fn escrever_copia(
        _app: &AppHandle,
        destino: &Escolhido,
        base: &str,
        bytes: &[u8],
        verificar: &dyn Fn(&[u8]) -> lissecurity_core::Resultado<()>,
    ) -> R<Escolhido> {
        let caminho = caminho_livre(Path::new(&destino.id), base);
        armazenamento::escrever_atomico(&caminho, bytes, verificar)?;
        Ok(Escolhido { nome: nome_de(&caminho), id: caminho.display().to_string() })
    }

    pub fn abrir_endereco(app: &AppHandle, url: &str) -> R<()> {
        app.opener().open_url(url, None::<&str>).map_err(|_| ErroUi::novo("sistema", "Não foi possível abrir o navegador."))
    }
}

// ───────────────────────────── Android ─────────────────────────────

#[cfg(target_os = "android")]
mod imp {
    use tauri::AppHandle;
    use zeroize::Zeroizing;

    use super::{Escolhido, Tipo};
    use crate::estado::{ErroUi, R};
    use crate::nativo;

    pub fn escolher_ficheiro(app: &AppHandle, _titulo: &str, tipo: Tipo) -> R<Option<Escolhido>> {
        let tipos: &[&str] = match tipo {
            // os fornecedores não concordam no tipo de um CSV (o Drive chega a dizer «Excel»)
            Tipo::Csv => &["text/csv", "text/comma-separated-values", "text/plain", "application/csv", "application/vnd.ms-excel", "application/octet-stream"],
            // um .lissec não tem tipo conhecido: aceita-se qualquer um e o núcleo valida
            Tipo::Copia => &["*/*"],
        };
        Ok(nativo::escolher_ficheiro(app, tipos)?.and_then(|d| d.uri.map(|id| Escolhido { id, nome: d.nome })))
    }

    pub fn ler(app: &AppHandle, id: &str, maximo: u64) -> R<Zeroizing<Vec<u8>>> {
        nativo::ler(app, id, maximo)
    }

    pub fn apagar(app: &AppHandle, id: &str) -> R<()> {
        if nativo::apagar(app, id)? {
            Ok(())
        } else {
            Err(ErroUi::novo("io", "O sítio onde o ficheiro está não deixa apagá-lo a partir da app. Apaga-o na app de Ficheiros."))
        }
    }

    /// «Guardar como…» do sistema (inclui o Google Drive). Cria o documento vazio.
    pub fn escolher_destino(app: &AppHandle, base: &str) -> R<Option<Escolhido>> {
        Ok(nativo::criar(app, &format!("{base}.lissec"), "application/octet-stream")?.and_then(|d| d.uri.map(|id| Escolhido { id, nome: d.nome })))
    }

    /// Escreve, relê e verifica; se alguma coisa falhar, apaga o documento (não fica uma cópia
    /// danificada com ar de boa).
    pub fn escrever_copia(
        app: &AppHandle,
        destino: &Escolhido,
        _base: &str,
        bytes: &[u8],
        verificar: &dyn Fn(&[u8]) -> lissecurity_core::Resultado<()>,
    ) -> R<Escolhido> {
        let resultado = nativo::escrever(app, &destino.id, bytes).and_then(|_| {
            let relido = nativo::ler(app, &destino.id, (bytes.len() as u64).saturating_mul(2).max(1 << 20))?;
            verificar(&relido).map_err(ErroUi::from)
        });
        if let Err(e) = resultado {
            let _ = nativo::apagar(app, &destino.id);
            return Err(e);
        }
        Ok(Escolhido { id: destino.id.clone(), nome: destino.nome.clone() })
    }

    pub fn abrir_endereco(app: &AppHandle, url: &str) -> R<()> {
        nativo::abrir_endereco(app, url)
    }
}

// ───────────────────────────── API comum ─────────────────────────────

/// Seletor de ficheiros. O escolhido fica registado: só esse pode ser lido ou apagado depois.
pub fn escolher_ficheiro(app: &AppHandle, titulo: &str, tipo: Tipo) -> R<Option<Escolhido>> {
    let e = imp::escolher_ficheiro(app, titulo, tipo)?;
    if let Some(e) = &e {
        registar(app, &e.id);
    }
    Ok(e)
}

/// Lê um ficheiro escolhido nesta sessão (até `maximo` bytes).
pub fn ler_escolhido(app: &AppHandle, id: &str, maximo: u64) -> R<Zeroizing<Vec<u8>>> {
    if !foi_escolhido(app, id) {
        return Err(ErroUi::novo("invalido", "Escolhe o ficheiro outra vez."));
    }
    #[cfg(desktop)]
    let _ = app;
    #[cfg(desktop)]
    return imp::ler(id, maximo);
    #[cfg(target_os = "android")]
    return imp::ler(app, id, maximo);
}

/// Apaga um ficheiro escolhido nesta sessão.
pub fn apagar_escolhido(app: &AppHandle, id: &str) -> R<()> {
    if !foi_escolhido(app, id) {
        return Err(ErroUi::novo("invalido", "Só se apagam ficheiros escolhidos para importar."));
    }
    #[cfg(desktop)]
    imp::apagar(id)?;
    #[cfg(target_os = "android")]
    imp::apagar(app, id)?;
    esquecer(app, id);
    Ok(())
}

/// Onde gravar uma cópia manual (pasta no computador, documento novo no Android). Não toca no
/// cofre: a pessoa pode demorar o tempo que quiser no seletor. `None` se cancelar.
pub fn escolher_destino_copia(app: &AppHandle, base: &str) -> R<Option<Escolhido>> {
    imp::escolher_destino(app, base)
}

/// Escreve a cópia no destino escolhido, relê-a e verifica-a.
pub fn escrever_copia(
    app: &AppHandle,
    destino: &Escolhido,
    base: &str,
    bytes: &[u8],
    verificar: &dyn Fn(&[u8]) -> lissecurity_core::Resultado<()>,
) -> R<Escolhido> {
    imp::escrever_copia(app, destino, base, bytes, verificar)
}

/// Abre um endereço web já validado (http/https) no navegador do sistema.
pub fn abrir_endereco(app: &AppHandle, url: &str) -> R<()> {
    imp::abrir_endereco(app, url)
}
