//! Android: a ponte para a camada Kotlin (`NativoPlugin.kt`).
//!
//! Só o Rust chama estas funções — o JavaScript não tem acesso ao plugin (não há permissões
//! para ele nas capacidades). Assim continua a valer a regra do computador: a interface não
//! lê ficheiros, não mexe na área de transferência e não abre endereços por si; pede um
//! comando concreto, que decide.
//!
//! Os ficheiros no Android são documentos do seletor do sistema (`content://…`, Storage Access
//! Framework): podem estar no telemóvel, num cartão, no Google Drive… A camada Kotlin lê e
//! escreve os bytes; abrir, verificar e cifrar continua a ser aqui e no núcleo.

use std::ffi::c_void;
use std::sync::OnceLock;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{AppHandle, Manager, Wry};
use zeroize::Zeroizing;

use crate::estado::{ErroUi, R};

static APP: OnceLock<AppHandle> = OnceLock::new();
/// O fio principal (de interface) do Android, onde o Tauri constrói a app.
static FIO_PRINCIPAL: OnceLock<std::thread::ThreadId> = OnceLock::new();

pub struct Nativo(PluginHandle<Wry>);

pub fn init() -> TauriPlugin<Wry> {
    Builder::new("lisnativo")
        .setup(|app, api| {
            // a app é construída no fio principal do Android (dentro do onCreate da Activity)
            let _ = FIO_PRINCIPAL.set(std::thread::current().id());
            let h = api.register_android_plugin("pt.lisfilms.lissecurity", "NativoPlugin")?;
            app.manage(Nativo(h));
            let _ = APP.set(app.clone());
            Ok(())
        })
        .build()
}

/// Chamado pela Activity (`Ponte.aoSairDaApp`) quando a app deixa de estar visível: ecrã
/// desligado, botão de início, outra app por cima. Não é chamado enquanto um seletor de
/// ficheiros, a folha de partilha ou a biometria pedidos pela própria app estão abertos.
#[no_mangle]
pub extern "system" fn Java_pt_lisfilms_lissecurity_Ponte_aoSairDaApp(_env: *mut c_void, _classe: *mut c_void) {
    if let Some(app) = APP.get() {
        // Chega no fio principal. Bloquear espera pelo cofre, que pode estar ocupado por uma
        // cópia de segurança a escrever através da camada Kotlin — ou seja, à espera deste
        // mesmo fio. Noutro fio, nunca se prendem um ao outro.
        let app = app.clone();
        let _ = std::thread::Builder::new().name("lissecurity-saiu".into()).spawn(move || crate::sistema::saiu_da_app(&app));
    }
}

/// Erros da camada Kotlin: `invoke.reject(mensagem, codigo)`. Os códigos são uma lista
/// fechada; as mensagens já vêm em português e nunca levam conteúdo do cofre.
fn erro(e: tauri::plugin::mobile::PluginInvokeError) -> ErroUi {
    use tauri::plugin::mobile::PluginInvokeError as P;
    match e {
        P::InvokeRejected(r) => {
            let codigo = match r.code.as_deref() {
                Some("cancelado") => "cancelado",
                Some("grande") => "invalido",
                Some("io") => "io",
                Some("sem_biometria") => "sem_biometria",
                Some("biometria_bloqueada") => "biometria_bloqueada",
                Some("biometria_invalidada") => "biometria_invalidada",
                Some("biometria") => "biometria",
                _ => "sistema",
            };
            ErroUi::novo(codigo, r.message.unwrap_or_else(|| "O Android recusou o pedido.".into()))
        }
        _ => ErroUi::novo("sistema", "Não foi possível falar com o Android."),
    }
}

/// Estamos no fio principal do Android? Lá, o processo e o fio têm o mesmo número
/// (`/proc/thread-self` → `<pid>/task/<tid>`); se o sistema não o disser, compara-se com o fio
/// guardado quando a app arrancou.
fn no_fio_principal() -> bool {
    if let Ok(l) = std::fs::read_link("/proc/thread-self") {
        if let Some((pid, tid)) = l.to_string_lossy().split_once("/task/") {
            return pid == tid;
        }
    }
    FIO_PRINCIPAL.get().is_some_and(|id| *id == std::thread::current().id())
}

/// Pede um comando à camada Kotlin e espera pela resposta.
///
/// O Tauri entrega o pedido ao fio principal do Android e este fio fica à espera: feito a
/// partir do próprio fio principal (o `setup` da app, o `onStop` da Activity…), a app ficava
/// bloqueada para sempre. Aí recusa-se; os pedidos sem resposta útil usam `pedir`.
fn chamar<T: DeserializeOwned>(app: &AppHandle, metodo: &str, args: impl Serialize) -> R<T> {
    if no_fio_principal() {
        return Err(ErroUi::novo("sistema", "Pedido ao Android feito no fio principal."));
    }
    let n = app.try_state::<Nativo>().ok_or_else(|| ErroUi::novo("sistema", "A camada Android não arrancou."))?;
    n.0.run_mobile_plugin::<T>(metodo, args).map_err(erro)
}

