# LisSecurity — testes e resultados

Todos os testes usam dados **claramente fictícios** (`SENHA-FICTICIA-…`, `exemplo.invalid`,
números de cartão e IBAN de documentação). Nunca se usam credenciais reais.

## Como correr

```bash
# núcleo criptográfico e camada nativa (Rust)
cargo test --workspace

# validações da interface (IBAN, BIC, Luhn, CPF/CNPJ, Pix, datas)
npm test

# app real conduzida por WebDriver (Linux: WebKitGTK + tauri-driver + Xvfb)
npx tauri build --debug --no-bundle
cargo install tauri-driver --locked
xvfb-run -a node e2e/teste.mjs
```

O workflow `.github/workflows/ci.yml` corre tudo isto em cada alteração e gera o instalador
Windows (e a Release, quando pedida).

## Resultados (v0.2.0, 31/10/2026)

| Conjunto | Resultado |
| --- | --- |
| `lissecurity-core` — testes unitários | **74/74** |
| `lissecurity-core` — critérios de aceitação (`core/tests/aceitacao.rs`) | **10/10** |
| `lissecurity` (camada Tauri) | **1/1** |
| Interface — `vitest` | **10/10** |
| Ponta-a-ponta na app real (`e2e/teste.mjs`) | **34/34** (`docs/resultado-e2e.json`, capturas em `docs/capturas/`) |
| `cargo clippy --workspace --all-targets` | 0 avisos |
| `cargo check --target x86_64-pc-windows-gnu` (código Windows: suspensão, Win+L, área de transferência) | compila |

## Critérios de aceitação → onde são verificados

| Critério | Teste |
| --- | --- |
| A senha correta abre o cofre | `aceitacao::senha_correta_abre_e_incorreta_nao`; E2E "senha certa abre" |
| A senha incorreta não permite leitura | idem; E2E "senha errada não abre e explica porquê" |
| A cópia do cofre não contém os dados de teste em texto puro | `aceitacao::ficheiro_e_copia_nao_tem_dados_em_claro` (UTF-8 e UTF-16); E2E percorre **todos** os ficheiros escritos pela app, incluindo caches do WebView |
| Backups também não | idem (`escrever_atomico` da cópia) |
| Alterações em conteúdo autenticado são detetadas | `aceitacao::qualquer_byte_alterado_e_detetado` (todos os bytes do cabeçalho + amostra dos dados); `cripto::qualquer_alteracao_falha` (todos os bytes) |
| Falhas de gravação não destroem o cofre anterior | `aceitacao::falha_de_gravacao_preserva_o_cofre_anterior` (verificação falhada, temporário meio escrito, principal danificado → anterior abre); `armazenamento::verificacao_falhada_nao_toca_no_original` |
| Trocar a senha preserva os dados | `aceitacao::trocar_senha_preserva_os_dados`; `cofre::nova_senha_roda_a_chave_do_cofre`; E2E "trocar a senha mestra preserva os dados" |
| Restaurar um backup recupera os registos | `aceitacao::copia_de_seguranca_restaura_os_registos` |
| Bloquear remove dados da interface e impede novas operações | E2E "bloquear (Ctrl+L) tira tudo do ecrã" + "com o cofre bloqueado a camada nativa recusa leituras" |
| Operação iniciada antes do bloqueio não revela dados depois | E2E "uma revelação pedida antes do bloqueio não reaparece depois" |
| Minimizar / inatividade respeitam as políticas | E2E "minimizar bloqueia…", "bloqueio automático por inatividade (1 min…)" |
| Suspender e bloquear a sessão do Windows | código compilado para Windows; **não testado automaticamente** (exige um Windows real — ver limitações) |
| A limpeza da área de transferência não apaga algo novo | E2E "copiar … limpa sozinha" + "a limpeza não apaga algo novo copiado pela pessoa" |
| Campos maliciosos e importações inválidas não executam código | `aceitacao::campos_maliciosos_sao_guardados_como_texto`, `ficheiros_invalidos_sao_recusados_sem_panico`, `formato::*` (truncado, versão futura, parâmetros abusivos, ranhuras duplicadas); só se abrem URLs http/https (`comandos::so_abre_enderecos_web`) |
| Logs e mensagens de erro não contêm segredos | `cripto::debug_nao_mostra_a_chave`, `modelo::debug_nao_mostra_segredos`; a camada nativa não escreve registos |
| Funções centrais sem internet | não há nenhum pedido de rede no código (CSP `connect-src ipc:` apenas); fontes e ícones empacotados |
| Interoperabilidade da cripto | `cripto::argon2id_igual_a_implementacao_de_referencia` (resultado idêntico ao Argon2id de referência em C) |
| Gerador sem enviesamento | `gerador::distribuicao_aproximadamente_uniforme`, `aleatorio::uniforme_*` |

