-- Trava do robô por número: com robo_ligado = false o chip só registra as conversas.
alter table public.numeros add column if not exists robo_ligado boolean not null default true;
-- Realtime para a tela Números atualizar sozinha quando o chip conecta/cai
alter publication supabase_realtime add table public.numeros;
