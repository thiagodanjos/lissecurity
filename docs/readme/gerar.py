#!/usr/bin/env python3
"""
Gera as imagens animadas do README (docs/readme/*.svg).

    pip install fonttools brotli pillow
    python docs/readme/gerar.py

Mesma identidade da app (src/index.css): fundo #0b0d10, cartões #161a20, verde #1ed760, Inter.
Os SVG são mostrados pelo GitHub como <img>: animações CSS/SMIL sim, JavaScript e recursos
externos não — por isso a fonte (só com as letras usadas) e as capturas vão embutidas.
Sem animação (prefers-reduced-motion ou visualizadores estáticos) fica sempre o estado final.
"""

from __future__ import annotations

import base64
import io
import json
import math
import random
import re
import sys
from html import unescape
from pathlib import Path
from xml.sax.saxutils import escape

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent.parent
REC = AQUI / "recursos"
ICONES = json.loads((REC / "icones.json").read_text(encoding="utf-8"))["linhas"]

C = {
    "bg": "#0b0d10",
    "lateral": "#08090c",
    "elevado": "#121519",
    "cartao": "#161a20",
    "cartao2": "#1d222a",
    "borda": "#252b34",
    "borda2": "#323a45",
    "texto": "#f4f6f8",
    "suave": "#9aa3ad",
    "tenue": "#7b8591",
    "verde": "#1ed760",
    "verde2": "#7cf3a8",
    "verde_suave": "#122b1b",
    "ouro": "#f5c518",
    "perigo": "#f23f42",
}
FAMILIA = "'LisInter','Inter','Segoe UI',system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif"


def esc(s: str) -> str:
    return escape(str(s), {'"': "&quot;"})


def n(v: float) -> str:
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s == "-0" else s


class Fonte:
    def __init__(self) -> None:
        self.bytes = (REC / "inter.woff2").read_bytes()
        self._inst: dict[int, tuple] = {}

    def _metricas(self, peso: int):
        if peso not in self._inst:
            from fontTools.ttLib import TTFont
            from fontTools.varLib import instancer

            f = TTFont(io.BytesIO(self.bytes), recalcTimestamp=False)
            st = instancer.instantiateVariableFont(f, {"wght": peso})
            self._inst[peso] = (st.getBestCmap(), st["hmtx"].metrics, st["head"].unitsPerEm)
        return self._inst[peso]

    def largura(self, texto: str, tamanho: float, peso: int = 400, espacamento: float = 0.0) -> float:
        cmap, hmtx, upm = self._metricas(peso)
        total = 0.0
        for ch in texto:
            g = cmap.get(ord(ch)) or cmap.get(ord("?"))
            total += hmtx[g][0] * tamanho / upm
        return total + espacamento * len(texto)

    def face(self, letras: str) -> str:
        from fontTools import subset
        from fontTools.ttLib import TTFont

        opcoes = subset.Options()
        opcoes.flavor = "woff2"
        opcoes.layout_features = ["kern", "liga", "calt", "tnum"]
        opcoes.name_IDs = [0, 1, 2]
        f = TTFont(io.BytesIO(self.bytes), recalcTimestamp=False)
        sub = subset.Subsetter(opcoes)
        sub.populate(text="".join(sorted(set(letras + " ?"))))
        sub.subset(f)
        buf = io.BytesIO()
        f.flavor = "woff2"
        f.save(buf)
        b64 = base64.b64encode(buf.getvalue()).decode()
        return (
            "@font-face{font-family:'LisInter';font-style:normal;font-weight:100 900;"
            f"src:url(data:font/woff2;base64,{b64}) format('woff2');}}"
        )


FONTE = Fonte()

BASE_CSS = (
    f"text{{font-family:{FAMILIA};font-kerning:normal;}}"
    ".fb{transform-box:fill-box;transform-origin:center;}"
    "@keyframes surgir{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:none;}}"
    "@keyframes aparecer{from{opacity:0;}to{opacity:1;}}"
    "@keyframes pulso{0%,100%{opacity:1;}50%{opacity:.35;}}"
    "@keyframes respirar{0%,100%{opacity:.55;transform:scale(1);}50%{opacity:1;transform:scale(1.08);}}"
    "@keyframes flutuar{0%,100%{transform:translateY(0);}50%{transform:translateY(-4px);}}"
    "@keyframes deriva1{0%,100%{transform:translate(0,0);}50%{transform:translate(34px,-14px);}}"
    "@keyframes deriva2{0%,100%{transform:translate(0,0);}50%{transform:translate(-30px,16px);}}"
    "@keyframes chuva{from{transform:translateY(0);}to{transform:translateY(210px);}}"
    "@media (prefers-reduced-motion:reduce){*{animation:none!important;}}"
)

