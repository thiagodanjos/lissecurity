//! Primitivas criptográficas — só composição de bibliotecas mantidas, nenhum algoritmo próprio.
//!
//! * Derivação da senha mestra: **Argon2id** (RFC 9106), crate `argon2` do projeto RustCrypto.
//! * Cifra autenticada: **XChaCha20-Poly1305**, crate `chacha20poly1305` (RustCrypto).
//!   O nonce de 192 bits é sempre aleatório e novo a cada cifra; com este tamanho o risco de
//!   repetição por acaso é desprezável, ao contrário dos 96 bits do AES-GCM.
//! * Chave de recuperação → chave de cifra: **HKDF-SHA-256** (a chave já tem 160 bits de
//!   entropia, por isso não precisa de uma derivação lenta).

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use std::time::{Duration, Instant};
use subtle::ConstantTimeEq;
use unicode_normalization::UnicodeNormalization;
use zeroize::Zeroizing;

use crate::aleatorio;
use crate::erro::{Erro, Resultado};

pub const TAM_CHAVE: usize = 32;
pub const TAM_SALT: usize = 32;
pub const TAM_NONCE: usize = 24;
pub const TAM_TAG: usize = 16;

/// Chave simétrica de 256 bits. A memória é apagada quando a chave sai de uso (`Zeroizing`)
/// e o `Debug` nunca mostra o conteúdo.
#[derive(Clone)]
pub struct Chave(Zeroizing<[u8; TAM_CHAVE]>);

impl Chave {
    pub fn aleatoria() -> Resultado<Self> {
        let mut k = Zeroizing::new([0u8; TAM_CHAVE]);
        aleatorio::preencher(&mut *k)?;
        Ok(Chave(k))
    }

    pub fn de_bytes(b: [u8; TAM_CHAVE]) -> Self {
        let k = Chave(Zeroizing::new(b));
        let mut b = b;
        zeroize::Zeroize::zeroize(&mut b);
        k
    }

    pub fn bytes(&self) -> &[u8; TAM_CHAVE] {
        &self.0
    }

    /// Comparação em tempo constante.
    pub fn igual(&self, outra: &Chave) -> bool {
        self.0.ct_eq(&*outra.0).into()
    }
}

impl std::fmt::Debug for Chave {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Chave(<oculta>)")
    }
}

/// Custo do Argon2id. Fica gravado no cabeçalho do cofre para que um cofre criado num
/// computador rápido continue a abrir num mais lento (só demora mais).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ParamsKdf {
    pub memoria_kib: u32,
    pub iteracoes: u32,
    pub paralelismo: u32,
}

impl ParamsKdf {
    /// Limites aceites ao LER um cofre. O mínimo é a recomendação mínima da OWASP para o
    /// Argon2id (19 MiB); o máximo evita que um ficheiro malicioso esgote a memória.
    pub const MIN_MEMORIA_KIB: u32 = 19 * 1024;
    pub const MAX_MEMORIA_KIB: u32 = 4 * 1024 * 1024;
    pub const MIN_ITERACOES: u32 = 1;
    pub const MAX_ITERACOES: u32 = 64;
    pub const MAX_PARALELISMO: u32 = 16;

    /// Ponto de partida da calibração: 128 MiB, que um PC de secretária atual aguenta bem.
    pub const MEMORIA_PADRAO_KIB: u32 = 128 * 1024;
    /// Valor de recurso para máquinas muito lentas (continua bem acima do mínimo da OWASP).
    pub const MEMORIA_RECURSO_KIB: u32 = 64 * 1024;
    pub const ITERACOES_MINIMAS_CRIACAO: u32 = 2;
    pub const ITERACOES_MAXIMAS_CRIACAO: u32 = 12;

    pub fn validos(&self) -> bool {
        (Self::MIN_MEMORIA_KIB..=Self::MAX_MEMORIA_KIB).contains(&self.memoria_kib)
            && (Self::MIN_ITERACOES..=Self::MAX_ITERACOES).contains(&self.iteracoes)
            && (1..=Self::MAX_PARALELISMO).contains(&self.paralelismo)
            // o Argon2 exige pelo menos 8 KiB por via
            && self.memoria_kib >= 8 * self.paralelismo
    }

    /// Parâmetros fixos e baratos — **só** para testes automáticos.
    pub fn para_testes() -> Self {
        ParamsKdf { memoria_kib: Self::MIN_MEMORIA_KIB, iteracoes: 1, paralelismo: 1 }
    }
}

/// Mede este computador e escolhe as iterações para que desbloquear demore cerca de `alvo`.
/// Nunca desce abaixo de 64 MiB × 2 iterações.
pub fn calibrar(alvo: Duration) -> Resultado<ParamsKdf> {
    calibrar_com(alvo, ParamsKdf::MEMORIA_PADRAO_KIB)
}

