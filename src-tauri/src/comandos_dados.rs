//! Comandos de importação (senhas e extratos), gastos e cópias automáticas.

use std::path::{Path, PathBuf};

use lissecurity_core::financas::{self, Mensal, Recorrente, ResumoMes};
use lissecurity_core::importacao;
use lissecurity_core::modelo::{ConfigCopias, Movimento};
use lissecurity_core::vista::normalizar;
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use zeroize::Zeroizing;

use crate::copias::{self, CopiaEncontrada, CopiaFeita, PastaNuvem};
use crate::estado::{trancar, ErroUi, Estado, R};

const MAX_CSV: u64 = 50 * 1024 * 1024;

async fn em_segundo_plano<T: Send + 'static>(f: impl FnOnce() -> R<T> + Send + 'static) -> R<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|_| ErroUi::novo("sistema", "A operação foi interrompida."))?
}

// ───────────────────────────── ficheiros escolhidos ─────────────────────────────

/// Janela "abrir ficheiro" para CSV. O caminho fica registado como escolhido pela pessoa.
#[tauri::command]
pub async fn escolher_csv(app: AppHandle, titulo: String) -> R<Option<String>> {
    if !app.state::<Estado>().desbloqueado() {
        return Err(ErroUi::bloqueado());
    }
    let app2 = app.clone();
    em_segundo_plano(move || {
        let titulo: String = titulo.chars().take(80).collect();
        let f = app2.dialog().file().set_title(titulo).add_filter("Ficheiro CSV", &["csv", "txt"]).blocking_pick_file();
        let Some(p) = f.and_then(|f| f.into_path().ok()) else { return Ok(None) };
        trancar(&app2.state::<Estado>().escolhidos).insert(p.clone());
        Ok(Some(p.display().to_string()))
    })
    .await
}

fn ler_escolhido(app: &AppHandle, caminho: &str) -> R<Zeroizing<String>> {
    let p = PathBuf::from(caminho);
    if !trancar(&app.state::<Estado>().escolhidos).contains(&p) {
        return Err(ErroUi::novo("invalido", "Escolhe o ficheiro outra vez."));
    }
    let meta = std::fs::metadata(&p).map_err(|_| ErroUi::novo("io", "O ficheiro já não existe."))?;
    if meta.len() > MAX_CSV {
        return Err(ErroUi::novo("invalido", "O ficheiro é demasiado grande (máximo 50 MB)."));
    }
    let bytes = Zeroizing::new(std::fs::read(&p).map_err(|_| ErroUi::novo("io", "Não foi possível ler o ficheiro."))?);
    Ok(Zeroizing::new(String::from_utf8_lossy(&bytes).into_owned()))
}

/// Apaga um CSV que a pessoa escolheu para importar (tem senhas em texto simples).
#[tauri::command]
pub async fn apagar_ficheiro_importado(app: AppHandle, caminho: String) -> R<()> {
    let p = PathBuf::from(&caminho);
    let estado = app.state::<Estado>();
    let mut escolhidos = trancar(&estado.escolhidos);
    let csv = p.extension().map(|e| e.eq_ignore_ascii_case("csv") || e.eq_ignore_ascii_case("txt")).unwrap_or(false);
    if !escolhidos.contains(&p) || !csv {
        return Err(ErroUi::novo("invalido", "Só se apagam ficheiros CSV escolhidos para importar."));
    }
    std::fs::remove_file(&p).map_err(|_| ErroUi::novo("io", "Não foi possível apagar o ficheiro."))?;
    escolhidos.remove(&p);
    Ok(())
}

// ───────────────────────────── importar senhas ─────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviaSenhas {
    formato: String,
    total: usize,
    novos: usize,
    duplicados: usize,
    ignorados: usize,
    amostra: Vec<String>,
}

