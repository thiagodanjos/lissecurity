//! Os únicos pontos de entrada da interface para a camada nativa. Não há comandos genéricos
//! (nada de "ler ficheiro", "executar", "abrir URL qualquer"): cada comando faz uma operação
//! do cofre concreta, valida os argumentos e devolve só o necessário para o ecrã atual.

use std::path::{Path, PathBuf};
use std::time::Duration;

use lissecurity_core::analise::{self, Forca};
use lissecurity_core::armazenamento::{self, ler_limitado};
use lissecurity_core::cofre::{validar_senha_nova, Aberto, CofreAberto};
use lissecurity_core::cripto;
use lissecurity_core::gerador::{self, OpcoesFrase, OpcoesSenha};
use lissecurity_core::modelo::{Conteudo, Definicoes, Item, PreferenciasGerador};
use lissecurity_core::vista::{self, Consulta, Contagem, Resumo, VisaoGeral};
use lissecurity_core::{agora_ms, Erro};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use zeroize::Zeroizing;

use crate::config::ConfigApp;
use crate::estado::{bloquear, trancar, ErroUi, Estado, Sessao, R};

/// Quanto deve demorar a derivação da senha mestra neste computador.
const ALVO_KDF: Duration = Duration::from_millis(750);

fn ocupado() -> ErroUi {
    ErroUi::novo("ocupado", "Já há uma operação do cofre em curso. Aguarda um momento.")
}

async fn em_segundo_plano<T: Send + 'static>(f: impl FnOnce() -> R<T> + Send + 'static) -> R<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|_| ErroUi::novo("sistema", "A operação foi interrompida."))?
}

fn data_ficheiro(ms: i64) -> String {
    let (a, m, d, h, min) = analise::data_hora(ms);
    format!("{a:04}-{m:02}-{d:02}_{h:02}{min:02}")
}

// ───────────────────────────── estado e janela ─────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EstadoApp {
    existe_cofre: bool,
    desbloqueado: bool,
    via_recuperacao: bool,
    erro_arranque: Option<String>,
    config: ConfigApp,
    versao: String,
    caminho_cofre: String,
    geracao: u64,
    /// política de bloqueio ao minimizar (para a interface esconder tudo ANTES de minimizar)
    bloquear_ao_minimizar: bool,
}

#[tauri::command]
pub async fn estado_app(app: AppHandle) -> R<EstadoApp> {
    let e = app.state::<Estado>();
    let existe_cofre = trancar(&e.armazenamento).as_ref().is_some_and(|a| a.existe());
    let (desbloqueado, via_recuperacao, bloquear_ao_minimizar) = match trancar(&e.sessao).as_ref() {
        Some(s) => (true, s.via_recuperacao, s.cofre.dados.definicoes.bloquear_ao_minimizar),
        None => (false, false, true),
    };
    let erro_arranque = trancar(&e.erro_arranque).clone();
    let config = trancar(&e.config).clone();
    let caminho_cofre = trancar(&e.caminho_cofre).display().to_string();
    Ok(EstadoApp {
        existe_cofre,
        desbloqueado,
        via_recuperacao,
        erro_arranque,
        config,
        versao: app.package_info().version.to_string(),
        caminho_cofre,
        geracao: e.geracao(),
        bloquear_ao_minimizar,
    })
}

#[tauri::command]
pub async fn janela_pronta(janela: WebviewWindow) -> R<()> {
    let _ = janela.show();
    let _ = janela.set_focus();
    Ok(())
}

#[tauri::command]
pub async fn janela_minimizar(app: AppHandle, janela: WebviewWindow) -> R<()> {
    if app.state::<Estado>().politicas().is_some_and(|d| d.bloquear_ao_minimizar) {
        bloquear(&app, "minimizar");
    }
    let _ = janela.minimize();
    Ok(())
}

#[tauri::command]
pub async fn janela_alternar_maximizar(janela: WebviewWindow) -> R<bool> {
    let max = janela.is_maximized().unwrap_or(false);
    let _ = if max { janela.unmaximize() } else { janela.maximize() };
    Ok(!max)
}

#[tauri::command]
pub async fn janela_maximizada(janela: WebviewWindow) -> R<bool> {
    Ok(janela.is_maximized().unwrap_or(false))
}

#[tauri::command]
pub async fn janela_fechar(janela: WebviewWindow) -> R<()> {
    let _ = janela.close();
    Ok(())
}

// ───────────────────────────── criar, abrir, bloquear ─────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Desbloqueio {
    /// o ficheiro principal estava danificado e abriu-se a versão anterior
    recuperado_anterior: bool,
    removidos_do_lixo: usize,
}

