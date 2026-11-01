//! O cofre aberto: chave do cofre em memória + dados decifrados. Abrir exige mesmo decifrar
//! (não há nenhuma verificação booleana de senha separada da criptografia).
//!
//! Hierarquia de chaves:
//! ```text
//! senha mestra ──Argon2id(salt)──► chave da senha ─┐
//!                                                   ├─ embrulham ─► chave do cofre (aleatória)
//! chave de recuperação ──HKDF(salt)──► chave rec. ──┘                     │
//!                                                     XChaCha20-Poly1305  ▼
//!                                                           todos os registos e definições
//! ```
//! Trocar a senha mestra (ou a recuperação) gera SEMPRE uma chave do cofre nova: quem tenha
//! uma cópia antiga do ficheiro e a senha antiga não consegue ler o cofre atual.

use zeroize::Zeroizing;

use crate::aleatorio;
use crate::cripto::{self, Chave, ParamsKdf, TAM_NONCE, TAM_TAG};
use crate::erro::{Erro, Resultado};
use crate::formato::{self, Cabecalho, FicheiroCofre, Ranhura, TipoRanhura};
use crate::modelo::{DadosCofre, ESQUEMA_ATUAL};
use crate::recuperacao;

const INFO_RECUPERACAO: &[u8] = b"LisSecurity v1 chave de recuperacao";
/// O texto em claro é preenchido até um múltiplo de 4 KiB: o tamanho do ficheiro só revela
/// a ordem de grandeza do cofre, não o tamanho exato de cada alteração.
const BLOCO: usize = 4096;

pub const MIN_CARACTERES_SENHA: usize = 12;
pub const MAX_CARACTERES_SENHA: usize = 4096;

pub struct CofreAberto {
    cabecalho: Cabecalho,
    chave: Chave,
    pub dados: DadosCofre,
}

impl std::fmt::Debug for CofreAberto {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("CofreAberto(<oculto>)")
    }
}

/// Resultado de abrir um ficheiro: o cofre e se os dados vieram de um esquema antigo
/// (nesse caso guarda-se uma cópia do ficheiro original antes de regravar).
pub struct Aberto {
    pub cofre: CofreAberto,
    pub migrado: bool,
}

/// Regras da senha mestra: só comprimento. Sem regras de composição, sem cortar nada.
pub fn validar_senha_nova(senha: &str) -> Resultado<()> {
    let n = senha.chars().count();
    if n < MIN_CARACTERES_SENHA {
        return Err(Erro::invalido(format!(
            "A senha mestra precisa de pelo menos {MIN_CARACTERES_SENHA} caracteres. Uma frase com 4 ou mais palavras é mais fácil de lembrar e mais forte."
        )));
    }
    if n > MAX_CARACTERES_SENHA {
        return Err(Erro::invalido(format!("A senha mestra pode ter no máximo {MAX_CARACTERES_SENHA} caracteres.")));
    }
    Ok(())
}

fn embrulhar(cab: &Cabecalho, tipo: TipoRanhura, chave_embrulho: &Chave, chave_cofre: &Chave) -> Resultado<Ranhura> {
    let (nonce, cifrado) = cripto::cifrar(chave_embrulho, &cab.aad_ranhura(tipo), chave_cofre.bytes())?;
    let chave_cifrada = cifrado.try_into().map_err(|_| Erro::Serializacao)?;
    Ok(Ranhura { tipo, nonce, chave_cifrada })
}

fn desembrulhar(cab: &Cabecalho, r: &Ranhura, chave_embrulho: &Chave) -> Resultado<Chave> {
    let texto = cripto::decifrar(chave_embrulho, &r.nonce, &cab.aad_ranhura(r.tipo), &r.chave_cifrada).ok_or(Erro::CredencialIncorreta)?;
    let bytes: [u8; 32] = texto.as_slice().try_into().map_err(|_| Erro::FormatoInvalido)?;
    Ok(Chave::de_bytes(bytes))
}

fn chave_recuperacao(material: &[u8], cab: &Cabecalho) -> Chave {
    cripto::derivar_de_material(material, &cab.salt, INFO_RECUPERACAO)
}

