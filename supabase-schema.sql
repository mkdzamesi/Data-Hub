-- Run this in Supabase: Project -> SQL Editor -> New query -> paste -> Run

create table orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  ref text not null,
  email text,
  phone text,
  momo text,
  items text,
  total numeric,
  currency text,
  status text,
  paid_at timestamptz,
  fulfillment_status text,
  fulfillment_detail text
);

-- Row Level Security: locked down by default. Only your Netlify Functions
-- (using the service_role key) can read/write. The browser never talks to
-- Supabase directly, so no public policies are needed.
alter table orders enable row level security;