fn instalar(app: &AppHandle, geracao_inicial: u64, cofre: CofreAberto, via_recuperacao: bool) -> R<()> {
    let e = app.state::<Estado>();
    let mut s = trancar(&e.sessao);
    if e.geracao() != geracao_inicial {
        // bloqueado enquanto a operação corria: o resultado é descartado
        return Err(ErroUi::bloqueado());
    }
    *s = Some(Sessao::nova(cofre, via_recuperacao));
    e.geracao.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    e.tocar();
    Ok(())
}

#[tauri::command]
pub async fn criar_cofre(
    app: AppHandle,
    senha: Zeroizing<String>,
    nome: String,
    bloqueio_minutos: u32,
    com_recuperacao: bool,
) -> R<Option<String>> {
    let e = app.state::<Estado>();
    let _g = e.operacao_longa.tentar().ok_or_else(ocupado)?;
    if trancar(&e.armazenamento).as_ref().is_none_or(|a| a.existe()) {
        return Err(ErroUi::novo("invalido", "Já existe um cofre neste computador."));
    }
    validar_senha_nova(&senha)?;
    let g0 = e.geracao();
    let app2 = app.clone();
    em_segundo_plano(move || {
        let params = cripto::calibrar(ALVO_KDF)?;
        let (mut cofre, recuperacao) = CofreAberto::criar_completo(&senha, params, &nome, agora_ms(), com_recuperacao)?;
        cofre.dados.definicoes.bloqueio_minutos = bloqueio_minutos.clamp(1, 240);
        let estado = app2.state::<Estado>();
        estado.gravar(&mut cofre)?;
        instalar(&app2, g0, cofre, false)?;
        Ok(recuperacao.map(|t| t.to_string()))
    })
    .await
}

fn abrir_com_reposicao(app: &AppHandle, abrir: impl Fn(&[u8]) -> Result<Aberto, Erro>) -> R<(Aberto, bool)> {
    let e = app.state::<Estado>();
    let a = trancar(&e.armazenamento);
    let a = a.as_ref().ok_or_else(|| ErroUi::novo("io", "O local do cofre não está disponível."))?;
    match abrir(&a.ler()?) {
        Ok(x) => Ok((x, false)),
        Err(Erro::IntegridadeFalhou | Erro::FormatoInvalido | Erro::Serializacao) => {
            // o principal está danificado: tenta a versão anterior com a mesma credencial
            let anterior = a.ler_anterior()?.ok_or_else(|| ErroUi::from(Erro::IntegridadeFalhou))?;
            let x = abrir(&anterior).map_err(|_| ErroUi::from(Erro::IntegridadeFalhou))?;
            a.repor_anterior(&format!("danificado-{}", data_ficheiro(agora_ms())), |b| x.cofre.verificar_gravado(b))?;
            Ok((x, true))
        }
        Err(outro) => Err(outro.into()),
    }
}

fn concluir_abertura(app: &AppHandle, g0: u64, aberto: Aberto, via_recuperacao: bool, recuperado_anterior: bool) -> R<Desbloqueio> {
    let e = app.state::<Estado>();
    let Aberto { mut cofre, migrado } = aberto;
    let removidos = cofre.dados.limpar_lixo_antigo(agora_ms());
    if migrado {
        if let Some(a) = trancar(&e.armazenamento).as_ref() {
            a.guardar_copia_local(&format!("antes-da-migracao-{}", data_ficheiro(agora_ms())))?;
        }
    }
    if migrado || removidos > 0 {
        e.gravar(&mut cofre)?;
    }
    instalar(app, g0, cofre, via_recuperacao)?;
    Ok(Desbloqueio { recuperado_anterior, removidos_do_lixo: removidos })
}

#[tauri::command]
pub async fn desbloquear(app: AppHandle, senha: Zeroizing<String>) -> R<Desbloqueio> {
    let e = app.state::<Estado>();
    let _g = e.operacao_longa.tentar().ok_or_else(ocupado)?;
    let g0 = e.geracao();
    let app2 = app.clone();
    em_segundo_plano(move || {
        let estado = app2.state::<Estado>();
        // Atraso crescente depois de 5 falhas seguidas (só trava tentativas à mão nesta app;
        // contra quem copia o ficheiro, a proteção é o custo do Argon2id).
        let falhas = estado.falhas.load(std::sync::atomic::Ordering::SeqCst);
        if falhas >= 5 {
            std::thread::sleep(Duration::from_secs(2u64.pow((falhas - 5).min(5)).min(30)));
        }
        match abrir_com_reposicao(&app2, |b| CofreAberto::abrir_com_senha(b, &senha)) {
            Ok((aberto, rep)) => {
                estado.falhas.store(0, std::sync::atomic::Ordering::SeqCst);
                concluir_abertura(&app2, g0, aberto, false, rep)
            }
            Err(err) => {
                if err.codigo == "credencial" {
                    estado.falhas.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                }
                Err(err)
            }
        }
    })
    .await
}