## Verificações acrescentadas na v0.2

| O quê | Onde |
| --- | --- |
| Códigos 2FA iguais aos vetores do RFC 6238 (SHA-1/256/512) e ao cálculo independente no E2E | `totp::vetores_rfc6238`; E2E "código 2FA ao vivo…" |
| Importar senhas: Chrome, Firefox, Bitwarden (pastas, favoritos, 2FA, notas), CSV desconhecido recusado, duplicados saltados | `importacao::*`, `operacoes::importar_salta_duplicados` |
| Extratos Revolut e CSV genérico em português: valores, comissões, datas, estados não concluídos, sem duplicados ao reimportar | `importacao::importa_extrato_*`, `operacoes::movimentos_sem_duplicados_e_com_regras` |
| Categorias automáticas, regras por comerciante, resumo do mês, evolução e pagamentos recorrentes | `financas::*` |
| Migração do esquema 1 → 2 e recusa de esquema futuro | `cofre::migra_esquema_antigo_e_recusa_futuro` |
| Reforçar a proteção pede a senha e o cofre abre com os parâmetros novos | `cofre::novos_parametros_pedem_a_senha` |
| Cópias automáticas: a primeira ao ligar e outra depois de uma alteração, na pasta do Google Drive detetada; ficheiros sem dados em claro | E2E "cópias automáticas cifradas para a pasta do Google Drive" + varrimento de todos os ficheiros |
| Copiar e minimizar: o cofre bloqueia mas o que se copiou continua na área de transferência | E2E "minimizar bloqueia o cofre mas mantém o que se copiou" |
| Senha mestra pedida antes de revelar o IBAN (opção ligada) | E2E "pedir a senha mestra antes de revelar o IBAN" |
| Fila de categorias com setas que rolam e menu "Todas" com todas as categorias | E2E "categorias: setas quando não cabem…" |

A importação de CSV não é exercida no E2E (abre a janela nativa de escolher ficheiro, que o
WebDriver não controla); está coberta pelos testes do núcleo. A captura
`31-gastos-ilustrativo.png` é a página de Gastos desenhada no Chromium com **dados simulados**
(ilustração do aspeto), não um teste da app.

## Bugs encontrados pelos testes e corrigidos

1. **Foco a saltar enquanto se escrevia num formulário** — o `Modal` voltava a focar o primeiro
   campo a cada tecla (a função de fechar mudava a cada render). Apanhado pelo E2E (o título
   ficava com as letras de todos os campos).
2. **Botão "Desbloquear" preso em "A abrir…" depois de uma senha errada** — o tratamento de
   respostas descartadas voltava a lançar os outros erros dentro de `try/catch`. Apanhado pelo E2E.
3. **Janela invisível no arranque em Linux** — com a janela escondida o WebKit não corre
   `requestAnimationFrame`; a interface já não depende disso e a camada nativa mostra a janela
   ao fim de 4 s se a interface não avisar.
4. **v0.2 — "o ícone de copiar não funciona" (relatado no Windows)**: com "bloquear ao minimizar"
   ligado, copiar e minimizar a janela para colar noutro sítio bloqueava o cofre **e limpava a
   área de transferência**. Agora bloquear não limpa (o prazo continua a contar) e a cópia tem
   uma segunda tentativa sem as marcas de exclusão do histórico. Coberto pelo E2E.
5. **v0.2 — categorias que não cabiam ficavam inacessíveis** (fila sem barra de deslocamento):
   agora há setas, roda do rato na horizontal, desvanecimento nas pontas e o menu "Todas".

## O que os testes não cobrem

- Comportamento em Windows real (DPI, Snap, vários monitores, Win+L, suspensão, histórico Win+V,
  proteção contra capturas). O workflow compila e empacota no Windows, mas não conduz a interface.
- Leitores de ecrã (os rótulos e papéis ARIA existem, mas não foram testados com NVDA/Narrador).
- Desempenho com dezenas de milhares de registos (testado com 2000 no núcleo).
