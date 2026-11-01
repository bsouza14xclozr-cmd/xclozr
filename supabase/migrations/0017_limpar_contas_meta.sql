-- ============================================================
-- Ao desmarcar contas de anúncio (ou desconectar o Meta), apaga os dados
-- das contas que saíram — assim o relatório só mostra as contas escolhidas.
-- ============================================================
create or replace function public.limpar_contas_meta()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  manter text[] := case when tg_op = 'DELETE' then '{}'::text[] else coalesce(new.contas, '{}') end;
begin
  delete from meta_insights_dia where dono_id = old.dono_id and not (conta_id = any(manter));
  delete from meta_anuncios     where dono_id = old.dono_id and not (conta_id = any(manter));
  delete from meta_conjuntos    where dono_id = old.dono_id and not (conta_id = any(manter));
  delete from meta_campanhas    where dono_id = old.dono_id and not (conta_id = any(manter));
  return null;
end $$;
revoke execute on function public.limpar_contas_meta() from public, anon, authenticated;

drop trigger if exists limpar_contas_meta_upd on public.meta_config;
create trigger limpar_contas_meta_upd after update of contas on public.meta_config
  for each row when (old.contas is distinct from new.contas) execute function public.limpar_contas_meta();

drop trigger if exists limpar_contas_meta_del on public.meta_config;
create trigger limpar_contas_meta_del after delete on public.meta_config
  for each row execute function public.limpar_contas_meta();

-- limpeza do que já ficou sobrando
delete from public.meta_insights_dia i using public.meta_config c where i.dono_id = c.dono_id and not (i.conta_id = any(c.contas));
delete from public.meta_anuncios a     using public.meta_config c where a.dono_id = c.dono_id and not (a.conta_id = any(c.contas));
delete from public.meta_conjuntos s    using public.meta_config c where s.dono_id = c.dono_id and not (s.conta_id = any(c.contas));
delete from public.meta_campanhas m    using public.meta_config c where m.dono_id = c.dono_id and not (m.conta_id = any(c.contas));
