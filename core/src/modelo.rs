//! Modelo de dados do cofre (o que fica DENTRO do bloco cifrado).
//!
//! `DadosCofre` e cada `Item` apagam a memória ao sair de uso (`ZeroizeOnDrop`), o que apaga
//! também tudo o que está dentro deles. Nenhum tipo implementa um `Debug` que mostre conteúdo:
//! um `{:?}` esquecido num registo nunca imprime uma senha.

use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::erro::{Erro, Resultado};

/// 1 → 2 (v0.2): códigos 2FA nas senhas, movimentos importados, cópias automáticas,
/// preferências do gerador e definições novas. Uma versão antiga recusa abrir um cofre do
/// esquema 2 (em vez de o abrir e, ao gravar, perder os campos que não conhece).
pub const ESQUEMA_ATUAL: u32 = 2;

#[derive(Serialize, Deserialize, Clone, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub struct DadosCofre {
    pub esquema: u32,
    #[serde(default)]
    pub perfil: Perfil,
    #[serde(default)]
    pub definicoes: Definicoes,
    #[serde(default)]
    pub itens: Vec<Item>,
    #[serde(default)]
    pub ultimo_backup: Option<i64>,
    pub criado_em: i64,
    #[serde(default)]
    pub gravado_em: i64,
    /// Cópias automáticas para uma pasta (p. ex. a do Google Drive para computador).
    #[serde(default)]
    pub copias: ConfigCopias,
    #[serde(default)]
    pub gerador: PreferenciasGerador,
    /// Movimentos importados de extratos bancários (CSV), para a análise de gastos.
    #[serde(default)]
    pub movimentos: Vec<Movimento>,
    /// Categoria escolhida pela pessoa para um comerciante (vale para os próximos extratos).
    #[serde(default)]
    pub regras_categoria: Vec<RegraCategoria>,
}

impl std::fmt::Debug for DadosCofre {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "DadosCofre {{ esquema: {}, itens: {} }}", self.esquema, self.itens.len())
    }
}

impl DadosCofre {
    pub fn novo(agora: i64, nome: &str) -> Self {
        DadosCofre {
            esquema: ESQUEMA_ATUAL,
            perfil: Perfil { nome: nome.trim().chars().take(60).collect() },
            definicoes: Definicoes::default(),
            itens: Vec::new(),
            ultimo_backup: None,
            criado_em: agora,
            gravado_em: agora,
            copias: ConfigCopias::default(),
            gerador: PreferenciasGerador::default(),
            movimentos: Vec::new(),
            regras_categoria: Vec::new(),
        }
    }

    pub fn item(&self, id: &str) -> Option<&Item> {
        self.itens.iter().find(|i| i.id == id)
    }

    pub fn item_mut(&mut self, id: &str) -> Option<&mut Item> {
        self.itens.iter_mut().find(|i| i.id == id)
    }

    /// Remove de vez o que está no lixo há mais tempo do que o configurado (0 = nunca).
    pub fn limpar_lixo_antigo(&mut self, agora: i64) -> usize {
        let dias = self.definicoes.dias_lixo;
        if dias == 0 {
            return 0;
        }
        let limite = agora - dias as i64 * 86_400_000;
        let antes = self.itens.len();
        self.itens.retain(|i| i.eliminado_em.is_none_or(|t| t > limite));
        antes - self.itens.len()
    }
}

#[derive(Serialize, Deserialize, Clone, Default, Zeroize)]
#[serde(rename_all = "camelCase", default)]
pub struct Perfil {
    /// Só para a saudação ("Bem-vindo, Thiago"); fica cifrado como tudo o resto.
    pub nome: String,
}

#[derive(Serialize, Deserialize, Clone, Zeroize, PartialEq, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Definicoes {
    /// Minutos sem atividade até bloquear (1–240).
    pub bloqueio_minutos: u32,
    pub bloquear_ao_minimizar: bool,
    pub bloquear_ao_suspender: bool,
    /// Bloquear quando a sessão do Windows é bloqueada (Win+L) ou se troca de utilizador.
    pub bloquear_com_sistema: bool,
    /// Segundos até limpar a área de transferência depois de copiar (5–300).
    pub limpar_copia_segundos: u32,
    /// Dias que um registo fica no lixo (0 = até ser esvaziado à mão).
    pub dias_lixo: u32,
    /// Quantas senhas anteriores guardar por registo (0–50).
    pub max_historico: u32,
    /// Segundos até um valor revelado voltar a ficar oculto (5–300).
    pub ocultar_revelado_segundos: u32,
    /// Pedir a senha mestra antes de revelar ou copiar números de cartões, IBAN, contas e
    /// chaves Pix (a confirmação vale 5 minutos).
    pub reautenticar_financeiro: bool,
    /// Limpar a área de transferência também ao bloquear (por padrão só no fim do prazo e ao sair).
    pub limpar_ao_bloquear: bool,
    /// Avisar na visão geral quando a última cópia de segurança tiver mais de N dias (0 = nunca).
    pub lembrete_copia_dias: u32,
}

