-- Gateway Asaas (QR Code Pix de uso único). A chave de API fica só no servidor.
alter table public.gateway_config drop constraint if exists gateway_config_gateway_check;
alter table public.gateway_config add constraint gateway_config_gateway_check check (gateway in ('pagbank', 'livepix', 'asaas'));
alter table public.gateway_config add column if not exists chave_pix text;  -- chave Pix que recebe (sem grant para o navegador)
drop index if exists public.pagamentos_verificar;
create index if not exists pagamentos_verificar on public.pagamentos (verificar_em)
  where status = 'pendente' and gateway in ('pagbank', 'livepix', 'asaas');
