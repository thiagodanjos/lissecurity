//! O que a interface pode ver. A camada de interface nunca recebe o registo completo para
//! mostrar: recebe resumos (listas) e vistas MASCARADAS (detalhe). Cada segredo chega como
//! `{ definido, fim? }` e só é revelado ou copiado campo a campo, a pedido.
//!
//! A lista do que é exposto é explícita (lista de permissões): um campo novo no modelo não
//! aparece na interface sem ser acrescentado aqui de propósito.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use unicode_normalization::UnicodeNormalization;

use crate::analise::Relatorio;
use crate::modelo::{Conteudo, DadosCofre, Item};

/// Últimos 4 caracteres alfanuméricos de um número (cartão, IBAN, conta) — só se o número
/// tiver mais do que isso, para nunca mostrar um número curto inteiro.
pub fn fim(v: &str) -> Option<String> {
    let alnum: Vec<char> = v.chars().filter(|c| c.is_alphanumeric()).collect();
    (alnum.len() > 4).then(|| alnum[alnum.len() - 4..].iter().collect())
}

/// Domínio de um endereço, sem esquema, porta, caminho nem "www.".
pub fn dominio(url: &str) -> Option<String> {
    let u = url.trim();
    if u.is_empty() {
        return None;
    }
    let sem_esquema = u.split_once("://").map(|(_, r)| r).unwrap_or(u);
    let host = sem_esquema.split(['/', '?', '#']).next()?.rsplit('@').next()?.split(':').next()?;
    let host = host.trim_start_matches("www.").to_lowercase();
    (!host.is_empty()).then_some(host)
}

pub fn normalizar(s: &str) -> String {
    s.nfd().filter(|c| !unicode_normalization::char::is_combining_mark(*c)).collect::<String>().to_lowercase()
}

fn mascara(v: &str) -> Value {
    json!({ "definido": !v.is_empty() })
}