impl Default for Definicoes {
    fn default() -> Self {
        Definicoes {
            bloqueio_minutos: 5,
            bloquear_ao_minimizar: true,
            bloquear_ao_suspender: true,
            bloquear_com_sistema: true,
            limpar_copia_segundos: 30,
            dias_lixo: 30,
            max_historico: 10,
            ocultar_revelado_segundos: 30,
            reautenticar_financeiro: false,
            limpar_ao_bloquear: false,
            lembrete_copia_dias: 7,
        }
    }
}

impl Definicoes {
    pub fn validar(&self) -> Resultado<()> {
        if !(1..=240).contains(&self.bloqueio_minutos) {
            return Err(Erro::invalido("O bloqueio automático tem de ficar entre 1 e 240 minutos."));
        }
        if !(5..=300).contains(&self.limpar_copia_segundos) {
            return Err(Erro::invalido("A limpeza da área de transferência tem de ficar entre 5 e 300 segundos."));
        }
        if self.dias_lixo > 3650 || self.max_historico > 50 || self.lembrete_copia_dias > 365 {
            return Err(Erro::invalido("Valor fora dos limites."));
        }
        if !(5..=300).contains(&self.ocultar_revelado_segundos) {
            return Err(Erro::invalido("O tempo até voltar a ocultar tem de ficar entre 5 e 300 segundos."));
        }
        Ok(())
    }
}

#[derive(Serialize, Deserialize, Clone, Zeroize, PartialEq, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct ConfigCopias {
    pub ativo: bool,
    /// Pasta de destino (a app cria lá dentro a subpasta "LisSecurity").
    pub pasta: String,
    /// Quantas cópias automáticas manter (as mais antigas são apagadas; as manuais nunca).
    pub manter: u32,
}

impl Default for ConfigCopias {
    fn default() -> Self {
        ConfigCopias { ativo: false, pasta: String::new(), manter: 15 }
    }
}

#[derive(Serialize, Deserialize, Clone, Zeroize, PartialEq, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct PreferenciasGerador {
    /// senha | frase
    pub modo: String,
    pub comprimento: u32,
    pub maiusculas: bool,
    pub minusculas: bool,
    pub numeros: bool,
    pub simbolos: bool,
    pub evitar_semelhantes: bool,
    pub palavras: u32,
    pub separador: String,
    pub maiuscula_inicial: bool,
    pub incluir_numero: bool,
}

impl Default for PreferenciasGerador {
    fn default() -> Self {
        PreferenciasGerador {
            modo: "senha".into(),
            comprimento: 20,
            maiusculas: true,
            minusculas: true,
            numeros: true,
            simbolos: true,
            evitar_semelhantes: false,
            palavras: 6,
            separador: "-".into(),
            maiuscula_inicial: false,
            incluir_numero: false,
        }
    }
}

impl PreferenciasGerador {
    pub fn validar(&self) -> Resultado<()> {
        if !["senha", "frase"].contains(&self.modo.as_str())
            || !(8..=128).contains(&self.comprimento)
            || !(3..=20).contains(&self.palavras)
            || self.separador.chars().count() > 3
            || !(self.maiusculas || self.minusculas || self.numeros || self.simbolos)
        {
            return Err(Erro::invalido("Preferências do gerador inválidas."));
        }
        Ok(())
    }
}

/// Um movimento de um extrato bancário importado. O valor é em cêntimos (negativo = saída).
#[derive(Serialize, Deserialize, Clone, Default, Zeroize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Movimento {
    /// Impressão digital (data, descrição, valor, moeda, saldo) — evita duplicados ao
    /// importar o mesmo extrato duas vezes.
    pub id: String,
    pub data: i64,
    pub descricao: String,
    pub valor: i64,
    pub moeda: String,
    /// Tipo no banco (CARD_PAYMENT, TRANSFER, TOPUP, EXCHANGE, ATM, …).
    pub tipo: String,
    pub categoria: String,
    /// De onde veio (p. ex. "Revolut").
    pub origem: String,
}