fn empacotar(dados: &DadosCofre) -> Resultado<Zeroizing<Vec<u8>>> {
    let json = Zeroizing::new(serde_json::to_vec(dados).map_err(|_| Erro::Serializacao)?);
    let tamanho = u32::try_from(json.len()).map_err(|_| Erro::Grande)?;
    let alvo = (4 + json.len()).div_ceil(BLOCO) * BLOCO;
    let mut v = Zeroizing::new(Vec::with_capacity(alvo));
    v.extend_from_slice(&tamanho.to_le_bytes());
    v.extend_from_slice(&json);
    v.resize(alvo, 0);
    Ok(v)
}

#[derive(serde::Deserialize)]
struct SoEsquema {
    esquema: u32,
}

fn desempacotar(texto: &[u8]) -> Resultado<(DadosCofre, bool)> {
    let tamanho = u32::from_le_bytes(texto.get(..4).ok_or(Erro::Serializacao)?.try_into().unwrap()) as usize;
    let json = texto.get(4..4 + tamanho).ok_or(Erro::Serializacao)?;
    if texto[4 + tamanho..].iter().any(|&b| b != 0) {
        return Err(Erro::Serializacao);
    }
    let esquema = serde_json::from_slice::<SoEsquema>(json).map_err(|_| Erro::Serializacao)?.esquema;
    if esquema > ESQUEMA_ATUAL {
        return Err(Erro::invalido("Este cofre foi gravado por uma versão mais recente do LisSecurity. Atualiza a aplicação."));
    }
    // Quando houver esquema 2, as migrações entram aqui (de N para N+1, por ordem).
    let migrado = esquema < ESQUEMA_ATUAL;
    let mut dados: DadosCofre = serde_json::from_slice(json).map_err(|_| Erro::Serializacao)?;
    dados.esquema = ESQUEMA_ATUAL;
    Ok((dados, migrado))
}

fn cabecalho_novo(id_cofre: [u8; 16], kdf: ParamsKdf) -> Resultado<Cabecalho> {
    Ok(Cabecalho { id_cofre, kdf, salt: aleatorio::bytes()?, ranhuras: Vec::new() })
}

impl CofreAberto {
    /// Cofre novo e vazio. `params` deve vir de `cripto::calibrar`.
    pub fn criar(senha: &str, params: ParamsKdf, nome: &str, agora: i64) -> Resultado<Self> {
        Ok(Self::criar_completo(senha, params, nome, agora, false)?.0)
    }

    /// Cofre novo, opcionalmente já com chave de recuperação (devolvida para mostrar uma vez).
    pub fn criar_completo(
        senha: &str,
        params: ParamsKdf,
        nome: &str,
        agora: i64,
        com_recuperacao: bool,
    ) -> Resultado<(Self, Option<Zeroizing<String>>)> {
        validar_senha_nova(senha)?;
        let modelo = CofreAberto {
            cabecalho: cabecalho_novo(aleatorio::bytes()?, params)?,
            chave: Chave::aleatoria()?,
            dados: DadosCofre::novo(agora, nome),
        };
        modelo.reconstruir(senha, params, com_recuperacao)
    }

    pub fn abrir_com_senha(bytes: &[u8], senha: &str) -> Resultado<Aberto> {
        let f = FicheiroCofre::ler(bytes)?;
        let r = f.cabecalho.ranhura(TipoRanhura::Senha).ok_or(Erro::FormatoInvalido)?;
        let chave_senha = cripto::derivar_de_senha(senha, &f.cabecalho.salt, &f.cabecalho.kdf)?;
        let chave = desembrulhar(&f.cabecalho, r, &chave_senha)?;
        Self::abrir_com_chave(f, chave)
    }

    pub fn abrir_com_recuperacao(bytes: &[u8], chave_texto: &str) -> Resultado<Aberto> {
        let material = recuperacao::decodificar(chave_texto)?;
        let f = FicheiroCofre::ler(bytes)?;
        let r = f.cabecalho.ranhura(TipoRanhura::Recuperacao).ok_or(Erro::SemRecuperacao)?;
        let chave = desembrulhar(&f.cabecalho, r, &chave_recuperacao(&*material, &f.cabecalho))?;
        Self::abrir_com_chave(f, chave)
    }

