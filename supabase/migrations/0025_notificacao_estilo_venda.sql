-- Notificações de venda no estilo "Venda aprovada! / Valor líquido: R$ X" + parabéns por marcos do dia
alter table public.avisos add column if not exists push_titulo text;
alter table public.avisos add column if not exists push_corpo text;

create or replace function public.brl_txt(c bigint) returns text
language sql immutable set search_path = '' as $$
  select 'R$ ' || translate(to_char(c / 100.0, 'FM999,999,990.00'), ',.', '.,')
$$;

create or replace function public.aviso_pagamento() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_nome text;
  v_liquido bigint;
  v_inicio timestamptz;
  v_antes bigint;
  v_depois bigint;
  v_marco bigint;
  v_hora int;
begin
  if new.status = 'pago' and old.status is distinct from 'pago' and not new.simulacao then
    select coalesce(nullif(c.nome, ''), c.telefone) into v_nome from contatos c where c.id = new.contato_id;
    v_liquido := greatest(new.valor_centavos - coalesce(new.taxa_centavos, 0), 0);
    insert into avisos (dono_id, contato_id, tipo, texto, link, push_titulo, push_corpo)
    values (new.dono_id, new.contato_id, 'venda',
      format('Venda%s de %s paga por %s 💰', case when new.tipo = 'upsell' then ' (upsell)' else '' end, brl_txt(new.valor_centavos), coalesce(v_nome, 'cliente')),
      '/conversas',
      'Venda aprovada!',
      'Valor líquido: ' || brl_txt(v_liquido));

    -- marcos do dia (horário de Brasília): R$ 100, 250, 500, 1 mil, 2,5 mil, 5 mil, 10 mil, 25 mil, 50 mil, 100 mil
    v_inicio := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
    select coalesce(sum(greatest(valor_centavos - coalesce(taxa_centavos, 0), 0)), 0) into v_depois
      from pagamentos where dono_id = new.dono_id and status = 'pago' and not simulacao and pago_em >= v_inicio;
    v_antes := v_depois - v_liquido;
    select max(m) into v_marco from unnest(array[10000, 25000, 50000, 100000, 250000, 500000, 1000000, 2500000, 5000000, 10000000]::bigint[]) m
      where v_antes < m and v_depois >= m;
    if v_marco is not null then
      v_hora := extract(hour from now() at time zone 'America/Sao_Paulo');
      insert into avisos (dono_id, tipo, texto, link, push_titulo, push_corpo)
      values (new.dono_id, 'venda',
        format('Parabéns! Hoje você já faturou %s líquido 🎉', brl_txt(v_depois)),
        '/',
        'Parabéns! 🎉',
        case when v_hora < 12 then format('O dia mal começou e você já faturou %s!', brl_txt(v_depois))
             else format('Hoje você já faturou %s! Bora pra cima 🚀', brl_txt(v_depois)) end);
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.aviso_pagamento() from public, anon, authenticated;
