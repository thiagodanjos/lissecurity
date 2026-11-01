//! Operações sobre os registos (criar, editar, duplicar, lixo…). As datas, o histórico de
//! senhas e os identificadores são sempre decididos aqui, nunca pela interface.

use crate::aleatorio;
use crate::erro::{Erro, Resultado};
use crate::modelo::{Conteudo, DadosCofre, Item, Movimento, SenhaAnterior};

fn nao_encontrado() -> Erro {
    Erro::invalido("O registo já não existe.")
}

fn arrumar(item: &mut Item) -> Resultado<()> {
    item.titulo = item.titulo.trim().to_string();
    item.categoria = item.categoria.trim().to_string();
    let mut etiquetas: Vec<String> = Vec::new();
    for e in item.etiquetas.iter().map(|e| e.trim()).filter(|e| !e.is_empty()) {
        if !etiquetas.iter().any(|x| x.eq_ignore_ascii_case(e)) {
            etiquetas.push(e.to_string());
        }
    }
    item.etiquetas = etiquetas;
    for c in item.campos.iter_mut() {
        if c.id.is_empty() {
            c.id = aleatorio::uuid_v4()?;
        }
        c.rotulo = c.rotulo.trim().to_string();
    }
    item.campos.retain(|c| !c.rotulo.is_empty() || !c.valor.is_empty());
    match &mut item.conteudo {
        Conteudo::Banco(b) => {
            b.iban = b.iban.split_whitespace().collect::<String>().to_uppercase();
            b.bic = b.bic.trim().to_uppercase();
            b.pais = b.pais.trim().to_uppercase();
            b.moeda = b.moeda.trim().to_uppercase();
            b.chaves_pix.retain(|p| !p.valor.trim().is_empty());
        }
        Conteudo::Cartao(c) => {
            c.numero = c.numero.chars().filter(|x| !x.is_whitespace() && *x != '-').collect();
            c.validade = c.validade.trim().to_string();
        }
        Conteudo::Nota(n) => {
            n.codigos.retain(|c| !c.valor.trim().is_empty());
            if n.tipo_nota.is_empty() {
                n.tipo_nota = "nota".into();
            }
        }
        Conteudo::Login(l) => {
            l.url = l.url.trim().to_string();
        }
    }
    Ok(())
}

impl DadosCofre {
    /// Liga só a registos que existem e são do tipo certo; o resto é descartado em silêncio
    /// (não é um erro da pessoa: o registo ligado pode ter sido eliminado entretanto).
    fn validar_ligacoes(&self, item: &mut Item) {
        let ok =
            |id: &Option<String>, tipo: &str| id.as_deref().and_then(|id| self.item(id)).is_some_and(|i| i.tipo() == tipo && !i.no_lixo());
        match &mut item.conteudo {
            Conteudo::Banco(b) if !ok(&b.credencial_ligada, "login") => b.credencial_ligada = None,
            Conteudo::Cartao(c) if !ok(&c.conta_ligada, "banco") => c.conta_ligada = None,
            _ => {}
        }
    }

    /// Cria (id vazio) ou atualiza um registo. Devolve o id.
    pub fn guardar_item(&mut self, mut item: Item, agora: i64) -> Resultado<String> {
        arrumar(&mut item)?;
        item.validar()?;
        self.validar_ligacoes(&mut item);
        let max_hist = self.definicoes.max_historico as usize;

        if item.id.is_empty() {
            if self.itens.len() >= 20_000 {
                return Err(Erro::invalido("O cofre atingiu o limite de 20 000 registos."));
            }
            item.id = aleatorio::uuid_v4()?;
            item.criado_em = agora;
            item.alterado_em = agora;
            item.eliminado_em = None;
            if let Conteudo::Login(l) = &mut item.conteudo {
                l.historico.clear();
                l.senha_alterada_em = (!l.senha.is_empty()).then_some(agora);
            }
            let id = item.id.clone();
            self.itens.push(item);
            return Ok(id);
        }

        let atual = self.item_mut(&item.id).ok_or_else(nao_encontrado)?;
        if atual.no_lixo() {
            return Err(Erro::invalido("Restaura o registo do lixo antes de o editar."));
        }
        if atual.tipo() != item.tipo() {
            return Err(Erro::invalido("Não é possível mudar o tipo de um registo."));
        }
        item.criado_em = atual.criado_em;
        item.alterado_em = agora;
        item.eliminado_em = None;
        if let (Conteudo::Login(novo), Conteudo::Login(velho)) = (&mut item.conteudo, &mut atual.conteudo) {
            // o histórico é do cofre, não da interface: mantém-se o que estava
            novo.historico = std::mem::take(&mut velho.historico);
            novo.senha_alterada_em = velho.senha_alterada_em;
            if novo.senha != velho.senha {
                if !velho.senha.is_empty() && max_hist > 0 {
                    novo.historico.insert(0, SenhaAnterior { senha: std::mem::take(&mut velho.senha), substituida_em: agora });
                }
                novo.senha_alterada_em = (!novo.senha.is_empty()).then_some(agora);
            }
            novo.historico.truncate(max_hist);
        }
        let id = item.id.clone();
        *atual = item;
        Ok(id)
    }