/// Pedidos que não precisam de resposta (proteção do ecrã, limpar a área de transferência, ir
/// para trás): correm noutro fio, por isso podem ser feitos de qualquer lado, incluindo do fio
/// principal.
fn pedir(app: &AppHandle, metodo: &'static str, args: serde_json::Value) {
    let app = app.clone();
    let _ = std::thread::Builder::new().name("lissecurity-android".into()).spawn(move || {
        let _ = chamar::<serde_json::Value>(&app, metodo, args);
    });
}

// ───────────────────────────── ficheiros (Storage Access Framework) ─────────────────────────────

/// Um documento escolhido pela pessoa (ou criado pela app numa pasta que ela escolheu).
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Documento {
    pub uri: Option<String>,
    pub nome: String,
    pub tamanho: u64,
    pub modificado: i64,
}

#[derive(Deserialize)]
struct Dados {
    dados: Zeroizing<String>,
}

/// Abre o seletor do sistema. `None` se a pessoa cancelar.
pub fn escolher_ficheiro(app: &AppHandle, tipos: &[&str]) -> R<Option<Documento>> {
    let d: Documento = chamar(app, "escolherFicheiro", json!({ "tipos": tipos }))?;
    Ok(d.uri.is_some().then_some(d))
}

/// Lê um documento até `maximo` bytes (os bytes passam pela camada Kotlin em base64 e são
/// apagados lá e aqui depois de usados).
pub fn ler(app: &AppHandle, uri: &str, maximo: u64) -> R<Zeroizing<Vec<u8>>> {
    let d: Dados = chamar(app, "lerFicheiro", json!({ "uri": uri, "maximo": maximo }))?;
    B64.decode(d.dados.as_bytes()).map(Zeroizing::new).map_err(|_| ErroUi::novo("io", "O ficheiro chegou incompleto."))
}

/// Substitui o conteúdo de um documento.
pub fn escrever(app: &AppHandle, uri: &str, bytes: &[u8]) -> R<()> {
    let dados = Zeroizing::new(B64.encode(bytes));
    chamar::<serde_json::Value>(app, "escreverFicheiro", json!({ "uri": uri, "dados": dados.as_str() }))?;
    Ok(())
}

/// «Guardar como…» do sistema (pode ser o Google Drive). `None` se a pessoa cancelar.
pub fn criar(app: &AppHandle, nome: &str, mime: &str) -> R<Option<Documento>> {
    let d: Documento = chamar(app, "criarFicheiro", json!({ "nome": nome, "mime": mime }))?;
    Ok(d.uri.is_some().then_some(d))
}

/// Apaga um documento. Nem todos os fornecedores deixam (devolve `false`).
pub fn apagar(app: &AppHandle, uri: &str) -> R<bool> {
    #[derive(Deserialize)]
    struct Ok_ {
        apagado: bool,
    }
    Ok(chamar::<Ok_>(app, "apagarFicheiro", json!({ "uri": uri }))?.apagado)
}

/// Escolher uma pasta para as cópias automáticas (a permissão de escrita fica guardada).
pub fn escolher_pasta(app: &AppHandle) -> R<Option<Documento>> {
    let d: Documento = chamar(app, "escolherPasta", json!({}))?;
    Ok(d.uri.is_some().then_some(d))
}

/// Nome da pasta e se a app ainda tem permissão de escrever lá.
pub fn info_pasta(app: &AppHandle, pasta: &str) -> R<(String, bool)> {
    #[derive(Deserialize)]
    struct Info {
        nome: String,
        acessivel: bool,
    }
    let i: Info = chamar(app, "infoPasta", json!({ "pasta": pasta }))?;
    Ok((i.nome, i.acessivel))
}

pub fn listar_pasta(app: &AppHandle, pasta: &str) -> R<Vec<Documento>> {
    #[derive(Deserialize)]
    struct Lista {
        ficheiros: Vec<Documento>,
    }
    Ok(chamar::<Lista>(app, "listarPasta", json!({ "pasta": pasta }))?.ficheiros)
}

/// Cria `nome` dentro da pasta e escreve-lhe os bytes.
pub fn gravar_na_pasta(app: &AppHandle, pasta: &str, nome: &str, bytes: &[u8]) -> R<Documento> {
    let dados = Zeroizing::new(B64.encode(bytes));
    chamar(app, "gravarNaPasta", json!({ "pasta": pasta, "nome": nome, "dados": dados.as_str() }))
}

/// Folha de partilha do Android com o ficheiro (cifrado) — Drive, e-mail, outra app.
pub fn partilhar(app: &AppHandle, nome: &str, bytes: &[u8]) -> R<()> {
    let dados = B64.encode(bytes);
    chamar::<serde_json::Value>(app, "partilhar", json!({ "nome": nome, "dados": dados }))?;
    Ok(())
}

