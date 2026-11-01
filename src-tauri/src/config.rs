//! Preferências da aplicação que têm de existir ANTES de desbloquear (aparência, local do
//! cofre, comportamento da janela). Não contêm nenhum dado do cofre nem segredos: tudo o que é
//! pessoal (nome, definições de bloqueio, registos) vive dentro do ficheiro cifrado.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ConfigApp {
    /// Ficheiro do cofre; vazio = pasta de dados da aplicação.
    pub caminho_cofre: Option<PathBuf>,
    /// sistema | reduzidas | completas
    pub animacoes: String,
    /// confortavel | compacta
    pub densidade: String,
    /// grafite | preto
    pub tema: String,
    /// sair | minimizar
    pub ao_fechar: String,
    pub iniciar_com_sistema: bool,
    /// Pede ao Windows para excluir a janela de capturas de ecrã e partilhas de ecrã.
    pub proteger_captura: bool,
    pub lateral_recolhida: bool,
    /// Tamanho de tudo na janela (0,8–1,5).
    pub zoom: f64,
    /// inicio | senhas | financeiro | gastos
    pub pagina_inicial: String,
    /// verde (LisFilms) | azul (LisGames)
    pub cor: String,
    /// Mostrar o número de registos ao lado de cada secção da lateral.
    pub contadores_lateral: bool,
}

impl Default for ConfigApp {
    fn default() -> Self {
        ConfigApp {
            caminho_cofre: None,
            animacoes: "sistema".into(),
            densidade: "confortavel".into(),
            tema: "grafite".into(),
            ao_fechar: "sair".into(),
            iniciar_com_sistema: false,
            proteger_captura: true,
            lateral_recolhida: false,
            zoom: 1.0,
            pagina_inicial: "inicio".into(),
            cor: "verde".into(),
            contadores_lateral: true,
        }
    }
}

impl ConfigApp {
    pub fn ler(caminho: &Path) -> Self {
        std::fs::read(caminho).ok().and_then(|b| serde_json::from_slice::<ConfigApp>(&b).ok()).map(|c| c.normalizada()).unwrap_or_default()
    }

    pub fn gravar(&self, caminho: &Path) -> std::io::Result<()> {
        if let Some(p) = caminho.parent() {
            std::fs::create_dir_all(p)?;
        }
        let json = serde_json::to_vec_pretty(self).map_err(std::io::Error::other)?;
        lissecurity_core::armazenamento::escrever_atomico(caminho, &json, |_| Ok(())).map_err(|e| std::io::Error::other(e.to_string()))
    }

    /// Valores desconhecidos voltam ao padrão (o ficheiro é editável por qualquer programa).
    pub fn normalizada(mut self) -> Self {
        let p = ConfigApp::default();
        if !["sistema", "reduzidas", "completas"].contains(&self.animacoes.as_str()) {
            self.animacoes = p.animacoes;
        }
        if !["confortavel", "compacta"].contains(&self.densidade.as_str()) {
            self.densidade = p.densidade;
        }
        if !["grafite", "preto"].contains(&self.tema.as_str()) {
            self.tema = p.tema;
        }
        if !["sair", "minimizar"].contains(&self.ao_fechar.as_str()) {
            self.ao_fechar = p.ao_fechar;
        }
        if !["inicio", "senhas", "financeiro", "gastos"].contains(&self.pagina_inicial.as_str()) {
            self.pagina_inicial = p.pagina_inicial;
        }
        if !["verde", "azul"].contains(&self.cor.as_str()) {
            self.cor = p.cor;
        }
        if !self.zoom.is_finite() {
            self.zoom = 1.0;
        }
        self.zoom = (self.zoom.clamp(0.8, 1.5) * 20.0).round() / 20.0;
        if self.caminho_cofre.as_ref().is_some_and(|c| !c.is_absolute()) {
            self.caminho_cofre = None;
        }
        self
    }
}
