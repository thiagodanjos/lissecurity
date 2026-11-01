#![allow(clippy::field_reassign_with_default)] // nos testes, montar os registos campo a campo lê-se melhor

//! Critérios de aceitação do núcleo, com dados claramente fictícios.
//! Cada teste corresponde a um ponto da lista "Testes e critérios de aceitação" do projeto.

use lissecurity_core::armazenamento::{self, Armazenamento};
use lissecurity_core::cofre::CofreAberto;
use lissecurity_core::cripto::ParamsKdf;
use lissecurity_core::formato::{FicheiroCofre, TAM_PREFIXO};
use lissecurity_core::modelo::*;
use lissecurity_core::Erro;

const SENHA: &str = "frase ficticia de teste para o cofre";
/// Marcadores que NUNCA podem aparecer em claro nos ficheiros.
const MARCADORES: &[&str] = &[
    "SENHA-FICTICIA-7731",
    "Banco Ficticio Exemplar",
    "PT50000201231234567890154",
    "4111111111111111",
    "codigo-recuperacao-ficticio",
    "Servico Exemplo Teste",
    "nota-privada-ficticia",
    "etiqueta-ficticia",
];

fn item(titulo: &str, conteudo: Conteudo) -> Item {
    Item {
        id: String::new(),
        titulo: titulo.into(),
        favorito: true,
        categoria: "Pessoal".into(),
        etiquetas: vec!["etiqueta-ficticia".into()],
        notas: "nota-privada-ficticia".into(),
        campos: vec![CampoPersonalizado { id: String::new(), rotulo: "PIN de teste".into(), valor: "0000".into(), oculto: true }],
        criado_em: 0,
        alterado_em: 0,
        eliminado_em: None,
        conteudo,
    }
}

fn cofre_com_dados() -> CofreAberto {
    let mut c = CofreAberto::criar(SENHA, ParamsKdf::para_testes(), "Pessoa Teste", 1).unwrap();
    let mut l = Login::default();
    l.url = "https://exemplo.invalid".into();
    l.utilizador = "utilizador.teste".into();
    l.senha = "SENHA-FICTICIA-7731".into();
    c.dados.guardar_item(item("Servico Exemplo Teste", Conteudo::Login(l)), 2).unwrap();
    let mut b = Banco::default();
    b.banco = "Banco Ficticio Exemplar".into();
    b.iban = "PT50000201231234567890154".into();
    b.pais = "PT".into();
    c.dados.guardar_item(item("Conta ordenado", Conteudo::Banco(b)), 3).unwrap();
    let mut k = Cartao::default();
    k.numero = "4111111111111111".into();
    k.validade = "12/30".into();
    c.dados.guardar_item(item("Cartão de teste", Conteudo::Cartao(k)), 4).unwrap();
    let mut n = Nota::default();
    n.tipo_nota = "codigos".into();
    n.codigos = vec![CodigoRecuperacao { valor: "codigo-recuperacao-ficticio".into(), usado: false }];
    c.dados.guardar_item(item("Códigos", Conteudo::Nota(n)), 5).unwrap();
    c
}

fn contem(bytes: &[u8], agulha: &str) -> bool {
    bytes.windows(agulha.len()).any(|w| w == agulha.as_bytes())
}

#[test]
fn senha_correta_abre_e_incorreta_nao() {
    let mut c = cofre_com_dados();
    let b = c.serializar(10).unwrap();
    let a = CofreAberto::abrir_com_senha(&b, SENHA).unwrap();
    assert_eq!(a.cofre.dados.itens.len(), 4);
    assert_eq!(a.cofre.dados.perfil.nome, "Pessoa Teste");
    for errada in ["", "frase ficticia de teste para o cofrE", "frase ficticia de teste para o cofre "] {
        assert!(matches!(CofreAberto::abrir_com_senha(&b, errada), Err(Erro::CredencialIncorreta)));
    }
}

