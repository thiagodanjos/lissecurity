//! Importação de ficheiros CSV:
//!
//! * **senhas** exportadas por outros gestores e navegadores (Chrome/Edge/Brave/Opera, Firefox,
//!   Bitwarden, LastPass, 1Password, KeePass/KeePassXC, ou um CSV genérico com cabeçalho);
//! * **extratos bancários** (Revolut, ou um CSV com data/descrição/valor).
//!
//! O CSV de senhas está em texto simples: a interface recomenda apagá-lo logo a seguir.
//! O texto lido é apagado da memória quando sai de uso (`Zeroizing`).

use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::erro::{Erro, Resultado};
use crate::financas;
use crate::modelo::{Conteudo, Item, Login, Movimento, Nota};
use crate::totp::Totp;
use crate::vista::{dominio, normalizar};

pub type Tabela = Zeroizing<Vec<Vec<String>>>;

/// Lê CSV (RFC 4180): aspas, aspas duplicadas, quebras de linha dentro de aspas, CRLF, BOM.
/// O separador (`,`, `;` ou tabulação) é detetado na primeira linha.
pub fn ler_csv(texto: &str) -> Tabela {
    let texto = texto.strip_prefix('\u{feff}').unwrap_or(texto);
    let primeira = texto.lines().next().unwrap_or("");
    let conta = |c: char| primeira.chars().filter(|x| *x == c).count();
    let sep = [',', ';', '\t'].into_iter().max_by_key(|c| conta(*c)).unwrap_or(',');

    let mut linhas: Vec<Vec<String>> = Vec::new();
    let mut linha: Vec<String> = Vec::new();
    let mut campo = String::new();
    let mut aspas = false;
    let mut chars = texto.chars().peekable();
    while let Some(c) = chars.next() {
        if aspas {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    campo.push('"');
                    chars.next();
                } else {
                    aspas = false;
                }
            } else {
                campo.push(c);
            }
        } else if c == '"' && campo.is_empty() {
            aspas = true;
        } else if c == sep {
            linha.push(std::mem::take(&mut campo));
        } else if c == '\n' || c == '\r' {
            if c == '\r' && chars.peek() == Some(&'\n') {
                chars.next();
            }
            linha.push(std::mem::take(&mut campo));
            if !(linha.len() == 1 && linha[0].is_empty()) {
                linhas.push(std::mem::take(&mut linha));
            }
            linha.clear();
        } else {
            campo.push(c);
        }
    }
    if !campo.is_empty() || !linha.is_empty() {
        linha.push(campo);
        linhas.push(linha);
    }
    Zeroizing::new(linhas)
}

fn chave_coluna(s: &str) -> String {
    normalizar(s).chars().filter(|c| c.is_alphanumeric()).collect()
}

struct Colunas(Vec<String>);

impl Colunas {
    fn de(cabecalho: &[String]) -> Self {
        Colunas(cabecalho.iter().map(|c| chave_coluna(c)).collect())
    }
    fn tem(&self, nome: &str) -> bool {
        self.0.iter().any(|c| c == nome)
    }
    fn indice(&self, nomes: &[&str]) -> Option<usize> {
        nomes.iter().find_map(|n| self.0.iter().position(|c| c == n))
    }
}

fn celula(linha: &[String], i: Option<usize>) -> &str {
    i.and_then(|i| linha.get(i)).map(|s| s.trim()).unwrap_or("")
}

// ───────────────────────────── senhas ─────────────────────────────

pub struct SenhasImportadas {
    pub formato: &'static str,
    pub itens: Vec<Item>,
    /// linhas sem nada aproveitável (nem senha, nem utilizador, nem endereço)
    pub ignorados: usize,
}

fn verdadeiro(v: &str) -> bool {
    matches!(normalizar(v.trim()).as_str(), "1" | "true" | "yes" | "sim" | "x" | "y")
}

