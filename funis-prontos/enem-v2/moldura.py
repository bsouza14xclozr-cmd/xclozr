"""Moldura para foto "Eu participei do ENEM Bíblico 2026" (bônus do kit). A4 deitado, centro em branco para recortar."""
import math
import random
import sys

from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

FONTES = "/usr/share/fonts/truetype/google-fonts/"
pdfmetrics.registerFont(TTFont("PopB", FONTES + "Poppins-Bold.ttf"))
pdfmetrics.registerFont(TTFont("PopX", FONTES + "Poppins-ExtraBold.ttf" if __import__("os").path.exists(FONTES + "Poppins-ExtraBold.ttf") else FONTES + "Poppins-Bold.ttf"))
pdfmetrics.registerFont(TTFont("PopR", FONTES + "Poppins-Regular.ttf"))

AZUL = (0.16, 0.62, 0.89)
AZUL_ESC = (0.06, 0.30, 0.55)
AMARELO = (1.0, 0.85, 0.15)
BRANCO = (1, 1, 1)
VERDE = (0.18, 0.65, 0.25)

W, H = landscape(A4)
M = 0  # sangria: a página toda é a moldura
TOPO, BASE, LADO = 118, 92, 58  # espessura da faixa colorida


def cruz(c, x, y, t, cor):
    c.setFillColorRGB(*cor)
    c.rect(x - t * 0.12, y - t * 0.5, t * 0.24, t, stroke=0, fill=1)
    c.rect(x - t * 0.36, y + t * 0.08, t * 0.72, t * 0.22, stroke=0, fill=1)


def estrela(c, x, y, r, cor):
    c.setFillColorRGB(*cor)
    p = c.beginPath()
    for i in range(8):
        a = math.pi / 2 + i * math.pi / 4
        rr = r if i % 2 == 0 else r * 0.35
        px, py = x + rr * math.cos(a), y + rr * math.sin(a)
        p.moveTo(px, py) if i == 0 else p.lineTo(px, py)
    p.close()
    c.drawPath(p, stroke=0, fill=1)


def texto_contorno(c, txt, fonte, tam, x, y, cor, contorno, largura=5):
    t = c.beginText()
    t.setFont(fonte, tam)
    t.setTextOrigin(x - pdfmetrics.stringWidth(txt, fonte, tam) / 2, y)
    t.setTextRenderMode(2)  # preenche + contorno
    c.setStrokeColorRGB(*contorno)
    c.setFillColorRGB(*cor)
    c.setLineWidth(largura)
    c.setLineJoin(1)
    t.textLine(txt)
    t.setTextRenderMode(0)
    c.drawText(t)
    # por cima, só o preenchimento (contorno fica por fora)
    c.setFillColorRGB(*cor)
    c.setFont(fonte, tam)
    c.drawCentredString(x, y, txt)


def main(saida):
    c = canvas.Canvas(saida, pagesize=(W, H))
    c.setTitle("Moldura ENEM Bíblico 2026")
    c.setAuthor("ENEM Bíblico 2026")

    # fundo azul + janela branca no meio
    c.setFillColorRGB(*AZUL)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    jx, jy, jw, jh = LADO, BASE, W - 2 * LADO, H - TOPO - BASE
    c.setFillColorRGB(*BRANCO)
    c.roundRect(jx, jy, jw, jh, 18, stroke=0, fill=1)

    # brilho e enfeites na faixa (cruzes, estrelas, pontinhos), longe dos textos
    rnd = random.Random(7)
    for _ in range(70):
        x, y = rnd.uniform(8, W - 8), rnd.uniform(8, H - 8)
        dentro = jx - 6 < x < jx + jw + 6 and jy - 6 < y < jy + jh + 6
        zona_titulo = H - TOPO < y and W * 0.2 < x < W * 0.8
        zona_base = y < BASE and W * 0.22 < x < W * 0.78
        if dentro or zona_titulo or zona_base:
            continue
        k = rnd.random()
        if k < 0.35:
            cruz(c, x, y, rnd.uniform(10, 18), AMARELO)
        elif k < 0.7:
            estrela(c, x, y, rnd.uniform(4, 8), BRANCO)
        else:
            c.setFillColorRGB(*BRANCO)
            c.circle(x, y, rnd.uniform(1.2, 2.4), stroke=0, fill=1)

    # linha de recorte
    c.setStrokeColorRGB(*AZUL_ESC)
    c.setLineWidth(1.2)
    c.setDash(6, 5)
    c.roundRect(jx + 6, jy + 6, jw - 12, jh - 12, 14, stroke=1, fill=0)
    c.setDash()
    c.setFillColorRGB(0.55, 0.62, 0.7)
    c.setFont("PopR", 10)
    c.drawCentredString(W / 2, jy + 18, "recorte na linha pontilhada e use para tirar a foto")
    c.setFont("PopR", 12)
    c.setFillColorRGB(0.78, 0.82, 0.86)
    c.drawCentredString(W / 2, jy + jh / 2, "")

    # título
    texto_contorno(c, "ENEM BÍBLICO 2026", "PopX", 50, W / 2, H - 70, AMARELO, AZUL_ESC, 7)
    c.setFillColorRGB(*BRANCO)
    c.setFont("PopB", 17)
    c.drawCentredString(W / 2, H - 100, "Prova bíblica • da criança ao avô")

    # base: selo "eu participei"
    selo_w, selo_h = 330, 50
    sx, sy = W / 2 - selo_w / 2, BASE / 2 - selo_h / 2 - 4
    c.setFillColorRGB(*VERDE)
    c.roundRect(sx, sy, selo_w, selo_h, selo_h / 2, stroke=0, fill=1)
    c.setFillColorRGB(*BRANCO)
    c.setFont("PopX", 27)
    c.drawCentredString(W / 2, sy + 15, "EU PARTICIPEI!")
    cruz(c, sx + 26, sy + selo_h / 2, 20, AMARELO)
    cruz(c, sx + selo_w - 26, sy + selo_h / 2, 20, AMARELO)

    c.showPage()
    c.save()


if __name__ == "__main__":
    main(sys.argv[1])