    pub fn duplicar(&mut self, id: &str, agora: i64) -> Resultado<String> {
        let mut copia = self.item(id).ok_or_else(nao_encontrado)?.clone();
        copia.id = String::new();
        copia.titulo = format!("{} (cópia)", copia.titulo).chars().take(200).collect();
        copia.favorito = false;
        self.guardar_item(copia, agora)
    }

    pub fn mover_para_lixo(&mut self, id: &str, agora: i64) -> Resultado<()> {
        let i = self.item_mut(id).ok_or_else(nao_encontrado)?;
        i.eliminado_em = Some(agora);
        Ok(())
    }

    pub fn restaurar(&mut self, id: &str, agora: i64) -> Resultado<()> {
        let i = self.item_mut(id).ok_or_else(nao_encontrado)?;
        i.eliminado_em = None;
        i.alterado_em = agora;
        Ok(())
    }

    /// Remove o registo do cofre. As cópias de segurança feitas antes continuam a tê-lo.
    pub fn eliminar_definitivamente(&mut self, id: &str) -> Resultado<()> {
        let pos = self.itens.iter().position(|i| i.id == id).ok_or_else(nao_encontrado)?;
        if !self.itens[pos].no_lixo() {
            return Err(Erro::invalido("Só se elimina de vez o que já está no lixo."));
        }
        self.itens.remove(pos);
        Ok(())
    }

    pub fn esvaziar_lixo(&mut self) -> usize {
        let antes = self.itens.len();
        self.itens.retain(|i| !i.no_lixo());
        antes - self.itens.len()
    }

    pub fn alternar_favorito(&mut self, id: &str) -> Resultado<bool> {
        let i = self.item_mut(id).ok_or_else(nao_encontrado)?;
        i.favorito = !i.favorito;
        Ok(i.favorito)
    }

    pub fn marcar_codigo(&mut self, id: &str, indice: usize, usado: bool, agora: i64) -> Resultado<()> {
        let i = self.item_mut(id).ok_or_else(nao_encontrado)?;
        match &mut i.conteudo {
            Conteudo::Nota(n) => {
                let c = n.codigos.get_mut(indice).ok_or_else(nao_encontrado)?;
                c.usado = usado;
                i.alterado_em = agora;
                Ok(())
            }
            _ => Err(nao_encontrado()),
        }
    }

    pub fn limpar_historico(&mut self, id: &str) -> Resultado<()> {
        let i = self.item_mut(id).ok_or_else(nao_encontrado)?;
        if let Conteudo::Login(l) = &mut i.conteudo {
            l.historico.clear();
        }
        Ok(())
    }
}

// ───────────────────────────── importação e movimentos ─────────────────────────────

fn chave_duplicado(i: &Item) -> Option<(String, String, String)> {
    match &i.conteudo {
        Conteudo::Login(l) => Some((
            crate::vista::dominio(&l.url).unwrap_or_else(|| crate::vista::normalizar(&i.titulo)),
            crate::vista::normalizar(if l.utilizador.is_empty() { &l.email } else { &l.utilizador }),
            l.senha.clone(),
        )),
        Conteudo::Nota(n) => Some((crate::vista::normalizar(&i.titulo), String::new(), n.conteudo.clone())),
        _ => None,
    }
}

impl DadosCofre {
    /// Junta registos importados, saltando os que já existem (mesmo site, utilizador e senha).
    /// Devolve (novos, duplicados).
    pub fn importar_itens(&mut self, itens: Vec<Item>, agora: i64) -> Resultado<(usize, usize)> {
        let mut existentes: std::collections::HashSet<(String, String, String)> =
            self.itens.iter().filter(|i| !i.no_lixo()).filter_map(chave_duplicado).collect();
        let (mut novos, mut duplicados) = (0, 0);
        for item in itens {
            match chave_duplicado(&item) {
                Some(k) if existentes.contains(&k) => duplicados += 1,
                k => {
                    self.guardar_item(item, agora)?;
                    if let Some(k) = k {
                        existentes.insert(k);
                    }
                    novos += 1;
                }
            }
        }
        Ok((novos, duplicados))
    }