#[test]
fn ficheiro_e_copia_nao_tem_dados_em_claro() {
    let d = tempfile::tempdir().unwrap();
    let a = Armazenamento::abrir(d.path().join("cofre.lissec")).unwrap();
    let mut c = cofre_com_dados();
    let b = c.serializar(10).unwrap();
    a.gravar(&b, |x| c.verificar_gravado(x)).unwrap();
    let b2 = c.serializar(11).unwrap();
    a.gravar(&b2, |x| c.verificar_gravado(x)).unwrap();
    let copia = d.path().join("LisSecurity-copia.lissec");
    let b3 = c.serializar(12).unwrap();
    armazenamento::escrever_atomico(&copia, &b3, |x| c.verificar_gravado(x)).unwrap();
    // No Windows o trinco é obrigatório: enquanto o cofre está aberto, o ficheiro .lock não se
    // lê de fora. Fecha-se primeiro para também o poder verificar (está sempre vazio).
    drop(a);

    for p in std::fs::read_dir(d.path()).unwrap().flatten() {
        let bytes = std::fs::read(p.path()).unwrap();
        for m in MARCADORES {
            assert!(!contem(&bytes, m), "«{m}» em claro em {:?}", p.file_name());
        }
        // e também não aparecem em UTF-16 (como o Windows guardaria texto)
        for m in MARCADORES {
            let utf16: Vec<u8> = m.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
            assert!(!bytes.windows(utf16.len()).any(|w| w == utf16.as_slice()));
        }
    }
}

#[test]
fn qualquer_byte_alterado_e_detetado() {
    let mut c = cofre_com_dados();
    let b = c.serializar(10).unwrap();
    let f = FicheiroCofre::ler(&b).unwrap();
    // percorre cabeçalho, ranhura, nonce, tamanho e uma amostra do texto cifrado
    let fim_cabecalho = b.len() - f.dados_cifrados.len();
    let mut posicoes: Vec<usize> = (0..fim_cabecalho).collect();
    posicoes.extend((fim_cabecalho..b.len()).step_by(97));
    posicoes.push(b.len() - 1);
    for i in posicoes {
        let mut x = b.clone();
        x[i] ^= 0x20;
        assert!(CofreAberto::abrir_com_senha(&x, SENHA).is_err(), "alteração no byte {i} passou despercebida");
    }
    // trocar o salt por outro também falha
    let mut x = b.clone();
    x[TAM_PREFIXO - 1] ^= 1;
    assert!(CofreAberto::abrir_com_senha(&x, SENHA).is_err());
}

#[test]
fn alteracao_dos_dados_com_ranhura_valida_da_integridade_falhada() {
    let mut c = cofre_com_dados();
    let b = c.serializar(10).unwrap();
    let mut x = b.clone();
    let n = x.len();
    x[n - 30] ^= 0xff;
    assert!(matches!(CofreAberto::abrir_com_senha(&x, SENHA), Err(Erro::IntegridadeFalhou)));
}

#[test]
fn falha_de_gravacao_preserva_o_cofre_anterior() {
    let d = tempfile::tempdir().unwrap();
    let caminho = d.path().join("cofre.lissec");
    let a = Armazenamento::abrir(caminho.clone()).unwrap();
    let mut c = cofre_com_dados();
    let bom = c.serializar(10).unwrap();
    a.gravar(&bom, |x| c.verificar_gravado(x)).unwrap();

    // 1) verificação falha (ex.: disco devolveu lixo) → original intacto
    let mut corrompido = c.serializar(11).unwrap();
    let n = corrompido.len();
    corrompido[n - 5] ^= 1;
    assert!(a.gravar(&corrompido, |x| c.verificar_gravado(x)).is_err());
    assert!(CofreAberto::abrir_com_senha(&a.ler().unwrap(), SENHA).is_ok());

    // 2) "corte de energia" a meio: um temporário meio escrito fica para trás
    std::fs::write(d.path().join("cofre.lissec.tmp-deadbeef"), &bom[..100]).unwrap();
    drop(a);
    let a = Armazenamento::abrir(caminho).unwrap();
    assert!(CofreAberto::abrir_com_senha(&a.ler().unwrap(), SENHA).is_ok());
    assert!(!d.path().join("cofre.lissec.tmp-deadbeef").exists());

    // 3) se o principal se danificar, a versão anterior ainda abre
    let segundo = c.serializar(12).unwrap();
    a.gravar(&segundo, |x| c.verificar_gravado(x)).unwrap();
    std::fs::write(a.caminho(), b"lixo").unwrap();
    assert!(CofreAberto::abrir_com_senha(&a.ler().unwrap(), SENHA).is_err());
    assert!(CofreAberto::abrir_com_senha(&a.ler_anterior().unwrap().unwrap(), SENHA).is_ok());
}

