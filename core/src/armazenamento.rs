//! Persistência à prova de falhas.
//!
//! * **Gravação atómica**: escreve-se para um temporário na mesma pasta, força-se para o disco
//!   (`fsync`), relê-se e verifica-se (decifrando) e só então se renomeia por cima do
//!   original. Uma falha a meio deixa sempre o cofre anterior intacto.
//! * **Versão anterior**: antes de cada substituição, a versão em uso é copiada para
//!   `<cofre>.anterior` — se o ficheiro principal se danificar, ainda há para onde voltar.
//! * **Um só escritor**: um trinco exclusivo do sistema (`<cofre>.lock`) impede que duas
//!   instâncias gravem ao mesmo tempo.
//! * Os temporários e cópias só contêm bytes já cifrados; nunca se escreve texto em claro.
//! * Em Unix os ficheiros ficam com permissões 600 e a pasta com 700; no Windows a pasta de
//!   dados da aplicação (%APPDATA%) já só é acessível à conta do utilizador.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use crate::aleatorio;
use crate::erro::{Erro, Resultado};
use crate::formato::TAMANHO_MAXIMO;

pub struct Armazenamento {
    caminho: PathBuf,
    _trinco: File,
}

fn com_sufixo(caminho: &Path, sufixo: &str) -> PathBuf {
    let mut nome = caminho.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    nome.push(sufixo);
    caminho.with_file_name(nome)
}

fn abrir_para_escrita(caminho: &Path) -> std::io::Result<File> {
    let mut o = OpenOptions::new();
    o.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600);
    }
    o.open(caminho)
}

/// Lê um ficheiro recusando tamanhos absurdos (não se carrega 10 GB para a memória).
pub fn ler_limitado(caminho: &Path) -> Resultado<Vec<u8>> {
    let f = File::open(caminho)?;
    let tamanho = f.metadata()?.len();
    if tamanho > TAMANHO_MAXIMO as u64 {
        return Err(Erro::Grande);
    }
    let mut v = Vec::with_capacity(tamanho as usize);
    f.take(TAMANHO_MAXIMO as u64 + 1).read_to_end(&mut v)?;
    if v.len() > TAMANHO_MAXIMO {
        return Err(Erro::Grande);
    }
    Ok(v)
}

fn sincronizar_pasta(_pasta: &Path) {
    #[cfg(unix)]
    if let Ok(d) = File::open(_pasta) {
        let _ = d.sync_all();
    }
}

fn renomear(de: &Path, para: &Path) -> std::io::Result<()> {
    // No Windows um antivírus ou o indexador pode segurar o ficheiro por instantes.
    let mut tentativa = 0;
    loop {
        match fs::rename(de, para) {
            Ok(()) => return Ok(()),
            Err(e) if tentativa < 6 && e.kind() == std::io::ErrorKind::PermissionDenied => {
                tentativa += 1;
                std::thread::sleep(std::time::Duration::from_millis(40 * tentativa));
            }
            Err(e) => return Err(e),
        }
    }
}

/// Escreve `bytes` em `destino` de forma atómica e verificada. `verificar` recebe o que foi
/// relido do disco; se falhar, o destino não é tocado.
pub fn escrever_atomico(destino: &Path, bytes: &[u8], verificar: impl Fn(&[u8]) -> Resultado<()>) -> Resultado<()> {
    let pasta = destino.parent().ok_or_else(|| Erro::invalido("Destino sem pasta."))?;
    let sufixo: String = aleatorio::bytes::<6>()?.iter().map(|b| format!("{b:02x}")).collect();
    let tmp = com_sufixo(destino, &format!(".tmp-{sufixo}"));
    let resultado = (|| -> Resultado<()> {
        {
            let mut f = abrir_para_escrita(&tmp)?;
            f.write_all(bytes)?;
            f.sync_all()?;
        }
        let relido = ler_limitado(&tmp)?;
        if relido != bytes {
            return Err(Erro::Io("os dados relidos não coincidem com os gravados".into()));
        }
        verificar(&relido)?;
        renomear(&tmp, destino)?;
        sincronizar_pasta(pasta);
        Ok(())
    })();
    if resultado.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    resultado
}

