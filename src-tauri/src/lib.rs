//! LisSecurity — aplicação para computador e Android (Tauri 2).
//!
//! A janela é criada aqui (e não no `tauri.conf.json`) para poder recusar qualquer navegação
//! para fora da própria aplicação e qualquer pedido de janela nova.
//!
//! O que é próprio de cada plataforma está separado: no computador, janelas de ficheiros,
//! instância única, arranque com o sistema e eventos do Windows; no Android, a camada Kotlin
//! (`gen/android/app/src/main/java/pt/lisfilms/lissecurity/`) chamada só a partir do Rust
//! (`nativo.rs`), nunca do JavaScript.

mod area_transferencia;
mod biometria;
mod comandos;
mod comandos_dados;
mod config;
mod copias;
mod estado;
#[cfg(target_os = "android")]
mod nativo;
mod plataforma;
mod sistema;

use tauri::webview::NewWindowResponse;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

use config::ConfigApp;
use estado::{bloquear, trancar, Estado};
use lissecurity_core::armazenamento::Armazenamento;

const JANELA: &str = "principal";

/// Só o conteúdo empacotado na própria aplicação (e, em desenvolvimento, o servidor do Vite).
fn navegacao_permitida(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" => {
            url.host_str() == Some("tauri.localhost")
                || (cfg!(debug_assertions) && url.host_str() == Some("localhost") && url.port() == Some(5174))
        }
        _ => false,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let construtor = tauri::Builder::default();
    #[cfg(desktop)]
    let construtor = construtor
        // tem de ser o primeiro plugin: uma segunda instância só traz a janela para a frente
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(j) = app.get_webview_window(JANELA) {
                let _ = j.unminimize();
                let _ = j.show();
                let _ = j.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None));
    #[cfg(target_os = "android")]
    let construtor = construtor.plugin(nativo::init());

    let app = construtor
        .setup(|app| {
            let pasta_config = app.path().app_config_dir()?;
            let caminho_config = pasta_config.join("preferencias.json");
            let config = ConfigApp::ler(&caminho_config);
            let caminho_cofre = config.caminho_cofre.clone().unwrap_or(app.path().app_data_dir()?.join("cofre.lissec"));
            let estado = Estado::novo(config.clone(), caminho_config, caminho_cofre.clone());
            match Armazenamento::abrir(caminho_cofre) {
                Ok(a) => *trancar(&estado.armazenamento) = Some(a),
                Err(e) => *trancar(&estado.erro_arranque) = Some(e.to_string()),
            }
            let _ = estado.app.set(app.handle().clone());
            app.manage(estado);
            criar_janela(app, &config)?;
            #[cfg(target_os = "android")]
            nativo::definir_protecao_ecra(app.handle(), config.proteger_captura);
            sistema::iniciar(app.handle());
            Ok(())
        })
        .on_window_event(|janela, evento| {
            #[cfg(desktop)]
            {
                use tauri::{Emitter, WindowEvent};
                let app = janela.app_handle();
                match evento {
                    WindowEvent::Resized(_) => {
                        if janela.is_minimized().unwrap_or(false) {
                            if app.state::<Estado>().politicas().is_some_and(|d| d.bloquear_ao_minimizar) {
                                bloquear(app, "minimizar");
                            }
                        } else {
                            let _ = app.emit("lis://janela", janela.is_maximized().unwrap_or(false));
                        }
                    }
                    WindowEvent::CloseRequested { api, .. } => {
                        let minimizar = trancar(&app.state::<Estado>().config).ao_fechar == "minimizar";
                        bloquear(app, "fechar");
                        if minimizar {
                            api.prevent_close();
                            let _ = janela.minimize();
                        }
                    }
                    _ => {}
                }
            }
            #[cfg(mobile)]
            let _ = (janela, evento);
        })
        .invoke_handler(tauri::generate_handler![
            comandos::estado_app,
            comandos::janela_pronta,
            comandos::janela_minimizar,
            comandos::janela_alternar_maximizar,
            comandos::janela_maximizada,
            comandos::janela_fechar,
            comandos::para_segundo_plano,
            comandos::margens_sistema,
            comandos::criar_cofre,
            comandos::desbloquear,
            comandos::desbloquear_recuperacao,
            comandos::bloquear_cofre,
            comandos::registar_atividade,
            comandos::alterar_senha,
            comandos::ativar_recuperacao,
            comandos::desativar_recuperacao,
            comandos::visao_geral,
            comandos::listar,
            comandos::agrupamentos,
            comandos::obter_item,
            comandos::obter_item_edicao,
            comandos::revelar_campo,
            comandos::copiar_campo,
            comandos::copiar_texto,
            comandos::abrir_endereco,
            comandos::relatorio_seguranca,
            comandos::guardar_item,
            comandos::duplicar_item,
            comandos::mover_para_lixo,
            comandos::restaurar_item,
            comandos::eliminar_item,
            comandos::esvaziar_lixo,
            comandos::alternar_favorito,
            comandos::marcar_codigo,
            comandos::limpar_historico,
            comandos::gerar_senha,
            comandos::gerar_frase,
            comandos::avaliar_senha,
            comandos::obter_definicoes,
            comandos::guardar_definicoes,
            comandos::guardar_config,
            comandos::abrir_pasta_cofre,
            comandos::criar_copia,
            comandos::partilhar_copia,
            comandos::escolher_copia,
            comandos::testar_copia,
            comandos::restaurar_copia,
            comandos::reautenticar,
            comandos::codigo_totp,
            comandos::copiar_codigo_totp,
            comandos::reforcar_protecao,
            comandos::guardar_gerador,
            comandos_dados::escolher_csv,
            comandos_dados::apagar_ficheiro_importado,
            comandos_dados::pre_visualizar_senhas,
            comandos_dados::importar_senhas,
            comandos_dados::importar_extrato,
            comandos_dados::resumo_gastos,
            comandos_dados::listar_movimentos,
            comandos_dados::categorizar_movimento,
            comandos_dados::eliminar_movimentos,
            comandos_dados::pastas_nuvem,
            comandos_dados::escolher_pasta,
            comandos_dados::listar_copias,
            comandos_dados::estado_copias,
            comandos_dados::configurar_copias,
            comandos_dados::fazer_copia_auto,
            biometria::estado_biometria,
            biometria::ativar_biometria,
            biometria::desativar_biometria,
            biometria::desbloquear_biometria,
        ])
        .build(tauri::generate_context!())
        .expect("erro ao iniciar o LisSecurity");

    app.run(|app, evento| {
        if let RunEvent::Exit = evento {
            // ao sair: largar as chaves e limpar a área de transferência se ainda for nossa
            #[cfg(desktop)]
            bloquear(app, "saida");
            // no Android este evento chega no fio principal, que não pode ficar à espera do
            // cofre (ver nativo.rs); a limpeza da área de transferência tem também o alarme
            #[cfg(target_os = "android")]
            {
                let app = app.clone();
                let _ = std::thread::Builder::new().name("lissecurity-saida".into()).spawn(move || bloquear(&app, "saida"));
            }
        }
    });
}

