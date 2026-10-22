-- Dashboard Financeiro · Agente de e-mails (Gmail)
-- Só cria tabelas novas no schema "dashboard_financeiro"; não altera nada existente. Pode rodar mais de uma vez.
-- Como aplicar: Supabase > SQL Editor > colar este arquivo > Run.

-- ---------------------------------------------------------------- conta do Gmail conectada
-- O refresh token do Google fica CRIPTOGRAFADO (AES-256-GCM) com a chave GMAIL_TOKEN_KEY do servidor.
create table if not exists dashboard_financeiro.gmail_accounts (
  id         text primary key,                    -- e-mail da conta
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- e-mails lidos e analisados
create table if not exists dashboard_financeiro.gmail_messages (
  id          text primary key,                   -- id da mensagem no Gmail
  data        jsonb not null,                     -- remetente, assunto, análise da IA, sinais de golpe, status
  category    text    generated always as (data ->> 'category') stored,
  suspicious  boolean generated always as ((data ->> 'suspicious')::boolean) stored,
  status      text    generated always as (data ->> 'status') stored,
  amount      numeric generated always as ((data ->> 'amount')::numeric) stored,
  due_date    text    generated always as (data ->> 'dueDate') stored,
  received_at text    generated always as (data ->> 'receivedAt') stored,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists gmail_messages_category_idx on dashboard_financeiro.gmail_messages (category);
create index if not exists gmail_messages_received_idx on dashboard_financeiro.gmail_messages (received_at desc);

-- ---------------------------------------------------------------- segurança
alter table dashboard_financeiro.gmail_accounts enable row level security;
alter table dashboard_financeiro.gmail_messages enable row level security;
grant all on dashboard_financeiro.gmail_accounts, dashboard_financeiro.gmail_messages to service_role;
revoke all on dashboard_financeiro.gmail_accounts from anon, authenticated;     -- tokens: só o servidor
revoke all on dashboard_financeiro.gmail_messages from anon;
grant select, update on dashboard_financeiro.gmail_messages to authenticated;

drop policy if exists gmail_messages_select on dashboard_financeiro.gmail_messages;
create policy gmail_messages_select on dashboard_financeiro.gmail_messages for select to authenticated
  using (dashboard_financeiro.member_role() = 'admin');

drop policy if exists gmail_messages_update on dashboard_financeiro.gmail_messages;
create policy gmail_messages_update on dashboard_financeiro.gmail_messages for update to authenticated
  using (dashboard_financeiro.member_role() = 'admin')
  with check (dashboard_financeiro.member_role() = 'admin');