    /// Junta movimentos de um extrato; os que já existem (mesma impressão digital) são
    /// ignorados e as regras de categoria da pessoa são aplicadas. Devolve (novos, duplicados).
    pub fn importar_movimentos(&mut self, movimentos: Vec<Movimento>) -> Resultado<(usize, usize)> {
        if self.movimentos.len() + movimentos.len() > 200_000 {
            return Err(Erro::invalido("O cofre atingiu o limite de 200 000 movimentos."));
        }
        let mut ids: std::collections::HashSet<String> = self.movimentos.iter().map(|m| m.id.clone()).collect();
        let (mut novos, mut duplicados) = (0, 0);
        for mut m in movimentos {
            if !ids.insert(m.id.clone()) {
                duplicados += 1;
                continue;
            }
            m.categoria = crate::financas::categorizar(&m.descricao, &m.tipo, m.valor, &self.regras_categoria);
            self.movimentos.push(m);
            novos += 1;
        }
        self.movimentos.sort_by_key(|m| std::cmp::Reverse(m.data));
        Ok((novos, duplicados))
    }

    /// Muda a categoria de um movimento e, se pedido, de todos os do mesmo comerciante
    /// (e dos que vierem em extratos futuros). Devolve quantos mudaram.
    pub fn categorizar_movimento(&mut self, id: &str, categoria: &str, todos_do_comerciante: bool) -> Resultado<usize> {
        if !crate::financas::CATEGORIAS.iter().any(|(c, _)| *c == categoria) {
            return Err(Erro::invalido("Categoria desconhecida."));
        }
        let m = self.movimentos.iter_mut().find(|m| m.id == id).ok_or_else(nao_encontrado)?;
        if !todos_do_comerciante {
            m.categoria = categoria.into();
            return Ok(1);
        }
        let com = crate::financas::comerciante(&m.descricao);
        self.regras_categoria.retain(|r| r.comerciante != com);
        self.regras_categoria.push(crate::modelo::RegraCategoria { comerciante: com.clone(), categoria: categoria.into() });
        let mut n = 0;
        for m in self.movimentos.iter_mut().filter(|m| crate::financas::comerciante(&m.descricao) == com) {
            m.categoria = categoria.into();
            n += 1;
        }
        Ok(n)
    }

    /// Apaga os movimentos importados (todos, ou só os de uma origem). Devolve quantos.
    pub fn eliminar_movimentos(&mut self, origem: Option<&str>) -> usize {
        let antes = self.movimentos.len();
        match origem {
            Some(o) => self.movimentos.retain(|m| m.origem != o),
            None => self.movimentos.clear(),
        }
        antes - self.movimentos.len()
    }
}

#[cfg(test)]
#[allow(clippy::field_reassign_with_default)]
mod testes {
    use super::*;
    use crate::modelo::{Banco, Login};

    fn login(titulo: &str, senha: &str) -> Item {
        let mut l = Login::default();
        l.senha = senha.into();
        Item {
            id: String::new(),
            titulo: titulo.into(),
            favorito: false,
            categoria: String::new(),
            etiquetas: vec![" a ".into(), "A".into(), "".into(), "b".into()],
            notas: String::new(),
            campos: vec![],
            criado_em: 999,
            alterado_em: 999,
            eliminado_em: Some(1),
            conteudo: Conteudo::Login(l),
        }
    }

