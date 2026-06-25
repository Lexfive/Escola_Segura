-- ============================================================
-- Escola Segura — schema de loja (isolado do Samantha)
-- Aplicar:  supabase db push   (ou cole no SQL Editor do painel)
-- ============================================================
create schema if not exists escola_segura;

-- PRODUCTS
create table if not exists escola_segura.products (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,
  name            text not null,
  type            text not null check (type in ('pdf','fisico','combo')),
  price_cents     integer not null,
  requires_shipping boolean not null default false,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

-- número de pedido curto e amigável (#1248) para o "Acompanhar pedido"
create sequence if not exists escola_segura.order_number_seq start 1248;

-- CUSTOMERS
create table if not exists escola_segura.customers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null unique,   -- chave do cliente (sem login)
  phone       text,                   -- WhatsApp
  cpf         text,                   -- opcional: só para etiqueta/nota fiscal
  created_at  timestamptz not null default now()
);

-- ORDERS
create table if not exists escola_segura.orders (
  id                uuid primary key default gen_random_uuid(),
  number            integer not null default nextval('escola_segura.order_number_seq'),
  customer_id       uuid references escola_segura.customers(id) on delete set null,
  product_id        uuid references escola_segura.products(id),
  qty               integer not null default 1,
  product_cents     integer not null,
  shipping_cents    integer not null default 0,
  total_cents       integer not null,
  shipping_carrier  text,
  shipping_days     integer,
  -- pending -> paid -> labeled -> shipped -> delivered
  status            text not null default 'pending'
                    check (status in ('pending','paid','labeled','shipped','delivered','canceled','refunded')),
  payment_provider  text default 'abacatepay',
  payment_ref       text,                 -- id da cobrança no AbacatePay
  tracking_code     text,                 -- código de rastreio (Melhor Envio)
  melhor_envio_id   text,                 -- id do envio/etiqueta
  address           jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists orders_number_idx on escola_segura.orders(number);
create index if not exists orders_customer_idx on escola_segura.orders(customer_id);
create index if not exists orders_status_idx   on escola_segura.orders(status);

-- SHIPPING_QUOTES (cotações do Melhor Envio)
create table if not exists escola_segura.shipping_quotes (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid references escola_segura.orders(id) on delete cascade,
  cep         text not null,
  carrier     text not null,
  price_cents integer not null,
  days        integer,
  raw         jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists quotes_cep_idx on escola_segura.shipping_quotes(cep);

-- TRACKING
create table if not exists escola_segura.tracking (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references escola_segura.orders(id) on delete cascade,
  carrier       text,
  tracking_code text,
  status        text,
  last_update   timestamptz,
  events        jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists tracking_order_idx on escola_segura.tracking(order_id);

-- RLS: bloqueia acesso anônimo direto; acesso de escrita só via Edge Functions (service role)
alter table escola_segura.products        enable row level security;
alter table escola_segura.customers       enable row level security;
alter table escola_segura.orders          enable row level security;
alter table escola_segura.shipping_quotes enable row level security;
alter table escola_segura.tracking        enable row level security;

-- products: leitura pública (catálogo)
drop policy if exists products_read on escola_segura.products;
create policy products_read on escola_segura.products for select using (true);

-- trigger updated_at em orders
create or replace function escola_segura.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists orders_touch on escola_segura.orders;
create trigger orders_touch before update on escola_segura.orders
  for each row execute function escola_segura.touch_updated_at();

-- Seed dos produtos
insert into escola_segura.products (slug,name,type,price_cents,requires_shipping) values
  ('pdf',    'Ebook PDF',            'pdf',    4990, false),
  ('fisico', 'Livro Físico',         'fisico', 5990, true),
  ('combo',  'Combo (Físico + PDF)', 'combo',  6990, true)
on conflict (slug) do update set
  name=excluded.name, price_cents=excluded.price_cents, requires_shipping=excluded.requires_shipping;