#[derive(Serialize, Deserialize, Clone, Default, Zeroize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct RegraCategoria {
    pub comerciante: String,
    pub categoria: String,
}

#[derive(Serialize, Deserialize, Clone, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    #[serde(default)]
    pub id: String,
    pub titulo: String,
    #[serde(default)]
    pub favorito: bool,
    #[serde(default)]
    pub categoria: String,
    #[serde(default)]
    pub etiquetas: Vec<String>,
    /// Notas privadas do registo (tratadas como segredo: ocultas até se pedir para revelar).
    #[serde(default)]
    pub notas: String,
    #[serde(default)]
    pub campos: Vec<CampoPersonalizado>,
    #[serde(default)]
    pub criado_em: i64,
    #[serde(default)]
    pub alterado_em: i64,
    #[serde(default)]
    pub eliminado_em: Option<i64>,
    pub conteudo: Conteudo,
}

impl std::fmt::Debug for Item {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Item {{ id: {}, tipo: {} }}", self.id, self.tipo())
    }
}

#[derive(Serialize, Deserialize, Clone, Zeroize)]
#[serde(tag = "tipo", rename_all = "camelCase")]
pub enum Conteudo {
    Login(Login),
    Banco(Banco),
    Cartao(Cartao),
    Nota(Nota),
}

#[derive(Serialize, Deserialize, Clone, Default, Zeroize)]
#[serde(rename_all = "camelCase", default)]
pub struct Login {
    pub url: String,
    pub utilizador: String,
    pub email: String,
    pub senha: String,
    pub senha_alterada_em: Option<i64>,
    pub historico: Vec<SenhaAnterior>,
    /// Chave da verificação em 2 passos (Base32 ou link otpauth://). Nunca é mostrada nem
    /// copiada fora do formulário de edição: a interface só recebe o código atual.
    pub totp: String,
}

#[derive(Serialize, Deserialize, Clone, Default, Zeroize)]
#[serde(rename_all = "camelCase", default)]
pub struct SenhaAnterior {
    pub senha: String,
    pub substituida_em: i64,
}

#[derive(Serialize, Deserialize, Clone, Default, Zeroize)]
#[serde(rename_all = "camelCase", default)]
pub struct Banco {
    pub banco: String,
    pub titular: String,
    /// Código ISO 3166-1 alfa-2 (PT, BR, …) — muda os campos pedidos e as validações.
    pub pais: String,
    /// Código ISO 4217 (EUR, BRL, …).
    pub moeda: String,
    /// corrente | poupanca | pagamento | salario | investimento | outra
    pub tipo_conta: String,
    pub agencia: String,
    pub numero_conta: String,
    pub iban: String,
    pub bic: String,
    pub chaves_pix: Vec<ChavePix>,
    /// Identificador de acesso ao homebanking (nº de adesão, utilizador…).
    pub id_acesso: String,
    /// Registo do cofre com a credencial deste banco (a senha não se duplica aqui).
    pub credencial_ligada: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default, Zeroize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChavePix {
    /// cpf | cnpj | email | telefone | aleatoria
    pub tipo: String,
    pub valor: String,
}

#[derive(Serialize, Deserialize, Clone, Default, Zeroize)]
#[serde(rename_all = "camelCase", default)]
pub struct Cartao {
    pub instituicao: String,
    pub bandeira: String,
    pub titular: String,
    pub numero: String,
    /// "MM/AA"
    pub validade: String,
    /// credito | debito | virtual | prepago
    pub tipo_cartao: String,
    pub conta_ligada: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default, Zeroize)]
#[serde(rename_all = "camelCase", default)]
pub struct Nota {
    /// nota | codigos | licenca
    pub tipo_nota: String,
    pub conteudo: String,
    pub codigos: Vec<CodigoRecuperacao>,
}

#[derive(Serialize, Deserialize, Clone, Default, Zeroize)]
#[serde(rename_all = "camelCase", default)]
pub struct CodigoRecuperacao {
    pub valor: String,
    pub usado: bool,
}

#[derive(Serialize, Deserialize, Clone, Default, Zeroize)]
#[serde(rename_all = "camelCase", default)]
pub struct CampoPersonalizado {
    pub id: String,
    pub rotulo: String,
    pub valor: String,
    /// Campo oculto = tratado como segredo (mascarado, revelar/copiar à parte).
    pub oculto: bool,
}

