"""Gera o grafo do funil "ENEM Bíblico 2026 — Funil v2 (pergunta → áudio → prova → oferta)".
A config do bloco Objeções é copiada do funil original na hora de inserir (placeholder __OBJ__)."""
import json

BASE = "https://xclozr.vercel.app/funis/enem-v2"
KIT = "b94e63fa-061a-4214-ae08-d57227e0df10"
PLANO = "e9b9788b-0442-40ef-b1d7-50fc88b71134"
DOWN = "0898acee-4efa-48ff-96ae-668821da3d63"

nos, arestas = [], []
col = {}


def no(id_, tipo, config, x, y):
    nos.append({"id": id_, "type": "bloco", "position": {"x": x, "y": y}, "data": {"tipo": tipo, "config": config}})


def liga(a, b, saida="seguir"):
    arestas.append({"id": f"e_{a}_{saida}_{b}", "source": a, "target": b, "sourceHandle": saida, "targetHandle": None})


def esp(s):
    return {"tipo": "espera", "segundos": s, "digitando": True}


def txt(t):
    return {"tipo": "texto", "texto": t}


OPCOES = ["Na igreja / célula", "Em família", "No ministério infantil", "Pra presentear alguém"]

# 1. Boas-vindas + pergunta
no("inicio", "inicio", {"atendenteIA": False}, 0, 200)
no("boas_vindas", "mensagem", {"itens": [esp(6), txt("Graça e paz, {nome}! 🙏 Que bom que você chamou!")]}, 280, 200)
no("pergunta", "menu", {"texto": "Antes de te mostrar, me conta rapidinho: é pra usar onde? 👇", "opcoes": OPCOES, "esperarMin": 10, "msgInvalida": ""}, 560, 200)
liga("inicio", "boas_vindas")
liga("boas_vindas", "pergunta")

ganchos = [
    "Que bênção! ⛪ Na igreja é lindo: todo mundo fazendo a prova junto e depois a premiação dos campeões lá na frente 🏆",
    "Que lindo! 🏡 Em família vira um momento gostoso: pais, filhos e avós competindo e aprendendo a Palavra juntos 💛",
    "Amo! 👧👦 Pros pequenos tem o caderno fácil, com perguntas ilustradas que eles adoram responder ✏️",
    "Que presente especial! 🎁 Pro pastor, líder ou professora da EBD é um mimo que vira atividade pra igreja toda 🙌",
]
for i, g in enumerate(ganchos):
    no(f"gancho_{i}", "mensagem", {"itens": [esp(3), txt(g)]}, 840, 40 + i * 140)
    liga("pergunta", f"gancho_{i}", f"opcao_{i}")
    liga(f"gancho_{i}", "audio_dor")

# lembrete se não responder a pergunta
no("pergunta_lembrete", "menu", {"texto": "Oi, {nome}! Ainda está por aí? 😊 Me conta onde vai usar, que eu já te mostro tudinho 👇", "opcoes": OPCOES, "esperarMin": 180, "msgInvalida": ""}, 840, 640)
liga("pergunta", "pergunta_lembrete", "sem_resposta")
for i in range(len(OPCOES)):
    liga("pergunta_lembrete", f"gancho_{i}", f"opcao_{i}")

# 2. Áudio curto: dor + produto (voz clonada, ~40 s)
AUDIO_DOR = (
    "[warmly] Deixa eu te contar uma coisa rapidinho... Sabe quando você quer ver o pessoal da igreja animado com a Bíblia, "
    "mas a EBD tá parada, as pessoas não participam e fica difícil inventar uma atividade nova toda semana? [sighs] "
    "Eu sei como é. Foi por isso que nasceu o ENEM Bíblico. É uma prova igualzinha à do vestibular, só que da Bíblia: "
    "três cadernos, do fácil ao difícil, com cento e cinquenta perguntas de Gênesis a Apocalipse. [excited] "
    "Vem com cartão-resposta, gabarito com a referência de cada resposta e certificado pros participantes. "
    "É só imprimir e aplicar. Serve da criança ao avô, e você imprime quantas cópias quiser. Olha só como é..."
)
no("audio_dor", "mensagem", {"itens": [esp(4), {"tipo": "voz", "texto": AUDIO_DOR}]}, 1120, 200)

