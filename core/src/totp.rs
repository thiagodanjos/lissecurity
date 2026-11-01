//! Códigos de verificação em 2 passos (TOTP, RFC 6238 sobre HOTP, RFC 4226).
//!
//! Aceita a chave em Base32 (como os sites a mostram, com ou sem espaços) ou o link
//! `otpauth://totp/…` do código QR. A chave fica cifrada no cofre como qualquer segredo; a
//! interface só recebe o código de 6 (ou 8) dígitos do momento.
//!
//! Nota honesta: guardar a 2FA no mesmo cofre das senhas é prático, mas quem abrir o cofre
//! fica com os dois fatores. A interface explica isto ao configurar.

use hmac::{Hmac, Mac};
use zeroize::Zeroizing;

use crate::erro::{Erro, Resultado};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Algoritmo {
    Sha1,
    Sha256,
    Sha512,
}

pub struct Totp {
    segredo: Zeroizing<Vec<u8>>,
    pub algoritmo: Algoritmo,
    pub digitos: u32,
    pub periodo: u64,
    pub emissor: Option<String>,
}

impl std::fmt::Debug for Totp {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Totp {{ {:?}, {} dígitos, {} s }}", self.algoritmo, self.digitos, self.periodo)
    }
}

fn invalida() -> Erro {
    Erro::invalido("A chave 2FA não é válida. Cola a chave secreta (letras A–Z e algarismos 2–7) ou o link otpauth://.")
}

/// Base32 (RFC 4648), sem distinguir maiúsculas, ignorando espaços, hífenes e '='.
fn base32(texto: &str) -> Resultado<Zeroizing<Vec<u8>>> {
    let mut saida = Zeroizing::new(Vec::with_capacity(texto.len() * 5 / 8));
    let (mut acumulado, mut bits) = (0u64, 0u32);
    for c in texto.bytes() {
        let v = match c.to_ascii_uppercase() {
            b'A'..=b'Z' => c.to_ascii_uppercase() - b'A',
            b'2'..=b'7' => c - b'2' + 26,
            b' ' | b'-' | b'=' | b'\t' => continue,
            _ => return Err(invalida()),
        } as u64;
        acumulado = (acumulado << 5) | v;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            saida.push((acumulado >> bits) as u8);
            acumulado &= (1 << bits) - 1;
        }
    }
    if saida.len() < 10 {
        // menos de 80 bits não é uma chave TOTP real
        return Err(invalida());
    }
    Ok(saida)
}

fn decodificar_percentagem(s: &str) -> String {
    let b = s.as_bytes();
    let mut v = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let hex = |c: u8| (c as char).to_digit(16);
            if let (Some(a), Some(c)) = (hex(b[i + 1]), hex(b[i + 2])) {
                v.push((a * 16 + c) as u8);
                i += 3;
                continue;
            }
        }
        v.push(if b[i] == b'+' { b' ' } else { b[i] });
        i += 1;
    }
    String::from_utf8_lossy(&v).into_owned()
}

impl Totp {
    pub fn ler(texto: &str) -> Resultado<Self> {
        let t = texto.trim();
        if t.len() > 2_000 {
            return Err(invalida());
        }
        let minusculo = t.to_ascii_lowercase();
        if !minusculo.starts_with("otpauth://") {
            return Ok(Totp { segredo: base32(t)?, algoritmo: Algoritmo::Sha1, digitos: 6, periodo: 30, emissor: None });
        }
        if !minusculo.starts_with("otpauth://totp/") {
            return Err(Erro::invalido("Só são suportados códigos baseados no tempo (TOTP)."));
        }
        let (_, consulta) = t.split_once('?').ok_or_else(invalida)?;
        let mut r = Totp { segredo: Zeroizing::new(Vec::new()), algoritmo: Algoritmo::Sha1, digitos: 6, periodo: 30, emissor: None };
        for par in consulta.split('&') {
            let (k, v) = par.split_once('=').unwrap_or((par, ""));
            let v = decodificar_percentagem(v);
            match k.to_ascii_lowercase().as_str() {
                "secret" => r.segredo = base32(&v)?,
                "issuer" => r.emissor = Some(v.chars().take(100).collect()),
                "digits" => r.digitos = v.parse().map_err(|_| invalida())?,
                "period" => r.periodo = v.parse().map_err(|_| invalida())?,
                "algorithm" => {
                    r.algoritmo = match v.to_ascii_uppercase().as_str() {
                        "SHA1" => Algoritmo::Sha1,
                        "SHA256" => Algoritmo::Sha256,
                        "SHA512" => Algoritmo::Sha512,
                        _ => return Err(invalida()),
                    }
                }
                _ => {}
            }
        }
        if r.segredo.is_empty() || !(6..=8).contains(&r.digitos) || !(10..=300).contains(&r.periodo) {
            return Err(invalida());
        }
        Ok(r)
    }

