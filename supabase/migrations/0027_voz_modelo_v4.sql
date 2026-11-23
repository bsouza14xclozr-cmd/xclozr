-- Voz clonada: opção "natural" (Eleven v4, com etiquetas de emoção)
do $$
declare c text;
begin
  select conname into c from pg_constraint where conrelid = 'public.voz_config'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%modelo%';
  if c is not null then execute format('alter table public.voz_config drop constraint %I', c); end if;
end $$;
alter table public.voz_config add constraint voz_config_modelo_check check (modelo in ('natural', 'qualidade', 'economia'));