    fn abrir_com_chave(f: FicheiroCofre, chave: Chave) -> Resultado<Aberto> {
        let texto = cripto::decifrar(&chave, &f.nonce_dados, &f.aad_dados(), &f.dados_cifrados).ok_or(Erro::IntegridadeFalhou)?;
        let (dados, migrado) = desempacotar(&texto)?;
        Ok(Aberto { cofre: CofreAberto { cabecalho: f.cabecalho, chave, dados }, migrado })
    }

    /// Cifra o estado atual num ficheiro completo, com nonce novo.
    pub fn serializar(&mut self, agora: i64) -> Resultado<Vec<u8>> {
        self.dados.gravado_em = agora;
        let texto = empacotar(&self.dados)?;
        let nonce: [u8; TAM_NONCE] = aleatorio::bytes()?;
        let tamanho = texto.len() + TAM_TAG;
        let aad = formato::aad_dados(&self.cabecalho, &nonce, tamanho);
        let dados_cifrados = cripto::cifrar_com_nonce(&self.chave, &nonce, &aad, &texto)?;
        debug_assert_eq!(dados_cifrados.len(), tamanho);
        Ok(FicheiroCofre { cabecalho: self.cabecalho.clone(), nonce_dados: nonce, dados_cifrados }.serializar())
    }

    /// Confirma que `bytes` é este cofre e decifra com a chave em memória. Usado antes de
    /// substituir o ficheiro em disco e para validar cópias de segurança acabadas de gravar.
    pub fn verificar_gravado(&self, bytes: &[u8]) -> Resultado<()> {
        let f = FicheiroCofre::ler(bytes)?;
        if f.cabecalho != self.cabecalho {
            return Err(Erro::IntegridadeFalhou);
        }
        let texto = cripto::decifrar(&self.chave, &f.nonce_dados, &f.aad_dados(), &f.dados_cifrados).ok_or(Erro::IntegridadeFalhou)?;
        let (dados, _) = desempacotar(&texto)?;
        if dados.itens.len() != self.dados.itens.len() {
            return Err(Erro::IntegridadeFalhou);
        }
        Ok(())
    }

    /// Reautenticação real: deriva a chave da senha e desembrulha a ranhura.
    pub fn verificar_senha(&self, senha: &str) -> Resultado<()> {
        let r = self.cabecalho.ranhura(TipoRanhura::Senha).ok_or(Erro::FormatoInvalido)?;
        let chave_senha = cripto::derivar_de_senha(senha, &self.cabecalho.salt, &self.cabecalho.kdf)?;
        let k = desembrulhar(&self.cabecalho, r, &chave_senha)?;
        if !k.igual(&self.chave) {
            return Err(Erro::CredencialIncorreta);
        }
        Ok(())
    }

    pub fn tem_recuperacao(&self) -> bool {
        self.cabecalho.ranhura(TipoRanhura::Recuperacao).is_some()
    }

    pub fn id_cofre(&self) -> [u8; 16] {
        self.cabecalho.id_cofre
    }

    pub fn params_kdf(&self) -> ParamsKdf {
        self.cabecalho.kdf
    }

    /// Constrói um cofre NOVO (sal, chave do cofre e ranhuras novos) com os mesmos dados.
    /// O original não é tocado: quem chama grava o novo, verifica e só depois troca.
    fn reconstruir(&self, senha: &str, params: ParamsKdf, com_recuperacao: bool) -> Resultado<(CofreAberto, Option<Zeroizing<String>>)> {
        let mut cabecalho = cabecalho_novo(self.cabecalho.id_cofre, params)?;
        let chave = Chave::aleatoria()?;
        let chave_senha = cripto::derivar_de_senha(senha, &cabecalho.salt, &params)?;
        let r = embrulhar(&cabecalho, TipoRanhura::Senha, &chave_senha, &chave)?;
        cabecalho.ranhuras.push(r);
        let mut texto_recuperacao = None;
        if com_recuperacao {
            let (material, texto) = recuperacao::gerar()?;
            let r = embrulhar(&cabecalho, TipoRanhura::Recuperacao, &chave_recuperacao(&*material, &cabecalho), &chave)?;
            cabecalho.ranhuras.push(r);
            texto_recuperacao = Some(texto);
        }
        Ok((CofreAberto { cabecalho, chave, dados: self.dados.clone() }, texto_recuperacao))
    }

