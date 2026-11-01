//! Integração com o sistema operativo para bloquear sozinho:
//!
//! * **Inatividade** — sem pedidos da interface durante N minutos (a interface avisa quando há
//!   teclado/rato; a contagem é feita aqui, não no JavaScript).
//! * **Suspensão** — no Windows, `WM_POWERBROADCAST/PBT_APMSUSPEND`; em qualquer sistema, um
//!   salto no relógio de parede (o computador esteve parado) também bloqueia.
//! * **Sessão do Windows bloqueada** (Win+L), troca de utilizador ou fim de sessão —
//!   `WM_WTSSESSION_CHANGE` depois de `WTSRegisterSessionNotification`.

use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Manager};

use crate::estado::{bloquear, Estado};

pub fn iniciar(app: &AppHandle) {
    let app_vigia = app.clone();
    std::thread::Builder::new().name("lissecurity-vigia".into()).spawn(move || vigiar(app_vigia)).expect("thread de vigia");
    #[cfg(windows)]
    windows::iniciar(app.clone());
}

fn vigiar(app: AppHandle) {
    let mut anterior = SystemTime::now();
    loop {
        std::thread::sleep(Duration::from_secs(1));
        let agora = SystemTime::now();
        let salto = agora.duration_since(anterior).map(|d| d > Duration::from_secs(20)).unwrap_or(true);
        anterior = agora;
        let estado = app.state::<Estado>();
        let Some(def) = estado.politicas() else { continue };
        if salto && def.bloquear_ao_suspender {
            bloquear(&app, "suspensao");
        } else if estado.inativo_ha() >= Duration::from_secs(def.bloqueio_minutos as u64 * 60) {
            bloquear(&app, "inatividade");
        }
    }
}

/// Evento do sistema operativo, filtrado pelas definições do cofre.
#[allow(dead_code)]
fn evento_sistema(app: &AppHandle, motivo: &'static str) {
    let Some(def) = app.state::<Estado>().politicas() else { return };
    let aplicar = match motivo {
        "suspensao" => def.bloquear_ao_suspender,
        _ => def.bloquear_com_sistema,
    };
    if aplicar {
        bloquear(app, motivo);
    }
}

#[cfg(windows)]
mod windows {
    use std::sync::OnceLock;

    use tauri::AppHandle;
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::System::RemoteDesktop::WTSRegisterSessionNotification;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW, TranslateMessage, MSG, WNDCLASSW,
    };

    static APP: OnceLock<AppHandle> = OnceLock::new();

    const WM_POWERBROADCAST: u32 = 0x0218;
    const PBT_APMSUSPEND: usize = 0x0004;
    const WM_WTSSESSION_CHANGE: u32 = 0x02B1;
    const WTS_CONSOLE_DISCONNECT: usize = 0x2;
    const WTS_REMOTE_DISCONNECT: usize = 0x4;
    const WTS_SESSION_LOGOFF: usize = 0x6;
    const WTS_SESSION_LOCK: usize = 0x7;
    const NOTIFY_FOR_THIS_SESSION: u32 = 0;

    unsafe extern "system" fn procedimento(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        let motivo = match (msg, wparam) {
            (WM_POWERBROADCAST, PBT_APMSUSPEND) => Some("suspensao"),
            (WM_WTSSESSION_CHANGE, WTS_SESSION_LOCK | WTS_SESSION_LOGOFF | WTS_CONSOLE_DISCONNECT | WTS_REMOTE_DISCONNECT) => {
                Some("sistema")
            }
            _ => None,
        };
        if let (Some(m), Some(app)) = (motivo, APP.get()) {
            super::evento_sistema(app, m);
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }

    /// Janela invisível de nível superior (as janelas "message-only" não recebem os avisos de
    /// energia, que são difundidos só para janelas de topo).
    pub fn iniciar(app: AppHandle) {
        if APP.set(app).is_err() {
            return;
        }
        let _ = std::thread::Builder::new().name("lissecurity-sessao-windows".into()).spawn(|| unsafe {
            let instancia = GetModuleHandleW(std::ptr::null());
            let classe: Vec<u16> = "LisSecurityVigia\0".encode_utf16().collect();
            let mut wc: WNDCLASSW = std::mem::zeroed();
            wc.lpfnWndProc = Some(procedimento);
            wc.hInstance = instancia;
            wc.lpszClassName = classe.as_ptr();
            RegisterClassW(&wc);
            let hwnd = CreateWindowExW(
                0,
                classe.as_ptr(),
                classe.as_ptr(),
                0,
                0,
                0,
                0,
                0,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                instancia,
                std::ptr::null(),
            );
            if hwnd.is_null() {
                return;
            }
            WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION);
            let mut msg: MSG = std::mem::zeroed();
            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        });
    }
}
