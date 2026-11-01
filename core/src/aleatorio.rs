//! Aleatoriedade criptográfica. Tudo o que é segredo (chaves, salts, nonces, senhas geradas,
//! chave de recuperação) vem daqui, que lê diretamente do gerador do sistema operativo
//! (BCryptGenRandom no Windows, getrandom(2) no Linux). Nunca se usa um gerador "de efeitos".

use crate::erro::{Erro, Resultado};

pub fn preencher(destino: &mut [u8]) -> Resultado<()> {
    getrandom::fill(destino).map_err(|_| Erro::Aleatoriedade)
}

pub fn bytes<const N: usize>() -> Resultado<[u8; N]> {
    let mut b = [0u8; N];
    preencher(&mut b)?;
    Ok(b)
}

fn u32_aleatorio() -> Resultado<u32> {
    Ok(u32::from_le_bytes(bytes::<4>()?))
}

/// Inteiro uniforme em `[0, limite)`, sem enviesamento (amostragem por rejeição:
/// os valores do "resto" que fariam alguns números sair mais vezes são descartados).
pub fn uniforme(limite: u32) -> Resultado<u32> {
    assert!(limite > 0, "limite tem de ser positivo");
    let zona = u32::MAX - (u32::MAX % limite);
    loop {
        let r = u32_aleatorio()?;
        if r < zona {
            return Ok(r % limite);
        }
    }
}

/// Identificador aleatório no formato UUID v4 (só para identificar registos dentro do cofre).
pub fn uuid_v4() -> Resultado<String> {
    let mut b = bytes::<16>()?;
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    Ok(format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32]))
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn uniforme_fica_no_intervalo_e_cobre_todos() {
        let mut vistos = [false; 7];
        for _ in 0..2000 {
            let v = uniforme(7).unwrap();
            assert!(v < 7);
            vistos[v as usize] = true;
        }
        assert!(vistos.iter().all(|v| *v));
    }

    #[test]
    fn uuid_tem_formato_v4() {
        let u = uuid_v4().unwrap();
        assert_eq!(u.len(), 36);
        assert_eq!(&u[14..15], "4");
        assert_ne!(uuid_v4().unwrap(), u);
    }
}
