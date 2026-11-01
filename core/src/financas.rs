//! Análise local de gastos a partir dos movimentos importados (nada sai do computador).
//!
//! * categorias automáticas por palavras-chave (comerciantes comuns em Portugal e no Brasil),
//!   com regras da pessoa a sobrepor-se;
//! * resumo de um mês: gastos, entradas, por categoria, por dia, principais comerciantes;
//! * evolução mensal e deteção de pagamentos recorrentes (subscrições, contas fixas).

use std::collections::{BTreeMap, HashMap};

use serde::Serialize;

use crate::analise::data_hora;
use crate::modelo::{Movimento, RegraCategoria};
use crate::vista::normalizar;

/// (id, nome) — a ordem é a da interface.
pub const CATEGORIAS: &[(&str, &str)] = &[
    ("supermercado", "Supermercado"),
    ("restauracao", "Restauração"),
    ("transportes", "Transportes"),
    ("subscricoes", "Subscrições"),
    ("compras", "Compras"),
    ("casa", "Casa e contas"),
    ("saude", "Saúde"),
    ("lazer", "Lazer e viagens"),
    ("educacao", "Educação"),
    ("levantamentos", "Levantamentos"),
    ("transferencias", "Transferências"),
    ("carregamentos", "Carregamentos"),
    ("cambio", "Câmbio"),
    ("rendimentos", "Rendimentos"),
    ("outros", "Outros"),
];

/// Categorias que não são gasto nem rendimento (movem dinheiro entre contas/moedas).
pub const NEUTRAS: &[&str] = &["transferencias", "carregamentos", "cambio"];

const PALAVRAS: &[(&str, &[&str])] = &[
    (
        "supermercado",
        &[
            "continente",
            "pingo doce",
            "lidl",
            "aldi",
            "auchan",
            "intermarche",
            "minipreco",
            "mercadona",
            "carrefour",
            "spar",
            "froiz",
            "el corte ingles",
            "pao de acucar",
            "atacadao",
            "assai",
            "extra hiper",
            "makro",
            "supermercado",
            "mercearia",
        ],
    ),
    (
        "restauracao",
        &[
            "restaurante",
            "mcdonald",
            "burger king",
            "kfc",
            "telepizza",
            "pizza",
            "uber eats",
            "ubereats",
            "glovo",
            "bolt food",
            "ifood",
            "starbucks",
            "cafe",
            "pastelaria",
            "padaria",
            "sushi",
            "taberna",
            "h3 ",
            "vitaminas",
            "tasca",
            "churrasqueira",
            "subway",
            "domino",
            "five guys",
            "cervejaria",
            "snack",
        ],
    ),
    (
        "transportes",
        &[
            "uber",
            "bolt",
            "cabify",
            "free now",
            "99app",
            "comboios",
            "cp ",
            "metro",
            "carris",
            "stcp",
            "fertagus",
            "via verde",
            "galp",
            "repsol",
            "cepsa",
            "prio",
            "bp ",
            "shell",
            "petrobras",
            "ipiranga",
            "estacionamento",
            "parking",
            "emel",
            "portagem",
            "flixbus",
            "rede expressos",
            "gira",
        ],
    ),
    (
        "subscricoes",
        &[
            "netflix",
            "spotify",
            "disney",
            "hbo",
            "max.com",
            "prime video",
            "amazon prime",
            "apple.com",
            "icloud",
            "google one",
            "google storage",
            "youtube",
            "playstation",
            "xbox",
            "steam",
            "nintendo",
            "twitch",
            "discord",
            "chatgpt",
            "openai",
            "anthropic",
            "claude.ai",
            "adobe",
            "microsoft 365",
            "office 365",
            "canva",
            "notion",
            "github",
            "dropbox",
            "patreon",
            "crunchyroll",
            "dazn",
            "sport tv",
            "deezer",
        ],
    ),
    (
        "compras",
        &[
            "amazon",
            "aliexpress",
            "temu",
            "shein",
            "zara",
            "primark",
            "h&m",
            "pull&bear",
            "bershka",
            "fnac",
            "worten",
            "ikea",
            "decathlon",
            "mercado livre",
            "mercadolivre",
            "shopee",
            "apple store",
            "leroy merlin",
            "sportzone",
            "radio popular",
            "media markt",
            "pcdiga",
            "globaldata",
            "vinted",
            "olx",
            "wook",
            "bertrand",
        ],
    ),
    (
        "casa",
        &[
            "edp",
            "endesa",
            "iberdrola",
            "goldenergy",
            "meo",
            "nos ",
            "vodafone",
            "nowo",
            "digi",
            "epal",
            "aguas",
            "renda",
            "condominio",
            "seguro",
            "fidelidade",
            "allianz",
            "tranquilidade",
            "ageas",
            "generali",
            "enel",
            "sabesp",
            "claro",
            "vivo",
            "tim ",
        ],
    ),
    ("saude", &["farmacia", "wells", "hospital", "cuf", "luz saude", "lusiadas", "clinica", "dentista", "medico", "drogaria", "optica"]),
    (
        "lazer",
        &[
            "cinema",
            "nos cinemas",
            "cinemas",
            "ticketline",
            "bol.pt",
            "booking",
            "airbnb",
            "hotel",
            "ryanair",
            "easyjet",
            "tap air",
            "vueling",
            "latam",
            "azul linhas",
            "gol linhas",
            "museu",
            "ginasio",
            "fitness",
            "holmes place",
            "solinca",
            "pingo bilhetes",
        ],
    ),
    ("educacao", &["escola", "universidade", "faculdade", "propina", "udemy", "coursera", "livraria", "duolingo"]),
];

