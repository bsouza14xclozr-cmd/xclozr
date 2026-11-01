-- XClozr — CRM: Kanban, etiquetas, campos personalizados
-- O motor do robô move os contatos de coluna sozinho quando um "evento" acontece
-- (novo contato, Pix gerado, pagou…) e o painel recebe tudo em tempo real.

create table public.kanban_colunas (
  id          uuid primary key default gen_random_uuid(),
  dono_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome        text not null,
  cor         text not null default '#6cb4ff',
  ordem       integer not null default 0,
  evento      text check (evento in ('novo_contato', 'respondeu', 'pix_gerado', 'pagou', 'pix_expirou', 'upsell_aceito', 'humano')),
  criado_em   timestamptz not null default now()
);
-- cada evento leva para no máximo uma coluna
create unique index kanban_colunas_evento_unico on public.kanban_colunas (dono_id, evento) where evento is not null;

create table public.etiquetas (
  id          uuid primary key default gen_random_uuid(),
  dono_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome        text not null,
  cor         text not null default '#6cb4ff',
  criado_em   timestamptz not null default now(),
  unique (dono_id, nome)
);

create table public.campos_personalizados (
  id          uuid primary key default gen_random_uuid(),
  dono_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  chave       text not null check (chave ~ '^[a-z0-9_]+$'),
  rotulo      text not null,
  tipo        text not null default 'texto' check (tipo in ('texto', 'numero', 'email', 'data')),
  criado_em   timestamptz not null default now(),
  unique (dono_id, chave)
);

alter table public.contatos add column kanban_coluna_id uuid references public.kanban_colunas(id) on delete set null;
alter table public.contatos add column notas text;
alter table public.contatos add column atualizado_em timestamptz not null default now();

create trigger contatos_atualizado_em before update on public.contatos
  for each row execute function public.tocar_atualizado_em();

alter table public.kanban_colunas enable row level security;
alter table public.etiquetas enable row level security;
alter table public.campos_personalizados enable row level security;

create policy "dono acessa" on public.kanban_colunas for all to authenticated
  using (dono_id = auth.uid()) with check (dono_id = auth.uid());
create policy "dono acessa" on public.etiquetas for all to authenticated
  using (dono_id = auth.uid()) with check (dono_id = auth.uid());
create policy "dono acessa" on public.campos_personalizados for all to authenticated
  using (dono_id = auth.uid()) with check (dono_id = auth.uid());

-- tempo real: o painel recebe na hora quando um contato muda (coluna, etiquetas, campos)
alter publication supabase_realtime add table public.contatos;
