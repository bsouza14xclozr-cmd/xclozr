-- ============================================================
-- Colunas personalizáveis no relatório de anúncios (estilo Utmify)
-- ============================================================
alter table public.trafego_config add column if not exists colunas jsonb;  -- ordem e quais colunas aparecem

drop function if exists public.relatorio_anuncios(text, date, date, text);
drop function if exists public.relatorio_anuncios_de(uuid, text, date, date, text);

create or replace function public.relatorio_anuncios_de(p_dono uuid, p_nivel text, p_inicio date, p_fim date, p_conta text default null)
returns table (
  id text, nome text, status text, status_efetivo text, conta_id text, campanha_id text, conjunto_id text,
  orcamento_diario bigint, gasto bigint, impressoes bigint, cliques bigint, conversas_meta bigint,
  contatos bigint, pix_gerados bigint, vendas bigint, faturamento bigint, lucro bigint,
  taxas bigint, custo_produtos bigint, imposto_venda bigint, imposto_meta bigint, upsells bigint, faturamento_upsell bigint
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
    coalesce(sum(p.taxa_centavos) filter (where p.status = 'pago' and (p.pago_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim), 0) taxas,
    coalesce(sum(coalesce(pr.custo_centavos, 0)) filter (where p.status = 'pago' and (p.pago_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim), 0) custo_prod,
    count(*) filter (where p.status = 'pago' and p.tipo = 'upsell' and (p.pago_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim) upsells,
    coalesce(sum(p.valor_centavos) filter (where p.status = 'pago' and p.tipo = 'upsell' and (p.pago_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim), 0) fat_upsell
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
  round(coalesce(pg.fat, 0) - coalesce(pg.taxas, 0) - coalesce(pg.custo_prod, 0) - coalesce(pg.fat, 0) * (select iv from cfg) / 100
        - coalesce(i.gasto, 0) * (1 + (select im from cfg) / 100))::bigint,
  coalesce(pg.taxas, 0)::bigint, coalesce(pg.custo_prod, 0)::bigint,
  round(coalesce(pg.fat, 0) * (select iv from cfg) / 100)::bigint,
  round(coalesce(i.gasto, 0) * (select im from cfg) / 100)::bigint,
  coalesce(pg.upsells, 0)::bigint, coalesce(pg.fat_upsell, 0)::bigint
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
  contatos bigint, pix_gerados bigint, vendas bigint, faturamento bigint, lucro bigint,
  taxas bigint, custo_produtos bigint, imposto_venda bigint, imposto_meta bigint, upsells bigint, faturamento_upsell bigint
)
language sql stable security invoker set search_path = public as $$
  select * from public.relatorio_anuncios_de(auth.uid(), p_nivel, p_inicio, p_fim, p_conta)
$$;

grant execute on function public.relatorio_anuncios(text, date, date, text) to authenticated;
revoke execute on function public.relatorio_anuncios(text, date, date, text) from anon, public;
revoke execute on function public.relatorio_anuncios_de(uuid, text, date, date, text) from public;
