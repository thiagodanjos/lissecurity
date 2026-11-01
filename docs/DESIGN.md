# LisSecurity — sistema visual

O LisSecurity é da família LisFilms. Não houve aproximações a partir de fotografias: os valores
abaixo vêm do código real da LisFilms (`web/src/index.css`,
`web/src/components/ui.tsx`, `web/src/layouts/AppShell.tsx`,
`web/src/components/titlebar-desktop.tsx`, `web/src/components/command-palette.tsx`, no
repositório do LisFilms).

## Tokens (iguais à LisFilms)

| Token | Valor | Uso |
| --- | --- | --- |
| `--color-sidebar` | `#08090c` | barra de título, lateral, fundo da janela |
| `--color-bg` | `#0b0d10` | o grande painel arredondado e os ecrãs de entrada |
| `--color-raised` | `#121519` | campos, pesquisas, controlos segmentados |
| `--color-card` / `card-hover` | `#161a20` / `#1d222a` | cartões, modais, paleta |
| `--color-border` / `border-strong` | `#252b34` / `#323a45` | bordas finas |
| `--color-text` / `muted` / `faint` | `#f4f6f8` / `#9aa3ad` / `#7b8591` | hierarquia de texto (contraste ≥ 4,5:1 nos auxiliares, como a LisFilms corrigiu) |
| `--color-accent` / `hover` / `soft` | `#1ed760` / `#3be477` / `#122b1b` | verde Lis; fundo verde-escuro dos itens ativos e dos ícones |
| `--color-danger` | `#f23f42` | erros e ações destrutivas (o botão fechar usa o vermelho do Windows `#e81123`) |
| `--color-warn` / `warn-soft` | `#f5a524` / `#2b2110` | **só LisSecurity**: "atenção" (senhas fracas, cartões a expirar) |
| `--shadow-glow` | `0 0 24px rgb(30 215 96 / .35)` | brilho verde localizado (botões principais, ponto de estado) |
| Raios | cartões 1rem–1.25rem, controlos .75rem, botões e pesquisas `rounded-full` | |
| Fonte | Inter (variável), empacotada com `@fontsource-variable/inter` | sem Google Fonts |
| Movimento | 140 ms (pressão) · 200 ms (estado) · 260 ms (painéis), curva `cubic-bezier(.22,1,.36,1)` | só `transform` e `opacity` |

As cores sugeridas no pedido original (#090D0F, #19D66B…) eram estimativas a partir de imagens;
como o código estava disponível, usaram-se os valores reais.

## Marca

- **Símbolo**: o da LisFilms é um ponto verde + barra branca + barra verde. No LisSecurity o
  **ponto passa a fechadura** (círculo + haste) e as duas barras ficam — reconhece-se a família e
  lê-se "cofre" mesmo a 16 px. Fonte: `design/icone.svg`; ícones da app gerados com `tauri icon`.
- **Palavra**: "Lis" branco + "Security" verde, `font-extrabold tracking-tight` (como "LisFilms").

## Estrutura da janela

- **Barra de título** (40 px, `h-10`): símbolo, menus Ficheiro/Editar/Ver/Ajuda, recolher a lateral,
  pesquisa central "Pesquisar páginas e ações…" com `Ctrl K`, estado do cofre (ponto verde com
  brilho / cinzento), botão Bloquear e controlos da janela de 46 px no mesmo fundo (fechar a
  vermelho no hover). Toda a área livre arrasta a janela; duplo clique maximiza.
- **Lateral** (240 px, `w-60`; só ícones abaixo de 1000 px ou recolhida): marca, seletor
  segmentado **Cofre / Financeiro** (o mesmo gesto do seletor LisFilms/LisGames, com o gradiente
  verde e animação partilhada), grupos com títulos de 10 px em maiúsculas, item ativo com fundo
  `accent-soft`, borda `accent/20` e ícone/texto verdes (indicador animado com `layoutId`),
  rodapé com identificação local, Definições e Bloquear.
- **Painel principal**: um grande painel `bg-bg` com `rounded-2xl` e borda `border/50`, afastado
  8 px das margens, com cabeçalho interno (pesquisa arredondada `h-11 rounded-full` e botões
  circulares) — o mesmo esquema do `AppShell` da LisFilms.

## Hierarquia (como a Home da LisFilms)

- `h1` 3xl extra-negrito com destaque em gradiente verde ("Bem-vindo, **Thiago**").
- Subtítulo 14 px cinzento.
- Fila de 4 cartões de resumo: ícone verde em `accent-soft` (`rounded-xl p-2.5`), número
  extra-negrito, descrição 11 px.
- Secções com o **marcador vertical verde** (`h-4 w-1 rounded-full bg-accent`).
- Faixa de destaque discreta e dispensável (primeira cópia de segurança), só quando faz falta.

## Paleta de comandos

Cópia do padrão da LisFilms: fundo `bg-black/60` com desfoque, painel `max-w-lg rounded-2xl
bg-card`, campo no topo, opções com ícone, opção ativa em `accent-soft` com `↵`. Navega com
↑ ↓ Enter e fecha com Esc. Com o cofre bloqueado não abre; ao bloquear, desaparece.

## Animações

Entrada do desbloqueio, transição para o cofre (o painel aparece com escala/opacidade), seletor de
área e indicador da lateral com mola, páginas com deslizamento curto, detalhe a entrar da direita,
modais com escala/opacidade, visto animado ao copiar, medidor de força, cartões com elevação no
hover, passos do primeiro uso. Ao bloquear, o conteúdo sai **no mesmo frame** (sem animação de
saída) e só depois entra o ecrã de bloqueio. "Reduzir animações" (ou a preferência do sistema)
desliga tudo.

## Critério de fidelidade (verificado nas capturas em `docs/capturas/`)

| Aspeto | LisFilms | LisSecurity |
| --- | --- | --- |
| Silhueta | barra fina + lateral + painel arredondado | igual |
| Barra superior | 40 px, menus textuais, pesquisa central com Ctrl K | igual (estado do cofre no lugar do utilizador) |
| Lateral | 240 px, seletor LisFilms/LisGames | 240 px, seletor Cofre/Financeiro |
| Painel vs cartões | `#0b0d10` vs `#161a20` | igual |
| Títulos | 3xl extra-negrito, destaque em gradiente | igual |
| Buscas e botões | `rounded-full`, verde com texto preto | igual |
| Uso do verde | pontual: ativo, ícones, ações principais | igual |
| Secções | marcador verde + 15 px negrito | igual |
| Paleta | painel central grafite | igual |
