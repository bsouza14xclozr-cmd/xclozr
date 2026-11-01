-- XClozr — funis de venda (editor visual)
-- O desenho do funil (blocos + ligações) fica num JSON em "grafo".

create table public.funis (
  id             uuid primary key default gen_random_uuid(),
  dono_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome           text not null,
  ativo          boolean not null default false,
  padrao         boolean not null default false,   -- funil usado quando o contato não veio de um anúncio com funil próprio
  grafo          jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

-- Cada anúncio pode abrir um funil próprio
alter table public.anuncios add column funil_id uuid references public.funis(id) on delete set null;

-- Em que bloco do funil cada contato está
alter table public.contatos add column funil_id uuid references public.funis(id) on delete set null;
alter table public.contatos add column bloco_atual text;
alter table public.contatos add column campos jsonb not null default '{}'::jsonb;   -- respostas salvas pelas perguntas
alter table public.contatos add column etiquetas text[] not null default '{}';

-- Quantas vezes cada bloco foi executado (métricas do funil)
create table public.execucoes_bloco (
  id          uuid primary key default gen_random_uuid(),
  dono_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  funil_id    uuid not null references public.funis(id) on delete cascade,
  bloco_id    text not null,
  contato_id  uuid references public.contatos(id) on delete cascade,
  saida       text,
  criado_em   timestamptz not null default now()
);
create index execucoes_bloco_funil_idx on public.execucoes_bloco (funil_id, bloco_id);

alter table public.funis enable row level security;
alter table public.execucoes_bloco enable row level security;

create policy "dono acessa" on public.funis for all to authenticated
  using (dono_id = auth.uid()) with check (dono_id = auth.uid());
create policy "dono acessa" on public.execucoes_bloco for all to authenticated
  using (dono_id = auth.uid()) with check (dono_id = auth.uid());

-- atualizado_em automático
create or replace function public.tocar_atualizado_em() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.atualizado_em = now();
  return new;
end $$;

create trigger funis_atualizado_em before update on public.funis
  for each row execute function public.tocar_atualizado_em();