#[tauri::command]
pub async fn pre_visualizar_senhas(app: AppHandle, caminho: String) -> R<PreviaSenhas> {
    let app2 = app.clone();
    em_segundo_plano(move || {
        let texto = ler_escolhido(&app2, &caminho)?;
        let r = importacao::senhas_de_csv(&texto)?;
        let estado = app2.state::<Estado>();
        estado.ler(|s| {
            // simula a importação numa cópia para contar os duplicados
            let mut copia = s.cofre.dados.clone();
            let total = r.itens.len();
            let amostra = r.itens.iter().take(6).map(|i| i.titulo.clone()).collect();
            let (novos, duplicados) = copia.importar_itens(r.itens, 0)?;
            Ok(PreviaSenhas { formato: r.formato.into(), total, novos, duplicados, ignorados: r.ignorados, amostra })
        })
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Importacao {
    novos: usize,
    duplicados: usize,
    ignorados: usize,
    origem: String,
}

#[tauri::command]
pub async fn importar_senhas(app: AppHandle, caminho: String) -> R<Importacao> {
    let app2 = app.clone();
    em_segundo_plano(move || {
        let texto = ler_escolhido(&app2, &caminho)?;
        let r = importacao::senhas_de_csv(&texto)?;
        let ignorados = r.ignorados;
        let origem = r.formato.to_string();
        let (novos, duplicados) = app2.state::<Estado>().mutar(move |d, agora| d.importar_itens(r.itens, agora))?;
        Ok(Importacao { novos, duplicados, ignorados, origem })
    })
    .await
}

// ───────────────────────────── extratos e gastos ─────────────────────────────

#[tauri::command]
pub async fn importar_extrato(app: AppHandle, caminho: String) -> R<Importacao> {
    let app2 = app.clone();
    em_segundo_plano(move || {
        let texto = ler_escolhido(&app2, &caminho)?;
        let r = importacao::extrato_de_csv(&texto)?;
        let ignorados = r.ignorados;
        let origem = r.origem.to_string();
        let (novos, duplicados) = app2.state::<Estado>().mutar(move |d, _| d.importar_movimentos(r.movimentos))?;
        Ok(Importacao { novos, duplicados, ignorados, origem })
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumoGastos {
    resumo: ResumoMes,
    evolucao: Vec<Mensal>,
    recorrentes: Vec<Recorrente>,
    moedas: Vec<String>,
    total_movimentos: usize,
    origens: Vec<String>,
    /// (ano, mês) do movimento mais antigo e do mais recente
    primeiro: Option<(i32, u32)>,
    ultimo: Option<(i32, u32)>,
    categorias: Vec<(String, String)>,
}

#[tauri::command]
pub async fn resumo_gastos(app: AppHandle, ano: Option<i32>, mes: Option<u32>, moeda: Option<String>) -> R<ResumoGastos> {
    app.state::<Estado>().ler(|s| {
        let movs = &s.cofre.dados.movimentos;
        let moedas = financas::moedas(movs);
        let moeda = moeda.filter(|m| moedas.contains(m)).or_else(|| moedas.first().cloned()).unwrap_or_else(|| "EUR".into());
        let datas = movs.iter().map(|m| m.data);
        let mes_de = |ms: i64| {
            let (a, m, _, _, _) = lissecurity_core::analise::data_hora(ms);
            (a, m)
        };
        let primeiro = datas.clone().min().map(mes_de);
        let ultimo = datas.max().map(mes_de);
        let (a, m) = match (ano, mes) {
            (Some(a), Some(m)) if (1..=12).contains(&m) => (a, m),
            _ => ultimo.unwrap_or_else(|| mes_de(lissecurity_core::agora_ms())),
        };
        let mut origens: Vec<String> = movs.iter().map(|m| m.origem.clone()).collect();
        origens.sort();
        origens.dedup();
        Ok(ResumoGastos {
            resumo: financas::resumo_mes(movs, a, m, &moeda),
            evolucao: financas::evolucao(movs, a, m, &moeda, 6),
            recorrentes: financas::recorrentes(movs, &moeda),
            moedas,
            total_movimentos: movs.len(),
            origens,
            primeiro,
            ultimo,
            categorias: financas::CATEGORIAS.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect(),
        })
    })
}

#[tauri::command]
pub async fn listar_movimentos(
    app: AppHandle,
    ano: i32,
    mes: u32,
    moeda: String,
    categoria: Option<String>,
    texto: Option<String>,
) -> R<Vec<Movimento>> {
    app.state::<Estado>().ler(|s| {
        let termo = texto.as_deref().map(normalizar).unwrap_or_default();
        Ok(s.cofre
            .dados
            .movimentos
            .iter()
            .filter(|m| m.moeda == moeda)
            .filter(|m| {
                let (a, mm, _, _, _) = lissecurity_core::analise::data_hora(m.data);
                (a, mm) == (ano, mes)
            })
            .filter(|m| categoria.as_deref().is_none_or(|c| c.is_empty() || m.categoria == c))
            .filter(|m| termo.is_empty() || normalizar(&m.descricao).contains(&termo))
            .take(2_000)
            .cloned()
            .collect())
    })
}

#[tauri::command]
pub async fn categorizar_movimento(app: AppHandle, id: String, categoria: String, todos: bool) -> R<usize> {
    app.state::<Estado>().mutar(|d, _| d.categorizar_movimento(&id, &categoria, todos))
}

#[tauri::command]
pub async fn eliminar_movimentos(app: AppHandle, origem: Option<String>) -> R<usize> {
    app.state::<Estado>().mutar(|d, _| Ok(d.eliminar_movimentos(origem.as_deref())))
}

// ───────────────────────────── cópias automáticas ─────────────────────────────

#[tauri::command]
pub async fn pastas_nuvem() -> R<Vec<PastaNuvem>> {
    em_segundo_plano(|| Ok(copias::pastas_nuvem())).await
}

#[tauri::command]
pub async fn escolher_pasta(app: AppHandle, titulo: String) -> R<Option<String>> {
    em_segundo_plano(move || {
        let titulo: String = titulo.chars().take(80).collect();
        let p = app.dialog().file().set_title(titulo).blocking_pick_folder();
        Ok(p.and_then(|p| p.into_path().ok()).map(|p| p.display().to_string()))
    })
    .await
}

#[tauri::command]
pub async fn listar_copias(pasta: String) -> R<Vec<CopiaEncontrada>> {
    em_segundo_plano(move || Ok(copias::listar(Path::new(&pasta)))).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EstadoCopias {
    config: ConfigCopias,
    destino: Option<String>,
    ultima_automatica: Option<i64>,
    ultimo_erro: Option<String>,
    ultima_manual: Option<i64>,
    copias: Vec<CopiaEncontrada>,
}

fn estado_copias_de(app: &AppHandle) -> R<EstadoCopias> {
    let estado = app.state::<Estado>();
    let (config, ultima_manual) = estado.ler(|s| Ok((s.cofre.dados.copias.clone(), s.cofre.dados.ultimo_backup)))?;
    let destino = (!config.pasta.is_empty()).then(|| copias::destino(&config.pasta));
    let encontradas = destino.as_ref().map(|d| copias::listar(d)).unwrap_or_default();
    let ultima_ficheiro = encontradas.iter().filter(|c| c.automatica).map(|c| c.modificado).max();
    let ultimo_ok = *trancar(&estado.copia_auto.ultimo_ok);
    let ultimo_erro = trancar(&estado.copia_auto.ultimo_erro).clone();
    Ok(EstadoCopias {
        destino: destino.map(|d| d.display().to_string()),
        ultima_automatica: ultimo_ok.max(ultima_ficheiro),
        ultimo_erro,
        ultima_manual,
        copias: encontradas,
        config,
    })
}

#[tauri::command]
pub async fn estado_copias(app: AppHandle) -> R<EstadoCopias> {
    em_segundo_plano(move || estado_copias_de(&app)).await
}

#[tauri::command]
pub async fn configurar_copias(app: AppHandle, ativo: bool, pasta: String, manter: u32) -> R<EstadoCopias> {
    em_segundo_plano(move || {
        let pasta = pasta.trim().to_string();
        if ativo {
            if pasta.is_empty() || !Path::new(&pasta).is_absolute() || !Path::new(&pasta).is_dir() {
                return Err(ErroUi::novo("invalido", "Escolhe uma pasta que exista (por exemplo, a do Google Drive)."));
            }
            std::fs::create_dir_all(copias::destino(&pasta)).map_err(|_| ErroUi::novo("io", "Não foi possível escrever nessa pasta."))?;
        }
        let estado = app.state::<Estado>();
        estado.mutar(|d, _| {
            d.copias = ConfigCopias { ativo, pasta: pasta.clone(), manter: manter.clamp(3, 100) };
            Ok(())
        })?;
        if ativo {
            // a primeira cópia faz-se já (e mostra logo se a pasta funciona); a cópia agendada
            // pela gravação das definições deixa de ser precisa
            copias::fazer(&app)?;
            estado.copia_auto.pedido.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }
        estado_copias_de(&app)
    })
    .await
}

#[tauri::command]
pub async fn fazer_copia_auto(app: AppHandle) -> R<CopiaFeita> {
    em_segundo_plano(move || copias::fazer(&app)).await
}
