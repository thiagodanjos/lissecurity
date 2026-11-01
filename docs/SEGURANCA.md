# LisSecurity — arquitetura de segurança

Este documento descreve o que o LisSecurity protege, como o faz e onde estão os limites.
Foi escrito antes e durante a implementação e corresponde ao código em `core/` e `src-tauri/`.

> **Estado:** primeira versão funcional, com testes automáticos (ver `TESTES.md`).
> **Ainda não teve revisão de segurança independente.** Não o uses como único sítio das tuas
> credenciais mais importantes antes disso (ver «Pendências para revisão» no fim).

---

## 1. Modelo de ameaças

### O que se quer proteger

| Ativo | Onde vive |
| --- | --- |
| Senhas, dados bancários, cartões, notas, códigos de recuperação, históricos e lixo | Dentro do ficheiro `cofre.lissec`, cifrado |
| Senha mestra | Só na cabeça da pessoa; nunca gravada, nunca enviada |
| Chave do cofre (256 bits aleatórios) | No ficheiro, embrulhada (cifrada) pela senha mestra e, opcionalmente, pela chave de recuperação; em memória só com o cofre aberto |
| Chave de recuperação | Fora do computador (papel) |

### Contra o quê

| Ameaça | Defesa |
| --- | --- |
| **Cópia ou roubo do ficheiro do cofre** (portátil roubado, disco clonado, sincronização indevida) | Tudo cifrado com XChaCha20-Poly1305; a chave só se obtém com a senha mestra (Argon2id, calibrado para ≈0,75 s e ≥64 MiB por tentativa) ou com a chave de recuperação (160 bits aleatórios). O cabeçalho não tem nomes, contagens nem datas. |
| **Exposição das cópias de segurança** | São o mesmo formato, igualmente cifradas. Não há exportação em texto simples. |
| **Acesso casual ao computador** (alguém senta-se ao teclado) | Bloqueio manual (Ctrl+L, barra de título, lateral), por inatividade (contado na camada nativa), ao minimizar, ao suspender, ao bloquear a sessão do Windows (Win+L) e ao fechar. Proteção contra capturas de ecrã (`WDA_EXCLUDEFROMCAPTURE`). |
| **Tentar abrir a app sem a senha** | Não existe verificação "booleana" da senha: abrir é decifrar. Não há senha padrão, acesso de suporte nem chave universal. Atraso crescente depois de 5 tentativas falhadas na app. |
| **Alteração indevida dos dados cifrados** | Cifra autenticada: qualquer byte alterado (cabeçalho, ranhuras, nonce, dados) faz a abertura falhar. O cabeçalho inteiro entra como dados associados (AAD). |
| **Fugas acidentais** (registos, temporários, interface) | A camada nativa não regista nada. Temporários só têm bytes cifrados. A interface recebe resumos e vistas mascaradas; os segredos chegam um a um e só quando pedidos; títulos de janela e notificações nunca levam segredos. O teste E2E procura os dados fictícios em **todos** os ficheiros escritos pela app (incluindo as caches do WebView). |

### Fora do alcance (limites honestos)

- **Malware no computador** ou um registador de teclas: vê a senha mestra quando é escrita e pode ler a memória do processo enquanto o cofre está aberto.
- **Uma sessão já desbloqueada**: quem estiver ao teclado vê o que a pessoa veria.
- **Área de transferência**: outros programas podem lê-la antes da limpeza automática.
- **Apagamento em memória**: o Rust apaga chaves e dados ao largá-los (`zeroize`), mas cópias intermédias (realocações de `String`, a pilha do WebView, o processo de IPC) podem sobreviver algum tempo. É melhor esforço, não garantia.
- **Apagamento em disco**: em SSD, pens e cópias do sistema não é possível garantir que um ficheiro apagado desaparece.
- **Senha mestra fraca**: o Argon2id encarece cada tentativa, mas não salva uma senha de 6 letras.

---

## 2. Escolhas criptográficas

