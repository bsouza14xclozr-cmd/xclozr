-- ============================================================
-- Minha voz: voz clonada (ElevenLabs) para os áudios do robô.
-- A chave da ElevenLabs fica só no servidor.
-- ============================================================
create table if not exists public.voz_config (
  dono_id        uuid primary key references auth.users(id) on delete cascade,
  apikey         text not null,
  voice_id       text,
  voz_nome       text,
  modelo         text not null default 'qualidade' check (modelo in ('qualidade', 'economia')),
  plano          text,
  ok             boolean not null default true,
  erro           text,
  atualizado_em  timestamptz not null default now()
);
alter table public.voz_config enable row level security;
create policy "dono lê" on public.voz_config for select to authenticated using (dono_id = auth.uid());
revoke all on public.voz_config from anon, authenticated;
grant select (dono_id, voice_id, voz_nome, modelo, plano, ok, erro, atualizado_em) on public.voz_config to authenticated;

-- áudios gerados (públicos para o WhatsApp baixar; só o servidor grava)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voz', 'voz', true, 10485760, array['audio/mpeg'])
on conflict (id) do nothing;
