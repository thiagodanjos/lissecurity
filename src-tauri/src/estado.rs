//! Estado da aplicação e sessão do cofre.
//!
//! Bloquear = largar a `Sessao` (a chave do cofre e os dados decifrados são apagados da
//! memória pelos seus `Drop`), aumentar a `geracao` e avisar a interface. Qualquer comando
//! que chegue depois encontra `sessao == None` e falha com "bloqueado"; uma operação longa que
//! tenha começado antes (p. ex. desbloquear) compara a geração e descarta o resultado.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::Instant;

use lissecurity_core::analise::CacheForca;
use lissecurity_core::armazenamento::Armazenamento;
use lissecurity_core::cofre::CofreAberto;
use lissecurity_core::modelo::{DadosCofre, Definicoes};
use lissecurity_core::{agora_ms, Erro, Resultado};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::area_transferencia::AreaTransferencia;
use crate::config::ConfigApp;

/// Um Mutex envenenado (pânico noutra thread) não deve deixar a app sem conseguir bloquear.
pub fn trancar<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

pub struct Sessao {
    pub cofre: CofreAberto,
    /// Aberto com a chave de recuperação: até definir uma senha nova, só isso é permitido.
    pub via_recuperacao: bool,
    pub cache_forca: CacheForca,
    /// Até quando vale a última confirmação da senha mestra (para revelar dados financeiros).
    pub reautenticado_ate: Option<Instant>,
}

impl Sessao {
    pub fn nova(cofre: CofreAberto, via_recuperacao: bool) -> Self {
        Sessao { cofre, via_recuperacao, cache_forca: Default::default(), reautenticado_ate: None }
    }
}

/// Estado das cópias automáticas (só em memória).
#[derive(Default)]
pub struct EstadoCopiaAuto {
    /// Número do último pedido; uma cópia agendada só corre se ainda for a mais recente.
    pub pedido: AtomicU64,
    pub ultimo_ok: Mutex<Option<i64>>,
    pub ultimo_erro: Mutex<Option<String>>,
}

pub struct Estado {
    pub sessao: Mutex<Option<Sessao>>,
    pub armazenamento: Mutex<Option<Armazenamento>>,
    pub erro_arranque: Mutex<Option<String>>,
    pub config: Mutex<ConfigApp>,
    pub caminho_config: PathBuf,
    pub caminho_cofre: Mutex<PathBuf>,
    pub geracao: AtomicU64,
    pub ultima_atividade: Mutex<Instant>,
    pub falhas: AtomicU32,
    pub area: AreaTransferencia,
    /// Serializa as operações pesadas (criar, desbloquear, trocar senha, restaurar).
    pub operacao_longa: exclusivo::Bandeira,
    pub copia_auto: EstadoCopiaAuto,
    /// Ficheiros escolhidos pela pessoa nas janelas de abrir ficheiro: só esses podem ser
    /// lidos para importar (ou apagados depois), nunca um caminho qualquer vindo da interface.
    pub escolhidos: Mutex<std::collections::HashSet<PathBuf>>,
    pub app: std::sync::OnceLock<AppHandle>,
}

/// Erro tal como chega à interface: um código para decidir o comportamento e uma mensagem em
/// português que nunca contém segredos.
#[derive(Serialize, Debug)]
pub struct ErroUi {
    pub codigo: &'static str,
    pub mensagem: String,
}

impl From<Erro> for ErroUi {
    fn from(e: Erro) -> Self {
        let codigo = match &e {
            Erro::CredencialIncorreta => "credencial",
            Erro::IntegridadeFalhou => "integridade",
            Erro::Invalido(_) => "invalido",
            Erro::EmUso => "em_uso",
            Erro::ChaveRecuperacaoMalFormada => "chave_mal_formada",
            Erro::SemRecuperacao => "sem_recuperacao",
            Erro::VersaoNaoSuportada(_) => "versao",
            Erro::FormatoInvalido | Erro::ParametrosInvalidos | Erro::Grande | Erro::Serializacao => "formato",
            Erro::Io(_) => "io",
            Erro::Aleatoriedade => "sistema",
        };
        ErroUi { codigo, mensagem: e.to_string() }
    }
}

impl ErroUi {
    pub fn bloqueado() -> Self {
        ErroUi { codigo: "bloqueado", mensagem: "O cofre está bloqueado.".into() }
    }
    pub fn novo(codigo: &'static str, mensagem: impl Into<String>) -> Self {
        ErroUi { codigo, mensagem: mensagem.into() }
    }
}

pub type R<T> = Result<T, ErroUi>;

impl Estado {
    pub fn novo(config: ConfigApp, caminho_config: PathBuf, caminho_cofre: PathBuf) -> Self {
        Estado {
            sessao: Mutex::new(None),
            armazenamento: Mutex::new(None),
            erro_arranque: Mutex::new(None),
            config: Mutex::new(config),
            caminho_config,
            caminho_cofre: Mutex::new(caminho_cofre),
            geracao: AtomicU64::new(1),
            ultima_atividade: Mutex::new(Instant::now()),
            falhas: AtomicU32::new(0),
            area: AreaTransferencia::default(),
            operacao_longa: exclusivo::Bandeira::default(),
            copia_auto: EstadoCopiaAuto::default(),
            escolhidos: Mutex::new(Default::default()),
            app: std::sync::OnceLock::new(),
        }
    }