# 3. Prova: mockup + prévia, em mensagens curtas
no("prova", "mensagem", {"itens": [
    esp(3),
    {"tipo": "imagem", "url": f"{BASE}/01-kit-mockup.jpg", "legenda": "Esse é o kit completo 😍"},
    esp(3),
    txt("O que vem nele:\n✅ 3 cadernos: fácil, intermediário e difícil\n✅ 150 perguntas ilustradas\n✅ Cartão-resposta\n✅ Gabarito com a referência bíblica\n✅ Certificado pros participantes"),
    esp(3),
    {"tipo": "imagem", "url": f"{BASE}/02-por-dentro.jpg", "legenda": "Olha como é por dentro 👆 páginas de verdade do PDF"},
    esp(3),
    txt("E o melhor: você compra *uma vez* e imprime *quantas cópias quiser* 🖨️"),
]}, 1400, 200)
liga("audio_dor", "prova")

# 4. Oferta: bônus + preço (sem "de" falso) + pergunta de fechamento
no("oferta", "mensagem", {"itens": [
    esp(3),
    {"tipo": "imagem", "url": f"{BASE}/03-bonus-moldura.jpg", "legenda": "🎁 E tem bônus: a moldura *“Eu participei do ENEM Bíblico 2026”* pra tirar foto da turma toda!"},
    esp(4),
    txt("📖 *ENEM Bíblico 2026 — Kit completo*\n✅ 3 cadernos (150 perguntas)\n✅ Cartão-resposta e gabarito\n✅ Certificados\n🎁 *Bônus:* moldura pra foto\n\nTudo por *R$13*: numa turma de 15 pessoas, sai *menos de R$1 por pessoa* 🙌\nChega aqui no WhatsApp na hora, logo depois do Pix."),
    esp(3),
    txt("Posso te mandar o Pix? 🙏"),
]}, 1680, 200)
liga("prova", "oferta")

no("objecoes", "objecoes", "__OBJ__", 1960, 200)
liga("oferta", "objecoes")
no("reengaja", "mensagem", {"itens": [txt("{nome}, imagina a turma toda fazendo a prova e tirando foto com a moldura no final... 😍 Ainda quer o kit? Me fala *SIM* que eu te mando o Pix 🙏")]}, 1960, 420)
liga("objecoes", "reengaja", "sem_resposta")
no("objecoes_2", "objecoes", "__OBJ2__", 2240, 420)
liga("reengaja", "objecoes_2")

# 5. Pix copia e cola + QR Code
no("pix", "pix", {
    "texto": "Aqui está seu Pix de *R$13,00* 👇\nCopie o código abaixo e cole no app do seu banco (Pix copia e cola), ou escaneie o QR Code. Assim que cair, o kit chega aqui na hora 🙌",
    "modoPix": "asaas", "enviarQr": True, "produtoId": KIT, "esperarMin": 10, "expiraMin": 1380,
}, 2240, 200)
liga("objecoes", "pix", "comprar")
liga("objecoes_2", "pix", "comprar")

