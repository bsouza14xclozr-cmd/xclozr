-- XClozr — tabelas iniciais
-- Rode no Supabase: SQL Editor → New query → cole tudo → Run.
-- Cada linha pertence a um usuário (dono_id). O RLS garante que cada um só vê o que é seu.

create extension if not exists "pgcrypto";

-- ---------- Números de WhatsApp (chips) ----------
create table public.numeros (
  id              uuid primary key default gen_random_uuid(),
  dono_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome            text not null,
  instancia       text not null,                 -- nome da instância na Evolution API
  telefone        text,
  status          text not null default 'desconectado'
                  check (status in ('conectado', 'desconectado', 'aquecendo', 'banido')),
  no_rodizio      boolean not null default true,
  limite_diario   integer not null default 250,
  conectado_em    timestamptz,
  criado_em       timestamptz not null default now(),
  unique (dono_id, instancia)
);

-- ---------- Anúncios (cada um com seu link de rastreio) ----------
create table public.anuncios (
  id               uuid primary key default gen_random_uuid(),
  dono_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome             text not null,
  codigo_rastreio  text not null unique,         -- usado no link xclozr.com.br/r/CODIGO
  meta_ad_id       text,                          -- id do anúncio na Meta, para puxar o gasto
  status           text not null default 'ativo' check (status in ('ativo', 'pausado')),
  criado_em        timestamptz not null default now()
);

-- Gasto diário de cada anúncio (vem da Meta)
create table public.gastos_anuncio (
  id              uuid primary key default gen_random_uuid(),
  dono_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  anuncio_id      uuid not null references public.anuncios(id) on delete cascade,
  dia             date not null,
  gasto_centavos  integer not null default 0,
  unique (anuncio_id, dia)
);

-- ---------- Produtos ----------
create table public.produtos (
  id                     uuid primary key default gen_random_uuid(),
  dono_id                uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome                   text not null,
  preco_centavos         integer not null check (preco_centavos > 0),
  preco_minimo_centavos  integer,                -- desconto máximo que o robô pode dar
  entrega_tipo           text not null default 'link' check (entrega_tipo in ('link', 'arquivo', 'codigo')),
  entrega_conteudo       text,
  mensagem_entrega       text,
  upsell_de_id           uuid references public.produtos(id) on delete set null, -- se for upsell de outro produto
  ativo                  boolean not null default true,
  criado_em              timestamptz not null default now()
);

-- ---------- Contatos (clientes que chamaram) ----------
create table public.contatos (
  id            uuid primary key default gen_random_uuid(),
  dono_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  telefone      text not null,
  nome          text,
  numero_id     uuid references public.numeros(id) on delete set null,   -- chip que atendeu
  anuncio_id    uuid references public.anuncios(id) on delete set null,  -- de onde veio
  etapa         text not null default 'abertura',
  robo_ativo    boolean not null default true,
  pausado_ate   timestamptz,
  criado_em     timestamptz not null default now(),
  ultima_msg_em timestamptz,
  unique (dono_id, telefone)
);

-- ---------- Mensagens ----------
create table public.mensagens (
  id          uuid primary key default gen_random_uuid(),
  dono_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contato_id  uuid not null references public.contatos(id) on delete cascade,
  autor       text not null check (autor in ('cliente', 'robo', 'humano')),
  tipo        text not null default 'texto' check (tipo in ('texto', 'audio', 'imagem', 'video', 'arquivo')),
  conteudo    text,
  midia_url   text,
  criado_em   timestamptz not null default now()
);
create index mensagens_contato_idx on public.mensagens (contato_id, criado_em);

-- ---------- Pagamentos (Pix) ----------
create table public.pagamentos (
  id               uuid primary key default gen_random_uuid(),
  dono_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contato_id       uuid not null references public.contatos(id) on delete cascade,
  produto_id       uuid references public.produtos(id) on delete set null,
  anuncio_id       uuid references public.anuncios(id) on delete set null,
  tipo             text not null default 'principal' check (tipo in ('principal', 'upsell')),
  valor_centavos   integer not null,
  taxa_centavos    integer not null default 0,   -- taxa do gateway, para o cálculo do lucro
  status           text not null default 'pendente' check (status in ('pendente', 'pago', 'expirado')),
  gateway          text,
  gateway_id       text,
  pix_copia_cola   text,
  pago_em          timestamptz,
  criado_em        timestamptz not null default now()
);
create index pagamentos_status_idx on public.pagamentos (dono_id, status, criado_em);

-- ---------- Segurança: cada usuário só acessa as próprias linhas ----------
do $$
declare t text;
begin
  foreach t in array array['numeros','anuncios','gastos_anuncio','produtos','contatos','mensagens','pagamentos']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "dono acessa" on public.%I for all to authenticated using (dono_id = auth.uid()) with check (dono_id = auth.uid())',
      t
    );
  end loop;
end $$;
