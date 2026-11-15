//! Desbloqueio com impressão digital ou rosto (Android).
//!
//! Não é um «sim/não» à frente da senha: a **chave do cofre** fica guardada cifrada por uma
//! chave RSA do Android Keystore (no hardware seguro do telemóvel quando existe), criada com
//! «autenticação biométrica forte obrigatória a cada uso» e invalidada se alguém registar uma
//! impressão digital nova. Só depois de a pessoa se autenticar é que o Keystore decifra a
//! chave, que vem para aqui e abre o cofre como a senha mestra o abriria.
//!
//! * Ativar pede a senha mestra (é uma alteração de segurança) e uma vez a biometria.
//! * Quando a chave do cofre roda (senha nova, recuperação, proteção, restauro), volta-se a
//!   guardar a nova sem pedir nada: cifra-se com a parte pública da chave RSA.
//! * Se a chave guardada já não abrir o cofre (outro aparelho mudou a senha e a cópia foi
//!   restaurada aqui, por exemplo), o desbloqueio biométrico desliga-se e pede-se a senha.
//! * No computador não existe (ver «Pendências» em `docs/SEGURANCA.md`).

use serde::Serialize;
use tauri::AppHandle;
use zeroize::Zeroizing;

use lissecurity_core::cofre::CofreAberto;

use crate::comandos::Desbloqueio;
use crate::estado::R;

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EstadoBiometria {
    /// esta plataforma tem desbloqueio biométrico (Android)
    suportada: bool,
    /// há biometria forte registada e utilizável neste aparelho
    disponivel: bool,
    /// está ativa para este cofre
    ativa: bool,
    motivo: Option<String>,
}

#[cfg(target_os = "android")]
mod android {
    use std::sync::atomic::Ordering;

    use tauri::{AppHandle, Manager};
    use zeroize::Zeroizing;

    use lissecurity_core::cofre::CofreAberto;
    use lissecurity_core::formato::id_do_cofre;

    use super::EstadoBiometria;
    use crate::comandos::{abrir_com_reposicao, concluir_abertura, em_segundo_plano, ocupado, Desbloqueio};
    use crate::estado::{trancar, ErroUi, Estado, R};
    use crate::nativo;

    pub fn hex(id: [u8; 16]) -> String {
        id.iter().map(|b| format!("{b:02x}")).collect()
    }

    /// O id do cofre: do cofre aberto ou, bloqueado, do cabeçalho do ficheiro (não é secreto).
    fn id_atual(app: &AppHandle) -> R<Option<String>> {
        let e = app.state::<Estado>();
        if let Some(s) = trancar(&e.sessao).as_ref() {
            return Ok(Some(hex(s.cofre.id_cofre())));
        }
        let a = trancar(&e.armazenamento);
        let Some(a) = a.as_ref() else { return Ok(None) };
        if !a.existe() {
            return Ok(None);
        }
        Ok(id_do_cofre(&a.ler()?).ok().map(hex))
    }

    pub async fn estado(app: AppHandle) -> R<EstadoBiometria> {
        em_segundo_plano(move || {
            let Some(id) = id_atual(&app)? else {
                return Ok(EstadoBiometria { suportada: true, ..Default::default() });
            };
            let n = nativo::biometria_estado(&app, &id)?;
            Ok(EstadoBiometria { suportada: true, disponivel: n.disponivel, ativa: n.ativa, motivo: n.motivo })
        })
        .await
    }

    pub async fn ativar(app: AppHandle, senha: Zeroizing<String>) -> R<()> {
        let e = app.state::<Estado>();
        let _g = e.operacao_longa.tentar().ok_or_else(ocupado)?;
        let app2 = app.clone();
        em_segundo_plano(move || {
            let estado = app2.state::<Estado>();
            // confirma a senha e copia a chave; o cofre não fica trancado durante a biometria
            let (id, chave) = {
                let g = trancar(&estado.sessao);
                let s = g.as_ref().ok_or_else(ErroUi::bloqueado)?;
                if s.via_recuperacao {
                    return Err(ErroUi::novo("nova_senha", "Define primeiro uma senha mestra nova."));
                }
                s.cofre.verificar_senha(&senha)?;
                (hex(s.cofre.id_cofre()), s.cofre.chave_do_cofre())
            };
            nativo::biometria_ativar(&app2, &id, &chave)
        })
        .await
    }