/// Como `calibrar`, a partir de outra quantidade de memória (p. ex. 256 MiB para o nível
/// "máximo" de proteção). Em máquinas lentas desce para 64 MiB.
pub fn calibrar_com(alvo: Duration, memoria_inicial_kib: u32) -> Resultado<ParamsKdf> {
    let medir = |memoria_kib: u32| -> Resultado<Duration> {
        let p = ParamsKdf { memoria_kib, iteracoes: 1, paralelismo: 1 };
        let salt = aleatorio::bytes::<TAM_SALT>()?;
        let inicio = Instant::now();
        derivar_de_senha("calibracao", &salt, &p)?;
        Ok(inicio.elapsed())
    };

    let mut memoria = memoria_inicial_kib.clamp(ParamsKdf::MEMORIA_RECURSO_KIB, 1024 * 1024);
    let mut por_passagem = medir(memoria)?;
    if por_passagem * ParamsKdf::ITERACOES_MINIMAS_CRIACAO > alvo * 3 {
        // máquina lenta: menos memória para o desbloqueio não passar dos segundos
        memoria = ParamsKdf::MEMORIA_RECURSO_KIB;
        por_passagem = medir(memoria)?;
    }
    let passagens = (alvo.as_secs_f64() / por_passagem.as_secs_f64().max(1e-6)).round() as u32;
    let iteracoes = passagens.clamp(ParamsKdf::ITERACOES_MINIMAS_CRIACAO, ParamsKdf::ITERACOES_MAXIMAS_CRIACAO);
    Ok(ParamsKdf { memoria_kib: memoria, iteracoes, paralelismo: 1 })
}

/// A senha é normalizada em Unicode NFC antes da derivação: "é" escrito como um só carácter
/// ou como "e" + acento dá a mesma chave. Não se cortam espaços nem se limita o tamanho.
pub fn normalizar_senha(senha: &str) -> Zeroizing<String> {
    Zeroizing::new(senha.nfc().collect())
}

/// Argon2id(senha, salt) → chave de 256 bits que embrulha a chave do cofre.
pub fn derivar_de_senha(senha: &str, salt: &[u8; TAM_SALT], p: &ParamsKdf) -> Resultado<Chave> {
    if !p.validos() {
        return Err(Erro::ParametrosInvalidos);
    }
    let params = Params::new(p.memoria_kib, p.iteracoes, p.paralelismo, Some(TAM_CHAVE)).map_err(|_| Erro::ParametrosInvalidos)?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let senha = normalizar_senha(senha);
    let mut saida = Zeroizing::new([0u8; TAM_CHAVE]);
    argon.hash_password_into(senha.as_bytes(), salt, &mut *saida).map_err(|_| Erro::ParametrosInvalidos)?;
    Ok(Chave(saida))
}

/// HKDF-SHA-256 para a chave de recuperação (material com entropia total).
pub fn derivar_de_material(material: &[u8], salt: &[u8], info: &[u8]) -> Chave {
    let hk = hkdf::Hkdf::<sha2::Sha256>::new(Some(salt), material);
    let mut saida = Zeroizing::new([0u8; TAM_CHAVE]);
    hk.expand(info, &mut *saida).expect("32 bytes é sempre um tamanho válido para o HKDF-SHA-256");
    Chave(saida)
}

/// Cifra com XChaCha20-Poly1305 e um nonce aleatório novo. `aad` é autenticado mas não cifrado.
pub fn cifrar(chave: &Chave, aad: &[u8], texto: &[u8]) -> Resultado<([u8; TAM_NONCE], Vec<u8>)> {
    let nonce = aleatorio::bytes::<TAM_NONCE>()?;
    let cifrado = cifrar_com_nonce(chave, &nonce, aad, texto)?;
    Ok((nonce, cifrado))
}

/// Variante para quando o nonce tem de entrar no próprio `aad` (o bloco de dados do cofre).
/// O nonce TEM de vir de `aleatorio::bytes` acabado de gerar — nunca reutilizado.
pub(crate) fn cifrar_com_nonce(chave: &Chave, nonce: &[u8; TAM_NONCE], aad: &[u8], texto: &[u8]) -> Resultado<Vec<u8>> {
    let cifra = XChaCha20Poly1305::new(Key::from_slice(chave.bytes()));
    cifra.encrypt(XNonce::from_slice(nonce), Payload { msg: texto, aad }).map_err(|_| Erro::Serializacao)
}

