-- Notificação de lead novo: vem ligada para contas novas e para quem já tinha as preferências salvas
alter table public.notif_prefs alter column tipos set default array['venda','lead','chip','humano','funil','trafego','resumo','info'];
update public.notif_prefs set tipos = array_append(tipos, 'lead') where not ('lead' = any(tipos));
