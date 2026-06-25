-- ============================================================
-- Escola Segura — Painel administrativo (Auth + RLS) + email_logs
-- Aplicar após 001_escola_segura_init.sql
-- ============================================================

-- Allowlist de administradores (vinculada ao auth.users do Supabase Auth)
create table if not exists escola_segura.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);
alter table escola_segura.admins enable row level security; -- sem policies = ninguém lê via API

-- helper: o usuário logado é admin? (SECURITY DEFINER p/ ler a allowlist ignorando RLS)
create or replace function escola_segura.is_admin()
returns boolean language sql stable security definer
set search_path = escola_segura, public as $$
  select exists (select 1 from escola_segura.admins a where a.user_id = auth.uid());
$$;
revoke all on function escola_segura.is_admin() from public;
grant execute on function escola_segura.is_admin() to authenticated;

-- LOG de e-mails (Resend)
create table if not exists escola_segura.email_logs (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid references escola_segura.orders(id) on delete set null,
  to_email    text not null,
  template    text not null check (template in ('payment_approved','label_created','shipped','delivered')),
  subject     text,
  provider_id text,                 -- id retornado pelo Resend
  status      text not null default 'sent' check (status in ('sent','failed')),
  error       text,
  created_at  timestamptz not null default now()
);
create index if not exists email_logs_order_idx on escola_segura.email_logs(order_id);
alter table escola_segura.email_logs enable row level security;

-- ============================================================
-- POLICIES: somente admins acessam dados sensíveis pela Data API
-- (products mantém leitura pública para o catálogo da landing)
-- ============================================================
drop policy if exists orders_admin     on escola_segura.orders;
drop policy if exists customers_admin   on escola_segura.customers;
drop policy if exists quotes_admin      on escola_segura.shipping_quotes;
drop policy if exists tracking_admin    on escola_segura.tracking;
drop policy if exists email_logs_admin  on escola_segura.email_logs;
drop policy if exists products_admin_w  on escola_segura.products;

create policy orders_admin    on escola_segura.orders          for all to authenticated using (escola_segura.is_admin()) with check (escola_segura.is_admin());
create policy customers_admin on escola_segura.customers       for all to authenticated using (escola_segura.is_admin()) with check (escola_segura.is_admin());
create policy quotes_admin    on escola_segura.shipping_quotes for all to authenticated using (escola_segura.is_admin()) with check (escola_segura.is_admin());
create policy tracking_admin  on escola_segura.tracking        for all to authenticated using (escola_segura.is_admin()) with check (escola_segura.is_admin());
create policy email_logs_admin on escola_segura.email_logs     for all to authenticated using (escola_segura.is_admin()) with check (escola_segura.is_admin());
-- products: admin pode editar (a policy products_read pública continua valendo p/ select)
create policy products_admin_w on escola_segura.products       for all to authenticated using (escola_segura.is_admin()) with check (escola_segura.is_admin());

-- ============================================================
-- Expor o schema escola_segura na Data API e conceder grants
-- (a RLS acima é quem realmente protege as linhas)
-- ============================================================
grant usage on schema escola_segura to anon, authenticated;
grant select on escola_segura.products to anon, authenticated;
grant select, insert, update, delete on
  escola_segura.orders, escola_segura.customers, escola_segura.shipping_quotes,
  escola_segura.tracking, escola_segura.email_logs to authenticated;

-- IMPORTANTE: no Dashboard > Project Settings > API > "Exposed schemas",
-- adicione "escola_segura". Depois rode:  notify pgrst, 'reload schema';

-- ============================================================
-- Cadastrar um admin (após criar o usuário em Authentication > Users):
--   insert into escola_segura.admins (user_id, email)
--   select id, email from auth.users where email = 'voce@seudominio.com.br';
-- ============================================================
