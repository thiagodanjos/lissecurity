//! Formato binário do ficheiro do cofre (`.lissec`), versão 1. Inteiros em little-endian.
//!
//! ```text
//! ┌─ prefixo fixo (73 bytes) ──────────────────────────────────────────────┐
//! │ magia "LISSECUR" (8) │ versão u16 │ flags u16 (=0) │ id do cofre (16)    │
//! │ kdf u8 (1 = Argon2id v1.3) │ memória KiB u32 │ iterações u32 │ vias u32  │
//! │ salt (32)                                                               │
//! ├─ ranhuras de chave ─────────────────────────────────────────────────────┤
//! │ n u8 (1..=4) │ n × [ tipo u8 │ nonce (24) │ chave do cofre cifrada (48) ] │
//! ├─ dados ─────────────────────────────────────────────────────────────────┤
//! │ nonce (24) │ tamanho u64 │ texto cifrado + etiqueta Poly1305           │
//! └─────────────────────────────────────────────────────────────────────────┘
//! ```
//!
//! * Cada ranhura guarda a **chave do cofre** (aleatória, 256 bits) cifrada com uma chave
//!   derivada da senha mestra (Argon2id) ou da chave de recuperação (HKDF). AAD da ranhura =
//!   prefixo fixo + tipo, por isso mexer nos parâmetros, no salt ou no id invalida-a.
//! * Os dados (todos os registos, definições, lixo e históricos) são um único bloco cifrado com
//!   a chave do cofre. AAD = tudo o que vem antes do texto cifrado, por isso qualquer alteração
//!   ao cabeçalho também é detetada.
//! * O cabeçalho só tem metadados técnicos: não há títulos, contagens, datas nem nomes.

use crate::cripto::{ParamsKdf, TAM_NONCE, TAM_SALT, TAM_TAG};
use crate::erro::{Erro, Resultado};

pub const MAGIA: &[u8; 8] = b"LISSECUR";
pub const VERSAO_FORMATO: u16 = 1;
pub const KDF_ARGON2ID_13: u8 = 1;
pub const TAM_CHAVE_CIFRADA: usize = 32 + TAM_TAG;
pub const TAM_PREFIXO: usize = 8 + 2 + 2 + 16 + 1 + 4 + 4 + 4 + TAM_SALT;
pub const MAX_RANHURAS: usize = 4;
/// Um cofre pessoal com milhares de registos cabe em poucos MB; acima disto recusa-se a ler.
pub const TAMANHO_MAXIMO: usize = 256 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TipoRanhura {
    Senha = 1,
    Recuperacao = 2,
}