# 6. Recuperação: 10 min, 1 h; no vencimento (~23 h) oferece o downsell
no("marca_pendente", "acao", {"acoes": [{"tipo": "etiqueta_add", "valor": "pix-pendente"}]}, 2520, 420)
no("rec_10min", "mensagem", {"itens": [esp(3), {"tipo": "audio", "url": "https://xclozr.vercel.app/funis/prova-biblica/03-lembrete-pix.mp3"}]}, 2800, 420)
no("espera_1h", "esperar", {"unidade": "minutos", "quantidade": 50, "cancelaSeResponder": False}, 3080, 420)
no("cond_1h", "condicao", {"logica": "todas", "regras": [{"tipo": "pix_pendente", "valor": "", "operador": "sim"}]}, 3360, 420)
no("rec_1h", "mensagem", {"itens": [esp(3), txt("{nome}, ficou alguma dúvida sobre o kit? 🙏 Seu Pix de R$13 continua aqui em cima, é só copiar e colar no app do banco que ele chega na hora 😉")]}, 3640, 420)
liga("pix", "marca_pendente", "nao_pagou")
liga("marca_pendente", "rec_10min")
liga("rec_10min", "espera_1h")
liga("espera_1h", "cond_1h")
liga("cond_1h", "rec_1h", "sim")

no("downsell", "downsell", {
    "produtoId": DOWN,
    "texto": "{nome}, seu Pix de R$13 venceu ⏳\nPra você não ficar de fora, consegui uma condição especial *só hoje*: o kit completo, com o bônus da moldura, por *{preco}* 🙏\nQuer? Responde *SIM* que eu te mando o Pix.",
    "palavrasSim": "sim, quero, manda, bora, pode, aceito, claro, ok",
    "esperarMin": 1440,
}, 2520, 640)
liga("pix", "downsell", "expirou")
no("pix_down", "pix", {
    "texto": "Aqui está seu Pix de *R$9,90* 👇\nCopie o código abaixo e cole no app do seu banco, ou escaneie o QR Code. Assim que cair, o kit chega na hora 🙌",
    "modoPix": "asaas", "enviarQr": True, "produtoId": DOWN, "esperarMin": 60, "expiraMin": 1440,
}, 2800, 640)
liga("downsell", "pix_down", "aceitou")
no("rec_down", "mensagem", {"itens": [txt("Seu Pix de R$9,90 ainda está aqui em cima, tá? 😉 A condição especial vale até ele vencer 🙏")]}, 3080, 640)
liga("pix_down", "rec_down", "nao_pagou")

