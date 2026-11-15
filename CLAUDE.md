# LisSecurity — notas para o Claude

Cofre pessoal de senhas e dados bancários para Windows e Android (Tauri 2 + Rust + React), da família Lis
(LisFilms). Todo o texto da app e da documentação é em português de Portugal. A app não fala com
nenhuma API nem com a internet.

- Segurança antes de tudo: ler `docs/SEGURANCA.md` antes de mexer em `core/` ou `src-tauri/src/comandos.rs`.
- `core/` (Rust, `#![forbid(unsafe_code)]`) decide a criptografia e o formato do ficheiro; a interface só
  recebe resumos e vistas mascaradas (`core/src/vista.rs`, lista de permissões explícita).
- Identidade visual = tokens do LisFilms (ver `docs/DESIGN.md`).
- **Android** (desde a 0.3.0): o mesmo núcleo e os mesmos comandos; o que é do telemóvel está em
  `src-tauri/src/{nativo,plataforma,biometria}.rs` e na camada Kotlin em `src-tauri/gen/android/`
  (só o Rust a chama). Manifesto sem `INTERNET` e sem cópias do Android — não acrescentar
  permissões. Interface móvel em `src/lib/movel.ts` + `src/componentes/movel.tsx`; ver no
  navegador com `npm run dev` e `?simular=android` (só em desenvolvimento). Teste no emulador:
  `e2e/android.mjs` (corre no CI). A chave de assinatura do APK só existe nos segredos do GitHub
  (`LISSECURITY_KEYSTORE_B64`, `LISSECURITY_KEYSTORE_SENHA`, `LISSECURITY_CHAVE_ALIAS`,
  `LISSECURITY_CHAVE_SENHA`) — nunca a commitar; sem ela o APK não entra na Release.
- Testes: `cargo test --workspace`, `npm test`, e o ponta-a-ponta na app real
  (`npx tauri build --debug --no-bundle && xvfb-run -a node e2e/teste.mjs`, precisa de `tauri-driver`).
- Nunca usar dados reais nos testes nem commitar ficheiros `.lissec`.
- Imagens do README: `python docs/readme/gerar.py` (precisa de `fonttools brotli pillow`).
- Releases: subir a versão (Cargo.toml, `src-tauri/tauri.conf.json`, package.json) e enviar a etiqueta
  `vX.Y.Z` **ou** um commit no `main` com `[publicar-release]` na mensagem — o workflow testa, compila o
  instalador, cria a etiqueta e publica a Release com o SHA-256.