#[tauri::command]
pub async fn desbloquear_recuperacao(app: AppHandle, chave: Zeroizing<String>) -> R<Desbloqueio> {
    let e = app.state::<Estado>();
    let _g = e.operacao_longa.tentar().ok_or_else(ocupado)?;
    let g0 = e.geracao();
    let app2 = app.clone();
    em_segundo_plano(move || {
        let (aberto, rep) = abrir_com_reposicao(&app2, |b| CofreAberto::abrir_com_recuperacao(b, &chave))?;
        concluir_abertura(&app2, g0, aberto, true, rep)
    })
    .await
}

#[tauri::command]
pub async fn bloquear_cofre(app: AppHandle, motivo: Option<String>) -> R<()> {
    let m = match motivo.as_deref() {
        Some("atalho") => "atalho",
        _ => "manual",
    };
    bloquear(&app, m);
    Ok(())
}

#[tauri::command]
pub async fn registar_atividade(app: AppHandle) -> R<()> {
    let e = app.state::<Estado>();
    if e.desbloqueado() {
        e.tocar();
    }
    Ok(())
}

// ───────────────────────────── senha mestra e recuperação ─────────────────────────────

/// Troca a senha mestra. `atual` é obrigatória, exceto logo depois de abrir com a chave de
/// recuperação. Devolve a nova chave de recuperação, se o cofre tinha uma.
#[tauri::command]
pub async fn alterar_senha(app: AppHandle, atual: Option<Zeroizing<String>>, nova: Zeroizing<String>) -> R<Option<String>> {
    let e = app.state::<Estado>();
    let _g = e.operacao_longa.tentar().ok_or_else(ocupado)?;
    validar_senha_nova(&nova)?;
    let app2 = app.clone();
    em_segundo_plano(move || {
        let estado = app2.state::<Estado>();
        let mut g = trancar(&estado.sessao);
        let s = g.as_mut().ok_or_else(ErroUi::bloqueado)?;
        if !s.via_recuperacao {
            let atual = atual.ok_or_else(|| ErroUi::novo("credencial", "Escreve a senha mestra atual."))?;
            s.cofre.verificar_senha(&atual)?;
        }
        let params = cripto::calibrar(ALVO_KDF)?;
        let (mut novo, recuperacao) = s.cofre.com_nova_senha(&nova, params)?;
        estado.gravar(&mut novo)?;
        s.cofre = novo;
        s.via_recuperacao = false;
        estado.tocar();
        Ok(recuperacao.map(|t| t.to_string()))
    })
    .await
}

#[tauri::command]
pub async fn ativar_recuperacao(app: AppHandle, senha: Zeroizing<String>) -> R<String> {
    let e = app.state::<Estado>();
    let _g = e.operacao_longa.tentar().ok_or_else(ocupado)?;
    let app2 = app.clone();
    em_segundo_plano(move || {
        let estado = app2.state::<Estado>();
        let mut g = trancar(&estado.sessao);
        let s = g.as_mut().ok_or_else(ErroUi::bloqueado)?;
        let (mut novo, texto) = s.cofre.com_recuperacao_nova(&senha)?;
        estado.gravar(&mut novo)?;
        s.cofre = novo;
        Ok(texto.to_string())
    })
    .await
}

#[tauri::command]
pub async fn desativar_recuperacao(app: AppHandle, senha: Zeroizing<String>) -> R<()> {
    let e = app.state::<Estado>();
    let _g = e.operacao_longa.tentar().ok_or_else(ocupado)?;
    let app2 = app.clone();
    em_segundo_plano(move || {
        let estado = app2.state::<Estado>();
        let mut g = trancar(&estado.sessao);
        let s = g.as_mut().ok_or_else(ErroUi::bloqueado)?;
        let mut novo = s.cofre.sem_recuperacao(&senha)?;
        estado.gravar(&mut novo)?;
        s.cofre = novo;
        Ok(())
    })
    .await
}

// ───────────────────────────── leitura ─────────────────────────────

#[tauri::command]
pub async fn visao_geral(app: AppHandle) -> R<VisaoGeral> {
    app.state::<Estado>().ler(|s| {
        let rel = analise::analisar(&s.cofre.dados, agora_ms(), &mut s.cache_forca);
        Ok(vista::visao_geral(&s.cofre.dados, &rel))
    })
}

#[tauri::command]
pub async fn listar(app: AppHandle, consulta: Consulta) -> R<Vec<Resumo>> {
    app.state::<Estado>().ler(|s| Ok(vista::pesquisar(&s.cofre.dados, &consulta)))
}

#[derive(Serialize)]
pub struct Agrupamentos {
    categorias: Vec<Contagem>,
    etiquetas: Vec<Contagem>,
}

#[tauri::command]
pub async fn agrupamentos(app: AppHandle, tipo: String) -> R<Agrupamentos> {
    app.state::<Estado>().ler(|s| {
        let (categorias, etiquetas) = vista::agrupamentos(&s.cofre.dados, &tipo);
        Ok(Agrupamentos { categorias, etiquetas })
    })
}