    /// Nova senha mestra. Se havia chave de recuperação, é gerada uma nova (a anterior deixa
    /// de abrir este cofre, mas continua a abrir as cópias de segurança feitas antes).
    pub fn com_nova_senha(&self, nova: &str, params: ParamsKdf) -> Resultado<(CofreAberto, Option<Zeroizing<String>>)> {
        validar_senha_nova(nova)?;
        self.reconstruir(nova, params, self.tem_recuperacao())
    }

    /// Volta a cifrar com outros parâmetros do Argon2id (p. ex. "reforçar a proteção").
    /// Pede a senha mestra atual; se havia chave de recuperação, gera uma nova.
    pub fn com_novos_parametros(&self, senha_atual: &str, params: ParamsKdf) -> Resultado<(CofreAberto, Option<Zeroizing<String>>)> {
        self.verificar_senha(senha_atual)?;
        self.reconstruir(senha_atual, params, self.tem_recuperacao())
    }

    /// Ativa (ou substitui) a chave de recuperação. Pede a senha mestra atual.
    pub fn com_recuperacao_nova(&self, senha_atual: &str) -> Resultado<(CofreAberto, Zeroizing<String>)> {
        self.verificar_senha(senha_atual)?;
        let (c, t) = self.reconstruir(senha_atual, self.cabecalho.kdf, true)?;
        Ok((c, t.expect("pedida com recuperação")))
    }

