-- Disparos: filtro "veio do anúncio" (remarketing de quem chegou por um anúncio e não comprou)
-- filtro.anuncios = lista de ids de anúncio do Meta (contatos.meta_ad_id)
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
    and (coalesce(jsonb_array_length(f->'anuncios'), 0) = 0 or c.meta_ad_id in (select jsonb_array_elements_text(f->'anuncios')))
$$;

-- o painel usa para saber que o filtro por anúncio já existe no banco
create or replace function public.disparos_recursos()
returns jsonb language sql stable security invoker set search_path = public as $$
  select '{"anuncios": true}'::jsonb
$$;
grant execute on function public.disparos_recursos() to authenticated;
revoke execute on function public.disparos_recursos() from anon;