Nada foi inventado: são composições normais de primitivas maduras, com bibliotecas mantidas
(projeto RustCrypto) e seguindo o [OWASP Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)
e o [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

| Função | Escolha | Biblioteca |
| --- | --- | --- |
| Derivação da senha mestra | **Argon2id** v1.3 (RFC 9106), salt aleatório de 256 bits por cofre | `argon2` 0.5 |
| Custo | Calibrado no computador ao criar/trocar a senha: 128 MiB, iterações até ≈0,75 s (2–12); máquinas lentas: 64 MiB. Nunca abaixo do mínimo OWASP (19 MiB). Gravado no cabeçalho. | — |
| Cifra | **XChaCha20-Poly1305** (cifra autenticada), nonce aleatório de 192 bits **novo a cada gravação** | `chacha20poly1305` 0.10 |
| Chave de recuperação → chave | **HKDF-SHA-256** (o material já tem 160 bits de entropia) | `hkdf`, `sha2` |
| Aleatoriedade | Gerador do sistema operativo (`BCryptGenRandom` / `getrandom(2)`) | `getrandom` |
| Comparações de chaves | Tempo constante | `subtle` |
| Apagar da memória | `Zeroizing` / `ZeroizeOnDrop` | `zeroize` |

Porquê XChaCha20 e não AES-256-GCM: o nonce de 192 bits pode ser sempre aleatório sem risco
prático de repetição (no GCM, 96 bits aleatórios limitam o número seguro de cifras com a mesma
chave), é rápido sem instruções AES e é a construção recomendada pela documentação do
[libsodium](https://doc.libsodium.org/secret-key_cryptography/aead/chacha20-poly1305/xchacha20-poly1305_construction).

A senha mestra é normalizada em **Unicode NFC** antes da derivação ("é" composto ou decomposto
dá a mesma chave). Não se cortam espaços nem se limita o tamanho (até 4096 caracteres, com erro
explícito acima disso). Mínimo: 12 caracteres, sem regras de composição.

Um teste compara a saída do Argon2id com a implementação de referência em C (argon2-cffi),
garantindo que é mesmo Argon2id v1.3 com os parâmetros declarados.

### Hierarquia de chaves

```
senha mestra ──Argon2id(salt, m, t, p)──► chave da senha ─┐
                                                           ├─ embrulham (XChaCha20-Poly1305) ─► chave do cofre
chave de recuperação ──HKDF-SHA-256(salt)──► chave rec. ───┘                                         │
                                                                                                     ▼
                                       registos + definições + lixo + históricos (um só bloco cifrado)
```

**Trocar a senha mestra gera uma chave do cofre nova** (e um salt novo). Quem tenha uma cópia
antiga do ficheiro e a senha antiga não consegue ler o cofre atual. Se o cofre tinha chave de
recuperação, é gerada também uma nova (a antiga continua a abrir as cópias antigas — é
inevitável e está explicado na interface). Ativar, substituir ou desativar a recuperação
também roda a chave do cofre e pede a senha mestra.

---

## 3. Formato do ficheiro (`.lissec`, versão 1)

Inteiros em little-endian. Especificação no código: `core/src/formato.rs`.

```
┌─ prefixo fixo (73 bytes) ───────────────────────────────────────────────┐
│ "LISSECUR" (8) │ versão u16 = 1 │ flags u16 = 0 │ id do cofre (16)       │
│ kdf u8 = 1 (Argon2id v1.3) │ memória KiB u32 │ iterações u32 │ vias u32  │
│ salt (32)                                                                │
├─ ranhuras de chave ──────────────────────────────────────────────────────┤
│ n u8 (1..=4) │ n × [ tipo u8 (1 senha, 2 recuperação) │ nonce (24) │      │
│                      chave do cofre cifrada (32 + 16 de etiqueta) ]      │
├─ dados ──────────────────────────────────────────────────────────────────┤
│ nonce (24) │ tamanho u64 │ texto cifrado + etiqueta Poly1305            │
└──────────────────────────────────────────────────────────────────────────┘
```

- **AAD de cada ranhura** = prefixo fixo + tipo. Mexer nos parâmetros, no salt ou no id invalida-a.
- **AAD dos dados** = tudo o que vem antes do texto cifrado.
- **Texto em claro** = `u32 tamanho ‖ JSON ‖ zeros`, preenchido até um múltiplo de 4 KiB
  (o tamanho do ficheiro só revela a ordem de grandeza do cofre).
- **Leitura estrita**: magia, versão, flags, tipos e tamanhos verificados; dados a mais no fim
  são erro; parâmetros de Argon2 fora de [19 MiB, 4 GiB] × [1, 64] × [1, 16] são recusados
  (protege contra ficheiros feitos para esgotar a memória); máximo 256 MiB por ficheiro.
- **Versões**: `versão` do formato no cabeçalho e `esquema` dentro do JSON. Um formato mais
  recente é recusado com mensagem clara. Migrações de esquema correm ao abrir e, antes de
  regravar, guarda-se uma cópia do ficheiro original (`.antes-da-migracao-…`).

O que o cabeçalho deixa ver: que é um cofre LisSecurity, a versão, os parâmetros do Argon2id,
se tem chave de recuperação, um id aleatório e o tamanho aproximado. Mais nada.

---

## 4. Persistência à prova de falhas

`core/src/armazenamento.rs`

1. Cifra-se o estado completo com nonce novo.
2. Grava-se para `cofre.lissec.tmp-<aleatório>` na mesma pasta, com `fsync`.
3. **Relê-se e decifra-se** o temporário com a chave em memória (tem de ser o mesmo cofre e abrir).
4. A versão em uso é copiada (também atomicamente) para `cofre.lissec.anterior`.
5. Renomeia-se o temporário por cima do principal (operação atómica no mesmo volume) e
   sincroniza-se a pasta.

Qualquer falha antes do passo 5 deixa o cofre anterior intacto; temporários esquecidos por um
encerramento inesperado são apagados no arranque (só têm bytes cifrados). Se ao abrir o
principal estiver danificado mas a senha abrir o `.anterior`, este é reposto e o danificado é
guardado à parte (`.danificado-…`).

Cada alteração na interface é **transacional**: aplica-se a uma cópia dos dados, grava-se e
verifica-se; se a gravação falhar, os dados em memória voltam ao que estavam.

Um trinco exclusivo do sistema (`cofre.lissec.lock`) impede duas instâncias de gravar ao mesmo
tempo (e o plugin de instância única traz a janela existente para a frente). Em Unix os
ficheiros ficam com permissões 600 e a pasta com 700; no Windows a pasta `%APPDATA%` já só é
acessível à conta do utilizador.

---

## 5. Sessão, memória e área de transferência

`src-tauri/src/estado.rs`, `sistema.rs`, `area_transferencia.rs`

- **Bloquear** = largar a sessão (a chave do cofre e os dados decifrados são apagados pelos
  `Drop`), aumentar a "geração" e avisar a interface. A interface **esconde primeiro**
  (síncrono, o ecrã do cofre é desmontado) e só depois pede à camada nativa para bloquear.
- **Respostas atrasadas**: cada pedido da interface guarda a "época" em que começou; se o cofre
  bloquear entretanto, a resposta é descartada antes de chegar ao ecrã. Na camada nativa, uma
  operação longa (desbloquear, trocar senha) compara a geração antes de instalar o resultado.
  Comandos que cheguem com o cofre bloqueado falham com `bloqueado`.
- **Inatividade**: contada na camada nativa (a interface só avisa que há teclado/rato, no
  máximo a cada 15 s). Um travamento do JavaScript não impede o bloqueio.
- **Suspensão**: `WM_POWERBROADCAST/PBT_APMSUSPEND` no Windows; em qualquer sistema, um salto de
  mais de 20 s no relógio também conta.
- **Sessão do Windows**: `WTSRegisterSessionNotification` → bloqueia em Win+L, troca de
  utilizador, desligar sessão remota e terminar sessão.
- **Minimizar**: com a política ativa (padrão), a interface esconde tudo, espera dois frames e
  só então minimiza — a miniatura da barra de tarefas não fica com o conteúdo. Minimizar por
  outros meios (Win+D, barra de tarefas) é apanhado pelo evento da janela.
- **Fechar**: bloqueia sempre; por padrão sai. Opção "minimizar ao fechar" mantém a app aberta
  mas bloqueada.
- **Reautenticação** (a senha mestra é desembrulhada de novo, não comparada): trocar a senha
  mestra, ativar/substituir/desativar a recuperação, reforçar a proteção, restaurar uma cópia
  sobre um cofre existente — e, se a opção estiver ligada, revelar ou copiar números de cartões,
  IBAN, contas, identificadores de acesso e chaves Pix (a confirmação fica válida 5 minutos na
  sessão nativa e desaparece ao bloquear).
- **Área de transferência**: o valor é posto pela camada nativa (o segredo não passa pela
  interface), marcado no Windows com `ExcludeClipboardContentFromMonitorProcessing` (fora do
  histórico Win+V, da nuvem e dos gestores de área de transferência que respeitam a convenção).
  Limpa-se ao fim de N segundos (configurável, 30 s por padrão) **só se ainda lá estiver o mesmo
  valor** — compara-se com SHA-256(chave aleatória ‖ valor), sem guardar o segredo. Limpa-se
  também ao sair. **Ao bloquear não se limpa por padrão** (v0.2): com "bloquear ao minimizar",
  copiar uma senha e minimizar a janela para a colar no navegador apagava o que se acabara de
  copiar. O prazo continua a contar; há uma opção para limpar também ao bloquear. Se o Windows
  recusar as marcas de exclusão do histórico, a cópia volta a ser tentada só com o texto. A confirmação no ecrã é genérica ("Copiado").

### O que a interface recebe

| Comando | Devolve |
| --- | --- |
| `listar`, `visao_geral`, pesquisa | Resumos: título, subtítulo (utilizador/instituição), últimos 4 dígitos, datas. Nunca senhas, números completos nem notas. |
| `obter_item` | Vista **mascarada**: cada segredo chega como `{ definido, fim? }`. Lista de permissões explícita (`core/src/vista.rs`). |
| `revelar_campo` | Um campo, a pedido. Volta a esconder-se ao fim de 30 s, ao mudar de registo ou ao bloquear. |
| `copiar_campo` | Nada — copia na camada nativa. |
| `obter_item_edicao` | O registo completo, **só** quando se abre o formulário de edição (o formulário precisa dos valores). |

A pesquisa nunca procura em senhas, números, notas ou campos ocultos.

---

## 6. WebView endurecido

- **CSP** estrita: `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src ipc: http://ipc.localhost; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'`.
  Fontes e ícones vão no pacote (sem Google Fonts, sem CDNs).
- **Navegação bloqueada**: `on_navigation` só aceita o conteúdo da própria app; `on_new_window`
  recusa janelas novas. Endereços de registos abrem-se no navegador do sistema pela camada
  nativa, **só http/https** (sem `javascript:`, `file:`, `ms-settings:`…).
- **Permissões mínimas** (`src-tauri/capabilities/principal.json`): ouvir eventos da app e
  arrastar/maximizar pela barra de título. Sem acesso a ficheiros, shell ou URLs a partir do
  JavaScript. Os 44 comandos são todos específicos (nada de "ler ficheiro" ou "executar").
- `withGlobalTauri: false`, `freezePrototype: true`.
- Atalhos do navegador desligados (F5, Ctrl+R, Ctrl+P, Ctrl+U, F12…); menu de contexto só nos
  campos de texto; arrastar ficheiros para a janela não navega.
- Conteúdo dos registos é sempre texto: o React escapa tudo, as notas são texto simples, nada é
  interpretado como HTML. Testado com `<script>`, `<img onerror>`, nulos e RTL.
- Ferramentas de programador desligadas nas compilações de produção.

---

## 7. Cópias de segurança e recuperação

- **Automáticas (v0.2)**: depois de cada alteração gravada (com 15 s de folga, para juntar
  alterações seguidas), a camada nativa cifra o estado atual e grava
  `<pasta>/LisSecurity/LisSecurity-auto-AAAA-MM-DD_HHMMSS.lissec` (atómico, relido e decifrado);
  mantêm-se as N mais recentes e as manuais nunca são apagadas. A pasta pensada é a do **Google
  Drive para computador** (detetada sozinha), que sincroniza o ficheiro com a nuvem. Escolha de
  desenho: a app **não** fala com a API do Google nem guarda tokens OAuth — quem envia é o
  programa do Google Drive. Com a conta Google comprometida, um atacante fica com o ficheiro
  cifrado, não com os dados: a defesa passa a ser a força da senha mestra (Argon2id) — daí a
  opção "reforçar a proteção".

- **Criar**: escolhe-se a pasta; o ficheiro (`LisSecurity-copia-AAAA-MM-DD_HHMM.lissec`, hora UTC)
  é o mesmo formato do cofre, gravado atomicamente, **relido e decifrado** antes de se dar por
  concluído. A data da última cópia fica no cofre e aparece na visão geral.
- **Testar**: abre a cópia com a senha da altura e conta os registos, sem tocar no cofre atual.
- **Restaurar**: valida a cópia (abre-a), pede confirmação e — se já houver cofre — a senha
  mestra atual; guarda o cofre atual ao lado (`.antes-do-restauro-…`, cifrado); substitui.
- **Recuperação**: chave aleatória de 160 bits + 16 de verificação, em Base32 de Crockford
  (9 grupos de 4, tolera O/0 e I/L/1). É mostrada uma vez. Quem a tiver abre o cofre.
  Depois de abrir com ela é obrigatório definir uma senha nova (e é gerada uma chave nova).
- **Não existe** "esqueci a senha" por e-mail: sem senha mestra nem chave de recuperação,
  o cofre não abre — por desenho.

---

## 7-A. Novidades da v0.2 com impacto na segurança

- **Códigos 2FA (TOTP, RFC 6238)**: a chave fica cifrada como qualquer segredo e só a camada
  nativa calcula o código; a interface recebe o código de 6 dígitos do momento (a chave não é
  revelável nem copiável fora do formulário de edição). Os pedidos do código não contam como
  atividade, para não impedirem o bloqueio automático. Limite explicado na interface: com a 2FA
  no mesmo cofre, quem abrir o cofre fica com os dois fatores. Testado com os vetores do RFC 6238
  e, no E2E, comparado com um cálculo independente.
- **Importação de CSV** (senhas e extratos): a camada nativa só lê ficheiros que a pessoa
  escolheu na janela de abrir ficheiro (caminhos registados na sessão), até 50 MB; o texto é
  apagado da memória (`Zeroizing`) depois de interpretado. Depois de importar senhas, a app
  oferece-se para apagar o CSV (só esse ficheiro, e só se for .csv/.txt escolhido para importar),
  com o aviso de que num SSD pode continuar recuperável.
- **Gastos**: movimentos e regras de categoria ficam dentro do bloco cifrado (esquema 2). Não há
  ligação a bancos — o Revolut não oferece acesso a contas pessoais a aplicações de terceiros;
  fazê-lo exigiria um agregador licenciado, internet e credenciais do banco guardadas.
- **Esquema 2 e migração**: um cofre v0.1 (esquema 1) é migrado ao abrir, com uma cópia do ficheiro
  original guardada antes (`.antes-da-migracao-…`). Uma versão antiga recusa abrir um cofre do
  esquema 2 (em vez de o abrir e perder campos ao gravar).
- **Reforçar a proteção**: volta a cifrar com um Argon2id mais pesado (até 256 MiB e ≈3 s), com
  chave do cofre e salt novos; pede a senha mestra.
- **Zoom da janela** e cor de destaque guardam-se nas preferências fora do cofre (não são dados).

## 8. Privacidade e funcionamento offline

Sem conta online, sem anúncios, sem rastreamento, sem analytics, sem sincronização, sem
consulta remota de senhas vazadas, sem relatórios de erro. Nenhum favicon é ido buscar: os
ícones dos registos são iniciais com uma cor local. A força das senhas é estimada localmente
(zxcvbn). **Atualizações automáticas não existem**: novas versões instalam-se à mão a partir
do repositório (os instaladores do CI são compilados a partir do código público).

---

## 9. Pendências para revisão de segurança

1. **Revisão independente** do núcleo (`core/`) e da camada de comandos (`src-tauri/src/comandos.rs`).
2. **Assinatura de código** do instalador Windows (sem certificado, o SmartScreen avisa).
3. **Bloquear ao minimizar por meios do sistema** (Win+D): a miniatura do DWM pode ter sido
   capturada antes do evento chegar. A proteção contra capturas reduz, mas não elimina.
4. **Memória do WebView**: valores revelados ou editados passam pelo heap do JavaScript, que não
   se consegue apagar de forma determinística.
5. **`obter_item_edicao`** envia o registo completo para o formulário; uma versão futura pode
   carregar os segredos campo a campo também na edição.
6. **Windows Hello / biometria**: não implementado (teria de usar o TPM via Windows Hello para
   proteger uma chave, e não apenas um "sim/não").
7. **Teste com ficheiros maliciosos em larga escala** (fuzzing do leitor do formato).
8. **Cópias na nuvem**: dependem do Google Drive para computador; uma alternativa futura é a API
   do Drive com a pasta oculta `appDataFolder` (exige credenciais OAuth próprias e tokens
   guardados no cofre — merece avaliação à parte).
9. **Política de bloqueio por tentativas**: o atraso só existe dentro da app; contra quem copia
   o ficheiro, a defesa é o custo do Argon2id e a força da senha.
