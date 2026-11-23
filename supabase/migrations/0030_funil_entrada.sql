-- Regras de entrada: qual funil atende cada conversa nova (por campanha/anúncio do Meta ou palavras da 1ª mensagem)
alter table public.funis add column if not exists entrada jsonb not null default '{}'::jsonb;
comment on column public.funis.entrada is '{"campanhas": [ids], "anuncios": [ids], "palavras": "enem, prova"}';
