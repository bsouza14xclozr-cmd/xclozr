-- Conversas ao vivo no painel
alter publication supabase_realtime add table public.mensagens;
create index if not exists mensagens_contato_criado on public.mensagens (contato_id, criado_em);
