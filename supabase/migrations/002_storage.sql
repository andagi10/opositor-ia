-- =====================================================================
-- Storage: bucket privado "documentos". Cada usuario solo accede a {su_uid}/...
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('documentos', 'documentos', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "docs_select_propios" on storage.objects;
drop policy if exists "docs_insert_propios" on storage.objects;
drop policy if exists "docs_update_propios" on storage.objects;
drop policy if exists "docs_delete_propios" on storage.objects;

create policy "docs_select_propios" on storage.objects for select to authenticated
  using (bucket_id = 'documentos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "docs_insert_propios" on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "docs_update_propios" on storage.objects for update to authenticated
  using (bucket_id = 'documentos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "docs_delete_propios" on storage.objects for delete to authenticated
  using (bucket_id = 'documentos' and (storage.foldername(name))[1] = auth.uid()::text);