pub const TIPOS_CONTA: &[&str] = &["corrente", "poupanca", "pagamento", "salario", "investimento", "outra"];
pub const TIPOS_PIX: &[&str] = &["cpf", "cnpj", "email", "telefone", "aleatoria"];
pub const TIPOS_CARTAO: &[&str] = &["credito", "debito", "virtual", "prepago"];
pub const TIPOS_NOTA: &[&str] = &["nota", "codigos", "licenca"];

impl Item {
    pub fn tipo(&self) -> &'static str {
        match self.conteudo {
            Conteudo::Login(_) => "login",
            Conteudo::Banco(_) => "banco",
            Conteudo::Cartao(_) => "cartao",
            Conteudo::Nota(_) => "nota",
        }
    }

    pub fn no_lixo(&self) -> bool {
        self.eliminado_em.is_some()
    }

    pub fn login(&self) -> Option<&Login> {
        match &self.conteudo {
            Conteudo::Login(l) => Some(l),
            _ => None,
        }
    }

    /// O valor de um campo pelo seu identificador — usado para revelar e copiar um campo de
    /// cada vez, sem enviar o registo inteiro para a interface.
    ///
    /// Identificadores: `notas`, `campo:<id>`, e por tipo — login: `url utilizador email senha
    /// historico:<i>`; banco: `banco titular agencia numeroConta iban bic idAcesso pix:<i>`;
    /// cartão: `numero validade titular`; nota: `conteudo codigo:<i>`.
    pub fn valor_campo(&self, campo: &str) -> Option<&str> {
        let indice = |prefixo: &str| campo.strip_prefix(prefixo).and_then(|s| s.parse::<usize>().ok());
        if campo == "notas" {
            return Some(&self.notas);
        }
        if let Some(id) = campo.strip_prefix("campo:") {
            return self.campos.iter().find(|c| c.id == id).map(|c| c.valor.as_str());
        }
        let v = match &self.conteudo {
            Conteudo::Login(l) => match campo {
                "url" => &l.url,
                "utilizador" => &l.utilizador,
                "email" => &l.email,
                "senha" => &l.senha,
                _ => return indice("historico:").and_then(|i| l.historico.get(i)).map(|h| h.senha.as_str()),
            },
            Conteudo::Banco(b) => match campo {
                "banco" => &b.banco,
                "titular" => &b.titular,
                "agencia" => &b.agencia,
                "numeroConta" => &b.numero_conta,
                "iban" => &b.iban,
                "bic" => &b.bic,
                "idAcesso" => &b.id_acesso,
                _ => return indice("pix:").and_then(|i| b.chaves_pix.get(i)).map(|p| p.valor.as_str()),
            },
            Conteudo::Cartao(c) => match campo {
                "numero" => &c.numero,
                "validade" => &c.validade,
                "titular" => &c.titular,
                _ => return None,
            },
            Conteudo::Nota(n) => match campo {
                "conteudo" => &n.conteudo,
                _ => return indice("codigo:").and_then(|i| n.codigos.get(i)).map(|c| c.valor.as_str()),
            },
        };
        Some(v.as_str())
    }

    /// Limites de tamanho e valores permitidos. As mensagens dizem o que corrigir, nunca
    /// repetem o valor recebido.
    pub fn validar(&self) -> Resultado<()> {
        fn max(v: &str, n: usize, nome: &str) -> Resultado<()> {
            if v.chars().count() > n {
                return Err(Erro::invalido(format!("O campo «{nome}» é demasiado longo (máximo {n} caracteres).")));
            }
            Ok(())
        }
        fn um_de(v: &str, opcoes: &[&str], nome: &str) -> Resultado<()> {
            if !v.is_empty() && !opcoes.contains(&v) {
                return Err(Erro::invalido(format!("Valor desconhecido em «{nome}».")));
            }
            Ok(())
        }
        if self.titulo.trim().is_empty() {
            return Err(Erro::invalido("Dá um título ao registo."));
        }
        max(&self.titulo, 200, "Título")?;
        max(&self.categoria, 60, "Categoria")?;
        max(&self.notas, 100_000, "Notas")?;
        if self.etiquetas.len() > 30 {
            return Err(Erro::invalido("No máximo 30 etiquetas por registo."));
        }
        for e in &self.etiquetas {
            max(e, 40, "Etiqueta")?;
        }
        if self.campos.len() > 50 {
            return Err(Erro::invalido("No máximo 50 campos personalizados por registo."));
        }
        for c in &self.campos {
            max(&c.rotulo, 80, "Nome do campo")?;
            max(&c.valor, 10_000, "Campo personalizado")?;
        }
        const CURTO: usize = 500;
        match &self.conteudo {
            Conteudo::Login(l) => {
                max(&l.url, 2_000, "Endereço")?;
                max(&l.utilizador, CURTO, "Utilizador")?;
                max(&l.email, CURTO, "E-mail")?;
                max(&l.senha, 10_000, "Senha")?;
                max(&l.totp, 2_000, "Chave 2FA")?;
                if !l.totp.trim().is_empty() {
                    crate::totp::Totp::ler(&l.totp)?;
                }
                if l.historico.len() > 100 {
                    return Err(Erro::invalido("Histórico de senhas demasiado longo."));
                }
            }
            Conteudo::Banco(b) => {
                for (v, n) in [
                    (&b.banco, "Banco"),
                    (&b.titular, "Titular"),
                    (&b.agencia, "Agência"),
                    (&b.numero_conta, "Número da conta"),
                    (&b.iban, "IBAN"),
                    (&b.bic, "BIC/SWIFT"),
                    (&b.id_acesso, "Identificador de acesso"),
                    (&b.pais, "País"),
                    (&b.moeda, "Moeda"),
                ] {
                    max(v, CURTO, n)?;
                }
                um_de(&b.tipo_conta, TIPOS_CONTA, "Tipo de conta")?;
                if b.chaves_pix.len() > 20 {
                    return Err(Erro::invalido("No máximo 20 chaves Pix por conta."));
                }
                for p in &b.chaves_pix {
                    um_de(&p.tipo, TIPOS_PIX, "Tipo de chave Pix")?;
                    max(&p.valor, CURTO, "Chave Pix")?;
                }
            }
            Conteudo::Cartao(c) => {
                for (v, n) in [(&c.instituicao, "Instituição"), (&c.bandeira, "Bandeira"), (&c.titular, "Titular"), (&c.numero, "Número")]
                {
                    max(v, CURTO, n)?;
                }
                max(&c.validade, 7, "Validade")?;
                um_de(&c.tipo_cartao, TIPOS_CARTAO, "Tipo de cartão")?;
            }
            Conteudo::Nota(n) => {
                max(&n.conteudo, 200_000, "Conteúdo")?;
                um_de(&n.tipo_nota, TIPOS_NOTA, "Tipo de nota")?;
                if n.codigos.len() > 200 {
                    return Err(Erro::invalido("No máximo 200 códigos por nota."));
                }
                for c in &n.codigos {
                    max(&c.valor, CURTO, "Código")?;
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
#[allow(clippy::field_reassign_with_default)]
mod testes {
    use super::*;

    fn login() -> Item {
        Item {
            id: "a".into(),
            titulo: "Serviço Fictício".into(),
            favorito: false,
            categoria: String::new(),
            etiquetas: vec![],
            notas: String::new(),
            campos: vec![],
            criado_em: 0,
            alterado_em: 0,
            eliminado_em: None,
            conteudo: Conteudo::Login(Login { senha: "senha-ficticia".into(), ..Default::default() }),
        }
    }

    #[test]
    fn json_usa_etiqueta_de_tipo() {
        let j = serde_json::to_value(login()).unwrap();
        assert_eq!(j["conteudo"]["tipo"], "login");
        assert_eq!(j["conteudo"]["senha"], "senha-ficticia");
    }

    #[test]
    fn debug_nao_mostra_segredos() {
        let s = format!("{:?}", login());
        assert!(!s.contains("senha-ficticia"));
    }

    #[test]
    fn valida_titulo_e_tipos() {
        let mut i = login();
        i.titulo = "   ".into();
        assert!(i.validar().is_err());
        let mut i = login();
        i.conteudo = Conteudo::Cartao(Cartao { tipo_cartao: "<script>".into(), ..Default::default() });
        assert!(i.validar().is_err());
    }

    #[test]
    fn lixo_antigo_e_removido() {
        let mut d = DadosCofre::novo(0, "Teste");
        let mut a = login();
        a.eliminado_em = Some(0);
        let mut b = login();
        b.id = "b".into();
        b.eliminado_em = Some(29 * 86_400_000);
        d.itens = vec![a, b, login()];
        assert_eq!(d.limpar_lixo_antigo(31 * 86_400_000), 1);
        assert_eq!(d.itens.len(), 2);
    }
}
