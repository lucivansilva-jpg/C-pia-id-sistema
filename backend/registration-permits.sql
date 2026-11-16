-- A API de autenticação grava app_metadata em etapa posterior ao INSERT.
-- Autoriza uma única criação por endereço interno aleatório, antes da chamada administrativa.
create table public.managed_registration_permits(email text primary key,expires_at timestamptz not null default(now()+interval '2 minutes'));
alter table public.managed_registration_permits enable row level security;
revoke all on public.managed_registration_permits from public,anon,authenticated;
grant select,insert,delete on public.managed_registration_permits to service_role;
grant select,delete on public.managed_registration_permits to supabase_auth_admin;
create policy registration_permits_backend on public.managed_registration_permits for all to service_role using(true) with check(true);
create policy registration_permits_auth_read on public.managed_registration_permits for select to supabase_auth_admin using(true);
create policy registration_permits_auth_consume on public.managed_registration_permits for delete to supabase_auth_admin using(true);
create or replace function app_internal.require_managed_registration() returns trigger language plpgsql security invoker set search_path='' as $$
declare approved text;
begin
 delete from public.managed_registration_permits where email=lower(new.email) and expires_at>now() returning email into approved;
 if approved is null then
  raise exception using errcode='42501',message='User registration requires administrative provisioning';
 end if;
 return new;
end $$;
alter table public.platform_admins add column login_email text unique;
alter table public.platform_admins add column auth_email text;
create or replace function public.complete_platform_setup(p_hash text,p_user uuid,p_name text) returns boolean language plpgsql security invoker set search_path='' as $$
declare owner_email text; account_email text;
begin
 select email into owner_email from public.platform_setup where id=1 and token_hash=p_hash and consumed_at is null and expires_at>now() for update;
 if owner_email is null or exists(select 1 from public.platform_admins) then return false; end if;
 select email into account_email from auth.users where id=p_user;
 if account_email is null then return false; end if;
 insert into public.platform_admins(user_id,display_name,login_email,auth_email) values(p_user,p_name,lower(owner_email),account_email);
 update public.platform_setup set consumed_at=now() where id=1;
 insert into public.access_audit(actor_id,action) values(p_user,'platform.setup');
 return true;
end $$;

grant select(id,email) on auth.users to service_role;