pub fn senhas_de_csv(texto: &str) -> Resultado<SenhasImportadas> {
    let tabela = ler_csv(texto);
    let (cabecalho, linhas) = tabela.split_first().ok_or_else(|| Erro::invalido("O ficheiro está vazio."))?;
    let c = Colunas::de(cabecalho);

    let formato = if c.tem("loginuri") && c.tem("loginpassword") {
        "Bitwarden"
    } else if c.tem("httprealm") || c.tem("formactionorigin") {
        "Firefox"
    } else if c.tem("grouping") && c.tem("extra") {
        "LastPass"
    } else if c.tem("otpauth") && c.tem("archived") {
        "1Password"
    } else if c.tem("group") && c.tem("title") && (c.tem("lastmodified") || c.tem("icon")) {
        "KeePass / KeePassXC"
    } else if c.0.len() >= 4 && c.tem("name") && c.tem("url") && c.tem("username") && c.tem("password") {
        "Chrome / Edge / Brave"
    } else {
        "CSV genérico"
    };

    let i_titulo = c.indice(&["name", "title", "nome", "titulo"]);
    let i_url = c.indice(&["loginuri", "url", "website", "site", "endereco", "uri", "loginurl"]);
    let i_user = c.indice(&["loginusername", "username", "user", "login", "utilizador", "usuario", "nomedeutilizador"]);
    let i_email = c.indice(&["email", "mail"]);
    let i_senha = c.indice(&["loginpassword", "password", "senha", "palavrapasse", "pass"]);
    let i_notas = c.indice(&["notes", "note", "extra", "notas", "nota", "comments"]);
    let i_totp = c.indice(&["logintotp", "totp", "otpauth", "otp"]);
    let i_categoria = c.indice(&["folder", "grouping", "group", "categoria", "pasta", "category"]);
    let i_favorito = c.indice(&["favorite", "fav", "favorito"]);
    let i_tipo = if formato == "Bitwarden" { c.indice(&["type"]) } else { None };

    if i_senha.is_none() && !(i_user.is_some() && (i_url.is_some() || i_titulo.is_some())) {
        return Err(Erro::invalido(
            "Não reconheço as colunas deste CSV. Exporta as senhas como CSV a partir do navegador ou do gestor de senhas (com a linha de cabeçalho).",
        ));
    }

    let mut itens = Vec::new();
    let mut ignorados = 0;
    for l in linhas {
        let tipo = celula(l, i_tipo).to_ascii_lowercase();
        let url = celula(l, i_url).to_string();
        let utilizador = celula(l, i_user).to_string();
        let senha = celula(l, i_senha).to_string();
        let notas = celula(l, i_notas).to_string();
        let titulo_bruto = celula(l, i_titulo);
        let titulo: String = if !titulo_bruto.is_empty() {
            titulo_bruto.to_string()
        } else if let Some(d) = dominio(&url) {
            d
        } else if !utilizador.is_empty() {
            utilizador.clone()
        } else {
            "Importado".into()
        }
        .chars()
        .take(200)
        .collect();
        let categoria: String = celula(l, i_categoria).chars().take(60).collect();

        let conteudo = if tipo == "note" || tipo == "securenote" {
            if notas.is_empty() {
                ignorados += 1;
                continue;
            }
            Conteudo::Nota(Nota { tipo_nota: "nota".into(), conteudo: notas.clone(), codigos: vec![] })
        } else if !tipo.is_empty() && tipo != "login" {
            ignorados += 1; // cartões/identidades do Bitwarden: formato diferente, não se adivinha
            continue;
        } else {
            if senha.is_empty() && utilizador.is_empty() && url.is_empty() {
                ignorados += 1;
                continue;
            }
            let totp = celula(l, i_totp);
            let (utilizador, email) = if i_email.is_none() && utilizador.contains('@') {
                (String::new(), utilizador.clone())
            } else {
                (utilizador.clone(), celula(l, i_email).to_string())
            };
            Conteudo::Login(Login {
                url: url.chars().take(2_000).collect(),
                utilizador: utilizador.chars().take(500).collect(),
                email: email.chars().take(500).collect(),
                senha: senha.clone(),
                senha_alterada_em: None,
                historico: vec![],
                totp: if !totp.is_empty() && Totp::ler(totp).is_ok() { totp.to_string() } else { String::new() },
            })
        };
        let notas_item = if matches!(conteudo, Conteudo::Nota(_)) { String::new() } else { notas.chars().take(100_000).collect() };
        let item = Item {
            id: String::new(),
            titulo,
            favorito: verdadeiro(celula(l, i_favorito)),
            categoria,
            etiquetas: vec!["importado".into()],
            notas: notas_item,
            campos: vec![],
            criado_em: 0,
            alterado_em: 0,
            eliminado_em: None,
            conteudo,
        };
        if item.validar().is_err() {
            ignorados += 1;
            continue;
        }
        itens.push(item);
    }
    Ok(SenhasImportadas { formato, itens, ignorados })
}