impl Armazenamento {
    /// Abre (ou prepara) o local do cofre e fica com o trinco exclusivo até ser largado.
    pub fn abrir(caminho: PathBuf) -> Resultado<Self> {
        let pasta = caminho.parent().ok_or_else(|| Erro::invalido("Local do cofre inválido."))?.to_path_buf();
        fs::create_dir_all(&pasta)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&pasta, fs::Permissions::from_mode(0o700));
        }
        let mut o = OpenOptions::new();
        o.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            o.mode(0o600);
        }
        let trinco = o.open(com_sufixo(&caminho, ".lock"))?;
        match trinco.try_lock() {
            Ok(()) => {}
            Err(fs::TryLockError::WouldBlock) => return Err(Erro::EmUso),
            Err(fs::TryLockError::Error(e)) => return Err(e.into()),
        }
        let a = Armazenamento { caminho, _trinco: trinco };
        a.limpar_temporarios();
        Ok(a)
    }

    pub fn caminho(&self) -> &Path {
        &self.caminho
    }

    pub fn existe(&self) -> bool {
        self.caminho.is_file()
    }

    pub fn ler(&self) -> Resultado<Vec<u8>> {
        ler_limitado(&self.caminho)
    }

    pub fn caminho_anterior(&self) -> PathBuf {
        com_sufixo(&self.caminho, ".anterior")
    }

    pub fn ler_anterior(&self) -> Resultado<Option<Vec<u8>>> {
        let p = self.caminho_anterior();
        if !p.is_file() {
            return Ok(None);
        }
        ler_limitado(&p).map(Some)
    }

    /// Substitui o cofre em disco. A versão em uso passa a `.anterior` (também atomicamente).
    pub fn gravar(&self, bytes: &[u8], verificar: impl Fn(&[u8]) -> Resultado<()>) -> Resultado<()> {
        if self.existe() {
            let atual = self.ler()?;
            escrever_atomico(&self.caminho_anterior(), &atual, |_| Ok(()))?;
        }
        escrever_atomico(&self.caminho, bytes, verificar)
    }

    /// Guarda uma cópia (cifrada) do ficheiro atual ao lado dele, p. ex. antes de restaurar uma
    /// cópia de segurança ou de migrar o esquema. Devolve o caminho criado.
    pub fn guardar_copia_local(&self, etiqueta: &str) -> Resultado<Option<PathBuf>> {
        if !self.existe() {
            return Ok(None);
        }
        let destino = com_sufixo(&self.caminho, &format!(".{etiqueta}"));
        let atual = self.ler()?;
        escrever_atomico(&destino, &atual, |_| Ok(()))?;
        Ok(Some(destino))
    }

    /// O ficheiro principal está danificado mas a versão anterior abre: guarda o danificado à
    /// parte (para análise, continua cifrado) e repõe a anterior como principal.
    pub fn repor_anterior(&self, etiqueta_danificado: &str, verificar: impl Fn(&[u8]) -> Resultado<()>) -> Resultado<()> {
        let anterior = self.ler_anterior()?.ok_or_else(|| Erro::invalido("Não há versão anterior do cofre."))?;
        self.guardar_copia_local(etiqueta_danificado)?;
        escrever_atomico(&self.caminho, &anterior, verificar)
    }

    /// Remove temporários deixados por um encerramento inesperado (só têm bytes cifrados).
    fn limpar_temporarios(&self) {
        let (Some(pasta), Some(nome)) = (self.caminho.parent(), self.caminho.file_name()) else { return };
        let prefixo = format!("{}.tmp-", nome.to_string_lossy());
        if let Ok(entradas) = fs::read_dir(pasta) {
            for e in entradas.flatten() {
                if e.file_name().to_string_lossy().starts_with(&prefixo) {
                    let _ = fs::remove_file(e.path());
                }
            }
        }
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn grava_e_guarda_anterior() {
        let d = tempfile::tempdir().unwrap();
        let a = Armazenamento::abrir(d.path().join("cofre.lissec")).unwrap();
        a.gravar(b"um", |_| Ok(())).unwrap();
        a.gravar(b"dois", |_| Ok(())).unwrap();
        assert_eq!(a.ler().unwrap(), b"dois");
        assert_eq!(a.ler_anterior().unwrap().unwrap(), b"um");
    }

    #[test]
    fn verificacao_falhada_nao_toca_no_original() {
        let d = tempfile::tempdir().unwrap();
        let a = Armazenamento::abrir(d.path().join("cofre.lissec")).unwrap();
        a.gravar(b"bom", |_| Ok(())).unwrap();
        assert!(a.gravar(b"mau", |_| Err(Erro::IntegridadeFalhou)).is_err());
        assert_eq!(a.ler().unwrap(), b"bom");
        // sem temporários esquecidos
        let n = fs::read_dir(d.path()).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().contains(".tmp-")).count();
        assert_eq!(n, 0);
    }

    #[test]
    fn trinco_impede_segunda_instancia() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("cofre.lissec");
        let a = Armazenamento::abrir(p.clone()).unwrap();
        assert!(matches!(Armazenamento::abrir(p.clone()), Err(Erro::EmUso)));
        drop(a);
        assert!(Armazenamento::abrir(p).is_ok());
    }

    #[test]
    fn temporarios_antigos_sao_limpos() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("cofre.lissec");
        fs::write(d.path().join("cofre.lissec.tmp-abc"), b"x").unwrap();
        let _a = Armazenamento::abrir(p).unwrap();
        assert!(!d.path().join("cofre.lissec.tmp-abc").exists());
    }

    #[cfg(unix)]
    #[test]
    fn permissoes_restritas() {
        use std::os::unix::fs::PermissionsExt;
        let d = tempfile::tempdir().unwrap();
        let a = Armazenamento::abrir(d.path().join("sub").join("cofre.lissec")).unwrap();
        a.gravar(b"x", |_| Ok(())).unwrap();
        assert_eq!(fs::metadata(a.caminho()).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(fs::metadata(d.path().join("sub")).unwrap().permissions().mode() & 0o777, 0o700);
    }
}
