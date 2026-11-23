-- Cache de prompt da IA: quanto veio do cache (mais barato) e quanto foi gravado nele
alter table public.ia_uso add column if not exists tokens_cache_leitura int not null default 0;
alter table public.ia_uso add column if not exists tokens_cache_escrita int not null default 0;
