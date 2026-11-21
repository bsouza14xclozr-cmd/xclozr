-- PDFs de produto maiores: bucket de mídias aceita até 50 MB (limite do plano) e e-books
update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = array_append(array_remove(allowed_mime_types, 'application/epub+zip'), 'application/epub+zip')
where id = 'midias';