fn registo<'a>(s: &'a Sessao, id: &str) -> R<&'a Item> {
    s.cofre.dados.item(id).ok_or_else(|| ErroUi::novo("invalido", "O registo já não existe."))
}

/// Detalhe mascarado (sem segredos).
#[tauri::command]
pub async fn obter_item(app: AppHandle, id: String) -> R<Value> {
    app.state::<Estado>().ler(|s| Ok(vista::vista(registo(s, &id)?, &s.cofre.dados)))
}

/// Registo completo para o formulário de edição — o único comando que devolve todos os
/// segredos de um registo, e só quando a pessoa pede para editar.
#[tauri::command]
pub async fn obter_item_edicao(app: AppHandle, id: String) -> R<Item> {
    app.state::<Estado>().ler(|s| {
        let i = registo(s, &id)?;
        if i.no_lixo() {
            return Err(ErroUi::novo("invalido", "Restaura o registo do lixo antes de o editar."));
        }
        Ok(i.clone())
    })
}

/// Números de cartão/conta, IBAN, identificadores de acesso e chaves Pix.
fn campo_financeiro(campo: &str) -> bool {
    matches!(campo, "numero" | "iban" | "numeroConta" | "idAcesso") || campo.starts_with("pix:")
}

const VALIDADE_REAUTENTICACAO: Duration = Duration::from_secs(5 * 60);

/// Com a opção "pedir a senha para dados financeiros", recusa até a pessoa confirmar a
/// senha mestra (vale 5 minutos e acaba ao bloquear).
fn exigir_reautenticacao(s: &Sessao, campo: &str) -> R<()> {
    if s.cofre.dados.definicoes.reautenticar_financeiro
        && campo_financeiro(campo)
        && s.reautenticado_ate.is_none_or(|t| std::time::Instant::now() > t)
    {
        return Err(ErroUi::novo("reautenticar", "Confirma com a senha mestra para ver este dado."));
    }
    Ok(())
}