DEFS_COMUNS = (
    '<filter id="desfoque" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="6"/></filter>'
    '<pattern id="pontos" width="22" height="22" patternUnits="userSpaceOnUse">'
    '<circle cx="1" cy="1" r=".9" fill="#ffffff" fill-opacity=".05"/></pattern>'
    '<radialGradient id="fundoIcone" cx="38%" cy="46%" r="75%"><stop offset="0" stop-color="#11201a"/>'
    '<stop offset=".55" stop-color="#0c1012"/><stop offset="1" stop-color="#090b0e"/></radialGradient>'
)


def documento(largura: int, altura: int, titulo: str, descricao: str, css: str, corpo: str) -> str:
    letras = "".join(unescape(t) for t in re.findall(r">([^<>]+)<", corpo)) + titulo + descricao
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{largura}" height="{altura}" '
        f'viewBox="0 0 {largura} {altura}" role="img" aria-labelledby="titulo descricao">\n'
        f'<title id="titulo">{esc(titulo)}</title>\n<desc id="descricao">{esc(descricao)}</desc>\n'
        f"<style>{FONTE.face(letras)}{BASE_CSS}{css}</style>\n{corpo}\n</svg>\n"
    )


def texto(x, y, conteudo, tamanho, peso=400, cor=C["texto"], ancora="start", espacamento=None, ajustar=False, extra=""):
    attrs = [f'x="{n(x)}"', f'y="{n(y)}"', f'font-size="{n(tamanho)}"', f'font-weight="{peso}"', f'fill="{cor}"']
    if ancora != "start":
        attrs.append(f'text-anchor="{ancora}"')
    if espacamento is not None:
        attrs.append(f'letter-spacing="{n(espacamento)}"')
    if ajustar:
        simples = unescape(re.sub(r"<[^>]+>", "", conteudo))
        attrs.append(f'textLength="{n(FONTE.largura(simples, tamanho, peso))}" lengthAdjust="spacingAndGlyphs"')
    return f'<text {" ".join(attrs)}{extra}>{conteudo}</text>'


def icone(nome, x, y, tamanho=18, cor=C["verde"], traco=2.0, extra=""):
    return (
        f'<g transform="translate({n(x)} {n(y)}) scale({tamanho / 24:.4f})" fill="none" stroke="{cor}" '
        f'stroke-width="{n(traco)}" stroke-linecap="round" stroke-linejoin="round"{extra}>{ICONES[nome]}</g>'
    )


def radial(id_, cor, opacidade):
    return (
        f'<radialGradient id="{id_}"><stop offset="0" stop-color="{cor}" stop-opacity="{opacidade}"/>'
        f'<stop offset="1" stop-color="{cor}" stop-opacity="0"/></radialGradient>'
    )


def simbolo(x, y, lado, brilho=True):
    """O ícone real do LisSecurity (design/icone.svg) com `lado` px."""
    s = lado / 512
    halo = (
        f'<g fill="{C["verde"]}" opacity=".55" filter="url(#desfoque)"><circle cx="170" cy="230" r="34"/>'
        '<path d="M158 250 L149 326 Q148 336 158 336 L182 336 Q192 336 191 326 L182 250 Z"/></g>'
        if brilho
        else ""
    )
    return (
        f'<g transform="translate({n(x)} {n(y)}) scale({s:.5f})">'
        '<rect width="512" height="512" rx="112" fill="url(#fundoIcone)"/>'
        '<rect x="1.5" y="1.5" width="509" height="509" rx="110.5" fill="none" stroke="#ffffff" stroke-opacity=".09" stroke-width="3"/>'
        f"{halo}"
        f'<g fill="{C["verde"]}"><circle cx="170" cy="230" r="34"/><path d="M158 250 L149 326 Q148 336 158 336 L182 336 Q192 336 191 326 L182 250 Z"/></g>'
        f'<rect x="246" y="160" width="32" height="192" rx="16" fill="{C["texto"]}"/>'
        f'<rect x="310" y="160" width="32" height="192" rx="16" fill="{C["verde"]}"/></g>'
    )


def chip(x, y, rotulo, tamanho=11, peso=700, cor=C["texto"], fundo=C["cartao"], borda=C["borda2"], h=26):
    w = FONTE.largura(rotulo, tamanho, peso) + 22
    return (
        f'<rect x="{n(x)}" y="{n(y)}" width="{n(w)}" height="{h}" rx="{h / 2}" fill="{fundo}" stroke="{borda}"/>'
        + texto(x + w / 2, y + h / 2 + tamanho * 0.36, esc(rotulo), tamanho, peso, cor, "middle")
    ), w


