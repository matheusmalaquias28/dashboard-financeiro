-- Dashboard Financeiro · Scale Company
-- Tudo deste painel fica no schema próprio "dashboard_financeiro", separado das tabelas de outros projetos
-- que usam o mesmo Supabase. Pode rodar mais de uma vez (idempotente).
--
-- Como aplicar: Supabase > SQL Editor > colar este arquivo > Run.
-- Depois: Project Settings > Data API > Exposed schemas > adicionar "dashboard_financeiro".

create schema if not exists dashboard_financeiro;

-- ---------------------------------------------------------------- cobranças do checkout (links InfinitePay)
create table if not exists dashboard_financeiro.checkout_charges (
  id            text primary key,                 -- também é o order_nsu enviado à InfinitePay
  data          jsonb not null,                   -- cobrança completa (itens, cliente, taxas, pagamento)
  seller        text   generated always as (data ->> 'seller') stored,
  status        text   generated always as (data ->> 'status') stored,
  customer_name text   generated always as (data -> 'customer' ->> 'name') stored,
  total_cents   bigint generated always as ((data ->> 'total')::bigint) stored,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists checkout_charges_seller_idx  on dashboard_financeiro.checkout_charges (seller);
create index if not exists checkout_charges_status_idx  on dashboard_financeiro.checkout_charges (status);
create index if not exists checkout_charges_created_idx on dashboard_financeiro.checkout_charges (created_at desc);

-- ---------------------------------------------------------------- configuração do checkout (taxas e catálogo)
create table if not exists dashboard_financeiro.checkout_config (
  id         text primary key,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- vendas InfinitePay recebidas por webhook
create table if not exists dashboard_financeiro.infinitepay_sales (
  id         text primary key,                    -- ip_<transaction_nsu>
  data       jsonb not null,
  paid_date  text    generated always as (data ->> 'paidDate') stored,
  method     text    generated always as (data ->> 'method') stored,
  amount     numeric generated always as ((data ->> 'amount')::numeric) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists infinitepay_sales_paid_idx on dashboard_financeiro.infinitepay_sales (paid_date);

-- ---------------------------------------------------------------- cache das APIs externas (ex.: Asaas)
create table if not exists dashboard_financeiro.cache (
  key        text primary key,
  value      jsonb not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index if not exists cache_expires_idx on dashboard_financeiro.cache (expires_at);

-- ---------------------------------------------------------------- contadores (versão do painel, muda a cada webhook)
create table if not exists dashboard_financeiro.counters (
  key   text primary key,
  value bigint not null default 0
);

create or replace function dashboard_financeiro.bump_counter(counter_key text)
returns bigint
language sql
as $$
  insert into dashboard_financeiro.counters as c (key, value) values (counter_key, 1)
  on conflict (key) do update set value = c.value + 1
  returning value;
$$;

-- ---------------------------------------------------------------- segurança
-- RLS ligado e nenhuma política: só a chave service_role (usada pelo servidor do painel) acessa.
-- As chaves anon/authenticated do outro projeto não enxergam nada deste schema.
alter table dashboard_financeiro.checkout_charges  enable row level security;
alter table dashboard_financeiro.checkout_config   enable row level security;
alter table dashboard_financeiro.infinitepay_sales enable row level security;
alter table dashboard_financeiro.cache             enable row level security;
alter table dashboard_financeiro.counters          enable row level security;

revoke all on schema dashboard_financeiro from anon, authenticated;
grant usage on schema dashboard_financeiro to service_role;
grant all on all tables in schema dashboard_financeiro to service_role;
grant execute on function dashboard_financeiro.bump_counter(text) to service_role;
revoke execute on function dashboard_financeiro.bump_counter(text) from public, anon, authenticated;
alter default privileges in schema dashboard_financeiro grant all on tables to service_role;