    #[test]
    fn criar_ignora_datas_da_interface() {
        let mut d = DadosCofre::novo(0, "");
        let id = d.guardar_item(login("  Serviço  ", "s1"), 10).unwrap();
        let i = d.item(&id).unwrap();
        assert_eq!(i.titulo, "Serviço");
        assert_eq!((i.criado_em, i.alterado_em, i.eliminado_em), (10, 10, None));
        assert_eq!(i.etiquetas, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn historico_guarda_senha_anterior() {
        let mut d = DadosCofre::novo(0, "");
        d.definicoes.max_historico = 2;
        let id = d.guardar_item(login("S", "s1"), 10).unwrap();
        for (n, s) in ["s2", "s3", "s4"].iter().enumerate() {
            let mut e = d.item(&id).unwrap().clone();
            if let Conteudo::Login(l) = &mut e.conteudo {
                l.senha = s.to_string();
                l.historico.clear(); // a interface não consegue apagar o histórico assim
            }
            d.guardar_item(e, 20 + n as i64).unwrap();
        }
        let l = d.item(&id).unwrap().login().unwrap();
        assert_eq!(l.senha, "s4");
        let h: Vec<&str> = l.historico.iter().map(|h| h.senha.as_str()).collect();
        assert_eq!(h, vec!["s3", "s2"]);
        assert_eq!(l.senha_alterada_em, Some(22));
    }

    #[test]
    fn nao_muda_tipo_nem_edita_no_lixo() {
        let mut d = DadosCofre::novo(0, "");
        let id = d.guardar_item(login("S", "s1"), 10).unwrap();
        let mut b = login("S", "x");
        b.id = id.clone();
        b.conteudo = Conteudo::Banco(Banco::default());
        assert!(d.guardar_item(b, 11).is_err());
        d.mover_para_lixo(&id, 12).unwrap();
        let mut e = d.item(&id).unwrap().clone();
        e.titulo = "novo".into();
        assert!(d.guardar_item(e, 13).is_err());
        d.restaurar(&id, 14).unwrap();
        assert!(d.item(&id).unwrap().eliminado_em.is_none());
    }

    #[test]
    fn eliminar_so_do_lixo() {
        let mut d = DadosCofre::novo(0, "");
        let id = d.guardar_item(login("S", "s1"), 10).unwrap();
        assert!(d.eliminar_definitivamente(&id).is_err());
        d.mover_para_lixo(&id, 11).unwrap();
        d.eliminar_definitivamente(&id).unwrap();
        assert!(d.item(&id).is_none());
    }

    #[test]
    fn duplicar_cria_registo_novo_sem_historico() {
        let mut d = DadosCofre::novo(0, "");
        let id = d.guardar_item(login("S", "s1"), 10).unwrap();
        let id2 = d.duplicar(&id, 11).unwrap();
        assert_ne!(id, id2);
        assert_eq!(d.item(&id2).unwrap().titulo, "S (cópia)");
    }

    #[test]
    fn ligacoes_invalidas_sao_descartadas() {
        let mut d = DadosCofre::novo(0, "");
        let mut b = login("Banco", "");
        let mut banco = Banco::default();
        banco.credencial_ligada = Some("nao-existe".into());
        b.conteudo = Conteudo::Banco(banco);
        let id = d.guardar_item(b, 1).unwrap();
        match &d.item(&id).unwrap().conteudo {
            Conteudo::Banco(b) => assert!(b.credencial_ligada.is_none()),
            _ => unreachable!(),
        }
    }

    #[test]
    fn importar_salta_duplicados() {
        let mut d = DadosCofre::novo(0, "");
        d.guardar_item(login("Exemplo", "s1"), 1).unwrap();
        let (n, dup) = d.importar_itens(vec![login("Exemplo", "s1"), login("Exemplo", "s2"), login("Outro", "s3")], 2).unwrap();
        assert_eq!((n, dup), (2, 1));
        assert_eq!(d.itens.len(), 3);
    }

    #[test]
    fn movimentos_sem_duplicados_e_com_regras() {
        let mut d = DadosCofre::novo(0, "");
        let m = |id: &str, desc: &str| Movimento {
            id: id.into(),
            data: 1,
            descricao: desc.into(),
            valor: -100,
            moeda: "EUR".into(),
            tipo: "CARD_PAYMENT".into(),
            categoria: String::new(),
            origem: "Revolut".into(),
        };
        assert_eq!(d.importar_movimentos(vec![m("a", "Loja X 1"), m("b", "Loja X 2")]).unwrap(), (2, 0));
        assert_eq!(d.importar_movimentos(vec![m("a", "Loja X 1"), m("c", "Loja X 3")]).unwrap(), (1, 1));
        assert_eq!(d.categorizar_movimento("a", "lazer", true).unwrap(), 3);
        assert!(d.movimentos.iter().all(|m| m.categoria == "lazer"));
        // um extrato novo do mesmo comerciante segue a regra
        d.importar_movimentos(vec![m("d", "Loja X 4")]).unwrap();
        assert_eq!(d.movimentos.iter().find(|m| m.id == "d").unwrap().categoria, "lazer");
        assert!(d.categorizar_movimento("a", "inventada", false).is_err());
        assert_eq!(d.eliminar_movimentos(Some("Revolut")), 4);
    }
}