# 7. Pagou → entrega + bônus + agradecimento + upsell
no("marca_comprador", "acao", {"acoes": [{"tipo": "etiqueta_add", "valor": "comprou-enem-biblico"}, {"tipo": "etiqueta_remover", "valor": "pix-pendente"}]}, 2520, 200)
liga("pix", "marca_comprador", "pagou")
liga("pix_down", "marca_comprador", "pagou")
no("entrega", "entregar", {"texto": "Pagamento confirmado! Deus abençoe, {nome} 🙏 Aqui está o seu kit completo 👇", "produtoId": KIT}, 2800, 200)
liga("marca_comprador", "entrega")
no("bonus", "mensagem", {"itens": [esp(3), txt("🎁 E aqui está o seu *bônus*: a moldura pra foto. Imprime em A4, recorta o meio e chama a turma pra foto no final 📸"), {"tipo": "arquivo", "url": f"{BASE}/bonus-moldura-enem-biblico-2026.pdf", "nome": "Moldura ENEM Bíblico 2026"}]}, 3080, 200)
liga("entrega", "bonus")
AGRADECE = (
    "[warmly] Oi! Passando aqui rapidinho só pra te agradecer, viu? De coração mesmo. [excited] Seu kit já tá aí em cima, prontinho pra imprimir, "
    "e a moldura também. Uma dica: imprime o cartão-resposta separado, aí você corrige rapidinho com o gabarito. "
    "E na premiação, chama os campeões lá na frente e tira a foto com a moldura... [laughs softly] o pessoal ama! Deus abençoe, tá bom?"
)
no("agradecimento", "mensagem", {"itens": [esp(4), {"tipo": "voz", "texto": AGRADECE}]}, 3360, 200)
liga("bonus", "agradecimento")
no("espera_upsell", "esperar", {"unidade": "minutos", "quantidade": 1, "cancelaSeResponder": False}, 3640, 200)
liga("agradecimento", "espera_upsell")
UPSELL_VOZ = (
    "[warmly] Ah, e antes de você ir... deixa eu te contar uma coisa. Sabe quando a gente começa a ler a Bíblia todo animado e aí... [sighs] para no meio do caminho? "
    "Acontece com muita gente, né? Por isso eu preparei o Plano de Leitura Bíblica de trinta dias. É um roteirinho simples, um pouquinho por dia, pra você criar o hábito de ler a Palavra todo dia. "
    "[excited] E pra quem levou o kit hoje, ele sai só por nove e noventa. Se quiser, é só me responder sim aqui embaixo que eu já te mando o Pix, tá?"
)
no("upsell_audio", "mensagem", {"itens": [esp(3), {"tipo": "voz", "texto": UPSELL_VOZ}]}, 3920, 200)
liga("espera_upsell", "upsell_audio")
no("upsell", "upsell", {
    "texto": "📖 *Plano de Leitura Bíblica de 30 Dias*\nUm roteiro simples, um pouquinho por dia, pra criar o hábito de ler a Palavra.\n\nSó hoje, pra quem levou o kit: *R$9,90*\n\nQuer que eu gere o Pix? É só responder *SIM* 😉",
    "produtoId": PLANO, "esperarMin": 30, "palavrasSim": "sim, quero, manda, bora, pode, gera, aceito, claro, ok",
}, 4200, 200)
liga("upsell_audio", "upsell")
no("pix_upsell", "pix", {"texto": "Aqui está o Pix de *R$9,90* do Plano de Leitura 👇 Assim que cair, te envio na hora 🙌", "modoPix": "asaas", "enviarQr": True, "produtoId": PLANO, "esperarMin": 30, "expiraMin": 1440}, 4480, 80)
liga("upsell", "pix_upsell", "aceitou")
no("entrega_upsell", "entregar", {"texto": "Pagamento confirmado! 🙏 Aqui está o seu *Plano de Leitura Bíblica de 30 Dias* 👇 Comece hoje mesmo pelo Dia 1!", "produtoId": PLANO}, 4760, 80)
liga("pix_upsell", "entrega_upsell", "pagou")
no("lembrete_upsell", "mensagem", {"itens": [txt("Seu Pix do Plano de Leitura ainda está aqui em cima, tá? 😉 Se não for o momento, sem problema nenhum, aproveite o kit! 🙏")]}, 4760, 260)
liga("pix_upsell", "lembrete_upsell", "nao_pagou")
no("fechamento", "mensagem", {"itens": [txt("Qualquer dúvida na hora de aplicar, é só me chamar aqui! Que Deus abençoe a sua igreja 🙏📖")]}, 5040, 200)
liga("upsell", "fechamento", "recusou")
liga("upsell", "fechamento", "sem_resposta")
liga("entrega_upsell", "fechamento")

# 8. Pós-venda: feedback + print (com permissão, vira prova social)
no("espera_posvenda", "esperar", {"unidade": "dias", "quantidade": 2, "cancelaSeResponder": False}, 5320, 200)
liga("fechamento", "espera_posvenda")
no("posvenda", "mensagem", {"itens": [
    txt("{nome}, e aí, já aplicou o ENEM Bíblico? 😍"),
    esp(3),
    txt("Me conta o que achou! Se puder, manda uma *foto da turma com a moldura* ou um *print* aqui 📸\nCom a sua permissão, eu mostro pra outras igrejas que estão em dúvida 🙏"),
]}, 5600, 200)
liga("espera_posvenda", "posvenda")

ids = {n["id"] for n in nos}
assert len([n for n in nos if n["data"]["tipo"] == "inicio"]) == 1
for e in arestas:
    assert e["source"] in ids and e["target"] in ids, e
assert len({e["id"] for e in arestas}) == len(arestas)
json.dump({"nodes": nos, "edges": arestas}, open("grafo.json", "w"), ensure_ascii=False)
print(len(nos), "nós,", len(arestas), "ligações")
