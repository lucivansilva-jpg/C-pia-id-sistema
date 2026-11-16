-- Extensão da autenticação: administrador da plataforma e suporte rastreável.
alter table public.business_members add column must_change_password boolean not null default false;
alter table public.businesses add column active boolean not null default true;
create table public.platform_admins(user_id uuid primary key references auth.users(id),display_name text not null,active boolean not null default true,created_at timestamptz not null default now());
create table public.platform_setup(id integer primary key check(id=1),email text not null,token_hash text not null,expires_at timestamptz not null,consumed_at timestamptz);
create table public.support_sessions(id uuid primary key default gen_random_uuid(),actor_id uuid not null references public.platform_admins(user_id),business_id uuid not null references public.businesses(id),purpose text not null check(char_length(purpose) between 5 and 500),write_enabled boolean not null default false,expires_at timestamptz not null default(now()+interval '30 minutes'),closed_at timestamptz,created_at timestamptz not null default now());
create index support_sessions_actor on public.support_sessions(actor_id,created_at desc);
create index support_sessions_business on public.support_sessions(business_id,created_at desc);
create table public.access_audit(id uuid primary key default gen_random_uuid(),actor_id uuid not null references auth.users(id),business_id uuid references public.businesses(id),support_session_id uuid references public.support_sessions(id),action text not null,target_id text,details jsonb not null default '{}',created_at timestamptz not null default now());
create index access_audit_business on public.access_audit(business_id,created_at desc);
create index access_audit_actor on public.access_audit(actor_id,created_at desc);
alter table public.platform_admins enable row level security;
alter table public.platform_setup enable row level security;
alter table public.support_sessions enable row level security;
alter table public.access_audit enable row level security;
revoke all on public.platform_admins,public.platform_setup,public.support_sessions,public.access_audit from anon,authenticated;
grant select,insert,update on public.platform_admins,public.platform_setup,public.support_sessions to service_role;
grant select,insert on public.access_audit to service_role;
create policy platform_admins_backend on public.platform_admins for all to service_role using(true) with check(true);
create policy platform_setup_backend on public.platform_setup for all to service_role using(true) with check(true);
create policy support_sessions_backend on public.support_sessions for all to service_role using(true) with check(true);
create policy access_audit_backend_read on public.access_audit for select to service_role using(true);
create policy access_audit_backend_append on public.access_audit for insert to service_role with check(true);
create function public.complete_platform_setup(p_hash text,p_user uuid,p_name text) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.platform_setup where id=1 and token_hash=p_hash and consumed_at is null and expires_at>now() for update;
 if not found or exists(select 1 from public.platform_admins) then return false; end if;
 insert into public.platform_admins(user_id,display_name) values(p_user,p_name);
 update public.platform_setup set consumed_at=now() where id=1;
 insert into public.access_audit(actor_id,action) values(p_user,'platform.setup');
 return true;
end $$;
revoke all on function public.complete_platform_setup(text,uuid,text) from public,anon,authenticated;
grant execute on function public.complete_platform_setup(text,uuid,text) to service_role;
-- O cadastro inicial de empresas passa a ser realizado somente pela plataforma.
-- bootstrap_business segue restrita ao service_role, sem acesso de clientes.
-- Suporte não recebe políticas de leitura de tabelas do cliente: passa obrigatoriamente
-- pelo backend, que valida escopo, expiração, modo de edição e registra o acesso.
revoke update,delete,truncate on public.access_audit from service_role;
