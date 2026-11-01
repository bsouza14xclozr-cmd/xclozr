-- Avisos do painel (sininho): tipo, link, realtime e avisos automáticos
alter table public.avisos add column if not exists tipo text not null default 'info';
alter table public.avisos add column if not exists link text;
create index if not exists avisos_dono_lido on public.avisos (dono_id, lido, criado_em desc);
alter publication supabase_realtime add table public.avisos;

-- Chip caiu / voltou
create or replace function public.aviso_status_numero() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if old.status = 'conectado' and new.status = 'desconectado' then
      insert into avisos (dono_id, tipo, texto, link)
      values (new.dono_id, 'chip', format('O chip "%s" desconectou. O robô parou de responder nele: leia o QR de novo em Números.', new.nome), '/numeros');
    elsif new.status = 'banido' then
      insert into avisos (dono_id, tipo, texto, link)
      values (new.dono_id, 'chip', format('O chip "%s" foi marcado como banido.', new.nome), '/numeros');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists numeros_aviso_status on public.numeros;
create trigger numeros_aviso_status after update of status on public.numeros
  for each row execute function public.aviso_status_numero();

-- Venda paga
create or replace function public.aviso_pagamento() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_nome text;
begin
  if new.status = 'pago' and old.status is distinct from 'pago' and not new.simulacao then
    select coalesce(nullif(c.nome, ''), c.telefone) into v_nome from contatos c where c.id = new.contato_id;
    insert into avisos (dono_id, contato_id, tipo, texto, link)
    values (new.dono_id, new.contato_id, 'venda',
      format('Venda%s de %s paga por %s 💰', case when new.tipo = 'upsell' then ' (upsell)' else '' end,
        'R$ ' || translate(to_char(new.valor_centavos / 100.0, 'FM999,999,990.00'), ',.', '.,'), coalesce(v_nome, 'cliente')),
      '/conversas');
  end if;
  return new;
end $$;
drop trigger if exists pagamentos_aviso on public.pagamentos;
create trigger pagamentos_aviso after update of status on public.pagamentos
  for each row execute function public.aviso_pagamento();

-- Avisos que o motor grava: humano / bloco sem configuração → tipo pela mensagem
create or replace function public.aviso_classificar() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.tipo = 'info' then
    if new.texto ilike '%humano%' then
      new.tipo := 'humano';
      new.link := coalesce(new.link, '/conversas');
    elsif new.texto ilike '%bloco%' or new.texto ilike '%funil%' then
      new.tipo := 'funil';
      new.link := coalesce(new.link, '/funil');
    elsif new.contato_id is not null then
      new.link := coalesce(new.link, '/conversas');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists avisos_classificar on public.avisos;
create trigger avisos_classificar before insert on public.avisos
  for each row execute function public.aviso_classificar();

revoke execute on function public.aviso_status_numero() from public, anon, authenticated;
revoke execute on function public.aviso_pagamento() from public, anon, authenticated;
revoke execute on function public.aviso_classificar() from public, anon, authenticated;
