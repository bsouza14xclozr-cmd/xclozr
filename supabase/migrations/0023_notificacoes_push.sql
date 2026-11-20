-- ============================================================
-- Notificações no celular/computador (app PWA + Web Push)
-- ============================================================

-- aparelhos inscritos (um por navegador/celular)
create table if not exists public.push_inscricoes (
  id            uuid primary key default gen_random_uuid(),
  dono_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  aparelho      text,
  criado_em     timestamptz not null default now(),
  ultimo_envio  timestamptz,
  erro          text
);
alter table public.push_inscricoes enable row level security;
create policy "dono acessa" on public.push_inscricoes for all to authenticated
  using (dono_id = auth.uid()) with check (dono_id = auth.uid());

-- o que cada usuário quer receber
create table if not exists public.notif_prefs (
  dono_id        uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  ativo          boolean not null default true,
  tipos          text[] not null default array['venda','chip','humano','funil','trafego','resumo','info'],
  resumo_hora    int not null default 21 check (resumo_hora between 0 and 23),
  resumo_ultimo  date,
  atualizado_em  timestamptz not null default now()
);
alter table public.notif_prefs enable row level security;
create policy "dono acessa" on public.notif_prefs for all to authenticated
  using (dono_id = auth.uid()) with check (dono_id = auth.uid());

-- cada aviso do sininho vira notificação uma vez só
alter table public.avisos add column if not exists push_em timestamptz;
create index if not exists avisos_push_pendente on public.avisos (criado_em) where push_em is null;

-- aviso novo → chama a função de notificação na hora (o cron de 1 min é a rede de segurança)
create or replace function public.avisos_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://hwfhrjvzanmsvxxdyifh.supabase.co/functions/v1/notificar/enviar',
    headers := jsonb_build_object('content-type', 'application/json', 'x-segredo', (select valor from public.motor_config where chave = 'segredo_relogio')),
    body := '{}'::jsonb
  );
  return null;
exception when others then
  return null; -- notificação nunca pode travar o aviso
end $$;
revoke execute on function public.avisos_push() from public, anon, authenticated;
drop trigger if exists avisos_push on public.avisos;
create trigger avisos_push after insert on public.avisos
  for each statement execute function public.avisos_push();

select cron.unschedule('xclozr-notificar') where exists (select 1 from cron.job where jobname = 'xclozr-notificar');
select cron.schedule('xclozr-notificar', '* * * * *', $$
  select net.http_post(
    url := 'https://hwfhrjvzanmsvxxdyifh.supabase.co/functions/v1/notificar/cron',
    headers := jsonb_build_object('content-type', 'application/json', 'x-segredo', (select valor from public.motor_config where chave = 'segredo_relogio')),
    body := '{}'::jsonb
  );
$$);