def chuva_cifrada(x0, x1, y0, y1, colunas, semente, opacidade=(0.1, 0.24)):
    r = random.Random(semente)
    passo = (x1 - x0) / max(1, colunas - 1)
    out = []
    for c in range(colunas):
        x = x0 + c * passo
        dur = r.uniform(7, 13)
        chars = [r.choice("0123456789abcdef") for _ in range(14)]
        tsp = "".join(f'<tspan x="{n(x)}" dy="15">{ch}</tspan>' for ch in chars + chars)
        out.append(
            f'<g style="animation:chuva {dur:.1f}s linear infinite -{r.uniform(0, dur):.1f}s">'
            f'<text x="{n(x)}" y="{y0 - 220}" font-size="11" font-weight="600" fill="{C["verde"]}" '
            f'fill-opacity="{r.uniform(*opacidade):.2f}" text-anchor="middle">{tsp}</text></g>'
        )
    return "".join(out)


# --------------------------------------------------------------------------------------------
# 1. Banner
# --------------------------------------------------------------------------------------------
def banner() -> str:
    W, H, TB = 900, 380, 40
    css = []
    defs = [DEFS_COMUNS, f'<clipPath id="quadro"><rect width="{W}" height="{H}" rx="20"/></clipPath>']
    defs.append(radial("aurora1", C["verde"], 0.26) + radial("aurora2", C["verde2"], 0.10))
    defs.append(
        f'<linearGradient id="marcaVerde" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="{C["verde"]}"/>'
        f'<stop offset=".55" stop-color="{C["verde2"]}"/><stop offset="1" stop-color="{C["verde"]}"/></linearGradient>'
        '<linearGradient id="desvanecer" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/>'
        '<stop offset=".25" stop-color="#fff"/><stop offset=".8" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>'
        f'<mask id="mascaraChuva"><rect x="500" y="{TB}" width="400" height="{H - TB}" fill="url(#desvanecer)"/></mask>'
    )
    p = [f'<rect width="{W}" height="{H}" fill="{C["bg"]}"/>', f'<rect y="{TB}" width="{W}" height="{H - TB}" fill="url(#pontos)"/>']
    p.append('<ellipse cx="200" cy="200" rx="320" ry="190" fill="url(#aurora1)" style="animation:deriva1 12s ease-in-out infinite"/>')
    p.append('<ellipse cx="700" cy="220" rx="260" ry="170" fill="url(#aurora2)" style="animation:deriva2 14s ease-in-out infinite"/>')
    p.append(f'<g mask="url(#mascaraChuva)">{chuva_cifrada(520, 880, TB, H, 18, 3)}</g>')

    # coluna da esquerda
    kick = "COFRE PESSOAL PARA WINDOWS"
    wk = FONTE.largura(kick, 9.5, 800, 1.8) + 34
    p.append(
        '<g style="animation:surgir .8s cubic-bezier(.22,1,.36,1) .1s both">'
        f'<rect x="48" y="84" width="{n(wk)}" height="24" rx="12" fill="{C["verde_suave"]}" stroke="{C["verde"]}" stroke-opacity=".35"/>'
        f'<circle cx="62" cy="96" r="3.2" fill="{C["verde"]}" style="animation:pulso 1.8s ease-in-out infinite"/>'
        + texto(72, 99.4, kick, 9.5, 800, C["verde"], espacamento=1.8)
        + "</g>"
    )
    p.append(
        '<g style="animation:surgir .9s cubic-bezier(.22,1,.36,1) .2s both">'
        + texto(46, 168, f'Lis<tspan fill="url(#marcaVerde)">Security</tspan>', 60, 900, C["texto"], espacamento=-1.6)
        + "</g>"
    )
    p.append(
        '<g style="animation:surgir .9s cubic-bezier(.22,1,.36,1) .35s both">'
        + texto(48, 206, "As tuas senhas, contas bancárias e cartões,", 17, 500, "#d2d9e0")
        + texto(48, 230, "cifrados no teu PC. Sem conta e sem internet.", 17, 500, "#d2d9e0")
        + "</g>"
    )
    x = 48
    chips = []
    for rot in ("Argon2id", "XChaCha20-Poly1305", "Rust + Tauri"):
        s, w = chip(x, 262, rot)
        chips.append(s)
        x += w + 8
    p.append(f'<g style="animation:surgir .9s cubic-bezier(.22,1,.36,1) .5s both">{"".join(chips)}</g>')
    p.append(
        '<g style="animation:aparecer 1s ease-out .7s both">'
        + icone("wifi-off", 48, 318, 14, C["tenue"], 2.2)
        + texto(68, 329.5, "Funciona sem internet", 11.5, 500, C["tenue"])
        + icone("hard-drive", 212, 318, 14, C["tenue"], 2.2)
        + texto(232, 329.5, "Tudo fica no teu computador", 11.5, 500, C["tenue"])
        + "</g>"
    )

    # ecrã de desbloqueio animado (8 s): escreve a senha, desbloqueia, volta a trancar
    cx, cy = 690, 210
    ciclo = 8
    css.append(
        "@keyframes ponto{0%,4%{opacity:0;transform:scale(.4);}7%,84%{opacity:1;transform:none;}88%,100%{opacity:0;}}"
        "@keyframes premir{0%,30%{transform:none;}32%{transform:scale(.96);}35%,100%{transform:none;}}"
        "@keyframes brilhoBotao{0%,30%{opacity:0;}34%{opacity:.9;}46%,100%{opacity:0;}}"
        "@keyframes estadoA{0%,33%{opacity:1;}36%,86%{opacity:0;}90%,100%{opacity:1;}}"
        "@keyframes estadoB{0%,34%{opacity:0;transform:translateY(4px);}38%,84%{opacity:1;transform:none;}88%,100%{opacity:0;}}"
        "@keyframes anel{0%,33%{stroke-dashoffset:315;opacity:1;}46%{stroke-dashoffset:0;opacity:1;}84%{stroke-dashoffset:0;opacity:1;}90%,100%{stroke-dashoffset:0;opacity:0;}}"
        ".estB{opacity:0;}"
    )
    painel = []
    painel.append(f'<rect x="{cx - 150}" y="{cy - 128}" width="300" height="262" rx="18" fill="{C["elevado"]}" fill-opacity=".92" stroke="{C["borda"]}"/>')
    painel.append(f'<circle cx="{cx}" cy="{cy - 66}" r="50" fill="none" stroke="#fff" stroke-opacity=".06" stroke-width="2"/>')
    painel.append(
        f'<circle cx="{cx}" cy="{cy - 66}" r="50" fill="none" stroke="{C["verde"]}" stroke-width="2.4" stroke-linecap="round" '
        f'stroke-dasharray="315" transform="rotate(-90 {cx} {cy - 66})" style="animation:anel {ciclo}s cubic-bezier(.65,0,.35,1) infinite"/>'
    )
    painel.append(f'<g style="animation:flutuar 4s ease-in-out infinite">{simbolo(cx - 30, cy - 96, 60)}</g>')
    painel.append(texto(cx, cy + 4, f'Lis<tspan fill="{C["verde"]}">Security</tspan>', 17, 800, C["texto"], "middle"))
    painel.append(
        f'<g style="animation:estadoA {ciclo}s infinite">'
        + texto(cx, cy + 24, "O teu cofre está bloqueado.", 11, 500, C["tenue"], "middle")
        + "</g>"
        f'<g class="estB" style="animation:estadoB {ciclo}s infinite">'
        + icone("circle-check", cx - 46, cy + 13, 13, C["verde"], 2.4)
        + texto(cx - 28, cy + 24, "Cofre aberto", 11, 700, C["verde"])
        + "</g>"
    )
    # campo da senha
    fy = cy + 40
    painel.append(f'<rect x="{cx - 120}" y="{fy}" width="240" height="34" rx="9" fill="{C["bg"]}" stroke="{C["verde"]}" stroke-opacity=".45"/>')
    for i in range(12):
        painel.append(
            f'<circle class="fb" cx="{cx - 104 + i * 13}" cy="{fy + 17}" r="3.4" fill="{C["texto"]}" '
            f'style="animation:ponto {ciclo}s infinite;animation-delay:{(i * 0.13):.2f}s"/>'
        )
    painel.append(icone("eye-off", cx + 94, fy + 10, 14, C["tenue"], 2.2))
    # botão
    by = fy + 46
    painel.append(
        f'<g class="fb" style="animation:premir {ciclo}s infinite">'
        f'<rect x="{cx - 120}" y="{by}" width="240" height="34" rx="17" fill="{C["verde"]}"/>'
        f'<rect x="{cx - 120}" y="{by}" width="240" height="34" rx="17" fill="#ffffff" opacity="0" style="animation:brilhoBotao {ciclo}s infinite"/>'
        + texto(cx, by + 21.5, "Desbloquear", 12.5, 800, "#05140b", "middle")
        + "</g>"
    )
    p.append(f'<g style="animation:surgir 1s cubic-bezier(.22,1,.36,1) .3s both">{"".join(painel)}</g>')

    # barra de título da app
    b = [f'<rect width="{W}" height="{TB}" fill="{C["lateral"]}"/>', f'<line x1="0" y1="{TB}" x2="{W}" y2="{TB}" stroke="{C["borda"]}"/>']
    b.append(simbolo(14, 9, 22, brilho=False))
    xm = 48
    for m in ("Ficheiro", "Editar", "Ver", "Ajuda"):
        b.append(texto(xm, 24.5, m, 11.5, 500, C["suave"]))
        xm += FONTE.largura(m, 11.5, 500) + 16
    b.append(icone("panel-left", xm + 2, 13, 14, C["tenue"], 2))
    bx, bw = W / 2 - 150, 300
    b.append(f'<rect x="{bx}" y="8" width="{bw}" height="24" rx="8" fill="{C["elevado"]}" stroke="{C["borda"]}"/>')
    b.append(icone("search", bx + 10, 14, 12, C["tenue"], 2.4))
    b.append(texto(bx + 30, 24, "Pesquisar páginas e ações…", 11, 500, C["tenue"]))
    b.append(f'<rect x="{bx + bw - 48}" y="12" width="40" height="16" rx="4" fill="{C["cartao"]}" stroke="{C["borda2"]}"/>')
    b.append(texto(bx + bw - 28, 23.5, "Ctrl K", 9, 700, C["suave"], "middle"))
    b.append(f'<circle cx="{W - 250}" cy="20" r="3.4" fill="{C["verde"]}" style="animation:pulso 2s ease-in-out infinite"/>')
    b.append(texto(W - 241, 24, "Cofre aberto", 11, 600, C["suave"]))
    b.append(f'<rect x="{W - 166}" y="9" width="76" height="22" rx="6" fill="{C["cartao"]}" stroke="{C["borda2"]}"/>')
    b.append(icone("lock", W - 158, 14, 12, C["texto"], 2.2))
    b.append(texto(W - 141, 24, "Bloquear", 10.5, 600, C["texto"]))
    for i, ic in enumerate(("minus", "square", "x")):
        b.append(icone(ic, W - 76 + i * 24, 14, 12 if ic != "square" else 11, C["suave"], 2))

    corpo = (
        f"<defs>{''.join(defs)}</defs>"
        f'<g clip-path="url(#quadro)">{"".join(p)}{"".join(b)}</g>'
        f'<rect x=".5" y=".5" width="{W - 1}" height="{H - 1}" rx="19.5" fill="none" stroke="{C["borda"]}"/>'
    )
    return documento(
        W,
        H,
        "LisSecurity",
        "LisSecurity: cofre pessoal para Windows. As tuas senhas, contas bancárias e cartões, cifrados no teu PC, "
        "sem conta e sem internet. Animação de um ecrã de desbloqueio.",
        "".join(css),
        corpo,
    )