// ───────────────────────────── extratos ─────────────────────────────

pub struct ExtratoImportado {
    pub origem: &'static str,
    pub movimentos: Vec<Movimento>,
    /// movimentos não concluídos (pendentes, anulados, recusados) ou linhas ilegíveis
    pub ignorados: usize,
}

/// "-1.234,56" / "1,234.56" / "-12.34" / "12,5" → cêntimos.
pub fn ler_valor(v: &str) -> Option<i64> {
    let limpo: String = v.trim().chars().filter(|c| !c.is_whitespace() && !"€$£R".contains(*c)).collect();
    if limpo.is_empty() {
        return None;
    }
    let (negativo, corpo) = match limpo.strip_prefix('-') {
        Some(r) => (true, r.to_string()),
        None => (false, limpo.trim_start_matches('+').to_string()),
    };
    // o último separador (',' ou '.') seguido de 1–2 algarismos é o decimal
    let pos = corpo.rfind([',', '.']);
    let (inteiro, decimal) = match pos {
        Some(p) if corpo.len() - p - 1 <= 2 && corpo.len() - p - 1 > 0 => (&corpo[..p], &corpo[p + 1..]),
        _ => (corpo.as_str(), ""),
    };
    let inteiro: String = inteiro.chars().filter(|c| c.is_ascii_digit()).collect();
    if inteiro.is_empty() && decimal.is_empty() {
        return None;
    }
    let mut cent: i64 = inteiro.parse::<i64>().unwrap_or(0).checked_mul(100)?;
    if !decimal.is_empty() {
        let d: i64 = decimal.parse().ok()?;
        cent += if decimal.len() == 1 { d * 10 } else { d };
    }
    Some(if negativo { -cent } else { cent })
}

/// "2024-01-02 10:11:12", "2024-01-02", "02/01/2024 10:11", "02-01-2024" → milissegundos (UTC).
pub fn ler_data(v: &str) -> Option<i64> {
    let v = v.trim();
    let (data, hora) = v.split_once([' ', 'T']).unwrap_or((v, ""));
    let partes: Vec<&str> = data.split(['-', '/', '.']).collect();
    if partes.len() != 3 {
        return None;
    }
    let n: Vec<i64> = partes.iter().map(|p| p.parse().ok()).collect::<Option<_>>()?;
    let (a, m, d) = if partes[0].len() == 4 { (n[0], n[1], n[2]) } else { (n[2], n[1], n[0]) };
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) || !(1970..=2200).contains(&a) {
        return None;
    }
    let hms: Vec<i64> = hora.split(':').filter_map(|x| x.trim().split('.').next()?.parse().ok()).collect();
    let segundos_dia = hms.first().unwrap_or(&0) * 3600 + hms.get(1).unwrap_or(&0) * 60 + hms.get(2).unwrap_or(&0);
    Some((dias_desde_1970(a, m, d) * 86_400 + segundos_dia) * 1000)
}

