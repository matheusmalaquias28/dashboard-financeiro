-- Dashboard Financeiro · Login com Supabase Auth + RLS
--
-- O Supabase Auth deste projeto é compartilhado com outra aplicação. Por isso ter conta NÃO basta:
-- só entra no painel quem estiver na tabela dashboard_financeiro.members (ativo), com o papel
-- 'admin' (painel financeiro, checkout completo, colaboradores) ou 'seller' (só o checkout, só as
-- próprias cobranças). As políticas de RLS abaixo aplicam essas regras no próprio banco.
--
-- Só mexe no schema "dashboard_financeiro"; não altera auth.users nem nada da outra aplicação.
-- Como aplicar: Supabase > SQL Editor > colar este arquivo > Run. Pode rodar mais de uma vez.

-- ---------------------------------------------------------------- membros do painel
create table if not exists dashboard_financeiro.members (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text,
  name       text not null,
  role       text not null check (role in ('admin', 'seller')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table dashboard_financeiro.members enable row level security;

-- papel de quem está logado (null = não é membro ativo). security definer: lê members sem depender do RLS dela.
create or replace function dashboard_financeiro.member_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from dashboard_financeiro.members m where m.user_id = auth.uid() and m.active;
$$;
revoke execute on function dashboard_financeiro.member_role() from public, anon;
grant execute on function dashboard_financeiro.member_role() to authenticated, service_role;

-- vendedor da cobrança (id do usuário) em coluna própria, para a política e para relatórios
alter table dashboard_financeiro.checkout_charges
  add column if not exists seller_id text generated always as (data ->> 'sellerId') stored;
create index if not exists checkout_charges_seller_id_idx on dashboard_financeiro.checkout_charges (seller_id);

-- ---------------------------------------------------------------- acesso do papel "authenticated"
-- O papel existe para TODOS os usuários do Supabase (inclusive os da outra aplicação); quem não é membro
-- passa nas permissões abaixo mas não enxerga nenhuma linha, porque toda política exige member_role().
grant usage on schema dashboard_financeiro to authenticated;
grant select on dashboard_financeiro.members, dashboard_financeiro.checkout_charges, dashboard_financeiro.checkout_config,
  dashboard_financeiro.infinitepay_sales, dashboard_financeiro.collaborators, dashboard_financeiro.collaborator_pay,
  dashboard_financeiro.webhook_log to authenticated;
grant insert, update on dashboard_financeiro.checkout_charges, dashboard_financeiro.checkout_config to authenticated;
-- cache e contadores continuam só com o servidor (service_role)
revoke all on dashboard_financeiro.cache, dashboard_financeiro.counters from authenticated;

-- ---------------------------------------------------------------- políticas
drop policy if exists members_select on dashboard_financeiro.members;
create policy members_select on dashboard_financeiro.members for select to authenticated
  using (user_id = auth.uid() or dashboard_financeiro.member_role() = 'admin');

drop policy if exists charges_select on dashboard_financeiro.checkout_charges;
create policy charges_select on dashboard_financeiro.checkout_charges for select to authenticated
  using (dashboard_financeiro.member_role() = 'admin'
         or (dashboard_financeiro.member_role() = 'seller' and seller_id = auth.uid()::text));

drop policy if exists charges_insert on dashboard_financeiro.checkout_charges;
create policy charges_insert on dashboard_financeiro.checkout_charges for insert to authenticated
  with check (dashboard_financeiro.member_role() = 'admin'
              or (dashboard_financeiro.member_role() = 'seller' and data ->> 'sellerId' = auth.uid()::text));

drop policy if exists charges_update on dashboard_financeiro.checkout_charges;
create policy charges_update on dashboard_financeiro.checkout_charges for update to authenticated
  using (dashboard_financeiro.member_role() = 'admin')
  with check (dashboard_financeiro.member_role() = 'admin');

drop policy if exists config_select on dashboard_financeiro.checkout_config;
create policy config_select on dashboard_financeiro.checkout_config for select to authenticated
  using (dashboard_financeiro.member_role() is not null);

drop policy if exists config_insert on dashboard_financeiro.checkout_config;
create policy config_insert on dashboard_financeiro.checkout_config for insert to authenticated
  with check (dashboard_financeiro.member_role() = 'admin');

drop policy if exists config_update on dashboard_financeiro.checkout_config;
create policy config_update on dashboard_financeiro.checkout_config for update to authenticated
  using (dashboard_financeiro.member_role() = 'admin')
  with check (dashboard_financeiro.member_role() = 'admin');

drop policy if exists sales_select on dashboard_financeiro.infinitepay_sales;
create policy sales_select on dashboard_financeiro.infinitepay_sales for select to authenticated
  using (dashboard_financeiro.member_role() = 'admin');

drop policy if exists collaborators_select on dashboard_financeiro.collaborators;
create policy collaborators_select on dashboard_financeiro.collaborators for select to authenticated
  using (dashboard_financeiro.member_role() = 'admin');

drop policy if exists collaborator_pay_select on dashboard_financeiro.collaborator_pay;
create policy collaborator_pay_select on dashboard_financeiro.collaborator_pay for select to authenticated
  using (dashboard_financeiro.member_role() = 'admin');

drop policy if exists webhook_log_select on dashboard_financeiro.webhook_log;
create policy webhook_log_select on dashboard_financeiro.webhook_log for select to authenticated
  using (dashboard_financeiro.member_role() = 'admin');

-- ---------------------------------------------------------------- como dar acesso a alguém
-- 1) Crie o usuário em Authentication > Users > Add user (e-mail + senha, marque "Auto Confirm User").
-- 2) Rode, trocando e-mail, nome e papel ('admin' ou 'seller'):
--
--   insert into dashboard_financeiro.members (user_id, email, name, role)
--   select id, email, 'Seu Nome', 'admin' from auth.users where email = 'voce@scalecompany.com.br'
--   on conflict (user_id) do update set name = excluded.name, role = excluded.role, active = true;
--
-- Para tirar o acesso: update dashboard_financeiro.members set active = false where email = '...';
