-- Endereço próprio da API de IA (gateway compatível com Claude/OpenAI). Vazio = API oficial.
alter table public.ia_config add column if not exists endereco text;
grant select (endereco) on public.ia_config to authenticated;
