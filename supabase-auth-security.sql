-- Rode este SQL no Supabase depois de criar os usuarios em Authentication.
-- Ele remove o acesso publico e permite ler/salvar apenas para usuarios logados.

alter table dashboard_data enable row level security;

drop policy if exists "Permitir leitura publica" on dashboard_data;
drop policy if exists "Permitir edicao publica" on dashboard_data;
drop policy if exists "Permitir criacao publica" on dashboard_data;
drop policy if exists "Permitir leitura autenticada" on dashboard_data;
drop policy if exists "Permitir edicao autenticada" on dashboard_data;
drop policy if exists "Permitir criacao autenticada" on dashboard_data;

create policy "Permitir leitura autenticada"
on dashboard_data
for select
to authenticated
using (true);

create policy "Permitir edicao autenticada"
on dashboard_data
for update
to authenticated
using (true)
with check (true);

create policy "Permitir criacao autenticada"
on dashboard_data
for insert
to authenticated
with check (true);
