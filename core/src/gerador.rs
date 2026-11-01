//! Gerador local de senhas e frases-senha. Usa só o gerador criptográfico do sistema
//! (`aleatorio`). Nada do que é gerado é registado ou guardado em histórico.

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::aleatorio;
use crate::erro::{Erro, Resultado};

const MINUSCULAS: &str = "abcdefghijklmnopqrstuvwxyz";
const MAIUSCULAS: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const NUMEROS: &str = "0123456789";
/// Sem aspas, barra invertida nem espaço: são os que mais partem formulários e terminais.
const SIMBOLOS: &str = "!#$%&*+-=?@^_~()[]{}<>.,:;/";
/// Caracteres fáceis de confundir quando se lê ou dita uma senha.
const SEMELHANTES: &str = "Il1|O0oS5Z2B8G6`'.,:;";

static PALAVRAS_TEXTO: &str = include_str!("../recursos/palavras-pt.txt");

/// Lista de 2048 palavras portuguesas sem acentos (lista BIP-39 em português, licença MIT).
pub fn palavras() -> Vec<&'static str> {
    PALAVRAS_TEXTO.split_whitespace().collect()
}

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OpcoesSenha {
    pub comprimento: u32,
    pub maiusculas: bool,
    pub minusculas: bool,
    pub numeros: bool,
    pub simbolos: bool,
    pub evitar_semelhantes: bool,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OpcoesFrase {
    pub palavras: u32,
    pub separador: String,
    pub maiuscula_inicial: bool,
    pub incluir_numero: bool,
}

pub struct Gerada {
    pub valor: Zeroizing<String>,
    /// Entropia da ESCOLHA aleatória (o que um atacante que conhece as opções teria de
    /// adivinhar). É uma estimativa por cima: a obrigação de incluir cada tipo de carácter
    /// tira uma fração de bit.
    pub entropia_bits: f64,
}

fn conjunto(base: &str, evitar: bool) -> Vec<char> {
    base.chars().filter(|c| !evitar || !SEMELHANTES.contains(*c)).collect()
}

pub fn gerar_senha(o: &OpcoesSenha) -> Resultado<Gerada> {
    if !(4..=256).contains(&o.comprimento) {
        return Err(Erro::invalido("O comprimento tem de ficar entre 4 e 256 caracteres."));
    }
    let mut classes: Vec<Vec<char>> = Vec::new();
    for (ativo, base) in [(o.minusculas, MINUSCULAS), (o.maiusculas, MAIUSCULAS), (o.numeros, NUMEROS), (o.simbolos, SIMBOLOS)] {
        if ativo {
            classes.push(conjunto(base, o.evitar_semelhantes));
        }
    }
    if classes.is_empty() {
        return Err(Erro::invalido("Escolhe pelo menos um tipo de carácter."));
    }
    let todos: Vec<char> = classes.iter().flatten().copied().collect();
    let n = o.comprimento as usize;
    // Amostragem uniforme sobre o conjunto todo, repetida até conter um carácter de cada
    // classe escolhida (rejeição: o resultado é uniforme entre as senhas válidas).
    let exigir_todas = n >= classes.len();
    loop {
        let mut s = Zeroizing::new(String::with_capacity(n));
        for _ in 0..n {
            s.push(todos[aleatorio::uniforme(todos.len() as u32)? as usize]);
        }
        if !exigir_todas || classes.iter().all(|c| s.chars().any(|x| c.contains(&x))) {
            return Ok(Gerada { valor: s, entropia_bits: n as f64 * (todos.len() as f64).log2() });
        }
    }
}

pub fn gerar_frase(o: &OpcoesFrase) -> Resultado<Gerada> {
    if !(3..=20).contains(&o.palavras) {
        return Err(Erro::invalido("Escolhe entre 3 e 20 palavras."));
    }
    if o.separador.chars().count() > 3 {
        return Err(Erro::invalido("O separador pode ter no máximo 3 caracteres."));
    }
    let lista = palavras();
    let n = o.palavras as usize;
    let mut partes: Vec<Zeroizing<String>> = Vec::with_capacity(n);
    for _ in 0..n {
        let p = lista[aleatorio::uniforme(lista.len() as u32)? as usize];
        let mut w = Zeroizing::new(String::with_capacity(p.len() + 1));
        if o.maiuscula_inicial {
            let mut cs = p.chars();
            if let Some(c) = cs.next() {
                w.extend(c.to_uppercase());
                w.push_str(cs.as_str());
            }
        } else {
            w.push_str(p);
        }
        partes.push(w);
    }
    let mut entropia = n as f64 * (lista.len() as f64).log2();
    if o.incluir_numero {
        let qual = aleatorio::uniforme(n as u32)? as usize;
        let digito = aleatorio::uniforme(10)?;
        partes[qual].push(char::from_digit(digito, 10).expect("0-9"));
        entropia += (10.0f64).log2() + (n as f64).log2();
    }
    let mut valor = Zeroizing::new(String::new());
    for (i, p) in partes.iter().enumerate() {
        if i > 0 {
            valor.push_str(&o.separador);
        }
        valor.push_str(p);
    }
    Ok(Gerada { valor, entropia_bits: entropia })
}

#[cfg(test)]
mod testes {
    use super::*;

    fn opcoes(n: u32) -> OpcoesSenha {
        OpcoesSenha { comprimento: n, maiusculas: true, minusculas: true, numeros: true, simbolos: true, evitar_semelhantes: false }
    }

    #[test]
    fn lista_de_palavras_valida() {
        let l = palavras();
        assert_eq!(l.len(), 2048);
        let mut u = l.clone();
        u.sort();
        u.dedup();
        assert_eq!(u.len(), 2048, "palavras repetidas");
        assert!(l.iter().all(|p| p.chars().all(|c| c.is_ascii_lowercase())));
    }

    #[test]
    fn senha_tem_comprimento_e_todas_as_classes() {
        for _ in 0..200 {
            let g = gerar_senha(&opcoes(12)).unwrap();
            assert_eq!(g.valor.chars().count(), 12);
            assert!(g.valor.chars().any(|c| c.is_ascii_lowercase()));
            assert!(g.valor.chars().any(|c| c.is_ascii_uppercase()));
            assert!(g.valor.chars().any(|c| c.is_ascii_digit()));
            assert!(g.valor.chars().any(|c| SIMBOLOS.contains(c)));
        }
    }

    #[test]
    fn evita_semelhantes() {
        let mut o = opcoes(256);
        o.evitar_semelhantes = true;
        let g = gerar_senha(&o).unwrap();
        assert!(!g.valor.chars().any(|c| SEMELHANTES.contains(c)));
    }

    #[test]
    fn entropia_coerente() {
        let g = gerar_senha(&OpcoesSenha {
            comprimento: 20,
            maiusculas: false,
            minusculas: true,
            numeros: false,
            simbolos: false,
            evitar_semelhantes: false,
        })
        .unwrap();
        assert!((g.entropia_bits - 20.0 * 26f64.log2()).abs() < 1e-9);
        let f = gerar_frase(&OpcoesFrase { palavras: 6, separador: "-".into(), maiuscula_inicial: false, incluir_numero: false }).unwrap();
        assert!((f.entropia_bits - 66.0).abs() < 1e-9);
        assert_eq!(f.valor.split('-').count(), 6);
    }

    #[test]
    fn nao_se_repete() {
        let a = gerar_senha(&opcoes(24)).unwrap();
        let b = gerar_senha(&opcoes(24)).unwrap();
        assert_ne!(*a.valor, *b.valor);
    }

    #[test]
    fn distribuicao_aproximadamente_uniforme() {
        // 26 letras × 20000 amostras: cada letra deve sair ~3,8 % (tolerância larga).
        let o = OpcoesSenha {
            comprimento: 200,
            maiusculas: false,
            minusculas: true,
            numeros: false,
            simbolos: false,
            evitar_semelhantes: false,
        };
        let mut contagem = [0u32; 26];
        for _ in 0..100 {
            for c in gerar_senha(&o).unwrap().valor.chars() {
                contagem[(c as u8 - b'a') as usize] += 1;
            }
        }
        let esperado = 20000.0 / 26.0;
        assert!(contagem.iter().all(|&c| (c as f64 - esperado).abs() < esperado * 0.2), "{contagem:?}");
    }

    #[test]
    fn opcoes_invalidas() {
        assert!(gerar_senha(&opcoes(2)).is_err());
        assert!(gerar_senha(&OpcoesSenha {
            comprimento: 10,
            maiusculas: false,
            minusculas: false,
            numeros: false,
            simbolos: false,
            evitar_semelhantes: false
        })
        .is_err());
        assert!(gerar_frase(&OpcoesFrase { palavras: 2, separador: "-".into(), maiuscula_inicial: false, incluir_numero: false }).is_err());
    }
}