#[test]
fn trocar_senha_preserva_os_dados() {
    let mut c = cofre_com_dados();
    let antes: Vec<String> = c.dados.itens.iter().map(|i| i.titulo.clone()).collect();
    let (mut n, _) = c.com_nova_senha("uma frase senha completamente nova", ParamsKdf::para_testes()).unwrap();
    let b = n.serializar(20).unwrap();
    let a = CofreAberto::abrir_com_senha(&b, "uma frase senha completamente nova").unwrap();
    let depois: Vec<String> = a.cofre.dados.itens.iter().map(|i| i.titulo.clone()).collect();
    assert_eq!(antes, depois);
    let senha = a.cofre.dados.itens[0].valor_campo("senha").unwrap().to_string();
    assert_eq!(senha, "SENHA-FICTICIA-7731");
    assert!(CofreAberto::abrir_com_senha(&b, SENHA).is_err());
    let _ = c.serializar(21).unwrap();
}

#[test]
fn copia_de_seguranca_restaura_os_registos() {
    let d = tempfile::tempdir().unwrap();
    let mut c = cofre_com_dados();
    let copia = d.path().join("copia.lissec");
    let b = c.serializar(10).unwrap();
    armazenamento::escrever_atomico(&copia, &b, |x| c.verificar_gravado(x)).unwrap();
    // o cofre muda depois da cópia
    let id = c.dados.itens[0].id.clone();
    c.dados.mover_para_lixo(&id, 11).unwrap();
    c.dados.eliminar_definitivamente(&id).unwrap();
    // restaurar = abrir a cópia com a senha da altura
    let lido = armazenamento::ler_limitado(&copia).unwrap();
    let r = CofreAberto::abrir_com_senha(&lido, SENHA).unwrap();
    assert_eq!(r.cofre.dados.itens.len(), 4);
    assert!(r.cofre.dados.item(&id).is_some());
}

#[test]
fn campos_maliciosos_sao_guardados_como_texto() {
    let mut c = CofreAberto::criar(SENHA, ParamsKdf::para_testes(), "<img src=x onerror=alert(1)>", 1).unwrap();
    let mut n = Nota::default();
    n.conteudo = "<script>alert('x')</script>\u{0}\u{202e}".into();
    let id = c.dados.guardar_item(item("<b>título</b>", Conteudo::Nota(n)), 2).unwrap();
    let b = c.serializar(3).unwrap();
    let a = CofreAberto::abrir_com_senha(&b, SENHA).unwrap();
    let i = a.cofre.dados.item(&id).unwrap();
    assert_eq!(i.titulo, "<b>título</b>");
    assert_eq!(i.valor_campo("conteudo").unwrap(), "<script>alert('x')</script>\u{0}\u{202e}");
}

#[test]
fn ficheiros_invalidos_sao_recusados_sem_panico() {
    for lixo in [&b""[..], b"LISSECUR", b"{\"esquema\":1}", &[0u8; 5000][..], &[0xffu8; 300][..]] {
        assert!(CofreAberto::abrir_com_senha(lixo, SENHA).is_err());
    }
    // ficheiro válido mas truncado em todos os pontos do cabeçalho
    let mut c = cofre_com_dados();
    let b = c.serializar(1).unwrap();
    for corte in (0..400).step_by(7) {
        assert!(CofreAberto::abrir_com_senha(&b[..corte], SENHA).is_err());
    }
}

#[test]
fn cofre_grande_abre_e_grava() {
    let mut c = CofreAberto::criar(SENHA, ParamsKdf::para_testes(), "", 1).unwrap();
    for i in 0..2000 {
        let mut l = Login::default();
        l.senha = format!("senha-ficticia-{i}");
        l.url = format!("https://servico{i}.invalid");
        c.dados.guardar_item(item(&format!("Serviço {i}"), Conteudo::Login(l)), i).unwrap();
    }
    let b = c.serializar(5000).unwrap();
    assert!(b.len() < 4 * 1024 * 1024);
    let a = CofreAberto::abrir_com_senha(&b, SENHA).unwrap();
    assert_eq!(a.cofre.dados.itens.len(), 2000);
}
