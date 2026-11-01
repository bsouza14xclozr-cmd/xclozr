-- Métricas da Visão geral (v2: gasto do Meta, impostos e custo de produto)
create or replace function public.metricas_painel(p_inicio timestamptz, p_fim timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with
eu as (select auth.uid() as id),
ct as (select * from contatos where dono_id = (select id from eu) and not simulacao),
pg as (select * from pagamentos where dono_id = (select id from eu) and not simulacao),
pagos as (select * from pg where status = 'pago' and pago_em >= p_inicio and pago_em < p_fim),
cfg as (
  select coalesce((select imposto_venda_pct from configuracoes where dono_id = (select id from eu)), 0) iv,
         coalesce((select imposto_meta_pct from configuracoes where dono_id = (select id from eu)), 0) im
),
gastos as (
  select dia, gasto_centavos from gastos_anuncio where dono_id = (select id from eu)
    and dia >= (p_inicio at time zone 'America/Sao_Paulo')::date and dia <= ((p_fim - interval '1 second') at time zone 'America/Sao_Paulo')::date
  union all
  select dia, gasto_centavos from meta_insights_dia where dono_id = (select id from eu)
    and dia >= (p_inicio at time zone 'America/Sao_Paulo')::date and dia <= ((p_fim - interval '1 second') at time zone 'America/Sao_Paulo')::date
),
msgs as (
  select m.* from mensagens m join ct on ct.id = m.contato_id
  where m.criado_em >= p_inicio and m.criado_em < p_fim
),
novos as (select * from ct where criado_em >= p_inicio and criado_em < p_fim),
abordados as (select distinct contato_id from msgs where autor = 'robo'),
resp as (
  select extract(epoch from (
    select min(r.criado_em) from mensagens r
    where r.contato_id = m.contato_id and r.autor = 'robo' and r.criado_em >= m.criado_em and r.criado_em < m.criado_em + interval '10 minutes'
  ) - m.criado_em) as seg
  from msgs m where m.autor = 'cliente'
),
dias as (
  select d::date as dia from generate_series((p_inicio at time zone 'America/Sao_Paulo')::date, ((p_fim - interval '1 second') at time zone 'America/Sao_Paulo')::date, interval '1 day') d
)
select jsonb_build_object(
  'faturamento', coalesce((select sum(valor_centavos) from pagos), 0),
  'taxas', coalesce((select sum(taxa_centavos) from pagos), 0),
  'gasto', coalesce((select sum(gasto_centavos) from gastos), 0),
  'imposto_meta', round(coalesce((select sum(gasto_centavos) from gastos), 0) * (select im from cfg) / 100)::bigint,
  'imposto_venda', round(coalesce((select sum(valor_centavos) from pagos), 0) * (select iv from cfg) / 100)::bigint,
  'custo_produtos', coalesce((select sum(pr.custo_centavos) from pagos join produtos pr on pr.id = pagos.produto_id), 0),
  'vendas', (select count(*) from pagos where tipo <> 'upsell'),
  'vendas_total', (select count(*) from pagos),
  'contatos', (select count(*) from novos),
  'ativas_hoje', (select count(*) from ct where ultima_msg_em >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'),
  'abordados', (select count(*) from abordados),
  'responderam', (select count(*) from ct join abordados a on a.contato_id = ct.id where ct.ja_respondeu),
  'tempo_resposta_seg', (select round(avg(seg))::int from resp where seg is not null),
  'msgs_enviadas', (select count(*) from msgs where autor in ('robo','humano')),
  'msgs_recebidas', (select count(*) from msgs where autor = 'cliente'),
  'funil', jsonb_build_object(
    'conversas', (select count(*) from novos),
    'pix_gerados', (select count(*) from pg where tipo <> 'upsell' and criado_em >= p_inicio and criado_em < p_fim),
    'pix_pagos', (select count(*) from pagos where tipo <> 'upsell'),
    'upsell', (select count(*) from pagos where tipo = 'upsell')
  ),
  'por_dia', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'dia', d.dia,
      'faturamento', coalesce((select sum(valor_centavos) from pagos where (pago_em at time zone 'America/Sao_Paulo')::date = d.dia), 0),
      'gasto', coalesce((select sum(gasto_centavos) from gastos where gastos.dia = d.dia), 0)
    ) order by d.dia), '[]'::jsonb) from dias d
  ),
  'por_anuncio', (
    select coalesce(jsonb_agg(jsonb_build_object('nome', r.nome, 'faturamento', r.faturamento, 'gasto', r.gasto, 'vendas', r.vendas, 'contatos', r.contatos, 'lucro', r.lucro) order by r.gasto desc), '[]'::jsonb)
    from public.relatorio_anuncios('campanha', (p_inicio at time zone 'America/Sao_Paulo')::date, ((p_fim - interval '1 second') at time zone 'America/Sao_Paulo')::date) r
    where r.gasto > 0 or r.vendas > 0 or r.contatos > 0
  )
);
$$;
grant execute on function public.metricas_painel(timestamptz, timestamptz) to authenticated;
revoke execute on function public.metricas_painel(timestamptz, timestamptz) from anon;
