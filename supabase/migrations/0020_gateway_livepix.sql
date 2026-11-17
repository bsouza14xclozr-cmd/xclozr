-- ============================================================
-- Gateway LivePix (link de pagamento Pix). Credenciais e token de acesso ficam só no servidor.
-- ============================================================
alter table public.gateway_config drop constraint if exists gateway_config_gateway_check;
alter table public.gateway_config add constraint gateway_config_gateway_check check (gateway in ('pagbank', 'livepix'));

-- token OAuth reaproveitado até expirar (a LivePix monitora emissão excessiva)
alter table public.gateway_config add column if not exists acesso_token text;
alter table public.gateway_config add column if not exists acesso_expira timestamptz;
-- (sem grant para authenticated: o navegador nunca lê essas colunas)

alter table public.configuracoes drop constraint if exists configuracoes_gateway_check;
alter table public.configuracoes add constraint configuracoes_gateway_check
  check (gateway in ('mercadopago', 'asaas', 'efi', 'pagbank', 'livepix', 'outro'));

drop index if exists public.pagamentos_verificar;
create index if not exists pagamentos_verificar on public.pagamentos (verificar_em)
  where status = 'pendente' and gateway in ('pagbank', 'livepix');