impl TipoRanhura {
    fn de_u8(v: u8) -> Option<Self> {
        match v {
            1 => Some(TipoRanhura::Senha),
            2 => Some(TipoRanhura::Recuperacao),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Ranhura {
    pub tipo: TipoRanhura,
    pub nonce: [u8; TAM_NONCE],
    pub chave_cifrada: [u8; TAM_CHAVE_CIFRADA],
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Cabecalho {
    pub id_cofre: [u8; 16],
    pub kdf: ParamsKdf,
    pub salt: [u8; TAM_SALT],
    pub ranhuras: Vec<Ranhura>,
}

impl Cabecalho {
    /// Os 73 bytes do prefixo fixo (magia → salt).
    pub fn prefixo(&self) -> Vec<u8> {
        let mut v = Vec::with_capacity(TAM_PREFIXO);
        v.extend_from_slice(MAGIA);
        v.extend_from_slice(&VERSAO_FORMATO.to_le_bytes());
        v.extend_from_slice(&0u16.to_le_bytes());
        v.extend_from_slice(&self.id_cofre);
        v.push(KDF_ARGON2ID_13);
        v.extend_from_slice(&self.kdf.memoria_kib.to_le_bytes());
        v.extend_from_slice(&self.kdf.iteracoes.to_le_bytes());
        v.extend_from_slice(&self.kdf.paralelismo.to_le_bytes());
        v.extend_from_slice(&self.salt);
        debug_assert_eq!(v.len(), TAM_PREFIXO);
        v
    }

    /// AAD de uma ranhura: prefixo + tipo.
    pub fn aad_ranhura(&self, tipo: TipoRanhura) -> Vec<u8> {
        let mut v = self.prefixo();
        v.push(tipo as u8);
        v
    }

    pub fn ranhura(&self, tipo: TipoRanhura) -> Option<&Ranhura> {
        self.ranhuras.iter().find(|r| r.tipo == tipo)
    }

    fn bytes_com_ranhuras(&self) -> Vec<u8> {
        let mut v = self.prefixo();
        v.push(self.ranhuras.len() as u8);
        for r in &self.ranhuras {
            v.push(r.tipo as u8);
            v.extend_from_slice(&r.nonce);
            v.extend_from_slice(&r.chave_cifrada);
        }
        v
    }
}

/// O ficheiro completo, ainda cifrado.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FicheiroCofre {
    pub cabecalho: Cabecalho,
    pub nonce_dados: [u8; TAM_NONCE],
    pub dados_cifrados: Vec<u8>,
}

/// AAD dos dados: cabeçalho com ranhuras + nonce + tamanho (tudo menos o texto cifrado).
pub fn aad_dados(cab: &Cabecalho, nonce: &[u8; TAM_NONCE], tamanho: usize) -> Vec<u8> {
    let mut v = cab.bytes_com_ranhuras();
    v.extend_from_slice(nonce);
    v.extend_from_slice(&(tamanho as u64).to_le_bytes());
    v
}

impl FicheiroCofre {
    pub fn aad_dados(&self) -> Vec<u8> {
        aad_dados(&self.cabecalho, &self.nonce_dados, self.dados_cifrados.len())
    }

    pub fn serializar(&self) -> Vec<u8> {
        let mut v = self.aad_dados();
        v.extend_from_slice(&self.dados_cifrados);
        v
    }

    /// Leitura estrita: qualquer byte fora do sítio é erro. Não há "tentar perceber".
    pub fn ler(b: &[u8]) -> Resultado<Self> {
        if b.len() > TAMANHO_MAXIMO {
            return Err(Erro::Grande);
        }
        let mut l = Leitor { b, pos: 0 };
        if l.fatia(8)? != MAGIA {
            return Err(Erro::FormatoInvalido);
        }
        let versao = l.u16()?;
        if versao != VERSAO_FORMATO {
            return Err(if versao > VERSAO_FORMATO { Erro::VersaoNaoSuportada(versao) } else { Erro::FormatoInvalido });
        }
        if l.u16()? != 0 {
            return Err(Erro::FormatoInvalido);
        }
        let id_cofre: [u8; 16] = l.fixo()?;
        if l.u8()? != KDF_ARGON2ID_13 {
            return Err(Erro::FormatoInvalido);
        }
        let kdf = ParamsKdf { memoria_kib: l.u32()?, iteracoes: l.u32()?, paralelismo: l.u32()? };
        if !kdf.validos() {
            return Err(Erro::ParametrosInvalidos);
        }
        let salt: [u8; TAM_SALT] = l.fixo()?;
        let n = l.u8()? as usize;
        if n == 0 || n > MAX_RANHURAS {
            return Err(Erro::FormatoInvalido);
        }
        let mut ranhuras = Vec::with_capacity(n);
        for _ in 0..n {
            let tipo = TipoRanhura::de_u8(l.u8()?).ok_or(Erro::FormatoInvalido)?;
            if ranhuras.iter().any(|r: &Ranhura| r.tipo == tipo) {
                return Err(Erro::FormatoInvalido);
            }
            ranhuras.push(Ranhura { tipo, nonce: l.fixo()?, chave_cifrada: l.fixo()? });
        }
        if !ranhuras.iter().any(|r| r.tipo == TipoRanhura::Senha) {
            return Err(Erro::FormatoInvalido);
        }
        let nonce_dados: [u8; TAM_NONCE] = l.fixo()?;
        let tamanho = l.u64()?;
        let resto = b.len() - l.pos;
        if tamanho as usize != resto || resto < TAM_TAG {
            return Err(Erro::FormatoInvalido);
        }
        let dados_cifrados = b[l.pos..].to_vec();
        Ok(FicheiroCofre { cabecalho: Cabecalho { id_cofre, kdf, salt, ranhuras }, nonce_dados, dados_cifrados })
    }
}

struct Leitor<'a> {
    b: &'a [u8],
    pos: usize,
}

impl<'a> Leitor<'a> {
    fn fatia(&mut self, n: usize) -> Resultado<&'a [u8]> {
        let fim = self.pos.checked_add(n).ok_or(Erro::FormatoInvalido)?;
        let s = self.b.get(self.pos..fim).ok_or(Erro::FormatoInvalido)?;
        self.pos = fim;
        Ok(s)
    }
    fn fixo<const N: usize>(&mut self) -> Resultado<[u8; N]> {
        Ok(self.fatia(N)?.try_into().expect("tamanho verificado"))
    }
    fn u8(&mut self) -> Resultado<u8> {
        Ok(self.fixo::<1>()?[0])
    }
    fn u16(&mut self) -> Resultado<u16> {
        Ok(u16::from_le_bytes(self.fixo()?))
    }
    fn u32(&mut self) -> Resultado<u32> {
        Ok(u32::from_le_bytes(self.fixo()?))
    }
    fn u64(&mut self) -> Resultado<u64> {
        Ok(u64::from_le_bytes(self.fixo()?))
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    fn exemplo() -> FicheiroCofre {
        FicheiroCofre {
            cabecalho: Cabecalho {
                id_cofre: [9; 16],
                kdf: ParamsKdf::para_testes(),
                salt: [3; TAM_SALT],
                ranhuras: vec![Ranhura { tipo: TipoRanhura::Senha, nonce: [4; TAM_NONCE], chave_cifrada: [5; TAM_CHAVE_CIFRADA] }],
            },
            nonce_dados: [6; TAM_NONCE],
            dados_cifrados: vec![7; 40],
        }
    }

    #[test]
    fn ida_e_volta() {
        let f = exemplo();
        let b = f.serializar();
        assert_eq!(&b[..8], MAGIA);
        assert_eq!(FicheiroCofre::ler(&b).unwrap(), f);
    }

    #[test]
    fn rejeita_truncado_e_lixo_no_fim() {
        let b = exemplo().serializar();
        for corte in [0, 5, 20, TAM_PREFIXO, b.len() - 1] {
            assert!(FicheiroCofre::ler(&b[..corte]).is_err(), "corte {corte}");
        }
        let mut mais = b.clone();
        mais.push(0);
        assert!(FicheiroCofre::ler(&mais).is_err());
    }

    #[test]
    fn rejeita_versao_futura_e_magia_errada() {
        let mut b = exemplo().serializar();
        b[8] = 2;
        assert!(matches!(FicheiroCofre::ler(&b), Err(Erro::VersaoNaoSuportada(2))));
        let mut b = exemplo().serializar();
        b[0] = b'X';
        assert!(matches!(FicheiroCofre::ler(&b), Err(Erro::FormatoInvalido)));
    }

    #[test]
    fn rejeita_parametros_abusivos() {
        let mut f = exemplo();
        f.cabecalho.kdf.memoria_kib = u32::MAX;
        assert!(matches!(FicheiroCofre::ler(&f.serializar()), Err(Erro::ParametrosInvalidos)));
    }

    #[test]
    fn rejeita_ranhuras_duplicadas_ou_sem_senha() {
        let mut f = exemplo();
        let r = f.cabecalho.ranhuras[0].clone();
        f.cabecalho.ranhuras.push(r);
        assert!(FicheiroCofre::ler(&f.serializar()).is_err());
        let mut f = exemplo();
        f.cabecalho.ranhuras[0].tipo = TipoRanhura::Recuperacao;
        assert!(FicheiroCofre::ler(&f.serializar()).is_err());
    }
}
