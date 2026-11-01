-- permite o status "conectando" (aguardando leitura do QR)
alter table public.numeros drop constraint numeros_status_check;
alter table public.numeros add constraint numeros_status_check check (status = any (array['conectado','conectando','desconectado','aquecendo','banido']));