/// Computador: janela sem moldura (a barra de título é da interface), invisível até a
/// interface pintar o primeiro ecrã, com proteção contra capturas e o zoom guardado.
#[cfg(desktop)]
fn criar_janela(app: &mut tauri::App, config: &ConfigApp) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, JANELA, WebviewUrl::App("index.html".into()))
        .title("LisSecurity")
        .inner_size(1240.0, 800.0)
        .min_inner_size(780.0, 560.0)
        .center()
        .decorations(false)
        .shadow(true)
        .resizable(true)
        .visible(false) // mostra-se quando a interface pinta o primeiro ecrã (sem clarão branco)
        .background_color(tauri::window::Color(11, 13, 16, 255))
        .content_protected(config.proteger_captura)
        .on_navigation(navegacao_permitida)
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .build()?;
    if (config.zoom - 1.0).abs() > f64::EPSILON {
        if let Some(j) = app.get_webview_window(JANELA) {
            let _ = j.set_zoom(config.zoom);
        }
    }
    // Salvaguarda: se a interface não avisar que pintou (erro inesperado), a janela aparece na
    // mesma ao fim de 4 s, para nunca ficar uma app invisível a correr.
    let app_mostrar = app.handle().clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(4));
        if let Some(j) = app_mostrar.get_webview_window(JANELA) {
            if !j.is_visible().unwrap_or(true) {
                let _ = j.show();
            }
        }
    });
    Ok(())
}

/// Android: uma só vista, em ecrã inteiro. A proteção contra capturas (FLAG_SECURE), as
/// margens do sistema e o teclado são tratados pela camada Kotlin.
#[cfg(mobile)]
fn criar_janela(app: &mut tauri::App, _config: &ConfigApp) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, JANELA, WebviewUrl::App("index.html".into()))
        .on_navigation(navegacao_permitida)
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .build()?;
    Ok(())
}