/// Comerciante "limpo" para agrupar e para as regras: minúsculas, sem acentos, sem números
/// de loja/referências, sem domínios genéricos.
pub fn comerciante(descricao: &str) -> String {
    let n = normalizar(descricao);
    let palavras: Vec<&str> = n
        .split(|c: char| !c.is_alphanumeric() && c != '&' && c != '.')
        .filter(|p| !p.is_empty() && !p.chars().all(|c| c.is_ascii_digit() || c == '.'))
        .take(4)
        .collect();
    palavras.join(" ").trim_matches('.').to_string()
}

pub fn categorizar(descricao: &str, tipo: &str, valor: i64, regras: &[RegraCategoria]) -> String {
    let com = comerciante(descricao);
    if let Some(r) = regras.iter().find(|r| r.comerciante == com) {
        return r.categoria.clone();
    }
    match tipo {
        "TOPUP" => return "carregamentos".into(),
        "EXCHANGE" => return "cambio".into(),
        "ATM" => return "levantamentos".into(),
        "TRANSFER" if valor < 0 => return "transferencias".into(),
        _ => {}
    }
    let texto = format!(" {} ", normalizar(descricao));
    for (cat, palavras) in PALAVRAS {
        if palavras.iter().any(|p| texto.contains(p)) {
            return (*cat).into();
        }
    }
    if valor > 0 {
        if ["salario", "ordenado", "vencimento", "salary", "payroll"].iter().any(|p| texto.contains(p)) || tipo.is_empty() {
            return "rendimentos".into();
        }
        if tipo == "TRANSFER" || tipo == "REFUND" || tipo == "CARD_REFUND" {
            return if tipo == "TRANSFER" { "rendimentos".into() } else { "compras".into() };
        }
    }
    if tipo == "TRANSFER" {
        return "transferencias".into();
    }
    "outros".into()
}

