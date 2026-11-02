-- ============================================================
-- API de Conversões do Meta: devolve Lead / Pix gerado / Compra ao Pixel (dataset)
-- para o Meta medir e otimizar os anúncios pelas vendas reais.
-- ============================================================
create table if not exists public.capi_config (
  dono_id       uuid primary key references auth.users(id) on delete cascade,
  pixel_id      text not null,
  pixel_nome    text,
  token         text not null,
  test_code     text,
  ev_lead       boolean not null default true,
  ev_checkout   boolean not null default true,
  ev_compra     boolean not null default true,
  ativo         boolean not null default true,
  erro          text,
  ultimo_envio  timestamptz,
  atualizado_em timestamptz not null default now()
);
alter table public.capi_config enable row level security;
create policy "dono lê" on public.capi_config for select to authenticated using (dono_id = auth.uid());
create policy "dono ajusta" on public.capi_config for update to authenticated using (dono_id = auth.uid()) with check (dono_id = auth.uid());
revoke all on public.capi_config from anon, authenticated;
grant select (dono_id, pixel_id, pixel_nome, test_code, ev_lead, ev_checkout, ev_compra, ativo, erro, ultimo_envio, atualizado_em) on public.capi_config to authenticated;
grant update (test_code, ev_lead, ev_checkout, ev_compra, ativo) on public.capi_config to authenticated;

create table if not exists public.capi_eventos (
  id             bigint generated always as identity primary key,
  dono_id        uuid not null references auth.users(id) on delete cascade,
  contato_id     uuid references public.contatos(id) on delete cascade,
  pagamento_id   uuid references public.pagamentos(id) on delete cascade,
  evento         text not null check (evento in ('Lead', 'InitiateCheckout', 'Purchase')),
  event_id       text not null unique,
  valor_centavos integer,
  status         text not null default 'pendente' check (status in ('pendente', 'enviado', 'erro', 'ignorado')),
  tentativas     int not null default 0,
  resposta       text,
  criado_em      timestamptz not null default now(),
  enviado_em     timestamptz
);
create index if not exists capi_eventos_fila on public.capi_eventos (criado_em) where status = 'pendente';
create index if not exists capi_eventos_dono on public.capi_eventos (dono_id, criado_em desc);
alter table public.capi_eventos enable row level security;
create policy "dono lê" on public.capi_eventos for select to authenticated using (dono_id = auth.uid());
revoke all on public.capi_eventos from anon;
grant select on public.capi_eventos to authenticated;

-- Enfileira um evento se a API de Conversões estiver ligada para esse tipo
create or replace function public.capi_enfileirar(p_dono uuid, p_contato uuid, p_pag uuid, p_evento text, p_event_id text, p_valor int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from capi_config c
    where c.dono_id = p_dono and c.ativo
      and case p_evento when 'Lead' then c.ev_lead when 'InitiateCheckout' then c.ev_checkout else c.ev_compra end
  ) then
    insert into capi_eventos (dono_id, contato_id, pagamento_id, evento, event_id, valor_centavos)
    values (p_dono, p_contato, p_pag, p_evento, p_event_id, p_valor)
    on conflict (event_id) do nothing;
  end if;
end $$;
revoke execute on function public.capi_enfileirar(uuid, uuid, uuid, text, text, int) from public, anon, authenticated;

-- Novo contato vindo de anúncio → Lead
create or replace function public.capi_contato() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not new.simulacao and new.meta_ad_id is not null and (tg_op = 'INSERT' or old.meta_ad_id is distinct from new.meta_ad_id) then
    perform capi_enfileirar(new.dono_id, new.id, null, 'Lead', 'lead-' || new.id || '-' || new.meta_ad_id, null);
  end if;
  return null;
end $$;
drop trigger if exists capi_contato on public.contatos;
create trigger capi_contato after insert or update of meta_ad_id on public.contatos
  for each row execute function public.capi_contato();

-- Pix gerado → InitiateCheckout; Pix pago → Purchase
create or replace function public.capi_pagamento() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.simulacao then return null; end if;
  if tg_op = 'INSERT' and new.tipo = 'principal' then
    perform capi_enfileirar(new.dono_id, new.contato_id, new.id, 'InitiateCheckout', 'ic-' || new.id, new.valor_centavos);
  end if;
  if new.status = 'pago' and (tg_op = 'INSERT' or old.status is distinct from 'pago') then
    perform capi_enfileirar(new.dono_id, new.contato_id, new.id, 'Purchase', 'pur-' || new.id, new.valor_centavos);
  end if;
  return null;
end $$;
drop trigger if exists capi_pagamento on public.pagamentos;
create trigger capi_pagamento after insert or update of status on public.pagamentos
  for each row execute function public.capi_pagamento();

-- Envia a fila a cada minuto
select cron.unschedule('xclozr-conversoes') where exists (select 1 from cron.job where jobname = 'xclozr-conversoes');
select cron.schedule('xclozr-conversoes', '* * * * *', $$
  select net.http_post(
    url := 'https://hwfhrjvzanmsvxxdyifh.supabase.co/functions/v1/conversoes/cron',
    headers := jsonb_build_object('content-type', 'application/json', 'x-segredo', (select valor from public.motor_config where chave = 'segredo_relogio')),
    body := '{}'::jsonb
  );
$$);