    pub fn geracao(&self) -> u64 {
        self.geracao.load(Ordering::SeqCst)
    }

    pub fn tocar(&self) {
        *trancar(&self.ultima_atividade) = Instant::now();
    }

    pub fn inativo_ha(&self) -> std::time::Duration {
        trancar(&self.ultima_atividade).elapsed()
    }

    pub fn desbloqueado(&self) -> bool {
        trancar(&self.sessao).is_some()
    }

    /// Definições de bloqueio do cofre aberto (None se bloqueado).
    pub fn politicas(&self) -> Option<Definicoes> {
        trancar(&self.sessao).as_ref().map(|s| s.cofre.dados.definicoes.clone())
    }

    /// Acesso de leitura ao cofre aberto.
    pub fn ler<T>(&self, f: impl FnOnce(&mut Sessao) -> R<T>) -> R<T> {
        let mut g = trancar(&self.sessao);
        let s = g.as_mut().ok_or_else(ErroUi::bloqueado)?;
        if s.via_recuperacao {
            return Err(ErroUi::novo("nova_senha", "Define primeiro uma senha mestra nova."));
        }
        self.tocar();
        f(s)
    }

    /// Leitura que NÃO conta como atividade (o código 2FA atualiza-se sozinho no ecrã e não
    /// pode impedir o bloqueio por inatividade).
    pub fn ler_sem_atividade<T>(&self, f: impl FnOnce(&mut Sessao) -> R<T>) -> R<T> {
        let mut g = trancar(&self.sessao);
        let s = g.as_mut().ok_or_else(ErroUi::bloqueado)?;
        if s.via_recuperacao {
            return Err(ErroUi::novo("nova_senha", "Define primeiro uma senha mestra nova."));
        }
        f(s)
    }

    /// Alteração transacional: aplica `f` aos dados, grava (atómico + verificado) e, se algo
    /// falhar, repõe os dados como estavam. A interface nunca fica a mostrar algo que não está
    /// no disco.
    pub fn mutar<T>(&self, f: impl FnOnce(&mut DadosCofre, i64) -> Resultado<T>) -> R<T> {
        let mut g = trancar(&self.sessao);
        let s = g.as_mut().ok_or_else(ErroUi::bloqueado)?;
        if s.via_recuperacao {
            return Err(ErroUi::novo("nova_senha", "Define primeiro uma senha mestra nova."));
        }
        self.tocar();
        let copia = s.cofre.dados.clone();
        let agora = agora_ms();
        match f(&mut s.cofre.dados, agora) {
            Err(e) => {
                s.cofre.dados = copia;
                Err(e.into())
            }
            Ok(v) => match self.gravar(&mut s.cofre) {
                Ok(()) => {
                    let automatica = s.cofre.dados.copias.ativo;
                    drop(g);
                    if automatica {
                        if let Some(app) = self.app.get() {
                            crate::copias::agendar(app);
                        }
                    }
                    Ok(v)
                }
                Err(e) => {
                    s.cofre.dados = copia;
                    Err(e)
                }
            },
        }
    }

    /// Cifra e grava o cofre (versão anterior guardada, verificação antes de substituir).
    pub fn gravar(&self, cofre: &mut CofreAberto) -> R<()> {
        let a = trancar(&self.armazenamento);
        let a = a.as_ref().ok_or_else(|| ErroUi::novo("io", "O local do cofre não está disponível."))?;
        let bytes = cofre.serializar(agora_ms())?;
        a.gravar(&bytes, |b| cofre.verificar_gravado(b))?;
        Ok(())
    }
}

/// Bloqueia já. Seguro de chamar de qualquer thread e repetidamente.
///
/// A área de transferência NÃO é limpa ao bloquear (o prazo de limpeza continua a contar):
/// copiar uma senha e minimizar a janela para a colar noutro sítio é o uso normal, e com
/// "bloquear ao minimizar" ligado isso apagava o que se tinha acabado de copiar. Só se limpa
/// já ao sair da aplicação (depois disso ninguém a limparia) ou se a pessoa o pedir nas
/// definições.
pub fn bloquear(app: &AppHandle, motivo: &str) {
    let estado = app.state::<Estado>();
    let sessao = trancar(&estado.sessao).take();
    let tinha = sessao.is_some();
    let limpar_ja = motivo == "saida" || sessao.as_ref().is_some_and(|s| s.cofre.dados.definicoes.limpar_ao_bloquear);
    drop(sessao);
    estado.geracao.fetch_add(1, Ordering::SeqCst);
    if limpar_ja {
        estado.area.limpar_se_nosso(None);
    }
    if tinha {
        let _ = app.emit("lis://bloqueado", motivo);
    }
}

/// Bandeira de "operação em curso": uma segunda operação pesada pedida ao mesmo tempo (dois
/// cliques em "Desbloquear") é recusada em vez de ficar à espera numa thread do runtime.
pub mod exclusivo {
    use std::sync::atomic::{AtomicBool, Ordering};

    #[derive(Default)]
    pub struct Bandeira(AtomicBool);

    pub struct Guarda<'a>(&'a AtomicBool);

    impl Bandeira {
        pub fn tentar(&self) -> Option<Guarda<'_>> {
            self.0.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).ok().map(|_| Guarda(&self.0))
        }
    }

    impl Drop for Guarda<'_> {
        fn drop(&mut self) {
            self.0.store(false, Ordering::SeqCst);
        }
    }
}
