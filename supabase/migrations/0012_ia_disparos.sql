-- ============================================================
-- Agente de IA: configuração por dono (a chave nunca sai do servidor)
-- ============================================================
create table if not exists public.ia_config (
  dono_id uuid primary key references auth.users(id) on delete cascade,
  provedor text not null check (provedor in ('openai','anthropic','gemini')),
  modelo text not null,
  chave text not null,
  atualizado_em timestamptz not null default now()
);
alter table public.ia_config enable row level security;
create policy "dono lê" on public.ia_config for select to authenticated using (dono_id = auth.uid());
-- o painel só enxerga provedor/modelo; a chave é gravada e lida apenas pelo motor (service role)
revoke all on public.ia_config from anon, authenticated;
grant select (dono_id, provedor, modelo, atualizado_em) on public.ia_config to authenticated;

create table if not exists public.ia_uso (
  id bigint generated always as identity primary key,
  dono_id uuid not null references auth.users(id) on delete cascade,
  contato_id uuid references public.contatos(id) on delete set null,
  provedor text not null,
  modelo text not null,
  tokens_entrada int not null default 0,
  tokens_saida int not null default 0,
  simulacao boolean not null default false,
  criado_em timestamptz not null default now()
);
alter table public.ia_uso enable row level security;
create policy "dono lê" on public.ia_uso for select to authenticated using (dono_id = auth.uid());
create index if not exists ia_uso_dono_data on public.ia_uso (dono_id, criado_em desc);

-- ============================================================
-- Disparos (remarketing)
-- ============================================================
create table if not exists public.campanhas (
  id uuid primary key default gen_random_uuid(),
  dono_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null,
  mensagem text not null default '',
  midia_tipo text check (midia_tipo in ('imagem','video','audio','arquivo')),
  midia_url text,
  incluir_sair boolean not null default true,
  filtro jsonb not null default '{}'::jsonb,
  funil_id uuid references public.funis(id) on delete set null,
  intervalo_min_seg int not null default 45 check (intervalo_min_seg >= 10),
  intervalo_max_seg int not null default 120 check (intervalo_max_seg >= 10),
  limite_diario_chip int not null default 150 check (limite_diario_chip between 1 and 2000),
  janela_inicio smallint not null default 9 check (janela_inicio between 0 and 23),
  janela_fim smallint not null default 20 check (janela_fim between 1 and 24),
  status text not null default 'rascunho' check (status in ('rascunho','enviando','pausada','concluida','cancelada')),
  total int not null default 0,
  enviados int not null default 0,
  falhas int not null default 0,
  proximo_envio_em timestamptz,
  iniciado_em timestamptz,
  concluido_em timestamptz,
  criado_em timestamptz not null default now()
);
alter table public.campanhas enable row level security;
create policy "dono acessa" on public.campanhas for all to authenticated using (dono_id = auth.uid()) with check (dono_id = auth.uid());
create index if not exists campanhas_fila on public.campanhas (status, proximo_envio_em);

create table if not exists public.campanha_envios (
  id bigint generated always as identity primary key,
  campanha_id uuid not null references public.campanhas(id) on delete cascade,
  dono_id uuid not null references auth.users(id) on delete cascade,
  contato_id uuid not null references public.contatos(id) on delete cascade,
  ordem int not null,
  status text not null default 'pendente' check (status in ('pendente','enviado','falhou','ignorado')),
  numero_id uuid references public.numeros(id) on delete set null,
  enviado_em timestamptz,
  respondeu_em timestamptz,
  erro text,
  unique (campanha_id, contato_id)
);
alter table public.campanha_envios enable row level security;
create policy "dono acessa" on public.campanha_envios for all to authenticated using (dono_id = auth.uid()) with check (dono_id = auth.uid());
create index if not exists envios_proximo on public.campanha_envios (campanha_id, status, ordem);
create index if not exists envios_contato on public.campanha_envios (contato_id, enviado_em desc);
create index if not exists envios_chip_dia on public.campanha_envios (numero_id, enviado_em) where status = 'enviado';

alter publication supabase_realtime add table public.campanhas;

