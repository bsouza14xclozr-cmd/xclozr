-- XClozr — motor do robô (Edge Function no Supabase)

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Estado da conversa de cada contato
alter table public.contatos add column aguardando jsonb;               -- bloco que está esperando resposta: {bloco, tipo, token, tentativas}
alter table public.contatos add column pix_ativo jsonb;                -- Pix em aberto: {bloco, pagamento_id}
alter table public.contatos add column finalizado boolean not null default false;
alter table public.contatos add column ja_respondeu boolean not null default false;
alter table public.contatos add column simulacao boolean not null default false;  -- contatos do simulador (fora das métricas)
alter table public.contatos add column processando_ate timestamptz;    -- trava: evita responder em dobro

-- Tarefas com hora marcada (esperas, "não respondeu", lembretes de Pix)
create table public.agendamentos (
  id           uuid primary key default gen_random_uuid(),
  dono_id      uuid not null references auth.users(id) on delete cascade,
  contato_id   uuid not null references public.contatos(id) on delete cascade,
  tipo         text not null,              -- 'timeout' | 'esperar' | 'pix_nao_pagou' | 'pix_expirou' | 'reprocessar'
  executar_em  timestamptz not null,
  dados        jsonb not null default '{}'::jsonb,
  feito        boolean not null default false,
  criado_em    timestamptz not null default now()
);
create index agendamentos_pendentes_idx on public.agendamentos (executar_em) where not feito;

alter table public.agendamentos enable row level security;
create policy "dono lê" on public.agendamentos for select to authenticated using (dono_id = auth.uid());

-- Configuração privada do motor (só o próprio motor lê, com a chave de serviço; sem acesso pelo painel)
create table public.motor_config (
  chave  text primary key,
  valor  text not null
);
alter table public.motor_config enable row level security;
-- sem políticas: ninguém do painel lê ou escreve

insert into public.motor_config (chave, valor) values ('segredo_relogio', encode(gen_random_bytes(24), 'hex'))
on conflict (chave) do nothing;

-- Avisos para o dono (ex.: "cliente pediu humano")
create table public.avisos (
  id          uuid primary key default gen_random_uuid(),
  dono_id     uuid not null references auth.users(id) on delete cascade,
  contato_id  uuid references public.contatos(id) on delete cascade,
  texto       text not null,
  lido        boolean not null default false,
  criado_em   timestamptz not null default now()
);
alter table public.avisos enable row level security;
create policy "dono acessa" on public.avisos for all to authenticated
  using (dono_id = auth.uid()) with check (dono_id = auth.uid());

alter table public.mensagens add column wa_id text;
alter table public.pagamentos add column simulacao boolean not null default false;

-- Segredo do webhook da Evolution e relógio do motor (a cada 10 s)
insert into public.motor_config (chave, valor) values ('segredo_webhook', encode(gen_random_bytes(24), 'hex')) on conflict (chave) do nothing;
select cron.schedule(
  'xclozr-relogio',
  '10 seconds',
  $$
  select net.http_post(
    url := 'https://hwfhrjvzanmsvxxdyifh.supabase.co/functions/v1/motor/relogio',
    headers := jsonb_build_object('content-type', 'application/json', 'x-segredo', (select valor from public.motor_config where chave = 'segredo_relogio')),
    body := '{}'::jsonb
  );
  $$
);
