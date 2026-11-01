-- ============================================================
-- Módulo Tráfego (Meta Ads) — pensado para virar módulo pago no SaaS
-- ============================================================

-- Conexão com o Meta (o token só é lido pelo servidor)
create table if not exists public.meta_config (
  dono_id uuid primary key references auth.users(id) on delete cascade,
  token text not null,
  usuario_nome text,
  contas text[] not null default '{}',       -- contas de anúncio escolhidas (act_...)
  ultimo_sync timestamptz,
  erro text,
  atualizado_em timestamptz not null default now()
);
alter table public.meta_config enable row level security;
create policy "dono lê" on public.meta_config for select to authenticated using (dono_id = auth.uid());
revoke all on public.meta_config from anon, authenticated;
grant select (dono_id, usuario_nome, contas, ultimo_sync, erro, atualizado_em) on public.meta_config to authenticated;

create table if not exists public.meta_contas (
  id text primary key,                       -- act_123
  dono_id uuid not null references auth.users(id) on delete cascade,
  nome text not null,
  moeda text,
  status int,
  atualizado_em timestamptz not null default now()
);
create table if not exists public.meta_campanhas (
  id text primary key,
  dono_id uuid not null references auth.users(id) on delete cascade,
  conta_id text not null,
  nome text not null,
  status text,
  status_efetivo text,
  objetivo text,
  orcamento_diario bigint,                   -- centavos (null = orçamento no conjunto)
  orcamento_total bigint,
  atualizado_em timestamptz not null default now()
);
create table if not exists public.meta_conjuntos (
  id text primary key,
  dono_id uuid not null references auth.users(id) on delete cascade,
  conta_id text not null,
  campanha_id text not null,
  nome text not null,
  status text,
  status_efetivo text,
  orcamento_diario bigint,
  orcamento_total bigint,
  atualizado_em timestamptz not null default now()
);
create table if not exists public.meta_anuncios (
  id text primary key,
  dono_id uuid not null references auth.users(id) on delete cascade,
  conta_id text not null,
  campanha_id text not null,
  conjunto_id text not null,
  nome text not null,
  status text,
  status_efetivo text,
  miniatura text,
  atualizado_em timestamptz not null default now()
);
-- números do Meta por anúncio e por dia (gasto, impressões, cliques, conversas)
create table if not exists public.meta_insights_dia (
  dono_id uuid not null references auth.users(id) on delete cascade,
  anuncio_id text not null,
  conjunto_id text not null,
  campanha_id text not null,
  conta_id text not null,
  dia date not null,
  gasto_centavos bigint not null default 0,
  impressoes bigint not null default 0,
  cliques bigint not null default 0,
  conversas int not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (anuncio_id, dia)
);
create index if not exists meta_insights_dono_dia on public.meta_insights_dia (dono_id, dia);

do $$
declare t text;
begin
  foreach t in array array['meta_contas','meta_campanhas','meta_conjuntos','meta_anuncios','meta_insights_dia'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "dono lê" on public.%I for select to authenticated using (dono_id = auth.uid())', t);
  end loop;
end $$;

-- Registro das ações feitas no Meta (pelo painel ou pelas regras)
create table if not exists public.meta_acoes (
  id bigint generated always as identity primary key,
  dono_id uuid not null references auth.users(id) on delete cascade,
  objeto_id text not null,
  nivel text not null check (nivel in ('campanha','conjunto','anuncio')),
  nome text,
  acao text not null,                        -- pausar | ativar | orcamento
  de text,
  para text,
  origem text not null default 'painel',     -- painel | regra
  ok boolean not null default true,
  erro text,
  criado_em timestamptz not null default now()
);
alter table public.meta_acoes enable row level security;
create policy "dono lê" on public.meta_acoes for select to authenticated using (dono_id = auth.uid());

-- Atribuição: de qual anúncio veio o contato (lido da 1ª mensagem do WhatsApp)
alter table public.contatos add column if not exists meta_ad_id text;
alter table public.contatos add column if not exists ctwa_clid text;
alter table public.contatos add column if not exists origem jsonb;
create index if not exists contatos_meta_ad on public.contatos (meta_ad_id) where meta_ad_id is not null;

-- Custos que entram no lucro
alter table public.configuracoes add column if not exists imposto_venda_pct numeric not null default 0;
alter table public.configuracoes add column if not exists imposto_meta_pct numeric not null default 0;
alter table public.produtos add column if not exists custo_centavos int not null default 0;

-- ============================================================
-- Relatório estilo Utmify: uma linha por campanha / conjunto / anúncio
-- ============================================================
create or replace function public.relatorio_anuncios(p_nivel text, p_inicio date, p_fim date, p_conta text default null)
returns table (
  id text, nome text, status text, status_efetivo text, conta_id text, campanha_id text, conjunto_id text,
  orcamento_diario bigint, gasto bigint, impressoes bigint, cliques bigint, conversas_meta bigint,
  contatos bigint, pix_gerados bigint, vendas bigint, faturamento bigint, lucro bigint
)
language sql stable security invoker set search_path = public as $$
with
eu as (select auth.uid() as uid),
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
grant execute on function public.relatorio_anuncios(text, date, date, text) to authenticated;
revoke execute on function public.relatorio_anuncios(text, date, date, text) from anon;

-- Sincronização do Meta a cada 15 min (a função só atualiza quem está há mais de ~55 min sem sync)
select cron.schedule('xclozr-trafego', '*/15 * * * *', $$
  select net.http_post(
    'https://hwfhrjvzanmsvxxdyifh.supabase.co/functions/v1/trafego/cron',
    '{}'::jsonb, '{}'::jsonb,
    jsonb_build_object('content-type','application/json','x-segredo',(select valor from public.motor_config where chave='segredo_relogio'))
  )
$$);
