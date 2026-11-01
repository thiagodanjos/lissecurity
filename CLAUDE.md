# LisSecurity — notas para o Claude

Cofre pessoal de senhas e dados bancários para Windows (Tauri 2 + Rust + React), da família Lis
(LisFilms). Todo o texto da app e da documentação é em português de Portugal. A app não fala com
nenhuma API nem com a internet.

- Segurança antes de tudo: ler `docs/SEGURANCA.md` antes de mexer em `core/` ou `src-tauri/src/comandos.rs`.
- `core/` (Rust, `#![forbid(unsafe_code)]`) decide a criptografia e o formato do ficheiro; a interface só
  recebe resumos e vistas mascaradas (`core/src/vista.rs`, lista de permissões explícita).
- Identidade visual = tokens do LisFilms (ver `docs/DESIGN.md`).
- Testes: `cargo test --workspace`, `npm test`, e o ponta-a-ponta na app real
  (`npx tauri build --debug --no-bundle && xvfb-run -a node e2e/teste.mjs`, precisa de `tauri-driver`).
- Nunca usar dados reais nos testes nem commitar ficheiros `.lissec`.
- Imagens do README: `python docs/readme/gerar.py` (precisa de `fonttools brotli pillow`).
- Releases: subir a versão (Cargo.toml, `src-tauri/tauri.conf.json`, package.json) e enviar a etiqueta
  `vX.Y.Z` **ou** um commit no `main` com `[publicar-release]` na mensagem — o workflow testa, compila o
  instalador, cria a etiqueta e publica a Release com o SHA-256.
