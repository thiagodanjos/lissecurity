//! Erros do núcleo. As mensagens nunca incluem segredos: no máximo dizem *que* algo falhou,
//! nunca *com que valor*. É seguro mostrá-las na interface e escrevê-las em registos.

use thiserror::Error;

pub type Resultado<T> = std::result::Result<T, Erro>;

#[derive(Debug, Error)]
pub enum Erro {
    /// O ficheiro não tem a assinatura do LisSecurity ou a estrutura está corrompida.
    #[error("O ficheiro não é um cofre do LisSecurity ou está danificado.")]
    FormatoInvalido,

    /// Cofre gravado por uma versão mais recente do LisSecurity.
    #[error("Este cofre foi criado por uma versão mais recente do LisSecurity (formato {0}).")]
    VersaoNaoSuportada(u16),

    /// Parâmetros de derivação fora dos limites aceites (ficheiro adulterado ou corrompido).
    #[error("Os parâmetros de proteção do cofre estão fora dos limites aceites.")]
    ParametrosInvalidos,

    /// A senha mestra (ou a chave de recuperação) não abre o cofre.
    /// Não se distingue "senha errada" de "ranhura adulterada": as duas falham a autenticação.
    #[error("A senha não abre este cofre.")]
    CredencialIncorreta,

    /// A chave foi aceite, mas o conteúdo cifrado não passou na verificação de integridade:
    /// alguém alterou o ficheiro ou o disco danificou-o.
    #[error("O conteúdo do cofre não passou na verificação de integridade.")]
    IntegridadeFalhou,

    #[error("A chave de recuperação está incompleta ou tem um erro de escrita.")]
    ChaveRecuperacaoMalFormada,

    #[error("Este cofre não tem chave de recuperação configurada.")]
    SemRecuperacao,

    #[error("O cofre já está aberto noutra janela do LisSecurity.")]
    EmUso,

    #[error("O ficheiro é demasiado grande para ser um cofre.")]
    Grande,

    #[error("O gerador de números aleatórios do sistema não respondeu.")]
    Aleatoriedade,

    #[error("Os dados do cofre não puderam ser interpretados.")]
    Serializacao,

    /// Erro de validação com texto pensado para a pessoa (nunca contém valores secretos).
    #[error("{0}")]
    Invalido(String),

    #[error("Não foi possível ler ou gravar o ficheiro: {0}")]
    Io(String),
}

impl From<std::io::Error> for Erro {
    fn from(e: std::io::Error) -> Self {
        // O texto do erro do sistema pode trazer o caminho do ficheiro, nunca conteúdo.
        Erro::Io(e.kind().to_string())
    }
}

impl Erro {
    pub fn invalido(texto: impl Into<String>) -> Self {
        Erro::Invalido(texto.into())
    }
}