    pub async fn desativar(app: AppHandle) -> R<()> {
        em_segundo_plano(move || {
            nativo::biometria_desativar(&app);
            Ok(())
        })
        .await
    }

    pub async fn desbloquear(app: AppHandle) -> R<Desbloqueio> {
        let e = app.state::<Estado>();
        let _g = e.operacao_longa.tentar().ok_or_else(ocupado)?;
        let g0 = e.geracao();
        let app2 = app.clone();
        em_segundo_plano(move || {
            let id = id_atual(&app2)?.ok_or_else(|| ErroUi::novo("invalido", "Ainda não há cofre neste aparelho."))?;
            let chave = nativo::biometria_desbloquear(&app2, &id)?;
            match abrir_com_reposicao(&app2, |b| CofreAberto::abrir_com_chave_do_cofre(b, &chave)) {
                Ok((aberto, rep)) => {
                    app2.state::<Estado>().falhas.store(0, Ordering::SeqCst);
                    concluir_abertura(&app2, g0, aberto, false, rep)
                }
                Err(err) if err.codigo == "integridade" || err.codigo == "credencial" => {
                    // a chave guardada é de outra versão do cofre: desliga-se e pede-se a senha
                    nativo::biometria_desativar(&app2);
                    Err(ErroUi::novo(
                        "biometria_desatualizada",
                        "O cofre mudou desde que ativaste a biometria (senha nova ou cópia restaurada). Entra com a senha mestra e volta a ativá-la nas definições.",
                    ))
                }
                Err(outro) => Err(outro),
            }
        })
        .await
    }

    pub fn renovar(app: &AppHandle, cofre: &CofreAberto) {
        let _ = nativo::biometria_renovar(app, &hex(cofre.id_cofre()), &cofre.chave_do_cofre());
    }
}

#[tauri::command]
pub async fn estado_biometria(app: AppHandle) -> R<EstadoBiometria> {
    #[cfg(target_os = "android")]
    return android::estado(app).await;
    #[cfg(desktop)]
    {
        let _ = app;
        Ok(EstadoBiometria { motivo: Some("Disponível só na app para Android.".into()), ..Default::default() })
    }
}

#[tauri::command]
pub async fn ativar_biometria(app: AppHandle, senha: Zeroizing<String>) -> R<()> {
    #[cfg(target_os = "android")]
    return android::ativar(app, senha).await;
    #[cfg(desktop)]
    {
        let _ = (app, senha);
        Err(crate::estado::ErroUi::novo("invalido", "Disponível só na app para Android."))
    }
}

#[tauri::command]
pub async fn desativar_biometria(app: AppHandle) -> R<()> {
    #[cfg(target_os = "android")]
    return android::desativar(app).await;
    #[cfg(desktop)]
    {
        let _ = app;
        Ok(())
    }
}

#[tauri::command]
pub async fn desbloquear_biometria(app: AppHandle) -> R<Desbloqueio> {
    #[cfg(target_os = "android")]
    return android::desbloquear(app).await;
    #[cfg(desktop)]
    {
        let _ = app;
        Err(crate::estado::ErroUi::novo("invalido", "Disponível só na app para Android."))
    }
}

/// Depois de a chave do cofre rodar, volta a guardá-la para a biometria (se estiver ativa).
pub fn renovar(app: &AppHandle, cofre: &CofreAberto) {
    #[cfg(target_os = "android")]
    android::renovar(app, cofre);
    #[cfg(desktop)]
    let _ = (app, cofre);
}