/// Dias desde 1970-01-01 (algoritmo de Howard Hinnant).
pub fn dias_desde_1970(a: i64, m: i64, d: i64) -> i64 {
    let a = if m <= 2 { a - 1 } else { a };
    let era = a.div_euclid(400);
    let yoe = a - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

pub fn extrato_de_csv(texto: &str) -> Resultado<ExtratoImportado> {
    let tabela = ler_csv(texto);
    let (cabecalho, linhas) = tabela.split_first().ok_or_else(|| Erro::invalido("O ficheiro está vazio."))?;
    let c = Colunas::de(cabecalho);
    let revolut = (c.tem("product") || c.tem("produto")) && (c.tem("completeddate") || c.tem("datadeconclusao") || c.tem("starteddate"));
    let origem = if revolut { "Revolut" } else { "Extrato" };

    let i_tipo = c.indice(&["type", "tipo"]);
    let i_data =
        c.indice(&["completeddate", "datadeconclusao", "starteddate", "datadeinicio", "date", "data", "datamovimento", "datavalor"]);
    let i_inicio = c.indice(&["starteddate", "datadeinicio"]);
    let i_desc = c.indice(&["description", "descricao", "descritivo", "movimento", "detalhes", "concept"]);
    let i_valor = c.indice(&["amount", "montante", "quantia", "valor", "importancia"]);
    let i_taxa = c.indice(&["fee", "comissao", "taxa", "comissoes"]);
    let i_moeda = c.indice(&["currency", "moeda", "divisa"]);
    let i_estado = c.indice(&["state", "estado"]);
    let i_saldo = c.indice(&["balance", "saldo"]);

    if i_data.is_none() || i_desc.is_none() || i_valor.is_none() {
        return Err(Erro::invalido(
            "Não reconheço este extrato. No Revolut: Conta → Extrato → Excel/CSV. Noutros bancos, o CSV precisa de colunas de data, descrição e valor.",
        ));
    }

    let mut movimentos = Vec::new();
    let mut ignorados = 0;
    for l in linhas {
        let estado = normalizar(celula(l, i_estado));
        if !estado.is_empty() && !["completed", "concluido", "concluida", "completo", "completa"].contains(&estado.as_str()) {
            ignorados += 1;
            continue;
        }
        let data = ler_data(celula(l, i_data)).or_else(|| ler_data(celula(l, i_inicio)));
        let valor = ler_valor(celula(l, i_valor));
        let (Some(data), Some(valor)) = (data, valor) else {
            ignorados += 1;
            continue;
        };
        let taxa = ler_valor(celula(l, i_taxa)).unwrap_or(0).abs();
        let valor = valor - taxa;
        let descricao: String = celula(l, i_desc).chars().take(300).collect();
        let moeda: String = {
            let m = celula(l, i_moeda).to_uppercase();
            if m.is_empty() {
                "EUR".into()
            } else {
                m.chars().take(5).collect()
            }
        };
        let tipo: String = celula(l, i_tipo).to_uppercase().chars().take(40).collect();
        let saldo = celula(l, i_saldo);
        let impressao = Sha256::digest(format!("{origem}|{data}|{descricao}|{valor}|{moeda}|{tipo}|{saldo}").as_bytes());
        let id: String = impressao[..12].iter().map(|b| format!("{b:02x}")).collect();
        let categoria = financas::categorizar(&descricao, &tipo, valor, &[]);
        movimentos.push(Movimento { id, data, descricao, valor, moeda, tipo, categoria, origem: origem.into() });
    }
    Ok(ExtratoImportado { origem, movimentos, ignorados })
}

#[cfg(test)]
mod testes {
    use super::*;
    use crate::modelo::Conteudo;

    #[test]
    fn csv_com_aspas_e_quebras() {
        let t = ler_csv("\u{feff}a,b,c\r\n1,\"dois, com \"\"aspas\"\"\",\"três\nlinhas\"\n\n4,5,6");
        assert_eq!(t.len(), 3);
        assert_eq!(t[1][1], "dois, com \"aspas\"");
        assert_eq!(t[1][2], "três\nlinhas");
        assert_eq!(t[2], vec!["4", "5", "6"]);
        let p = ler_csv("a;b\n1,5;2");
        assert_eq!(p[1], vec!["1,5", "2"]);
    }

    #[test]
    fn importa_chrome() {
        let r = senhas_de_csv("name,url,username,password,note\nExemplo,https://exemplo.invalid/login,ana,senha-ficticia-1,\n,https://outro.invalid,bruno@exemplo.invalid,x,nota\n,,,,\n").unwrap();
        assert_eq!(r.formato, "Chrome / Edge / Brave");
        assert_eq!(r.itens.len(), 2);
        assert_eq!(r.ignorados, 1);
        assert_eq!(r.itens[1].titulo, "outro.invalid");
        match &r.itens[1].conteudo {
            Conteudo::Login(l) => {
                assert_eq!(l.email, "bruno@exemplo.invalid");
                assert!(l.utilizador.is_empty());
            }
            _ => unreachable!(),
        }
    }

    #[test]
    fn importa_bitwarden_com_pasta_favorito_totp_e_nota() {
        let csv = "folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n\
                   Trabalho,1,login,Correio,,,0,https://mail.invalid,ana,s3nha,GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ\n\
                   ,,note,Nota secreta,conteúdo fictício,,0,,,,\n\
                   ,,card,Cartão,,,0,,,,\n";
        let r = senhas_de_csv(csv).unwrap();
        assert_eq!(r.formato, "Bitwarden");
        assert_eq!(r.itens.len(), 2);
        assert_eq!(r.ignorados, 1);
        assert_eq!(r.itens[0].categoria, "Trabalho");
        assert!(r.itens[0].favorito);
        match &r.itens[0].conteudo {
            Conteudo::Login(l) => assert!(!l.totp.is_empty()),
            _ => unreachable!(),
        }
        assert!(matches!(r.itens[1].conteudo, Conteudo::Nota(_)));
    }

    #[test]
    fn importa_firefox_sem_titulo() {
        let r = senhas_de_csv("\"url\",\"username\",\"password\",\"httpRealm\",\"formActionOrigin\",\"guid\"\n\"https://www.loja.invalid\",\"ana\",\"x\",,\"\",\"{1}\"\n").unwrap();
        assert_eq!(r.formato, "Firefox");
        assert_eq!(r.itens[0].titulo, "loja.invalid");
    }

    #[test]
    fn recusa_csv_desconhecido() {
        assert!(senhas_de_csv("a,b\n1,2").is_err());
        assert!(senhas_de_csv("").is_err());
    }

    #[test]
    fn valores_e_datas() {
        assert_eq!(ler_valor("-12.34"), Some(-1234));
        assert_eq!(ler_valor("-1.234,56"), Some(-123456));
        assert_eq!(ler_valor("1,234.56"), Some(123456));
        assert_eq!(ler_valor("12,5"), Some(1250));
        assert_eq!(ler_valor("100"), Some(10000));
        assert_eq!(ler_valor("€ -3,00"), Some(-300));
        assert_eq!(ler_valor("abc"), None);
        assert_eq!(ler_data("2026-10-31 13:07:00"), Some(1_793_404_800_000 + (13 * 3600 + 7 * 60) * 1000));
        assert_eq!(ler_data("31/10/2026"), Some(1_793_404_800_000));
        assert_eq!(ler_data("2026-13-01"), None);
    }

    #[test]
    fn importa_extrato_revolut() {
        let csv = "Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance\n\
                   CARD_PAYMENT,Current,2026-10-01 10:00:00,2026-10-02 09:00:00,Pingo Doce,-23.45,0.00,EUR,COMPLETED,976.55\n\
                   CARD_PAYMENT,Current,2026-10-03 10:00:00,2026-10-03 11:00:00,Netflix.com,-7.99,0.00,EUR,COMPLETED,968.56\n\
                   CARD_PAYMENT,Current,2026-10-04 10:00:00,,Loja,-5.00,0.00,EUR,REVERTED,968.56\n\
                   TOPUP,Current,2026-10-05 10:00:00,2026-10-05 10:00:01,Payment from Exemplo,500.00,0.00,EUR,COMPLETED,1468.56\n\
                   ATM,Current,2026-10-06 10:00:00,2026-10-06 10:00:01,Cash at Multibanco,-40.00,1.00,EUR,COMPLETED,1427.56\n";
        let r = extrato_de_csv(csv).unwrap();
        assert_eq!(r.origem, "Revolut");
        assert_eq!(r.movimentos.len(), 4);
        assert_eq!(r.ignorados, 1);
        assert_eq!(r.movimentos[0].categoria, "supermercado");
        assert_eq!(r.movimentos[1].categoria, "subscricoes");
        assert_eq!(r.movimentos[2].categoria, "carregamentos");
        assert_eq!(r.movimentos[3].valor, -4100); // 40 € + 1 € de comissão
        assert_eq!(r.movimentos[3].categoria, "levantamentos");
        // a mesma linha dá sempre o mesmo id (para não duplicar ao reimportar)
        assert_eq!(extrato_de_csv(csv).unwrap().movimentos[0].id, r.movimentos[0].id);
    }

    #[test]
    fn importa_extrato_generico_pt() {
        let r = extrato_de_csv("Data;Descrição;Valor\n02/10/2026;Continente Lisboa;-15,20\n03/10/2026;Ordenado;1.200,00\n").unwrap();
        assert_eq!(r.origem, "Extrato");
        assert_eq!(r.movimentos.len(), 2);
        assert_eq!(r.movimentos[0].valor, -1520);
        assert_eq!(r.movimentos[1].valor, 120000);
        assert_eq!(r.movimentos[1].categoria, "rendimentos");
    }
}