    fn hotp(&self, contador: u64) -> u32 {
        let msg = contador.to_be_bytes();
        let resumo: Vec<u8> = match self.algoritmo {
            Algoritmo::Sha1 => {
                let mut m = Hmac::<sha1::Sha1>::new_from_slice(&self.segredo).expect("o HMAC aceita qualquer tamanho de chave");
                m.update(&msg);
                m.finalize().into_bytes().to_vec()
            }
            Algoritmo::Sha256 => {
                let mut m = Hmac::<sha2::Sha256>::new_from_slice(&self.segredo).expect("o HMAC aceita qualquer tamanho de chave");
                m.update(&msg);
                m.finalize().into_bytes().to_vec()
            }
            Algoritmo::Sha512 => {
                let mut m = Hmac::<sha2::Sha512>::new_from_slice(&self.segredo).expect("o HMAC aceita qualquer tamanho de chave");
                m.update(&msg);
                m.finalize().into_bytes().to_vec()
            }
        };
        let deslocamento = (resumo[resumo.len() - 1] & 0x0f) as usize;
        let binario = u32::from_be_bytes(resumo[deslocamento..deslocamento + 4].try_into().expect("4 bytes")) & 0x7fff_ffff;
        binario % 10u32.pow(self.digitos)
    }

    /// Código para o instante `segundos` (tempo Unix), com os zeros à esquerda.
    pub fn codigo(&self, segundos: u64) -> String {
        format!("{:0width$}", self.hotp(segundos / self.periodo), width = self.digitos as usize)
    }

    /// Segundos até o código mudar.
    pub fn restante(&self, segundos: u64) -> u64 {
        self.periodo - segundos % self.periodo
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    fn com(algoritmo: Algoritmo, semente: &[u8]) -> Totp {
        Totp { segredo: Zeroizing::new(semente.to_vec()), algoritmo, digitos: 8, periodo: 30, emissor: None }
    }

    /// Vetores de teste do RFC 6238 (apêndice B).
    #[test]
    fn vetores_rfc6238() {
        let s1 = com(Algoritmo::Sha1, b"12345678901234567890");
        let s256 = com(Algoritmo::Sha256, b"12345678901234567890123456789012");
        let s512 = com(Algoritmo::Sha512, b"1234567890123456789012345678901234567890123456789012345678901234");
        for (t, a, b, c) in [
            (59u64, "94287082", "46119246", "90693936"),
            (1111111109, "07081804", "68084774", "25091201"),
            (1111111111, "14050471", "67062674", "99943326"),
            (1234567890, "89005924", "91819424", "93441116"),
            (2000000000, "69279037", "90698825", "38618901"),
            (20000000000, "65353130", "77737706", "47863826"),
        ] {
            assert_eq!(s1.codigo(t), a, "SHA1 t={t}");
            assert_eq!(s256.codigo(t), b, "SHA256 t={t}");
            assert_eq!(s512.codigo(t), c, "SHA512 t={t}");
        }
    }

    #[test]
    fn le_base32_e_otpauth() {
        let a = Totp::ler("gezd gnbv gy3t qojq gezd gnbv gy3t qojq").unwrap();
        assert_eq!(a.codigo(59), "287082");
        let b = Totp::ler("otpauth://totp/Exemplo:ana%40exemplo.invalid?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Exemplo&digits=8")
            .unwrap();
        assert_eq!(b.codigo(59), "94287082");
        assert_eq!(b.emissor.as_deref(), Some("Exemplo"));
        assert_eq!(b.restante(59), 1);
        assert_eq!(b.restante(60), 30);
    }

    #[test]
    fn recusa_chaves_invalidas() {
        for mau in
            ["", "abc", "GEZD!GNBV", "otpauth://hotp/x?secret=GEZDGNBVGY3TQOJQ", "otpauth://totp/x?secret=GEZDGNBVGY3TQOJQGEZD&digits=12"]
        {
            assert!(Totp::ler(mau).is_err(), "{mau}");
        }
    }

    #[test]
    fn debug_nao_mostra_a_chave() {
        let a = Totp::ler("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ").unwrap();
        assert!(!format!("{a:?}").contains("GEZD"));
    }
}
