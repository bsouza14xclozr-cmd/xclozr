-- ============================================================
-- Regras automáticas + agente de tráfego com IA
-- ============================================================

-- Relatório parametrizado por dono (o servidor usa nas regras e no agente)
create or replace function public.relatorio_anuncios_de(p_dono uuid, p_nivel text, p_inicio date, p_fim date, p_conta text default null)
returns table (
  id text, nome text, status text, status_efetivo text, conta_id text, campanha_id text, conjunto_id text,
  orcamento_diario bigint, gasto bigint, impressoes bigint, cliques bigint, conversas_meta bigint,
  contatos bigint, pix_gerados bigint, vendas bigint, faturamento bigint, lucro bigint
)
language sql stable security invoker set search_path = public as $$
with
eu as (select p_dono as uid where p_dono = auth.uid() or coalesce(auth.role(), '') = 'service_role'),
cfg as (
  select coalesce((select imposto_venda_pct from configuracoes where dono_id = (select uid from eu)), 0) iv,
         coalesce((select imposto_meta_pct from configuracoes where dono_id = (select uid from eu)), 0) im
),
objs as (
  select c.id, c.nome, c.status, c.status_efetivo, c.conta_id, c.id campanha_id, null::text conjunto_id, c.orcamento_diario
    from meta_campanhas c where p_nivel = 'campanha' and c.dono_id = (select uid from eu)
  union all
  select s.id, s.nome, s.status, s.status_efetivo, s.conta_id, s.campanha_id, s.id, s.orcamento_diario
    from meta_conjuntos s where p_nivel = 'conjunto' and s.dono_id = (select uid from eu)
  union all
  select a.id, a.nome, a.status, a.status_efetivo, a.conta_id, a.campanha_id, a.conjunto_id, null
    from meta_anuncios a where p_nivel = 'anuncio' and a.dono_id = (select uid from eu)
),
chave_ad as (
  select a.id ad, case p_nivel when 'campanha' then a.campanha_id when 'conjunto' then a.conjunto_id else a.id end k
  from meta_anuncios a where a.dono_id = (select uid from eu)
),
ins as (
  select case p_nivel when 'campanha' then i.campanha_id when 'conjunto' then i.conjunto_id else i.anuncio_id end k,
         sum(i.gasto_centavos) gasto, sum(i.impressoes) imp, sum(i.cliques) cli, sum(i.conversas) conv
  from meta_insights_dia i
  where i.dono_id = (select uid from eu) and i.dia between p_inicio and p_fim
  group by 1
),
ct as (
  select ca.k, count(*) n
  from contatos c join chave_ad ca on ca.ad = c.meta_ad_id
  where c.dono_id = (select uid from eu) and not c.simulacao
    and (c.criado_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
  group by 1
),
pg as (
  select ca.k,
    count(*) filter (where p.tipo <> 'upsell' and (p.criado_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim) pix,
    count(*) filter (where p.status = 'pago' and p.tipo <> 'upsell' and (p.pago_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim) vendas,
    coalesce(sum(p.valor_centavos) filter (where p.status = 'pago' and (p.pago_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim), 0) fat,
    coalesce(sum(p.taxa_centavos + coalesce(pr.custo_centavos, 0)) filter (where p.status = 'pago' and (p.pago_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim), 0) custos
  from pagamentos p
  join contatos c on c.id = p.contato_id
  join chave_ad ca on ca.ad = c.meta_ad_id
  left join produtos pr on pr.id = p.produto_id
  where p.dono_id = (select uid from eu) and not p.simulacao
  group by 1
)
select o.id, o.nome, o.status, o.status_efetivo, o.conta_id, o.campanha_id, o.conjunto_id, o.orcamento_diario,
  coalesce(i.gasto, 0), coalesce(i.imp, 0), coalesce(i.cli, 0), coalesce(i.conv, 0),
  coalesce(ct.n, 0), coalesce(pg.pix, 0), coalesce(pg.vendas, 0), coalesce(pg.fat, 0),
  round(coalesce(pg.fat, 0) - coalesce(pg.custos, 0) - coalesce(pg.fat, 0) * (select iv from cfg) / 100
        - coalesce(i.gasto, 0) * (1 + (select im from cfg) / 100))::bigint
from objs o
left join ins i on i.k = o.id
left join ct on ct.k = o.id
left join pg on pg.k = o.id
where p_conta is null or o.conta_id = p_conta
order by coalesce(i.gasto, 0) desc, o.nome
$$;
grant execute on function public.relatorio_anuncios_de(uuid, text, date, date, text) to authenticated, service_role;
revoke execute on function public.relatorio_anuncios_de(uuid, text, date, date, text) from anon;

create or replace function public.relatorio_anuncios(p_nivel text, p_inicio date, p_fim date, p_conta text default null)
returns table (
  id text, nome text, status text, status_efetivo text, conta_id text, campanha_id text, conjunto_id text,
  orcamento_diario bigint, gasto bigint, impressoes bigint, cliques bigint, conversas_meta bigint,
  contatos bigint, pix_gerados bigint, vendas bigint, faturamento bigint, lucro bigint
)
language sql stable security invoker set search_path = public as $$
  select * from public.relatorio_anuncios_de(auth.uid(), p_nivel, p_inicio, p_fim, p_conta)
$$;

-- Travas e configuração do agente
create table if not exists public.trafego_config (
  dono_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  emergencia boolean not null default false,          -- desliga todas as automações
  teto_diario_centavos bigint not null default 0,     -- 0 = sem teto
  aumento_max_pct int not null default 30 check (aumento_max_pct between 1 and 100),
  gasto_min_centavos bigint not null default 2000,    -- só mexe depois de gastar isso no período
  agente_modo text not null default 'desligado' check (agente_modo in ('desligado','recomendar','automatico')),
  agente_hora smallint not null default 8 check (agente_hora between 0 and 23),
  agente_ultimo date,
  atualizado_em timestamptz not null default now()
);
alter table public.trafego_config enable row level security;
create policy "dono acessa" on public.trafego_config for all to authenticated using (dono_id = auth.uid()) with check (dono_id = auth.uid());

-- Regras automáticas (formato parecido com a Utmify)
create table if not exists public.meta_regras (
  id uuid primary key default gen_random_uuid(),
  dono_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null,
  ativa boolean not null default true,
  nivel text not null check (nivel in ('campanha','conjunto','anuncio')),
  alvo text not null default 'ativos' check (alvo in ('ativos','pausados')),
  filtro_nome text,                                   -- só itens cujo nome contém isso
  acao text not null check (acao in ('pausar','ativar','aumentar','diminuir','definir')),
  valor numeric,                                      -- % (aumentar/diminuir) ou centavos (definir)
  condicoes jsonb not null default '[]'::jsonb,       -- [{metrica, op, valor}] (dinheiro em centavos, taxas em %)
  periodo text not null default 'hoje' check (periodo in ('hoje','ontem','3d','7d','3d_sem_hoje','7d_sem_hoje')),
  frequencia_min int not null default 15 check (frequencia_min >= 15),
  hora_inicio smallint not null default 0 check (hora_inicio between 0 and 23),
  hora_fim smallint not null default 24 check (hora_fim between 1 and 24),
  limite_dia int not null default 1 check (limite_dia between 1 and 10),   -- vezes por item por dia
  so_pausados_por_regra boolean not null default false,                    -- para reativar só o que uma regra pausou
  origem text not null default 'manual' check (origem in ('manual','recomendada')),
  ultima_execucao timestamptz,
  criado_em timestamptz not null default now()
);
alter table public.meta_regras enable row level security;
create policy "dono acessa" on public.meta_regras for all to authenticated using (dono_id = auth.uid()) with check (dono_id = auth.uid());

alter table public.meta_acoes add column if not exists regra_id uuid references public.meta_regras(id) on delete set null;
alter table public.meta_acoes add column if not exists motivo text;
create index if not exists meta_acoes_obj on public.meta_acoes (objeto_id, criado_em desc);

-- Agente de tráfego com IA
create table if not exists public.agente_relatorios (
  id uuid primary key default gen_random_uuid(),
  dono_id uuid not null references auth.users(id) on delete cascade,
  modo text not null,
  texto text not null,
  revisao_regras text,
  criado_em timestamptz not null default now()
);
create table if not exists public.agente_sugestoes (
  id uuid primary key default gen_random_uuid(),
  relatorio_id uuid not null references public.agente_relatorios(id) on delete cascade,
  dono_id uuid not null references auth.users(id) on delete cascade,
  nivel text not null check (nivel in ('campanha','conjunto','anuncio')),
  objeto_id text not null,
  nome text,
  acao text not null check (acao in ('pausar','ativar','aumentar','diminuir')),
  valor numeric,
  motivo text,
  status text not null default 'pendente' check (status in ('pendente','aplicada','ignorada','bloqueada','falhou')),
  resultado text,
  criado_em timestamptz not null default now()
);
alter table public.agente_relatorios enable row level security;
alter table public.agente_sugestoes enable row level security;
create policy "dono lê" on public.agente_relatorios for select to authenticated using (dono_id = auth.uid());
create policy "dono acessa" on public.agente_sugestoes for all to authenticated using (dono_id = auth.uid()) with check (dono_id = auth.uid());
