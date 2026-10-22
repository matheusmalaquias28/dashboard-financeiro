-- Dashboard Financeiro · Colaboradores (recebidos por webhook de outra plataforma)
-- Só cria tabelas novas no schema "dashboard_financeiro"; não altera nada existente. Pode rodar mais de uma vez.
-- Como aplicar: Supabase > SQL Editor > colar este arquivo > Run.

-- ---------------------------------------------------------------- cadastro atual de cada colaborador
create table if not exists dashboard_financeiro.collaborators (
  id         text primary key,                    -- id da plataforma de origem (ou derivado do nome)
  data       jsonb not null,                      -- nome, cargo, e-mail, fixo/variável atuais, ativo
  name       text    generated always as (data ->> 'name') stored,
  active     boolean generated always as ((data ->> 'active')::boolean) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists collaborators_name_idx on dashboard_financeiro.collaborators (name);

-- ---------------------------------------------------------------- remuneração por competência (mês)
create table if not exists dashboard_financeiro.collaborator_pay (
  id               text primary key,              -- <colaborador>:<AAAA-MM>
  data             jsonb not null,
  collaborator_id  text    generated always as (data ->> 'collaboratorId') stored,
  competence       text    generated always as (data ->> 'competence') stored,
  fixed            numeric generated always as ((data ->> 'fixed')::numeric) stored,
  variable         numeric generated always as ((data ->> 'variable')::numeric) stored,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists collaborator_pay_competence_idx on dashboard_financeiro.collaborator_pay (competence);
create index if not exists collaborator_pay_collaborator_idx on dashboard_financeiro.collaborator_pay (collaborator_id);

-- ---------------------------------------------------------------- registro dos webhooks recebidos (auditoria)
create table if not exists dashboard_financeiro.webhook_log (
  id         text primary key,
  data       jsonb not null,                      -- origem, payload bruto, resultado
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- segurança (igual às demais tabelas do painel)
alter table dashboard_financeiro.collaborators    enable row level security;
alter table dashboard_financeiro.collaborator_pay enable row level security;
alter table dashboard_financeiro.webhook_log      enable row level security;
grant all on dashboard_financeiro.collaborators, dashboard_financeiro.collaborator_pay, dashboard_financeiro.webhook_log to service_role;
revoke all on dashboard_financeiro.collaborators, dashboard_financeiro.collaborator_pay, dashboard_financeiro.webhook_log from anon, authenticated;