/// Decifra e verifica a autenticação. Qualquer alteração ao texto cifrado, ao nonce ou ao
/// `aad` faz isto falhar — nunca se devolve texto não autenticado.
pub fn decifrar(chave: &Chave, nonce: &[u8; TAM_NONCE], aad: &[u8], cifrado: &[u8]) -> Option<Zeroizing<Vec<u8>>> {
    let cifra = XChaCha20Poly1305::new(Key::from_slice(chave.bytes()));
    cifra.decrypt(XNonce::from_slice(nonce), Payload { msg: cifrado, aad }).ok().map(Zeroizing::new)
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn cifra_e_decifra() {
        let k = Chave::aleatoria().unwrap();
        let (n, c) = cifrar(&k, b"aad", b"ola mundo").unwrap();
        assert_eq!(c.len(), 9 + TAM_TAG);
        assert_eq!(&*decifrar(&k, &n, b"aad", &c).unwrap(), b"ola mundo");
    }

    #[test]
    fn qualquer_alteracao_falha() {
        let k = Chave::aleatoria().unwrap();
        let (n, c) = cifrar(&k, b"aad", b"segredo ficticio").unwrap();
        for i in 0..c.len() {
            let mut c2 = c.clone();
            c2[i] ^= 0x01;
            assert!(decifrar(&k, &n, b"aad", &c2).is_none(), "byte {i}");
        }
        assert!(decifrar(&k, &n, b"aaD", &c).is_none());
        let mut n2 = n;
        n2[0] ^= 1;
        assert!(decifrar(&k, &n2, b"aad", &c).is_none());
        let outra = Chave::aleatoria().unwrap();
        assert!(decifrar(&outra, &n, b"aad", &c).is_none());
    }

    #[test]
    fn nonces_nunca_se_repetem() {
        let k = Chave::aleatoria().unwrap();
        let (n1, c1) = cifrar(&k, b"", b"x").unwrap();
        let (n2, c2) = cifrar(&k, b"", b"x").unwrap();
        assert_ne!(n1, n2);
        assert_ne!(c1, c2);
    }

    #[test]
    fn argon2id_deterministico_e_sensivel_a_senha_e_salt() {
        let p = ParamsKdf::para_testes();
        let s1 = [1u8; TAM_SALT];
        let s2 = [2u8; TAM_SALT];
        let a = derivar_de_senha("frase de teste ficticia", &s1, &p).unwrap();
        let b = derivar_de_senha("frase de teste ficticia", &s1, &p).unwrap();
        let c = derivar_de_senha("frase de teste ficticia", &s2, &p).unwrap();
        let d = derivar_de_senha("frase de teste ficticiA", &s1, &p).unwrap();
        assert!(a.igual(&b));
        assert!(!a.igual(&c));
        assert!(!a.igual(&d));
    }

    /// Resposta conhecida calculada com a implementação de referência em C (argon2-cffi,
    /// `hash_secret_raw(..., type=Type.ID)`): confirma que é mesmo Argon2id v1.3 com os
    /// parâmetros indicados, e que outra implementação consegue abrir o mesmo cofre.
    #[test]
    fn argon2id_igual_a_implementacao_de_referencia() {
        let salt: [u8; TAM_SALT] = std::array::from_fn(|i| i as u8);
        let p = ParamsKdf { memoria_kib: 19456, iteracoes: 2, paralelismo: 1 };
        let k = derivar_de_senha("Frase-Senha Fictícia de Teste 123", &salt, &p).unwrap();
        let hex: String = k.bytes().iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(hex, "0d4cdc0e720cadfe8ec0f251e854509db6442e6da75e32f527992932973750ae");
    }

    #[test]
    fn senha_normalizada_nfc() {
        let p = ParamsKdf::para_testes();
        let s = [7u8; TAM_SALT];
        let composta = "caf\u{e9}";
        let decomposta = "cafe\u{301}";
        assert!(derivar_de_senha(composta, &s, &p).unwrap().igual(&derivar_de_senha(decomposta, &s, &p).unwrap()));
    }

    #[test]
    fn parametros_fora_dos_limites_sao_recusados() {
        let s = [0u8; TAM_SALT];
        for p in [
            ParamsKdf { memoria_kib: 1024, iteracoes: 1, paralelismo: 1 },
            ParamsKdf { memoria_kib: u32::MAX, iteracoes: 1, paralelismo: 1 },
            ParamsKdf { memoria_kib: 65536, iteracoes: 0, paralelismo: 1 },
            ParamsKdf { memoria_kib: 65536, iteracoes: 1000, paralelismo: 1 },
            ParamsKdf { memoria_kib: 65536, iteracoes: 1, paralelismo: 0 },
        ] {
            assert!(matches!(derivar_de_senha("x", &s, &p), Err(Erro::ParametrosInvalidos)));
        }
    }

    #[test]
    fn debug_nao_mostra_a_chave() {
        let k = Chave::de_bytes([0xAB; 32]);
        assert_eq!(format!("{k:?}"), "Chave(<oculta>)");
    }
}
