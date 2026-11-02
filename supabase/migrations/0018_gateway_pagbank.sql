-- ============================================================
-- Gateway de Pix real (PagBank). O token fica só no servidor.
-- ============================================================
create table if not exists public.gateway_config (
  dono_id          uuid primary key references auth.users(id) on delete cascade,
  gateway          text not null default 'pagbank' check (gateway in ('pagbank')),
  token            text not null,
  ambiente         text not null default 'producao' check (ambiente in ('producao', 'sandbox')),
  segredo_webhook  text not null default encode(gen_random_bytes(18), 'hex'),
  ok               boolean not null default false,
  erro             text,
  atualizado_em    timestamptz not null default now()
);
alter table public.gateway_config enable row level security;
create policy "dono lê" on public.gateway_config for select to authenticated using (dono_id = auth.uid());
revoke all on public.gateway_config from anon, authenticated;
grant select (dono_id, gateway, ambiente, ok, erro, atualizado_em) on public.gateway_config to authenticated;

-- conferência periódica do pagamento (caso o aviso do gateway se perca)
alter table public.pagamentos add column if not exists verificar_em timestamptz;
create index if not exists pagamentos_verificar on public.pagamentos (verificar_em) where status = 'pendente' and gateway = 'pagbank';