# --------------------------------------------------------------------------------------------
# 2. Funções
# --------------------------------------------------------------------------------------------
FUNCOES = [
    ("key-round", "Senhas", "histórico, favoritos e lixo"),
    ("timer", "Códigos 2FA", "ao vivo, com contagem decrescente"),
    ("landmark", "Dados bancários", "IBAN, Pix, agência e conta"),
    ("credit-card", "Cartões", "só os últimos 4 dígitos à vista"),
    ("notebook-pen", "Notas seguras", "e códigos de recuperação"),
    ("wand-sparkles", "Gerador", "senhas e frases-senha"),
    ("shield-alert", "Relatório de segurança", "senhas fracas e reutilizadas"),
    ("cloud-upload", "Cópias no Google Drive", "automáticas e cifradas"),
    ("chart-pie", "Gastos", "a partir de extratos (Revolut, CSV)"),
    ("file-down", "Importar senhas", "Chrome, Edge, Firefox, Bitwarden…"),
    ("lock-keyhole", "Bloqueio automático", "inatividade, minimizar, Win+L"),
    ("clipboard-check", "Área de transferência", "limpa-se sozinha"),
]


def funcoes() -> str:
    W = 900
    colunas, tw, th, gap = 4, 204, 84, 12
    x0 = (W - (colunas * tw + (colunas - 1) * gap)) / 2
    y0 = 74
    linhas = math.ceil(len(FUNCOES) / colunas)
    H = y0 + linhas * (th + gap) + 14
    ciclo = 9.0
    css = ["@keyframes realce{0%,100%{opacity:0;}4%{opacity:1;}14%{opacity:0;}}"]
    p = [
        f'<rect x=".5" y=".5" width="{W - 1}" height="{H - 1}" rx="20" fill="{C["bg"]}" stroke="{C["borda"]}"/>',
        f'<rect x=".5" y=".5" width="{W - 1}" height="{H - 1}" rx="20" fill="url(#pontos)"/>',
        f'<rect x="{x0}" y="28" width="4" height="22" rx="2" fill="{C["verde"]}"/>',
        texto(x0 + 14, 45, "Tudo num só cofre", 16, 800, C["texto"]),
        texto(W - x0, 45, "cada registo cifrado, mesmo os gastos e as notas", 10.5, 500, C["tenue"], "end"),
    ]
    for i, (ic, tit, sub) in enumerate(FUNCOES):
        c, l = i % colunas, i // colunas
        x = x0 + c * (tw + gap)
        y = y0 + l * (th + gap)
        p.append(
            f'<g style="animation:surgir .6s cubic-bezier(.22,1,.36,1) {0.1 + i * 0.05:.2f}s both">'
            f'<rect x="{n(x)}" y="{y}" width="{tw}" height="{th}" rx="14" fill="{C["cartao"]}" stroke="{C["borda"]}"/>'
            f'<rect x="{n(x)}" y="{y}" width="{tw}" height="{th}" rx="14" fill="{C["verde"]}" fill-opacity=".05" stroke="{C["verde"]}" '
            f'stroke-opacity=".75" opacity="0" style="animation:realce {ciclo}s ease-in-out {1.2 + i * ciclo / len(FUNCOES):.2f}s infinite"/>'
            f'<rect x="{n(x + 14)}" y="{y + 14}" width="32" height="32" rx="10" fill="{C["verde_suave"]}"/>'
            + icone(ic, x + 21, y + 21, 18, C["verde"])
            + texto(x + 14, y + 64, esc(tit), 13, 750, C["texto"])
            + texto(x + 14, y + 78, esc(sub), 10, 500, C["tenue"])
            + "</g>"
        )
    corpo = f"<defs>{DEFS_COMUNS}</defs>" + "".join(p)
    return documento(
        W, H, "O que o LisSecurity faz", "; ".join(f"{t}: {s}" for _, t, s in FUNCOES) + ".", "".join(css), corpo
    )


