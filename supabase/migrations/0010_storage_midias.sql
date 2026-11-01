-- Bucket público para as mídias dos funis (imagem, vídeo, áudio, arquivo). Cada dono só envia na própria pasta.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('midias', 'midias', true, 16777216, array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/3gpp','video/quicktime','audio/mpeg','audio/mp3','audio/ogg','audio/mp4','audio/aac','audio/wav','audio/x-m4a','audio/webm','application/pdf','application/zip','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "midias: dono envia" on storage.objects for insert to authenticated
  with check (bucket_id = 'midias' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "midias: dono atualiza" on storage.objects for update to authenticated
  using (bucket_id = 'midias' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "midias: dono apaga" on storage.objects for delete to authenticated
  using (bucket_id = 'midias' and (storage.foldername(name))[1] = auth.uid()::text);
