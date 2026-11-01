//! Chave de recuperação: 160 bits aleatórios + 16 bits de verificação, escritos em Base32 de
//! Crockford (sem I, L, O, U para não haver confusões) em 9 grupos de 4, p. ex.
//! `7Q4M-K2ZD-…`. Quem a tiver consegue abrir o cofre — guarda-se fora do computador.
//!
//! Os 16 bits de verificação só servem para apanhar erros de escrita antes de gastar tempo a
//! tentar abrir o cofre; não reduzem a segurança (os 160 bits continuam todos aleatórios).

use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::aleatorio;
use crate::erro::{Erro, Resultado};

pub const TAM_ENTROPIA: usize = 20;
const TAM_TOTAL: usize = TAM_ENTROPIA + 2;
const ALFABETO: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/// 22 bytes = 176 bits → 36 símbolos de 5 bits (o último leva 4 bits de enchimento a zero).
const SIMBOLOS: usize = (TAM_TOTAL * 8).div_ceil(5);

fn verificacao(entropia: &[u8]) -> [u8; 2] {
    let h = Sha256::digest([b"LisSecurity recuperacao v1".as_slice(), entropia].concat());
    [h[0], h[1]]
}

/// Gera uma chave nova. Devolve (material de 20 bytes, texto para mostrar à pessoa).
pub fn gerar() -> Resultado<(Zeroizing<[u8; TAM_ENTROPIA]>, Zeroizing<String>)> {
    let mut material = Zeroizing::new([0u8; TAM_ENTROPIA]);
    aleatorio::preencher(&mut *material)?;
    let texto = codificar(&material);
    Ok((material, texto))
}

pub fn codificar(material: &[u8; TAM_ENTROPIA]) -> Zeroizing<String> {
    let mut total = Zeroizing::new([0u8; TAM_TOTAL]);
    total[..TAM_ENTROPIA].copy_from_slice(material);
    total[TAM_ENTROPIA..].copy_from_slice(&verificacao(material));

    let mut simbolos = Zeroizing::new(Vec::with_capacity(SIMBOLOS));
    let (mut acumulado, mut bits) = (0u32, 0u32);
    for &byte in total.iter() {
        acumulado = (acumulado << 8) | byte as u32;
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            simbolos.push(ALFABETO[((acumulado >> bits) & 31) as usize]);
        }
        acumulado &= (1 << bits) - 1;
    }
    if bits > 0 {
        simbolos.push(ALFABETO[((acumulado << (5 - bits)) & 31) as usize]);
    }
    let mut texto = Zeroizing::new(String::with_capacity(SIMBOLOS + SIMBOLOS / 4));
    for (i, s) in simbolos.iter().enumerate() {
        if i > 0 && i % 4 == 0 {
            texto.push('-');
        }
        texto.push(*s as char);
    }
    texto
}

fn valor(c: u8) -> Option<u32> {
    let c = match c.to_ascii_uppercase() {
        b'O' => b'0',
        b'I' | b'L' => b'1',
        x => x,
    };
    ALFABETO.iter().position(|&a| a == c).map(|p| p as u32)
}

/// Lê o texto escrito pela pessoa: ignora espaços, hífenes e maiúsculas/minúsculas, e aceita
/// as confusões habituais (O→0, I/L→1). Falha se faltar algo ou a verificação não bater.
pub fn decodificar(texto: &str) -> Resultado<Zeroizing<[u8; TAM_ENTROPIA]>> {
    let limpo: Zeroizing<Vec<u8>> = Zeroizing::new(texto.bytes().filter(|c| !matches!(c, b'-' | b' ' | b'\t' | b'\n' | b'\r')).collect());
    if limpo.len() != SIMBOLOS {
        return Err(Erro::ChaveRecuperacaoMalFormada);
    }
    let mut total = Zeroizing::new([0u8; TAM_TOTAL]);
    let (mut acumulado, mut bits, mut i) = (0u32, 0u32, 0usize);
    for &c in limpo.iter() {
        let v = valor(c).ok_or(Erro::ChaveRecuperacaoMalFormada)?;
        acumulado = (acumulado << 5) | v;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            if i < TAM_TOTAL {
                total[i] = (acumulado >> bits) as u8;
            }
            i += 1;
            acumulado &= (1 << bits) - 1;
        }
    }
    // os bits de enchimento têm de ser zero
    if i != TAM_TOTAL || acumulado != 0 {
        return Err(Erro::ChaveRecuperacaoMalFormada);
    }
    let mut material = Zeroizing::new([0u8; TAM_ENTROPIA]);
    material.copy_from_slice(&total[..TAM_ENTROPIA]);
    if verificacao(&*material) != total[TAM_ENTROPIA..] {
        return Err(Erro::ChaveRecuperacaoMalFormada);
    }
    Ok(material)
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn ida_e_volta() {
        for _ in 0..50 {
            let (m, t) = gerar().unwrap();
            assert_eq!(t.len(), 36 + 8);
            assert_eq!(*decodificar(&t).unwrap(), *m);
            assert_eq!(*decodificar(&t.to_lowercase().replace('-', " ")).unwrap(), *m);
        }
    }

    #[test]
    fn apanha_erros_de_escrita() {
        let (_, t) = gerar().unwrap();
        let mut b: Vec<u8> = t.bytes().collect();
        let i = 5;
        b[i] = if b[i] == b'A' { b'B' } else { b'A' };
        assert!(decodificar(std::str::from_utf8(&b).unwrap()).is_err());
        assert!(decodificar(&t[..t.len() - 1]).is_err());
        assert!(decodificar(&format!("{}X", *t)).is_err());
    }

    #[test]
    fn aceita_confusoes_comuns() {
        let m = [0u8; TAM_ENTROPIA];
        let t = codificar(&m);
        assert_eq!(*decodificar(&t.replace('0', "O")).unwrap(), m);
    }
}