# --------------------------------------------------------------------------------------------
# 3. Como os dados ficam protegidos
# --------------------------------------------------------------------------------------------
def cifra() -> str:
    W, H = 900, 350
    css = []
    defs = [DEFS_COMUNS]
    p = [
        f'<rect x=".5" y=".5" width="{W - 1}" height="{H - 1}" rx="20" fill="{C["bg"]}" stroke="{C["borda"]}"/>',
        f'<rect x=".5" y=".5" width="{W - 1}" height="{H - 1}" rx="20" fill="url(#pontos)"/>',
        f'<rect x="32" y="28" width="4" height="22" rx="2" fill="{C["verde"]}"/>',
        texto(46, 45, "Da tua senha ao ficheiro cifrado", 16, 800, C["texto"]),
        texto(W - 32, 45, "tudo calculado no teu computador", 10.5, 500, C["tenue"], "end"),
    ]
    hn = 58
    defs_nos = {
        "senha": ("key-round", "Senha mestra", "só tu a sabes"),
        "chaveS": ("key", "Chave da senha", "derivada no teu PC"),
        "rec": ("file-lock", "Chave de recuperação", "opcional · 160 bits"),
        "chaveR": ("key", "Chave da recuperação", "derivada no teu PC"),
        "cofre": ("lock-keyhole", "Chave do cofre", "256 bits aleatórios"),
        "ficheiro": ("hard-drive", "cofre.lissec", "cifrado e autenticado"),
    }
    colunas = [["senha", "rec"], ["chaveS", "chaveR"], ["cofre"], ["ficheiro"]]
    larguras = [
        max(max(FONTE.largura(defs_nos[k][1], 12, 750), FONTE.largura(defs_nos[k][2], 10, 500)) for k in col) + 70
        for col in colunas
    ]
    margem = 28
    folga = (W - 2 * margem - sum(larguras)) / (len(colunas) - 1)
    nos = {}
    x = margem
    for col, w in zip(colunas, larguras):
        ys = [86, 196] if len(col) == 2 else [141]
        for k, y in zip(col, ys):
            nos[k] = (x, y, w) + defs_nos[k]
        x += w + folga

    def centro_dir(k):
        x, y, w, *_ = nos[k]
        return x + w, y + hn / 2

    def centro_esq(k):
        x, y, *_ = nos[k]
        return x, y + hn / 2

    arestas = [
        ("senha", "chaveS", "Argon2id", 0.0),
        ("rec", "chaveR", "HKDF-SHA-256", 0.6),
        ("chaveS", "cofre", "abre", 1.4),
        ("chaveR", "cofre", "abre", 2.0),
        ("cofre", "ficheiro", "XChaCha20-Poly1305", 2.8),
    ]
    ciclo = 4.2
    for i, (a, b, rot, atraso) in enumerate(arestas):
        (x1, y1), (x2, y2) = centro_dir(a), centro_esq(b)
        if abs(y1 - y2) < 1:
            d = f"M{n(x1)} {n(y1)} H{n(x2 - 6)}"
        else:
            mx = (x1 + x2) / 2
            d = f"M{n(x1)} {n(y1)} C{n(mx)} {n(y1)} {n(mx)} {n(y2)} {n(x2 - 6)} {n(y2)}"
        defs.append(f'<path id="aresta{i}" d="{d}"/>')
        p.append(f'<path d="{d}" fill="none" stroke="{C["borda2"]}" stroke-width="1.6"/>')
        p.append(f'<path d="{d}" fill="none" stroke="{C["verde"]}" stroke-opacity=".5" stroke-width="1.6" stroke-dasharray="3 6" style="animation:fluir 1.2s linear infinite"/>')
        p.append(
            f'<path d="M{n(x2 - 7)} {n(y2 - 4.5)} L{n(x2)} {n(y2)} L{n(x2 - 7)} {n(y2 + 4.5)}" fill="none" stroke="{C["verde"]}" '
            'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
        )
        p.append(
            f'<circle r="4" fill="{C["verde"]}" opacity="0"><animateMotion dur="{ciclo}s" begin="{atraso:.1f}s" repeatCount="indefinite" '
            f'keyPoints="0;1;1" keyTimes="0;.32;1" calcMode="linear"><mpath href="#aresta{i}"/></animateMotion>'
            f'<animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;.04;.3;.34;1" dur="{ciclo}s" begin="{atraso:.1f}s" repeatCount="indefinite"/></circle>'
        )
        wl = FONTE.largura(rot, 9.5, 700)
        if abs(y1 - y2) >= 1:  # curva: rótulo junto ao meio
            lado = -1 if y1 < y2 else 1
            p.append(texto((x1 + x2) / 2 + 8, (y1 + y2) / 2 + lado * 22 + 3, rot, 9.5, 700, C["verde"], "start"))
        elif wl + 12 < x2 - x1:  # cabe por cima da seta
            p.append(texto((x1 + x2) / 2, y1 - 9, rot, 9.5, 700, C["verde"], "middle"))
        else:  # etiqueta por baixo dos cartões
            lx = (x1 + x2) / 2
            p.append(
                f'<line x1="{n(lx)}" y1="{n(y1 + 4)}" x2="{n(lx)}" y2="{n(y1 + 36)}" stroke="{C["borda2"]}" stroke-dasharray="2 3"/>'
                f'<rect x="{n(lx - wl / 2 - 9)}" y="{n(y1 + 36)}" width="{n(wl + 18)}" height="20" rx="10" fill="{C["elevado"]}" stroke="{C["verde"]}" stroke-opacity=".4"/>'
                + texto(lx, y1 + 49.5, rot, 9.5, 700, C["verde"], "middle")
            )
    css.append("@keyframes fluir{from{stroke-dashoffset:9;}to{stroke-dashoffset:0;}}")
    css.append("@keyframes acender{0%,100%{opacity:0;}10%{opacity:.85;}35%{opacity:0;}}")
    for k, (x, y, w, ic, tit, sub) in nos.items():  # noqa: B007
        destaque = k in ("cofre", "ficheiro")
        p.append(
            f'<g style="animation:surgir .6s cubic-bezier(.22,1,.36,1) .1s both">'
            f'<rect x="{x}" y="{y}" width="{w}" height="{hn}" rx="14" fill="{C["cartao"]}" stroke="{C["verde"] if destaque else C["borda"]}" '
            f'stroke-opacity="{".55" if destaque else "1"}"/>'
            f'<rect x="{x + 12}" y="{y + 13}" width="32" height="32" rx="10" fill="{C["verde_suave"]}"/>'
            + icone(ic, x + 19, y + 20, 18, C["verde"])
            + texto(x + 54, y + 26, esc(tit), 12, 750, C["texto"])
            + texto(x + 54, y + 42, esc(sub), 10, 500, C["tenue"])
            + "</g>"
        )
    # o ficheiro "acende" quando o pacote chega
    x, y, w, *_ = nos["ficheiro"]
    p.append(
        f'<rect x="{x}" y="{y}" width="{w}" height="{hn}" rx="14" fill="none" stroke="{C["verde"]}" stroke-width="2" opacity="0" '
        f'style="animation:acender {ciclo}s ease-out {2.8 + 0.32 * ciclo:.2f}s infinite"/>'
    )
    # notas
    notas = [
        ("wifi-off", "Nada sai do teu computador"),
        ("refresh-ccw", "Trocar a senha mestra gera chaves novas"),
        ("shield-check", "Um byte alterado e o cofre recusa abrir"),
    ]
    xn = 32
    for ic, t in notas:
        w = FONTE.largura(t, 11, 600) + 46
        p.append(
            f'<rect x="{n(xn)}" y="{H - 52}" width="{n(w)}" height="30" rx="15" fill="{C["cartao"]}" stroke="{C["borda"]}"/>'
            + icone(ic, xn + 12, H - 44, 14, C["verde"], 2.2)
            + texto(xn + 32, H - 33, esc(t), 11, 600, C["suave"])
        )
        xn += w + 10
    corpo = f"<defs>{''.join(defs)}</defs>" + "".join(p)
    return documento(
        W,
        H,
        "Como os dados ficam protegidos",
        "A senha mestra passa pelo Argon2id e dá a chave da senha; a chave de recuperação opcional passa pelo HKDF-SHA-256. "
        "Qualquer uma das duas abre a chave do cofre (256 bits aleatórios), que cifra o ficheiro cofre.lissec com "
        "XChaCha20-Poly1305. Nada sai do computador.",
        "".join(css),
        corpo,
    )


