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

## Configurar o Supabase

1. **Tabelas:** SQL Editor → New query → cole o conteúdo de `supabase/migrations/0001_inicial.sql` → Run.
2. **Seu usuário:** Authentication → Users → Add user → e-mail e senha (marque "Auto Confirm User").
3. **Fechar cadastro público:** Authentication → Sign In / Providers → desligue "Allow new users to sign up".
4. **Chaves:** a URL e a chave pública (publishable) já estão em `src/lib/supabase/config.ts`.
   Não precisa configurar nada na Vercel.

Nunca coloque a chave `service_role` no painel nem no GitHub.

## Publicar na Vercel

1. Em vercel.com → **Add New → Project** → importe o repositório `xclozr`.
2. Framework: Next.js (detectado sozinho). Não precisa mudar nada no build.
3. Não precisa de variáveis de ambiente: as chaves públicas já estão no código.
4. **Deploy**. Cada novo envio para a branch `main` publica sozinho.

## Rota do projeto

- [x] Parte 1 — projeto, layout e páginas esqueleto
- [x] Supabase — login e tabelas
- [ ] Fase 1 — conectar números pelo QR code (Evolution API)
- [ ] Fase 2 — conversas
- [x] Fase 3a — editor visual de funil (blocos, ligações, salvamento automático)
- [ ] Fase 3b — motor que executa o funil no WhatsApp (VPS)
- [ ] Fase 4 — Pix, entrega, upsell, recuperação
- [ ] Fase 5 — rastreio de anúncios e métricas de lucro
- [ ] Fase 6 — regras automáticas de anúncios
- [ ] Fase 7 — IA de reserva (opcional)
- [ ] Fase 8 — rodízio de números e proteção contra ban
