//! Análise local das senhas guardadas — nada sai do computador (não há consulta a serviços de
//! senhas vazadas). Os alertas são factos verificáveis ("3 senhas reutilizadas"), nunca uma
//! "pontuação de segurança" inventada.
//!
//! A força é estimada com o zxcvbn (Dropbox), que procura padrões, palavras comuns, datas e
//! sequências. É uma ESTIMATIVA do número de tentativas, não uma garantia.

use std::collections::HashMap;

use serde::Serialize;

use crate::modelo::{Conteudo, DadosCofre, Item};

/// O zxcvbn é quadrático no tamanho: acima disto avalia-se só o início (uma senha mais longa
/// é pelo menos tão forte como o seu começo).
const MAX_AVALIACAO: usize = 100;
pub const DIAS_SENHA_ANTIGA: i64 = 365;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Forca {
    /// 0 (muito fraca) a 4 (muito forte)
    pub pontuacao: u8,
    /// log10 do número estimado de tentativas para a adivinhar
    pub log10_tentativas: f64,
}

pub fn forca(senha: &str, contexto: &[&str]) -> Forca {
    if senha.is_empty() {
        return Forca { pontuacao: 0, log10_tentativas: 0.0 };
    }
    let avaliada: String = senha.chars().take(MAX_AVALIACAO).collect();
    let e = zxcvbn::zxcvbn(&avaliada, contexto);
    Forca { pontuacao: u8::from(e.score()), log10_tentativas: e.guesses_log10() }
}

/// Palavras do próprio registo que não devem fazer parte da senha (nome do serviço, domínio…).
fn contexto(item: &Item) -> Vec<String> {
    let mut v = vec![item.titulo.clone()];
    if let Some(l) = item.login() {
        v.push(crate::vista::dominio(&l.url).unwrap_or_default());
        v.push(l.utilizador.clone());
        v.push(l.email.clone());
    }
    v.retain(|s| !s.is_empty());
    v
}

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Relatorio {
    /// (id, pontuação) das senhas com pontuação ≤ 2
    pub fracas: Vec<(String, u8)>,
    /// grupos de registos que partilham exatamente a mesma senha
    pub reutilizadas: Vec<Vec<String>>,
    /// senhas sem alteração há mais de um ano
    pub antigas: Vec<String>,
    pub cartoes_expirados: Vec<String>,
    pub cartoes_a_expirar: Vec<String>,
}

/// Cache de pontuações por registo: (alterado_em, pontuação). Vive só enquanto o cofre está
/// aberto e é largada ao bloquear.
pub type CacheForca = HashMap<String, (i64, u8)>;

pub fn analisar(dados: &DadosCofre, agora: i64, cache: &mut CacheForca) -> Relatorio {
    let mut r = Relatorio::default();
    let mut por_senha: HashMap<&str, Vec<&str>> = HashMap::new();
    let (ano, mes) = ano_mes(agora);

    for item in dados.itens.iter().filter(|i| !i.no_lixo()) {
        match &item.conteudo {
            Conteudo::Login(l) if !l.senha.is_empty() => {
                let p = match cache.get(&item.id) {
                    Some((t, p)) if *t == item.alterado_em => *p,
                    _ => {
                        let ctx = contexto(item);
                        let refs: Vec<&str> = ctx.iter().map(|s| s.as_str()).collect();
                        let p = forca(&l.senha, &refs).pontuacao;
                        cache.insert(item.id.clone(), (item.alterado_em, p));
                        p
                    }
                };
                if p <= 2 {
                    r.fracas.push((item.id.clone(), p));
                }
                por_senha.entry(l.senha.as_str()).or_default().push(&item.id);
                let desde = l.senha_alterada_em.unwrap_or(item.criado_em);
                if agora - desde > DIAS_SENHA_ANTIGA * 86_400_000 {
                    r.antigas.push(item.id.clone());
                }
            }
            Conteudo::Cartao(c) => {
                if let Some((m, a)) = validade(&c.validade) {
                    let meses = (a - ano) * 12 + (m as i32 - mes as i32);
                    if meses < 0 {
                        r.cartoes_expirados.push(item.id.clone());
                    } else if meses <= 2 {
                        r.cartoes_a_expirar.push(item.id.clone());
                    }
                }
            }
            _ => {}
        }
    }
    let mut grupos: Vec<Vec<String>> =
        por_senha.into_values().filter(|ids| ids.len() > 1).map(|ids| ids.into_iter().map(String::from).collect()).collect();
    grupos.sort_by_key(|g| std::cmp::Reverse(g.len()));
    r.reutilizadas = grupos;
    r
}

/// "MM/AA" ou "MM/AAAA" → (mês, ano).
pub fn validade(texto: &str) -> Option<(u32, i32)> {
    let (m, a) = texto.trim().split_once('/')?;
    let m: u32 = m.trim().parse().ok()?;
    let a = a.trim();
    let a: i32 = match a.len() {
        2 => 2000 + a.parse::<i32>().ok()?,
        4 => a.parse().ok()?,
        _ => return None,
    };
    (1..=12).contains(&m).then_some((m, a))
}

/// Ano e mês (UTC) de um instante em milissegundos.
pub fn ano_mes(ms: i64) -> (i32, u32) {
    let (a, m, _, _, _) = data_hora(ms);
    (a, m)
}

/// (ano, mês, dia, hora, minuto) em UTC de um instante em milissegundos
/// (conversão de dias para data civil de Howard Hinnant).
pub fn data_hora(ms: i64) -> (i32, u32, u32, u32, u32) {
    let minutos_do_dia = (ms.rem_euclid(86_400_000) / 60_000) as u32;
    let dias = ms.div_euclid(86_400_000);
    let z = dias + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = (yoe + era * 400 + if m <= 2 { 1 } else { 0 }) as i32;
    (y, m, d, minutos_do_dia / 60, minutos_do_dia % 60)
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn datas() {
        assert_eq!(ano_mes(0), (1970, 1));
        assert_eq!(ano_mes(1_793_404_800_000), (2026, 10)); // 31/10/2026
        assert_eq!(ano_mes(1_793_404_800_000 + 86_400_000), (2026, 11));
        assert_eq!(ano_mes(951_782_400_000), (2000, 2)); // 29/02/2000
        assert_eq!(data_hora(951_782_400_000 + 13 * 3_600_000 + 7 * 60_000), (2000, 2, 29, 13, 7));
        assert_eq!(validade("03/27"), Some((3, 2027)));
        assert_eq!(validade("12/2030"), Some((12, 2030)));
        assert_eq!(validade("13/27"), None);
        assert_eq!(validade("abc"), None);
    }

    #[test]
    fn forca_ordena_senhas() {
        assert!(forca("123456", &[]).pontuacao <= 1);
        assert!(forca("password", &[]).pontuacao <= 1);
        assert_eq!(forca("reboque-gaveta-orvalho-ninho-tufao", &[]).pontuacao, 4);
        // o nome do serviço dentro da senha pesa contra ela
        let com = forca("LisFilms2026", &["LisFilms"]).log10_tentativas;
        let sem = forca("LisFilms2026", &[]).log10_tentativas;
        assert!(com <= sem);
    }
}