# --------------------------------------------------------------------------------------------
# 4. Ecrãs (capturas reais, a passar)
# --------------------------------------------------------------------------------------------
ECRAS = [
    ("15-visao-geral", "Visão geral", "o estado do cofre num relance"),
    ("10-detalhe-banco", "Dados bancários", "o IBAN fica mascarado até pedires"),
    ("16-financeiro", "Cartões", "só os últimos 4 dígitos à vista"),
    ("28-reautenticacao", "Confirma que és tu", "a senha mestra antes dos dados financeiros"),
    ("26-copias-google-drive", "Cópias no Google Drive", "cifradas e automáticas"),
    ("18-gerador", "Gerador", "senhas e frases-senha fortes"),
    ("17-seguranca", "Segurança", "o que convém mudar primeiro"),
    ("20-bloqueado", "Bloqueado", "nada fica no ecrã"),
]


def ecras() -> str:
    from PIL import Image

    W = 900
    iw = W - 40
    ih = round(iw * 820 / 1280)
    H = 20 + ih + 64
    por = 3.5
    total = por * len(ECRAS)
    css = [
        f"@keyframes passar{{0%{{opacity:0;}}{100 * 0.5 / total:.2f}%{{opacity:1;}}{100 * por / total:.2f}%{{opacity:1;}}"
        f"{100 * (por + 0.5) / total:.2f}%{{opacity:0;}}100%{{opacity:0;}}}}"
        f"@keyframes progresso{{0%{{transform:scaleX(0);}}{100 * por / total:.2f}%{{transform:scaleX(1);}}{100 * por / total + .01:.2f}%,100%{{transform:scaleX(0);}}}}"
        ".ecra{opacity:0;}.ecra0{opacity:1;}"
        ".barra{transform-box:fill-box;transform-origin:left center;transform:scaleX(0);}"
    ]
    defs = [f'<clipPath id="janela"><rect x="20" y="20" width="{iw}" height="{ih}" rx="12"/></clipPath>']
    camadas, legendas, pontos = [], [], []
    for i, (fich, tit, sub) in enumerate(ECRAS):
        im = Image.open(RAIZ / "docs" / "capturas" / f"{fich}.png").convert("RGB").resize((iw * 2 // 2, ih), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, "WEBP", quality=82, method=6)
        b64 = base64.b64encode(buf.getvalue()).decode()
        estilo = f'style="animation:passar {total}s ease-in-out {i * por}s infinite both"'
        camadas.append(
            f'<g class="ecra ecra{i}" {estilo}><image x="20" y="20" width="{iw}" height="{ih}" href="data:image/webp;base64,{b64}"/></g>'
        )
        legendas.append(
            f'<g class="ecra ecra{i}" {estilo}>'
            + texto(24, ih + 50, esc(tit), 15, 800, C["texto"])
            + texto(24 + FONTE.largura(tit, 15, 800) + 10, ih + 50, esc(sub), 12, 500, C["tenue"])
            + "</g>"
        )
        px = W - 24 - (len(ECRAS) - i) * 30
        pontos.append(
            f'<rect x="{px}" y="{ih + 42}" width="24" height="5" rx="2.5" fill="{C["borda2"]}"/>'
            f'<rect class="barra" x="{px}" y="{ih + 42}" width="24" height="5" rx="2.5" fill="{C["verde"]}" '
            f'style="animation:progresso {total}s linear {i * por}s infinite"/>'
        )
    corpo = (
        f"<defs>{''.join(defs)}</defs>"
        f'<rect x=".5" y=".5" width="{W - 1}" height="{H - 1}" rx="20" fill="{C["lateral"]}" stroke="{C["borda"]}"/>'
        f'<g clip-path="url(#janela)">{"".join(camadas)}</g>'
        f'<rect x="20.5" y="20.5" width="{iw - 1}" height="{ih - 1}" rx="11.5" fill="none" stroke="{C["borda"]}"/>'
        + "".join(legendas)
        + "".join(pontos)
    )
    return documento(
        W,
        H,
        "Ecrãs do LisSecurity",
        "Capturas da app real (com dados fictícios): " + ", ".join(t for _, t, _ in ECRAS) + ".",
        "".join(css),
        corpo,
    )


def main() -> int:
    for nome, fn in (("banner.svg", banner), ("funcoes.svg", funcoes), ("cifra.svg", cifra), ("ecras.svg", ecras)):
        svg = fn()
        (AQUI / nome).write_text(svg, encoding="utf-8")
        print(f"{nome}: {len(svg.encode()) / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