    /// Desativa a chave de recuperação. Pede a senha mestra atual.
    pub fn sem_recuperacao(&self, senha_atual: &str) -> Resultado<CofreAberto> {
        self.verificar_senha(senha_atual)?;
        Ok(self.reconstruir(senha_atual, self.cabecalho.kdf, false)?.0)
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    const SENHA: &str = "cavalo bateria agrafo correto";

    fn novo() -> CofreAberto {
        CofreAberto::criar(SENHA, ParamsKdf::para_testes(), "Teste", 1).unwrap()
    }

    #[test]
    fn criar_com_recuperacao_abre_com_as_duas() {
        let (mut c, rec) = CofreAberto::criar_completo(SENHA, ParamsKdf::para_testes(), "", 1, true).unwrap();
        let b = c.serializar(2).unwrap();
        assert!(CofreAberto::abrir_com_senha(&b, SENHA).is_ok());
        assert!(CofreAberto::abrir_com_recuperacao(&b, &rec.unwrap()).is_ok());
    }

    #[test]
    fn senha_curta_recusada() {
        assert!(CofreAberto::criar("curta", ParamsKdf::para_testes(), "", 1).is_err());
    }

    #[test]
    fn abre_com_a_senha_certa_e_so_com_ela() {
        let mut c = novo();
        let b = c.serializar(2).unwrap();
        assert!(CofreAberto::abrir_com_senha(&b, SENHA).is_ok());
        assert!(matches!(CofreAberto::abrir_com_senha(&b, "cavalo bateria agrafo errado"), Err(Erro::CredencialIncorreta)));
    }

    #[test]
    fn tamanho_multiplo_do_bloco() {
        let mut c = novo();
        let b = c.serializar(2).unwrap();
        let f = FicheiroCofre::ler(&b).unwrap();
        assert_eq!((f.dados_cifrados.len() - TAM_TAG) % BLOCO, 0);
    }

    #[test]
    fn verificar_gravado_deteta_alteracoes() {
        let mut c = novo();
        let b = c.serializar(2).unwrap();
        c.verificar_gravado(&b).unwrap();
        let mut b2 = b.clone();
        let n = b2.len();
        b2[n - 10] ^= 1;
        assert!(c.verificar_gravado(&b2).is_err());
    }

    #[test]
    fn nova_senha_roda_a_chave_do_cofre() {
        let mut c = novo();
        let antigo = c.serializar(2).unwrap();
        let (mut n, rec) = c.com_nova_senha("outra frase senha muito longa", ParamsKdf::para_testes()).unwrap();
        assert!(rec.is_none());
        assert!(!n.chave.igual(&c.chave));
        let novo_b = n.serializar(3).unwrap();
        assert!(CofreAberto::abrir_com_senha(&novo_b, SENHA).is_err());
        assert!(CofreAberto::abrir_com_senha(&novo_b, "outra frase senha muito longa").is_ok());
        // a cópia antiga continua a abrir só com a senha antiga
        assert!(CofreAberto::abrir_com_senha(&antigo, SENHA).is_ok());
    }

    #[test]
    fn recuperacao_abre_e_e_substituida_ao_trocar_senha() {
        let c = novo();
        assert!(c.com_recuperacao_nova("senha errada mas comprida").is_err());
        let (mut r, texto) = c.com_recuperacao_nova(SENHA).unwrap();
        assert!(r.tem_recuperacao());
        let b = r.serializar(2).unwrap();
        assert!(CofreAberto::abrir_com_recuperacao(&b, &texto).is_ok());
        assert!(CofreAberto::abrir_com_senha(&b, SENHA).is_ok());

        let (mut t, nova_rec) = r.com_nova_senha("frase nova para o cofre", ParamsKdf::para_testes()).unwrap();
        let nova_rec = nova_rec.unwrap();
        let b2 = t.serializar(3).unwrap();
        assert!(CofreAberto::abrir_com_recuperacao(&b2, &texto).is_err());
        assert!(CofreAberto::abrir_com_recuperacao(&b2, &nova_rec).is_ok());

        let mut s = t.sem_recuperacao("frase nova para o cofre").unwrap();
        let b3 = s.serializar(4).unwrap();
        assert!(matches!(CofreAberto::abrir_com_recuperacao(&b3, &nova_rec), Err(Erro::SemRecuperacao)));
    }

    #[test]
    fn verificar_senha_e_criptografica() {
        let c = novo();
        assert!(c.verificar_senha(SENHA).is_ok());
        assert!(c.verificar_senha("quase a mesma senha!").is_err());
    }

    #[test]
    fn trocar_ranhuras_entre_cofres_nao_funciona() {
        // Uma ranhura copiada de outro cofre (mesma senha) não abre os dados deste.
        let mut a = novo();
        let mut b = novo();
        let ba = a.serializar(1).unwrap();
        let bb = b.serializar(1).unwrap();
        let mut fa = FicheiroCofre::ler(&ba).unwrap();
        let fb = FicheiroCofre::ler(&bb).unwrap();
        fa.cabecalho.ranhuras = fb.cabecalho.ranhuras.clone();
        assert!(CofreAberto::abrir_com_senha(&fa.serializar(), SENHA).is_err());
    }

    #[test]
    fn migra_esquema_antigo_e_recusa_futuro() {
        let mut c = novo();
        c.dados.esquema = 1;
        let b = c.serializar(2).unwrap();
        let a = CofreAberto::abrir_com_senha(&b, SENHA).unwrap();
        assert!(a.migrado);
        assert_eq!(a.cofre.dados.esquema, ESQUEMA_ATUAL);
        let mut c = novo();
        c.dados.esquema = ESQUEMA_ATUAL + 1;
        let b = c.serializar(3).unwrap();
        assert!(matches!(CofreAberto::abrir_com_senha(&b, SENHA), Err(Erro::Invalido(_))));
    }

    #[test]
    fn novos_parametros_pedem_a_senha() {
        let c = novo();
        assert!(c.com_novos_parametros("senha errada e comprida", ParamsKdf::para_testes()).is_err());
        let p = ParamsKdf { memoria_kib: ParamsKdf::MIN_MEMORIA_KIB, iteracoes: 2, paralelismo: 1 };
        let (mut n, rec) = c.com_novos_parametros(SENHA, p).unwrap();
        assert!(rec.is_none());
        assert_eq!(n.params_kdf(), p);
        let b = n.serializar(5).unwrap();
        assert!(CofreAberto::abrir_com_senha(&b, SENHA).is_ok());
    }
}