fn mascara_com_fim(v: &str) -> Value {
    match fim(v) {
        Some(f) => json!({ "definido": true, "fim": f }),
        None => mascara(v),
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Resumo {
    pub id: String,
    pub tipo: &'static str,
    pub titulo: String,
    pub subtitulo: String,
    pub favorito: bool,
    pub categoria: String,
    pub etiquetas: Vec<String>,
    pub criado_em: i64,
    pub alterado_em: i64,
    pub eliminado_em: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dominio: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fim: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instituicao: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bandeira: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub validade: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tipo_detalhe: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub moeda: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pais: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codigos_por_usar: Option<usize>,
}

pub fn resumo(item: &Item) -> Resumo {
    let mut r = Resumo {
        id: item.id.clone(),
        tipo: item.tipo(),
        titulo: item.titulo.clone(),
        subtitulo: String::new(),
        favorito: item.favorito,
        categoria: item.categoria.clone(),
        etiquetas: item.etiquetas.clone(),
        criado_em: item.criado_em,
        alterado_em: item.alterado_em,
        eliminado_em: item.eliminado_em,
        dominio: None,
        fim: None,
        instituicao: None,
        bandeira: None,
        validade: None,
        tipo_detalhe: None,
        moeda: None,
        pais: None,
        codigos_por_usar: None,
    };
    match &item.conteudo {
        Conteudo::Login(l) => {
            r.dominio = dominio(&l.url);
            r.subtitulo =
                [&l.utilizador, &l.email].into_iter().find(|s| !s.is_empty()).cloned().or_else(|| r.dominio.clone()).unwrap_or_default();
        }
        Conteudo::Banco(b) => {
            r.fim = fim(if b.iban.is_empty() { &b.numero_conta } else { &b.iban });
            r.instituicao = Some(b.banco.clone()).filter(|s| !s.is_empty());
            r.moeda = Some(b.moeda.clone()).filter(|s| !s.is_empty());
            r.pais = Some(b.pais.clone()).filter(|s| !s.is_empty());
            r.tipo_detalhe = Some(b.tipo_conta.clone()).filter(|s| !s.is_empty());
            r.subtitulo = b.banco.clone();
        }
        Conteudo::Cartao(c) => {
            r.fim = fim(&c.numero);
            r.instituicao = Some(c.instituicao.clone()).filter(|s| !s.is_empty());
            r.bandeira = Some(c.bandeira.clone()).filter(|s| !s.is_empty());
            r.validade = Some(c.validade.clone()).filter(|s| !s.is_empty());
            r.tipo_detalhe = Some(c.tipo_cartao.clone()).filter(|s| !s.is_empty());
            r.subtitulo = c.instituicao.clone();
        }
        Conteudo::Nota(n) => {
            r.tipo_detalhe = Some(if n.tipo_nota.is_empty() { "nota".into() } else { n.tipo_nota.clone() });
            if n.tipo_nota == "codigos" {
                r.codigos_por_usar = Some(n.codigos.iter().filter(|c| !c.usado).count());
            }
        }
    }
    r
}

/// Vista de detalhe mascarada. `dados` serve para resolver os registos ligados (só o título).
pub fn vista(item: &Item, dados: &DadosCofre) -> Value {
    let ligado = |id: &Option<String>| -> Value {
        id.as_deref()
            .and_then(|id| dados.item(id))
            .map(|i| json!({ "id": i.id, "titulo": i.titulo, "tipo": i.tipo() }))
            .unwrap_or(Value::Null)
    };
    let conteudo = match &item.conteudo {
        Conteudo::Login(l) => json!({
            "tipo": "login",
            "url": l.url,
            "utilizador": l.utilizador,
            "email": l.email,
            "senha": mascara(&l.senha),
            "totp": mascara(&l.totp),
            "senhaAlteradaEm": l.senha_alterada_em,
            "historico": l.historico.iter().map(|h| json!({ "substituidaEm": h.substituida_em })).collect::<Vec<_>>(),
        }),
        Conteudo::Banco(b) => json!({
            "tipo": "banco",
            "banco": b.banco,
            "titular": b.titular,
            "pais": b.pais,
            "moeda": b.moeda,
            "tipoConta": b.tipo_conta,
            "agencia": b.agencia,
            "bic": b.bic,
            "numeroConta": mascara_com_fim(&b.numero_conta),
            "iban": mascara_com_fim(&b.iban),
            "idAcesso": mascara(&b.id_acesso),
            "chavesPix": b.chaves_pix.iter().map(|p| json!({ "tipo": p.tipo, "valor": mascara(&p.valor) })).collect::<Vec<_>>(),
            "credencialLigada": ligado(&b.credencial_ligada),
        }),
        Conteudo::Cartao(c) => json!({
            "tipo": "cartao",
            "instituicao": c.instituicao,
            "bandeira": c.bandeira,
            "titular": c.titular,
            "validade": c.validade,
            "tipoCartao": c.tipo_cartao,
            "numero": mascara_com_fim(&c.numero),
            "contaLigada": ligado(&c.conta_ligada),
        }),
        Conteudo::Nota(n) => json!({
            "tipo": "nota",
            "tipoNota": n.tipo_nota,
            "conteudo": mascara(&n.conteudo),
            "codigos": n.codigos.iter().map(|c| json!({ "usado": c.usado, "valor": mascara(&c.valor) })).collect::<Vec<_>>(),
        }),
    };
    json!({
        "id": item.id,
        "titulo": item.titulo,
        "favorito": item.favorito,
        "categoria": item.categoria,
        "etiquetas": item.etiquetas,
        "criadoEm": item.criado_em,
        "alteradoEm": item.alterado_em,
        "eliminadoEm": item.eliminado_em,
        "notas": mascara(&item.notas),
        "campos": item.campos.iter().map(|c| json!({
            "id": c.id,
            "rotulo": c.rotulo,
            "oculto": c.oculto,
            "valor": if c.oculto { mascara(&c.valor) } else { json!({ "definido": !c.valor.is_empty(), "texto": c.valor }) },
        })).collect::<Vec<_>>(),
        "conteudo": conteudo,
    })
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Consulta {
    pub texto: String,
    /// login | banco | cartao | nota (vazio = todos)
    pub tipo: String,
    /// todos | favoritos | lixo
    pub filtro: String,
    pub categoria: String,
    pub etiqueta: String,
    /// titulo | alterado | criado
    pub ordem: String,
}

/// Texto pesquisável de um registo. Nunca inclui senhas, números, notas nem campos ocultos.
fn texto_pesquisavel(item: &Item) -> String {
    let mut partes: Vec<&str> = vec![&item.titulo, &item.categoria];
    partes.extend(item.etiquetas.iter().map(|s| s.as_str()));
    for c in &item.campos {
        partes.push(&c.rotulo);
        if !c.oculto {
            partes.push(&c.valor);
        }
    }
    match &item.conteudo {
        Conteudo::Login(l) => partes.extend([l.url.as_str(), &l.utilizador, &l.email]),
        Conteudo::Banco(b) => partes.extend([b.banco.as_str(), &b.titular, &b.bic, &b.pais, &b.moeda]),
        Conteudo::Cartao(c) => partes.extend([c.instituicao.as_str(), &c.bandeira, &c.titular]),
        Conteudo::Nota(_) => {}
    }
    normalizar(&partes.join(" "))
}

pub fn pesquisar(dados: &DadosCofre, c: &Consulta) -> Vec<Resumo> {
    let termos: Vec<String> = normalizar(&c.texto).split_whitespace().map(String::from).collect();
    let mut v: Vec<&Item> = dados
        .itens
        .iter()
        .filter(|i| if c.filtro == "lixo" { i.no_lixo() } else { !i.no_lixo() })
        .filter(|i| c.filtro != "favoritos" || i.favorito)
        .filter(|i| c.tipo.is_empty() || i.tipo() == c.tipo)
        .filter(|i| c.categoria.is_empty() || i.categoria == c.categoria)
        .filter(|i| c.etiqueta.is_empty() || i.etiquetas.contains(&c.etiqueta))
        .filter(|i| {
            if termos.is_empty() {
                return true;
            }
            let t = texto_pesquisavel(i);
            termos.iter().all(|x| t.contains(x.as_str()))
        })
        .collect();
    match c.ordem.as_str() {
        "alterado" => v.sort_by_key(|i| std::cmp::Reverse(i.alterado_em)),
        "criado" => v.sort_by_key(|i| std::cmp::Reverse(i.criado_em)),
        _ => v.sort_by_cached_key(|i| normalizar(&i.titulo)),
    }
    v.into_iter().map(resumo).collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Contagem {
    pub nome: String,
    pub total: usize,
}

/// Categorias e etiquetas em uso num tipo (para os filtros).
pub fn agrupamentos(dados: &DadosCofre, tipo: &str) -> (Vec<Contagem>, Vec<Contagem>) {
    let mut cat: std::collections::BTreeMap<String, usize> = Default::default();
    let mut eti: std::collections::BTreeMap<String, usize> = Default::default();
    for i in dados.itens.iter().filter(|i| !i.no_lixo() && (tipo.is_empty() || i.tipo() == tipo)) {
        if !i.categoria.is_empty() {
            *cat.entry(i.categoria.clone()).or_default() += 1;
        }
        for e in &i.etiquetas {
            *eti.entry(e.clone()).or_default() += 1;
        }
    }
    let conv = |m: std::collections::BTreeMap<String, usize>| m.into_iter().map(|(nome, total)| Contagem { nome, total }).collect();
    (conv(cat), conv(eti))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisaoGeral {
    pub nome: String,
    pub total: usize,
    pub logins: usize,
    pub bancos: usize,
    pub cartoes: usize,
    pub notas: usize,
    pub favoritos_total: usize,
    pub no_lixo: usize,
    pub favoritos: Vec<Resumo>,
    pub recentes: Vec<Resumo>,
    pub fracas: usize,
    pub reutilizadas: usize,
    pub grupos_reutilizados: usize,
    pub antigas: usize,
    pub cartoes_expirados: usize,
    pub cartoes_a_expirar: usize,
    pub ultimo_backup: Option<i64>,
    /// houve alterações depois da última cópia de segurança
    pub alteracoes_por_salvaguardar: bool,
    pub copias_automaticas: bool,
    pub lembrete_copia_dias: u32,
    pub total_movimentos: usize,
}

pub fn visao_geral(dados: &DadosCofre, rel: &Relatorio) -> VisaoGeral {
    let ativos: Vec<&Item> = dados.itens.iter().filter(|i| !i.no_lixo()).collect();
    let conta = |t: &str| ativos.iter().filter(|i| i.tipo() == t).count();
    let mut favoritos: Vec<&Item> = ativos.iter().copied().filter(|i| i.favorito).collect();
    favoritos.sort_by_cached_key(|i| normalizar(&i.titulo));
    let mut recentes = ativos.clone();
    recentes.sort_by_key(|i| std::cmp::Reverse(i.alterado_em));
    let ultima_alteracao = dados.itens.iter().map(|i| i.alterado_em.max(i.eliminado_em.unwrap_or(0))).max().unwrap_or(0);
    VisaoGeral {
        nome: dados.perfil.nome.clone(),
        total: ativos.len(),
        logins: conta("login"),
        bancos: conta("banco"),
        cartoes: conta("cartao"),
        notas: conta("nota"),
        favoritos_total: favoritos.len(),
        no_lixo: dados.itens.len() - ativos.len(),
        favoritos: favoritos.into_iter().take(8).map(resumo).collect(),
        recentes: recentes.into_iter().take(6).map(resumo).collect(),
        fracas: rel.fracas.len(),
        reutilizadas: rel.reutilizadas.iter().map(|g| g.len()).sum(),
        grupos_reutilizados: rel.reutilizadas.len(),
        antigas: rel.antigas.len(),
        cartoes_expirados: rel.cartoes_expirados.len(),
        cartoes_a_expirar: rel.cartoes_a_expirar.len(),
        ultimo_backup: dados.ultimo_backup,
        alteracoes_por_salvaguardar: !ativos.is_empty() && dados.ultimo_backup.is_none_or(|b| ultima_alteracao > b),
        copias_automaticas: dados.copias.ativo,
        lembrete_copia_dias: dados.definicoes.lembrete_copia_dias,
        total_movimentos: dados.movimentos.len(),
    }
}

#[cfg(test)]
#[allow(clippy::field_reassign_with_default)]
mod testes {
    use super::*;
    use crate::modelo::{Cartao, Login};

    fn item(id: &str, titulo: &str, conteudo: Conteudo) -> Item {
        Item {
            id: id.into(),
            titulo: titulo.into(),
            favorito: false,
            categoria: String::new(),
            etiquetas: vec![],
            notas: "nota secreta ficticia".into(),
            campos: vec![],
            criado_em: 1,
            alterado_em: 1,
            eliminado_em: None,
            conteudo,
        }
    }

    fn login(senha: &str, utilizador: &str) -> Conteudo {
        let mut l = Login::default();
        l.senha = senha.into();
        l.utilizador = utilizador.into();
        l.url = "https://www.exemplo-ficticio.pt/entrar".into();
        Conteudo::Login(l)
    }

    #[test]
    fn auxiliares() {
        assert_eq!(fim("4111 1111 1111 1234").as_deref(), Some("1234"));
        assert_eq!(fim("123"), None);
        assert_eq!(fim("1234"), None);
        assert_eq!(dominio("https://www.Exemplo.pt:443/a?b").as_deref(), Some("exemplo.pt"));
        assert_eq!(dominio("user@host.pt/x").as_deref(), Some("host.pt"));
        assert_eq!(normalizar("Ação Única"), "acao unica");
    }

    #[test]
    fn vista_nao_tem_segredos() {
        let mut cartao = Cartao::default();
        cartao.numero = "4111111111119876".into();
        let d = DadosCofre::novo(0, "");
        for i in [item("a", "A", login("senha-ficticia-xyz", "ana")), item("b", "B", Conteudo::Cartao(cartao))] {
            let t = vista(&i, &d).to_string();
            assert!(!t.contains("senha-ficticia-xyz"));
            assert!(!t.contains("411111111111"));
            assert!(!t.contains("nota secreta"));
            let r = serde_json::to_string(&resumo(&i)).unwrap();
            assert!(!r.contains("senha-ficticia-xyz") && !r.contains("411111111111") && !r.contains("nota secreta"));
        }
    }

    #[test]
    fn pesquisa_ignora_acentos_e_nao_procura_em_senhas() {
        let mut d = DadosCofre::novo(0, "");
        d.itens.push(item("a", "Finanças Públicas", login("palavra-unica-zzz", "ana")));
        d.itens.push(item("b", "Correio", login("outra", "bruno")));
        let q = |t: &str| pesquisar(&d, &Consulta { texto: t.into(), ..Default::default() }).len();
        assert_eq!(q("financas"), 1);
        assert_eq!(q("FINANÇAS publ"), 1);
        assert_eq!(q("bruno"), 1);
        assert_eq!(q("exemplo-ficticio"), 2);
        assert_eq!(q("palavra-unica-zzz"), 0);
        assert_eq!(q("nota secreta"), 0);
    }

    #[test]
    fn lixo_separado() {
        let mut d = DadosCofre::novo(0, "");
        let mut a = item("a", "A", login("x", ""));
        a.eliminado_em = Some(5);
        d.itens.push(a);
        d.itens.push(item("b", "B", login("y", "")));
        assert_eq!(pesquisar(&d, &Consulta::default()).len(), 1);
        assert_eq!(pesquisar(&d, &Consulta { filtro: "lixo".into(), ..Default::default() })[0].id, "a");
    }
}