fn neutra(c: &str) -> bool {
    NEUTRAS.contains(&c)
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Total {
    pub chave: String,
    pub total: i64,
    pub n: usize,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ResumoMes {
    pub ano: i32,
    pub mes: u32,
    pub moeda: String,
    /// soma dos gastos (positivo)
    pub gastos: i64,
    pub entradas: i64,
    pub movimentos: usize,
    pub gastos_mes_anterior: i64,
    pub por_categoria: Vec<Total>,
    /// gasto por dia do mês (índice 0 = dia 1)
    pub por_dia: Vec<i64>,
    pub comerciantes: Vec<Total>,
    pub maior_gasto: Option<i64>,
}

fn mes_de(ms: i64) -> (i32, u32, u32) {
    let (a, m, d, _, _) = data_hora(ms);
    (a, m, d)
}

fn dias_no_mes(a: i32, m: u32) -> u32 {
    match m {
        2 if (a % 4 == 0 && a % 100 != 0) || a % 400 == 0 => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

fn anterior(a: i32, m: u32) -> (i32, u32) {
    if m == 1 {
        (a - 1, 12)
    } else {
        (a, m - 1)
    }
}

fn ordenar(mapa: HashMap<String, (i64, usize)>, limite: usize) -> Vec<Total> {
    let mut v: Vec<Total> = mapa.into_iter().map(|(chave, (total, n))| Total { chave, total, n }).collect();
    v.sort_by(|a, b| b.total.cmp(&a.total).then(a.chave.cmp(&b.chave)));
    v.truncate(limite);
    v
}

pub fn resumo_mes(movs: &[Movimento], ano: i32, mes: u32, moeda: &str) -> ResumoMes {
    let (pa, pm) = anterior(ano, mes);
    let mut r = ResumoMes {
        ano,
        mes,
        moeda: moeda.into(),
        gastos: 0,
        entradas: 0,
        movimentos: 0,
        gastos_mes_anterior: 0,
        por_categoria: vec![],
        por_dia: vec![0; dias_no_mes(ano, mes) as usize],
        comerciantes: vec![],
        maior_gasto: None,
    };
    let mut cat: HashMap<String, (i64, usize)> = HashMap::new();
    let mut com: HashMap<String, (i64, usize)> = HashMap::new();
    for m in movs.iter().filter(|m| m.moeda == moeda) {
        let (a, mm, d) = mes_de(m.data);
        if (a, mm) == (pa, pm) && m.valor < 0 && !neutra(&m.categoria) {
            r.gastos_mes_anterior += -m.valor;
        }
        if (a, mm) != (ano, mes) {
            continue;
        }
        r.movimentos += 1;
        if neutra(&m.categoria) {
            continue;
        }
        if m.valor < 0 {
            let g = -m.valor;
            r.gastos += g;
            r.por_dia[(d - 1) as usize] += g;
            r.maior_gasto = Some(r.maior_gasto.unwrap_or(0).max(g));
            let e = cat.entry(m.categoria.clone()).or_default();
            e.0 += g;
            e.1 += 1;
            let e = com.entry(comerciante(&m.descricao)).or_default();
            e.0 += g;
            e.1 += 1;
        } else {
            r.entradas += m.valor;
        }
    }
    r.por_categoria = ordenar(cat, 20);
    r.comerciantes = ordenar(com, 8);
    r
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Mensal {
    pub ano: i32,
    pub mes: u32,
    pub gastos: i64,
    pub entradas: i64,
}

/// Os últimos `n` meses até (ano, mes), do mais antigo para o mais recente.
pub fn evolucao(movs: &[Movimento], ano: i32, mes: u32, moeda: &str, n: usize) -> Vec<Mensal> {
    let mut meses = vec![(ano, mes)];
    while meses.len() < n {
        let (a, m) = *meses.last().unwrap();
        meses.push(anterior(a, m));
    }
    meses.reverse();
    let mut mapa: BTreeMap<(i32, u32), (i64, i64)> = meses.iter().map(|k| (*k, (0, 0))).collect();
    for m in movs.iter().filter(|m| m.moeda == moeda && !neutra(&m.categoria)) {
        let (a, mm, _) = mes_de(m.data);
        if let Some(e) = mapa.get_mut(&(a, mm)) {
            if m.valor < 0 {
                e.0 += -m.valor;
            } else {
                e.1 += m.valor;
            }
        }
    }
    mapa.into_iter().map(|((ano, mes), (gastos, entradas))| Mensal { ano, mes, gastos, entradas }).collect()
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Recorrente {
    pub comerciante: String,
    pub descricao: String,
    pub categoria: String,
    /// valor médio por mês (positivo)
    pub valor: i64,
    pub meses: usize,
    pub ultimo: i64,
}

/// Comerciantes com saídas em pelo menos 3 meses diferentes e valores parecidos (±20 %)
/// — quase sempre subscrições ou contas fixas.
pub fn recorrentes(movs: &[Movimento], moeda: &str) -> Vec<Recorrente> {
    let mut grupos: HashMap<String, Vec<&Movimento>> = HashMap::new();
    for m in movs.iter().filter(|m| m.moeda == moeda && m.valor < 0 && !neutra(&m.categoria) && m.categoria != "levantamentos") {
        grupos.entry(comerciante(&m.descricao)).or_default().push(m);
    }
    let mut r: Vec<Recorrente> = grupos
        .into_iter()
        .filter_map(|(com, ms)| {
            let mut por_mes: BTreeMap<(i32, u32), i64> = BTreeMap::new();
            for m in &ms {
                let (a, mm, _) = mes_de(m.data);
                *por_mes.entry((a, mm)).or_default() += -m.valor;
            }
            if por_mes.len() < 3 {
                return None;
            }
            let valores: Vec<i64> = por_mes.values().copied().collect();
            let media = valores.iter().sum::<i64>() / valores.len() as i64;
            let parecidos = valores.iter().all(|v| (v - media).abs() * 5 <= media);
            if !parecidos || media == 0 {
                return None;
            }
            let ultimo = ms.iter().max_by_key(|m| m.data)?;
            Some(Recorrente {
                comerciante: com,
                descricao: ultimo.descricao.clone(),
                categoria: ultimo.categoria.clone(),
                valor: media,
                meses: por_mes.len(),
                ultimo: ultimo.data,
            })
        })
        .collect();
    r.sort_by_key(|x| std::cmp::Reverse(x.valor));
    r
}

/// Moedas presentes, da mais usada para a menos usada.
pub fn moedas(movs: &[Movimento]) -> Vec<String> {
    let mut c: HashMap<&str, usize> = HashMap::new();
    for m in movs {
        *c.entry(m.moeda.as_str()).or_default() += 1;
    }
    let mut v: Vec<(&str, usize)> = c.into_iter().collect();
    v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
    v.into_iter().map(|(m, _)| m.to_string()).collect()
}

#[cfg(test)]
mod testes {
    use super::*;
    use crate::importacao::ler_data;

    fn mov(data: &str, desc: &str, valor: i64, tipo: &str) -> Movimento {
        Movimento {
            id: format!("{data}{desc}{valor}"),
            data: ler_data(data).unwrap(),
            descricao: desc.into(),
            valor,
            moeda: "EUR".into(),
            tipo: tipo.into(),
            categoria: categorizar(desc, tipo, valor, &[]),
            origem: "Teste".into(),
        }
    }

    #[test]
    fn categorias_e_regras() {
        assert_eq!(categorizar("PINGO DOCE LISBOA 1234", "CARD_PAYMENT", -100, &[]), "supermercado");
        assert_eq!(categorizar("Uber *Trip", "CARD_PAYMENT", -100, &[]), "transportes");
        assert_eq!(categorizar("Spotify P2A3", "CARD_PAYMENT", -100, &[]), "subscricoes");
        assert_eq!(categorizar("Loja Desconhecida", "CARD_PAYMENT", -100, &[]), "outros");
        assert_eq!(categorizar("To Ana", "TRANSFER", -100, &[]), "transferencias");
        let regras = vec![RegraCategoria { comerciante: comerciante("Loja Desconhecida 22"), categoria: "lazer".into() }];
        assert_eq!(categorizar("Loja Desconhecida 99", "CARD_PAYMENT", -100, &regras), "lazer");
        assert_eq!(comerciante("PINGO DOCE  LISBOA 1234"), "pingo doce lisboa");
    }

    #[test]
    fn resumo_do_mes() {
        let movs = vec![
            mov("2026-10-02", "Continente", -2000, "CARD_PAYMENT"),
            mov("2026-10-02", "Continente", -1000, "CARD_PAYMENT"),
            mov("2026-10-15", "Netflix", -799, "CARD_PAYMENT"),
            mov("2026-10-20", "Top-up", 50000, "TOPUP"),
            mov("2026-10-25", "Salario", 120000, ""),
            mov("2026-09-10", "Lidl", -500, "CARD_PAYMENT"),
        ];
        let r = resumo_mes(&movs, 2026, 10, "EUR");
        assert_eq!(r.gastos, 3799);
        assert_eq!(r.entradas, 120000); // o carregamento não é rendimento
        assert_eq!(r.gastos_mes_anterior, 500);
        assert_eq!(r.por_dia.len(), 31);
        assert_eq!(r.por_dia[1], 3000);
        assert_eq!(r.por_categoria[0].chave, "supermercado");
        assert_eq!(r.comerciantes[0].chave, "continente");
        assert_eq!(r.comerciantes[0].n, 2);
        let e = evolucao(&movs, 2026, 10, "EUR", 3);
        assert_eq!(e.len(), 3);
        assert_eq!((e[0].ano, e[0].mes), (2026, 8));
        assert_eq!(e[2].gastos, 3799);
    }

    #[test]
    fn deteta_recorrentes() {
        let mut movs = vec![];
        for m in ["2026-07-05", "2026-08-05", "2026-09-05", "2026-10-05"] {
            movs.push(mov(m, "Spotify AB", -699, "CARD_PAYMENT"));
        }
        for (m, v) in [("2026-08-01", -1000), ("2026-09-01", -9000), ("2026-10-01", -300)] {
            movs.push(mov(m, "Loja Variavel", v, "CARD_PAYMENT"));
        }
        let r = recorrentes(&movs, "EUR");
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].comerciante, "spotify ab");
        assert_eq!(r[0].valor, 699);
        assert_eq!(r[0].meses, 4);
    }
}
