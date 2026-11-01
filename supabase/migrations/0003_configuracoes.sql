-- XClozr — configurações da conta (gateway de Pix e taxas para o cálculo do lucro)
-- As credenciais do gateway (token) NÃO ficam aqui: vão para o servidor do robô na VPS.

create table public.configuracoes (
  dono_id               uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  gateway               text check (gateway in ('mercadopago', 'asaas', 'efi', 'pagbank', 'outro')),
  taxa_percentual       numeric(5,2) not null default 0,   -- ex.: 0.99 = 0,99% por Pix
  taxa_fixa_centavos    integer not null default 0,         -- ex.: 50 = R$ 0,50 por Pix
  atualizado_em         timestamptz not null default now()
);

alter table public.configuracoes enable row level security;
create policy "dono acessa" on public.configuracoes for all to authenticated
  using (dono_id = auth.uid()) with check (dono_id = auth.uid());

create trigger configuracoes_atualizado_em before update on public.configuracoes
  for each row execute function public.tocar_atualizado_em();

-- Produtos: descrição curta (usada nas mensagens e pela IA)
alter table public.produtos add column descricao text;
