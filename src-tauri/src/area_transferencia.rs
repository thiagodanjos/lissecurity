//! Área de transferência com exposição mínima.
//!
//! * O valor é posto diretamente pela camada nativa: um segredo copiado nunca passa pela
//!   interface web.
//! * Windows: marcado com `ExcludeClipboardContentFromMonitorProcessing`, que o tira do
//!   histórico (Win+V), da sincronização na nuvem e dos gestores de área de transferência que
//!   respeitam a convenção. Linux: dica `x-kde-passwordManagerHint`.
//! * Ao fim de N segundos limpa-se — mas SÓ se ainda lá estiver o que o LisSecurity copiou.
//!   Para comparar sem guardar o segredo, guarda-se apenas SHA-256(chave aleatória ‖ valor).
//! * Limitação: outro programa pode ler a área de transferência antes da limpeza.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use zeroize::Zeroizing;

use crate::estado::{trancar, Estado};

struct Pendente {
    id: u64,
    chave: [u8; 32],
    impressao: [u8; 32],
}

#[derive(Default)]
pub struct AreaTransferencia {
    clip: Mutex<Option<arboard::Clipboard>>,
    pendente: Mutex<Option<Pendente>>,
    contador: AtomicU64,
}

fn impressao(chave: &[u8; 32], texto: &str) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(chave);
    h.update(texto.as_bytes());
    h.finalize().into()
}

impl AreaTransferencia {
    fn com_clip<T>(&self, f: impl FnOnce(&mut arboard::Clipboard) -> Result<T, arboard::Error>) -> Result<T, String> {
        let mut g = trancar(&self.clip);
        if g.is_none() {
            *g = Some(arboard::Clipboard::new().map_err(|_| "A área de transferência do sistema não está disponível.".to_string())?);
        }
        f(g.as_mut().expect("acabada de criar")).map_err(|e| match e {
            arboard::Error::ClipboardOccupied => "Outro programa está a usar a área de transferência. Tenta outra vez.".to_string(),
            _ => "Não foi possível usar a área de transferência.".to_string(),
        })
    }

    /// Põe o texto marcado para ficar fora do histórico (Win+V), da nuvem e dos gestores de
    /// área de transferência. Se o Windows recusar as marcas de exclusão (há versões e
    /// programas de terceiros que o fazem), tenta de novo só com o texto: copiar tem de
    /// funcionar sempre.
    fn por_texto(&self, texto: &str) -> Result<(), String> {
        let com_exclusoes = self.com_clip(|c| {
            let set = c.set();
            #[cfg(windows)]
            let set = {
                use arboard::SetExtWindows;
                set.exclude_from_monitoring()
            };
            #[cfg(target_os = "linux")]
            let set = {
                use arboard::SetExtLinux;
                set.exclude_from_history()
            };
            set.text(texto)
        });
        if com_exclusoes.is_ok() {
            return Ok(());
        }
        for tentativa in 1..=3u64 {
            std::thread::sleep(Duration::from_millis(40 * tentativa));
            if self.com_clip(|c| c.set_text(texto)).is_ok() {
                return Ok(());
            }
        }
        com_exclusoes
    }

    /// Copia `texto` e agenda a limpeza ao fim de `segundos`.
    pub fn copiar(&self, app: &AppHandle, texto: &str, segundos: u32) -> Result<(), String> {
        self.por_texto(texto)?;
        let chave: [u8; 32] = lissecurity_core::aleatorio::bytes().map_err(|e| e.to_string())?;
        let id = self.contador.fetch_add(1, Ordering::SeqCst) + 1;
        *trancar(&self.pendente) = Some(Pendente { id, chave, impressao: impressao(&chave, texto) });

        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(segundos as u64));
            app.state::<Estado>().area.limpar_se_nosso(Some(id));
        });
        Ok(())
    }

    /// Limpa a área de transferência se ainda tiver o último valor copiado pela app.
    /// `id` = só se for esta cópia em concreto (uma cópia mais recente reinicia o prazo).
    pub fn limpar_se_nosso(&self, id: Option<u64>) {
        let mut pendente = trancar(&self.pendente);
        let Some(p) = pendente.as_ref() else { return };
        if id.is_some_and(|i| i != p.id) {
            return;
        }
        let (chave, esperado) = (p.chave, p.impressao);
        *pendente = None;
        drop(pendente);
        let _ = self.com_clip(|c| {
            let atual = Zeroizing::new(c.get_text().unwrap_or_default());
            if impressao(&chave, &atual) == esperado {
                c.clear()?;
            }
            Ok(())
        });
    }
}