-- Público de um disparo (respeita RLS: só contatos do próprio dono)
-- filtro: colunas[], etiquetas[], sem_etiquetas[], comprou ('sim'|'nao'), pix_pendente (bool),
--         conversou_dias (int: conversou nos últimos N dias), parado_horas (int: sem mensagem há pelo menos N horas),
--         incluir_pausados (bool)
create or replace function public.publico_campanha(f jsonb)
returns setof public.contatos
language sql stable security invoker set search_path = public as $$
  select c.* from contatos c
  where c.dono_id = auth.uid()
    and not c.simulacao
    and c.numero_id is not null
    and not ('Não perturbe' = any(coalesce(c.etiquetas, '{}')))
    and (coalesce(jsonb_array_length(f->'colunas'), 0) = 0 or c.kanban_coluna_id::text in (select jsonb_array_elements_text(f->'colunas')))
    and (coalesce(jsonb_array_length(f->'etiquetas'), 0) = 0 or c.etiquetas && array(select jsonb_array_elements_text(f->'etiquetas')))
    and (coalesce(jsonb_array_length(f->'sem_etiquetas'), 0) = 0 or not (c.etiquetas && array(select jsonb_array_elements_text(f->'sem_etiquetas'))))
    and (coalesce(f->>'comprou', '') = '' or (f->>'comprou' = 'sim') = exists (select 1 from pagamentos p where p.contato_id = c.id and p.status = 'pago' and not p.simulacao))
    and (coalesce((f->>'pix_pendente')::boolean, false) = false or exists (select 1 from pagamentos p where p.contato_id = c.id and p.status in ('pendente','expirado') and not p.simulacao)
         and not exists (select 1 from pagamentos p where p.contato_id = c.id and p.status = 'pago' and not p.simulacao))
    and (coalesce((f->>'conversou_dias')::int, 0) = 0 or c.ultima_msg_em >= now() - make_interval(days => (f->>'conversou_dias')::int))
    and (coalesce((f->>'parado_horas')::int, 0) = 0 or c.ultima_msg_em is null or c.ultima_msg_em <= now() - make_interval(hours => (f->>'parado_horas')::int))
    and (coalesce((f->>'incluir_pausados')::boolean, false) or c.robo_ativo)
$$;

create or replace function public.contar_publico(f jsonb)
returns int language sql stable security invoker set search_path = public as $$
  select count(*)::int from public.publico_campanha(f)
$$;

-- Inicia (ou retoma) um disparo: monta a fila uma vez e libera o envio
create or replace function public.iniciar_campanha(p_id uuid)
returns int language plpgsql security invoker set search_path = public as $$
declare
  v campanhas;
  n int;
begin
  select * into v from campanhas where id = p_id and dono_id = auth.uid();
  if not found then raise exception 'campanha não encontrada'; end if;
  if v.status = 'rascunho' then
    if coalesce(trim(v.mensagem), '') = '' and v.midia_url is null then raise exception 'escreva a mensagem'; end if;
    insert into campanha_envios (campanha_id, dono_id, contato_id, ordem)
    select v.id, v.dono_id, c.id, row_number() over (order by c.ultima_msg_em desc nulls last)
    from publico_campanha(v.filtro) c
    on conflict do nothing;
    get diagnostics n = row_count;
    if n = 0 then raise exception 'nenhum contato nesse público'; end if;
    update campanhas set status = 'enviando', total = n, iniciado_em = now(), proximo_envio_em = now() where id = v.id;
    return n;
  elsif v.status = 'pausada' then
    update campanhas set status = 'enviando', proximo_envio_em = now() where id = v.id;
    return v.total;
  end if;
  raise exception 'esse disparo não pode ser iniciado (status %)', v.status;
end $$;

grant execute on function public.publico_campanha(jsonb) to authenticated;
grant execute on function public.contar_publico(jsonb) to authenticated;
grant execute on function public.iniciar_campanha(uuid) to authenticated;
revoke execute on function public.publico_campanha(jsonb) from anon;
revoke execute on function public.contar_publico(jsonb) from anon;
revoke execute on function public.iniciar_campanha(uuid) from anon;