// ───────────────────────────── sistema ─────────────────────────────

/// Copia marcado como sensível (Android 13+ não mostra a pré-visualização nem o guarda no
/// histórico do teclado) e agenda a limpeza ao fim de `segundos`, mesmo com a app fechada.
pub fn copiar(app: &AppHandle, texto: &str, segundos: u32) -> R<()> {
    chamar::<serde_json::Value>(app, "copiar", json!({ "texto": texto, "segundos": segundos }))?;
    Ok(())
}

/// Pode ser pedido ao bloquear, também a partir do fio principal (sair da app).
pub fn limpar_area_transferencia(app: &AppHandle) {
    pedir(app, "limparAreaTransferencia", json!({}));
}

pub fn abrir_endereco(app: &AppHandle, url: &str) -> R<()> {
    chamar::<serde_json::Value>(app, "abrirEndereco", json!({ "url": url }))?;
    Ok(())
}

/// FLAG_SECURE: o conteúdo não aparece em capturas, gravações de ecrã nem na lista de apps
/// recentes.
/// Chamado também no arranque (fio principal); a Activity já liga a proteção no `onCreate`.
pub fn definir_protecao_ecra(app: &AppHandle, ativo: bool) {
    pedir(app, "protecaoEcra", json!({ "ativo": ativo }));
}

pub fn para_segundo_plano(app: &AppHandle) {
    pedir(app, "paraSegundoPlano", json!({}));
}

/// Margens do sistema (barra de estado, navegação, recorte do ecrã e teclado), em píxeis CSS.
#[derive(Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Margens {
    pub topo: f64,
    pub direita: f64,
    pub baixo: f64,
    pub esquerda: f64,
    pub teclado: f64,
}

pub fn margens(app: &AppHandle) -> Margens {
    chamar(app, "margens", json!({})).unwrap_or_default()
}

// ───────────────────────────── biometria (Android Keystore) ─────────────────────────────

#[derive(Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct EstadoBiometria {
    /// há impressão digital/rosto de classe forte registado neste aparelho
    pub disponivel: bool,
    /// a chave deste cofre está guardada para o desbloqueio biométrico
    pub ativa: bool,
    /// porque não está disponível (em português), quando não está
    pub motivo: Option<String>,
}

pub fn biometria_estado(app: &AppHandle, id_cofre: &str) -> R<EstadoBiometria> {
    chamar(app, "biometriaEstado", json!({ "idCofre": id_cofre }))
}

/// Guarda a chave do cofre cifrada por uma chave do Keystore que só se usa com a biometria.
/// Pede a impressão digital uma vez, para confirmar que tudo funciona antes de a ativar.
pub fn biometria_ativar(app: &AppHandle, id_cofre: &str, chave: &[u8; 32]) -> R<()> {
    let c = Zeroizing::new(B64.encode(chave));
    chamar::<serde_json::Value>(app, "biometriaAtivar", json!({ "idCofre": id_cofre, "chave": c.as_str() }))?;
    Ok(())
}

/// Depois de a chave do cofre rodar (senha nova, recuperação, proteção, restauro): volta a
/// guardá-la, sem pedir nada (cifra-se com a parte pública). Devolve se estava ativa.
pub fn biometria_renovar(app: &AppHandle, id_cofre: &str, chave: &[u8; 32]) -> R<bool> {
    #[derive(Deserialize)]
    struct Renovada {
        renovada: bool,
    }
    let c = Zeroizing::new(B64.encode(chave));
    Ok(chamar::<Renovada>(app, "biometriaRenovar", json!({ "idCofre": id_cofre, "chave": c.as_str() }))?.renovada)
}

/// Pede a biometria e devolve a chave do cofre.
pub fn biometria_desbloquear(app: &AppHandle, id_cofre: &str) -> R<Zeroizing<[u8; 32]>> {
    #[derive(Deserialize)]
    struct Chave {
        chave: Zeroizing<String>,
    }
    let c: Chave = chamar(app, "biometriaDesbloquear", json!({ "idCofre": id_cofre }))?;
    let bytes = Zeroizing::new(B64.decode(c.chave.as_bytes()).map_err(|_| ErroUi::novo("biometria", "A chave guardada está danificada."))?);
    let arr: [u8; 32] = bytes.as_slice().try_into().map_err(|_| ErroUi::novo("biometria", "A chave guardada está danificada."))?;
    Ok(Zeroizing::new(arr))
}

pub fn biometria_desativar(app: &AppHandle) {
    if no_fio_principal() {
        pedir(app, "biometriaDesativar", json!({}));
    } else {
        let _ = chamar::<serde_json::Value>(app, "biometriaDesativar", json!({}));
    }
}
