# XClozr

Painel de vendas low ticket no X1 (WhatsApp): números, conversas, funil, Pix, anúncios e métricas de lucro.

## Como está organizado

- **Painel** (este repositório): Next.js, hospedado na Vercel.
- **Banco**: Supabase.
- **Motor do robô**: roda na VPS junto da Evolution API (fase futura).

```
src/
  app/
    layout.tsx           layout raiz (fontes, tema)
    (painel)/            páginas com o menu lateral
      page.tsx           Visão geral
      numeros/           Números de WhatsApp
      conversas/         Conversas
      funil/             Funil de venda
      produtos/          Produtos e Pix
      anuncios/          Anúncios
  components/            Sidebar e componentes visuais
  lib/supabase/          clientes do Supabase (navegador e servidor)
```

## Rodar no computador

```bash
npm install
cp .env.example .env.local   # preencha as chaves
npm run dev                  # abre em http://localhost:3000
```

## Publicar na Vercel

1. Em vercel.com → **Add New → Project** → importe o repositório `xclozr`.
2. Framework: Next.js (detectado sozinho). Não precisa mudar nada no build.
3. Em **Environment Variables**, cadastre as variáveis do `.env.example`.
4. **Deploy**. Cada novo envio para a branch `main` publica sozinho.

## Rota do projeto

- [x] Parte 1 — projeto, layout e páginas esqueleto
- [ ] Supabase — login e tabelas
- [ ] Fase 1 — conectar números pelo QR code (Evolution API)
- [ ] Fase 2 — conversas
- [ ] Fase 3 — funil sem IA
- [ ] Fase 4 — Pix, entrega, upsell, recuperação
- [ ] Fase 5 — rastreio de anúncios e métricas de lucro
- [ ] Fase 6 — regras automáticas de anúncios
- [ ] Fase 7 — IA de reserva (opcional)
- [ ] Fase 8 — rodízio de números e proteção contra ban