#[tauri::command]
pub async fn reautenticar(app: AppHandle, senha: Zeroizing<String>) -> R<()> {
    let app2 = app.clone();
    em_segundo_plano(move || {
        let estado = app2.state::<Estado>();
        let mut g = trancar(&estado.sessao);
        let s = g.as_mut().ok_or_else(ErroUi::bloqueado)?;
        s.cofre.verificar_senha(&senha)?;
        s.reautenticado_ate = Some(std::time::Instant::now() + VALIDADE_REAUTENTICACAO);
        estado.tocar();
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn revelar_campo(app: AppHandle, id: String, campo: String) -> R<String> {
    app.state::<Estado>().ler(|s| {
        exigir_reautenticacao(s, &campo)?;
        registo(s, &id)?.valor_campo(&campo).map(String::from).ok_or_else(|| ErroUi::novo("invalido", "Campo desconhecido."))
    })
}

#[tauri::command]
pub async fn copiar_campo(app: AppHandle, id: String, campo: String) -> R<u32> {
    let e = app.state::<Estado>();
    e.ler(|s| {
        exigir_reautenticacao(s, &campo)?;
        let segundos = s.cofre.dados.definicoes.limpar_copia_segundos;
        let v = registo(s, &id)?.valor_campo(&campo).ok_or_else(|| ErroUi::novo("invalido", "Campo desconhecido."))?;
        if v.is_empty() {
            return Err(ErroUi::novo("invalido", "O campo está vazio."));
        }
        e.area.copiar(&app, v, segundos).map_err(|m| ErroUi::novo("sistema", m))?;
        Ok(segundos)
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodigoTotp {
    codigo: String,
    restante: u64,
    periodo: u64,
    emissor: Option<String>,
}

fn totp_de(s: &Sessao, id: &str) -> R<lissecurity_core::totp::Totp> {
    match &registo(s, id)?.conteudo {
        Conteudo::Login(l) if !l.totp.is_empty() => Ok(lissecurity_core::totp::Totp::ler(&l.totp)?),
        _ => Err(ErroUi::novo("invalido", "Este registo não tem verificação em 2 passos.")),
    }
}

fn segundos_agora() -> u64 {
    (agora_ms() / 1000).max(0) as u64
}

/// Código 2FA do momento. Não conta como atividade (a interface pede-o sozinha a cada
/// mudança de período e isso não pode impedir o bloqueio por inatividade).
#[tauri::command]
pub async fn codigo_totp(app: AppHandle, id: String) -> R<CodigoTotp> {
    app.state::<Estado>().ler_sem_atividade(|s| {
        let t = totp_de(s, &id)?;
        let agora = segundos_agora();
        Ok(CodigoTotp { codigo: t.codigo(agora), restante: t.restante(agora), periodo: t.periodo, emissor: t.emissor.clone() })
    })
}

#[tauri::command]
pub async fn copiar_codigo_totp(app: AppHandle, id: String) -> R<u32> {
    let e = app.state::<Estado>();
    e.ler(|s| {
        let t = totp_de(s, &id)?;
        let codigo = Zeroizing::new(t.codigo(segundos_agora()));
        let segundos = s.cofre.dados.definicoes.limpar_copia_segundos;
        e.area.copiar(&app, &codigo, segundos).map_err(|m| ErroUi::novo("sistema", m))?;
        Ok(segundos)
    })
}

/// Volta a cifrar o cofre com um custo maior (ou menor) do Argon2id.
/// normal ≈ 0,75 s · forte ≈ 1,5 s · maxima ≈ 3 s com 256 MiB.
#[tauri::command]
pub async fn reforcar_protecao(app: AppHandle, senha: Zeroizing<String>, nivel: String) -> R<Option<String>> {
    let e = app.state::<Estado>();
    let _g = e.operacao_longa.tentar().ok_or_else(ocupado)?;
    let (alvo, memoria) = match nivel.as_str() {
        "normal" => (Duration::from_millis(750), 128 * 1024),
        "forte" => (Duration::from_millis(1500), 128 * 1024),
        "maxima" => (Duration::from_millis(3000), 256 * 1024),
        _ => return Err(ErroUi::novo("invalido", "Nível desconhecido.")),
    };
    let app2 = app.clone();
    em_segundo_plano(move || {
        let estado = app2.state::<Estado>();
        let mut g = trancar(&estado.sessao);
        let s = g.as_mut().ok_or_else(ErroUi::bloqueado)?;
        s.cofre.verificar_senha(&senha)?;
        let params = cripto::calibrar_com(alvo, memoria)?;
        let (mut novo, recuperacao) = s.cofre.com_novos_parametros(&senha, params)?;
        estado.gravar(&mut novo)?;
        s.cofre = novo;
        estado.tocar();
        Ok(recuperacao.map(|t| t.to_string()))
    })
    .await
}

#[tauri::command]
pub async fn guardar_gerador(app: AppHandle, preferencias: PreferenciasGerador) -> R<()> {
    preferencias.validar()?;
    app.state::<Estado>().mutar(move |d, _| {
        d.gerador = preferencias;
        Ok(())
    })
}

/// Copia um valor que a interface já tem (p. ex. uma senha acabada de gerar).
#[tauri::command]
pub async fn copiar_texto(app: AppHandle, texto: Zeroizing<String>) -> R<u32> {
    let e = app.state::<Estado>();
    let segundos = e.politicas().map(|d| d.limpar_copia_segundos).unwrap_or(30);
    if texto.is_empty() || texto.len() > 10_000 {
        return Err(ErroUi::novo("invalido", "Nada para copiar."));
    }
    e.area.copiar(&app, &texto, segundos).map_err(|m| ErroUi::novo("sistema", m))?;
    Ok(segundos)
}

/// Só endereços web (http/https). Sem esquema, assume-se https. Nada de file:, javascript:…
fn endereco_seguro(url: &str) -> Option<String> {
    let u = url.trim();
    if u.is_empty() || u.len() > 2000 || u.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return None;
    }
    let com_esquema = if u.contains("://") {
        u.to_string()
    } else {
        // "algo:resto" sem "//" é um esquema (javascript:, mailto:, ms-settings:…), exceto
        // quando o que vem depois dos dois pontos é uma porta ("router.local:8080").
        if let Some((_, depois)) = u.split_once(':') {
            if !depois.starts_with(|c: char| c.is_ascii_digit()) {
                return None;
            }
        }
        format!("https://{u}")
    };
    let minusculo = com_esquema.to_ascii_lowercase();
    if !(minusculo.starts_with("https://") || minusculo.starts_with("http://")) {
        return None;
    }
    vista::dominio(&com_esquema)?;
    Some(com_esquema)
}

#[tauri::command]
pub async fn abrir_endereco(app: AppHandle, id: String) -> R<()> {
    let url = app.state::<Estado>().ler(|s| match &registo(s, &id)?.conteudo {
        Conteudo::Login(l) => Ok(l.url.clone()),
        _ => Err(ErroUi::novo("invalido", "Este registo não tem endereço.")),
    })?;
    let url = endereco_seguro(&url).ok_or_else(|| ErroUi::novo("invalido", "Só se abrem endereços web (http ou https)."))?;
    app.opener().open_url(url, None::<&str>).map_err(|_| ErroUi::novo("sistema", "Não foi possível abrir o navegador."))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelatorioVista {
    fracas: Vec<(Resumo, u8)>,
    reutilizadas: Vec<Vec<Resumo>>,
    antigas: Vec<Resumo>,
    cartoes_expirados: Vec<Resumo>,
    cartoes_a_expirar: Vec<Resumo>,
    tem_recuperacao: bool,
    kdf_memoria_mib: u32,
    kdf_iteracoes: u32,
}

#[tauri::command]
pub async fn relatorio_seguranca(app: AppHandle) -> R<RelatorioVista> {
    app.state::<Estado>().ler(|s| {
        let rel = analise::analisar(&s.cofre.dados, agora_ms(), &mut s.cache_forca);
        let d = &s.cofre.dados;
        let r = |id: &String| d.item(id).map(vista::resumo);
        let p = s.cofre.params_kdf();
        Ok(RelatorioVista {
            fracas: rel.fracas.iter().filter_map(|(id, f)| r(id).map(|x| (x, *f))).collect(),
            reutilizadas: rel.reutilizadas.iter().map(|g| g.iter().filter_map(r).collect()).collect(),
            antigas: rel.antigas.iter().filter_map(r).collect(),
            cartoes_expirados: rel.cartoes_expirados.iter().filter_map(r).collect(),
            cartoes_a_expirar: rel.cartoes_a_expirar.iter().filter_map(r).collect(),
            tem_recuperacao: s.cofre.tem_recuperacao(),
            kdf_memoria_mib: p.memoria_kib / 1024,
            kdf_iteracoes: p.iteracoes,
        })
    })
}

// ───────────────────────────── escrita ─────────────────────────────

#[tauri::command]
pub async fn guardar_item(app: AppHandle, item: Item) -> R<String> {
    app.state::<Estado>().mutar(|d, agora| d.guardar_item(item, agora))
}

#[tauri::command]
pub async fn duplicar_item(app: AppHandle, id: String) -> R<String> {
    app.state::<Estado>().mutar(|d, agora| d.duplicar(&id, agora))
}

#[tauri::command]
pub async fn mover_para_lixo(app: AppHandle, id: String) -> R<()> {
    app.state::<Estado>().mutar(|d, agora| d.mover_para_lixo(&id, agora))
}

#[tauri::command]
pub async fn restaurar_item(app: AppHandle, id: String) -> R<()> {
    app.state::<Estado>().mutar(|d, agora| d.restaurar(&id, agora))
}

#[tauri::command]
pub async fn eliminar_item(app: AppHandle, id: String) -> R<()> {
    app.state::<Estado>().mutar(|d, _| d.eliminar_definitivamente(&id))
}

#[tauri::command]
pub async fn esvaziar_lixo(app: AppHandle) -> R<usize> {
    app.state::<Estado>().mutar(|d, _| Ok(d.esvaziar_lixo()))
}

#[tauri::command]
pub async fn alternar_favorito(app: AppHandle, id: String) -> R<bool> {
    app.state::<Estado>().mutar(|d, _| d.alternar_favorito(&id))
}

#[tauri::command]
pub async fn marcar_codigo(app: AppHandle, id: String, indice: usize, usado: bool) -> R<()> {
    app.state::<Estado>().mutar(|d, agora| d.marcar_codigo(&id, indice, usado, agora))
}

#[tauri::command]
pub async fn limpar_historico(app: AppHandle, id: String) -> R<()> {
    app.state::<Estado>().mutar(|d, _| d.limpar_historico(&id))
}

// ───────────────────────────── gerador e força ─────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Gerada {
    valor: String,
    entropia_bits: f64,
}

#[tauri::command]
pub async fn gerar_senha(opcoes: OpcoesSenha) -> R<Gerada> {
    let g = gerador::gerar_senha(&opcoes)?;
    Ok(Gerada { valor: g.valor.to_string(), entropia_bits: g.entropia_bits })
}

#[tauri::command]
pub async fn gerar_frase(opcoes: OpcoesFrase) -> R<Gerada> {
    let g = gerador::gerar_frase(&opcoes)?;
    Ok(Gerada { valor: g.valor.to_string(), entropia_bits: g.entropia_bits })
}

#[tauri::command]
pub async fn avaliar_senha(senha: Zeroizing<String>, contexto: Vec<String>) -> R<Forca> {
    let refs: Vec<&str> = contexto.iter().take(10).map(|s| s.as_str()).collect();
    Ok(analise::forca(&senha, &refs))
}

// ───────────────────────────── definições ─────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefinicoesVista {
    cofre: Definicoes,
    nome: String,
    tem_recuperacao: bool,
    config: ConfigApp,
    caminho_cofre: String,
    kdf_memoria_mib: u32,
    kdf_iteracoes: u32,
    gerador: PreferenciasGerador,
}

#[tauri::command]
pub async fn obter_definicoes(app: AppHandle) -> R<DefinicoesVista> {
    let e = app.state::<Estado>();
    let config = trancar(&e.config).clone();
    let caminho_cofre = trancar(&e.caminho_cofre).display().to_string();
    e.ler(|s| {
        let p = s.cofre.params_kdf();
        Ok(DefinicoesVista {
            cofre: s.cofre.dados.definicoes.clone(),
            nome: s.cofre.dados.perfil.nome.clone(),
            tem_recuperacao: s.cofre.tem_recuperacao(),
            config,
            caminho_cofre,
            kdf_memoria_mib: p.memoria_kib / 1024,
            kdf_iteracoes: p.iteracoes,
            gerador: s.cofre.dados.gerador.clone(),
        })
    })
}

#[tauri::command]
pub async fn guardar_definicoes(app: AppHandle, definicoes: Definicoes, nome: String) -> R<()> {
    definicoes.validar()?;
    if nome.chars().count() > 60 {
        return Err(ErroUi::novo("invalido", "O nome pode ter no máximo 60 caracteres."));
    }
    app.state::<Estado>().mutar(move |d, _| {
        d.definicoes = definicoes;
        d.perfil.nome = nome.trim().to_string();
        Ok(())
    })
}

#[tauri::command]
pub async fn guardar_config(app: AppHandle, config: ConfigApp) -> R<ConfigApp> {
    let e = app.state::<Estado>();
    if !e.desbloqueado() {
        return Err(ErroUi::bloqueado());
    }
    let mut nova = config.normalizada();
    let anterior = trancar(&e.config).clone();
    nova.caminho_cofre = anterior.caminho_cofre.clone(); // o local muda-se por outro caminho
    if nova.iniciar_com_sistema != anterior.iniciar_com_sistema {
        use tauri_plugin_autostart::ManagerExt;
        let al = app.autolaunch();
        let r = if nova.iniciar_com_sistema { al.enable() } else { al.disable() };
        r.map_err(|_| ErroUi::novo("sistema", "O sistema não permitiu alterar o arranque automático."))?;
    }
    if let Some(j) = app.get_webview_window("principal") {
        if nova.proteger_captura != anterior.proteger_captura {
            let _ = j.set_content_protected(nova.proteger_captura);
        }
        if (nova.zoom - anterior.zoom).abs() > f64::EPSILON {
            let _ = j.set_zoom(nova.zoom);
        }
    }
    nova.gravar(&e.caminho_config).map_err(|_| ErroUi::novo("io", "Não foi possível gravar as preferências."))?;
    *trancar(&e.config) = nova.clone();
    Ok(nova)
}

#[tauri::command]
pub async fn abrir_pasta_cofre(app: AppHandle) -> R<()> {
    if !app.state::<Estado>().desbloqueado() {
        return Err(ErroUi::bloqueado());
    }
    let caminho = trancar(&app.state::<Estado>().caminho_cofre).clone();
    app.opener().reveal_item_in_dir(caminho).map_err(|_| ErroUi::novo("sistema", "Não foi possível abrir a pasta."))
}

// ───────────────────────────── cópias de segurança ─────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopiaCriada {
    caminho: String,
    nome: String,
    em: i64,
    bytes: usize,
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

/// Pede a pasta, grava uma cópia cifrada (o mesmo formato do cofre, abre com a senha mestra
/// atual ou com a chave de recuperação atual), relê-a e verifica-a.
#[tauri::command]
pub async fn criar_copia(app: AppHandle) -> R<Option<CopiaCriada>> {
    if !app.state::<Estado>().desbloqueado() {
        return Err(ErroUi::bloqueado());
    }
    let app2 = app.clone();
    em_segundo_plano(move || {
        let Some(pasta) = app2.dialog().file().set_title("Escolhe a pasta para a cópia de segurança").blocking_pick_folder() else {
            return Ok(None);
        };
        let pasta = pasta.into_path().map_err(|_| ErroUi::novo("invalido", "Pasta inválida."))?;
        let estado = app2.state::<Estado>();
        let agora = agora_ms();
        let destino = caminho_livre(&pasta, &format!("LisSecurity-copia-{}", data_ficheiro(agora)));
        let bytes = {
            let mut g = trancar(&estado.sessao);
            let s = g.as_mut().ok_or_else(ErroUi::bloqueado)?;
            let bytes = s.cofre.serializar(agora)?;
            armazenamento::escrever_atomico(&destino, &bytes, |b| s.cofre.verificar_gravado(b))?;
            bytes.len()
        };
        estado.mutar(|d, _| {
            d.ultimo_backup = Some(agora);
            Ok(())
        })?;
        Ok(Some(CopiaCriada {
            nome: destino.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
            caminho: destino.display().to_string(),
            em: agora,
            bytes,
        }))
    })
    .await
}

#[tauri::command]
pub async fn escolher_copia(app: AppHandle) -> R<Option<String>> {
    em_segundo_plano(move || {
        let f = app
            .dialog()
            .file()
            .set_title("Escolhe a cópia de segurança")
            .add_filter("Cópia do LisSecurity", &["lissec"])
            .blocking_pick_file();
        Ok(f.and_then(|f| f.into_path().ok()).map(|p| p.display().to_string()))
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InfoCopia {
    total: usize,
    logins: usize,
    bancos: usize,
    cartoes: usize,
    notas: usize,
    no_lixo: usize,
    gravado_em: i64,
    mesmo_cofre: Option<bool>,
    tem_recuperacao: bool,
}

fn info_copia(app: &AppHandle, a: &Aberto) -> InfoCopia {
    let d = &a.cofre.dados;
    let conta = |t: &str| d.itens.iter().filter(|i| !i.no_lixo() && i.tipo() == t).count();
    let atual = trancar(&app.state::<Estado>().sessao).as_ref().map(|s| s.cofre.id_cofre());
    InfoCopia {
        total: d.itens.iter().filter(|i| !i.no_lixo()).count(),
        logins: conta("login"),
        bancos: conta("banco"),
        cartoes: conta("cartao"),
        notas: conta("nota"),
        no_lixo: d.itens.iter().filter(|i| i.no_lixo()).count(),
        gravado_em: d.gravado_em,
        mesmo_cofre: atual.map(|id| id == a.cofre.id_cofre()),
        tem_recuperacao: a.cofre.tem_recuperacao(),
    }
}

/// Teste de restauro: abre a cópia com a senha da altura em que foi feita e conta os
/// registos, sem tocar no cofre atual.
#[tauri::command]
pub async fn testar_copia(app: AppHandle, caminho: String, senha: Zeroizing<String>) -> R<InfoCopia> {
    let e = app.state::<Estado>();
    let _g = e.operacao_longa.tentar().ok_or_else(ocupado)?;
    let app2 = app.clone();
    em_segundo_plano(move || {
        let bytes = ler_limitado(Path::new(&caminho))?;
        let a = CofreAberto::abrir_com_senha(&bytes, &senha)?;
        Ok(info_copia(&app2, &a))
    })
    .await
}

/// Substitui o cofre atual pelo da cópia. Se já existe um cofre, pede a senha mestra atual
/// e guarda uma cópia (cifrada) do cofre atual ao lado antes de o substituir.
#[tauri::command]
pub async fn restaurar_copia(
    app: AppHandle,
    caminho: String,
    senha: Zeroizing<String>,
    senha_atual: Option<Zeroizing<String>>,
) -> R<InfoCopia> {
    let e = app.state::<Estado>();
    let _g = e.operacao_longa.tentar().ok_or_else(ocupado)?;
    let g0 = e.geracao();
    let app2 = app.clone();
    em_segundo_plano(move || {
        let estado = app2.state::<Estado>();
        let existe = trancar(&estado.armazenamento).as_ref().is_some_and(|a| a.existe());
        if existe {
            let atual = senha_atual.ok_or_else(|| ErroUi::novo("credencial", "Confirma com a senha mestra atual."))?;
            let g = trancar(&estado.sessao);
            let s = g.as_ref().ok_or_else(ErroUi::bloqueado)?;
            s.cofre.verificar_senha(&atual)?;
        }
        let bytes = ler_limitado(Path::new(&caminho))?;
        let aberto = CofreAberto::abrir_com_senha(&bytes, &senha)?;
        let info = info_copia(&app2, &aberto);
        {
            let a = trancar(&estado.armazenamento);
            let a = a.as_ref().ok_or_else(|| ErroUi::novo("io", "O local do cofre não está disponível."))?;
            a.guardar_copia_local(&format!("antes-do-restauro-{}", data_ficheiro(agora_ms())))?;
            a.gravar(&bytes, |b| aberto.cofre.verificar_gravado(b))?;
        }
        // a sessão antiga sai antes de entrar a nova (sem aviso de bloqueio: foi a própria
        // interface que pediu o restauro e recarrega tudo quando ele termina)
        let g1 = {
            let mut s = trancar(&estado.sessao);
            if estado.geracao() != g0 {
                return Err(ErroUi::bloqueado());
            }
            *s = None;
            estado.geracao.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1
        };
        concluir_abertura(&app2, g1, aberto, false, false)?;
        Ok(info)
    })
    .await
}

#[cfg(test)]
mod testes {
    use super::endereco_seguro;

    #[test]
    fn so_abre_enderecos_web() {
        assert_eq!(endereco_seguro("exemplo.pt").as_deref(), Some("https://exemplo.pt"));
        assert_eq!(endereco_seguro("http://192.168.1.1/").as_deref(), Some("http://192.168.1.1/"));
        assert_eq!(endereco_seguro("router.local:8080/admin").as_deref(), Some("https://router.local:8080/admin"));
        for mau in [
            "javascript:alert(1)",
            "file:///C:/Windows",
            "ms-settings:privacy",
            "https://a b",
            "",
            "  ",
            "ftp://x.pt",
            "data:text/html,x",
            "https://",
            "mailto:a@b.pt",
        ] {
            assert!(endereco_seguro(mau).is_none(), "{mau}");
        }
    }
}
