-- Robô pausado porque você respondeu pelo celular: volta sozinho depois de um tempo (null = pausa definitiva)
alter table public.contatos add column if not exists robo_retomar_em timestamptz;
create index if not exists contatos_robo_retomar on public.contatos (robo_retomar_em) where robo_retomar_em is not null;
