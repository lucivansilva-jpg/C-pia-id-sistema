-- Migration registrada no Supabase. Rever antes de aplicar em outro ambiente.
-- Login externo, sem alterar o banco do sistema atualmente publicado no Sites.
create table public.businesses (
 id uuid primary key default gen_random_uuid(),
 code text not null unique default substr(replace(gen_random_uuid()::text,'-',''),1,12),
 name text not null check(char_length(name) between 1 and 100),
 owner_user_id uuid not null unique references auth.users(id),
 created_at timestamptz not null default now()
);
create table public.business_profiles (
 business_id uuid not null references public.businesses(id) on delete cascade,
 role text not null check(role in ('admin','cashier','waiter')),
 name text not null,
 permissions jsonb not null default '{}'::jsonb check(jsonb_typeof(permissions)='object'),
 primary key(business_id,role)
);
create table public.business_members (
 user_id uuid primary key references auth.users(id) on delete cascade,
 business_id uuid not null references public.businesses(id) on delete cascade,
 username text,
 display_name text not null,
 login_email text,
 role text not null check(role in ('admin','cashier','waiter')),
 permissions jsonb not null default '{}'::jsonb check(jsonb_typeof(permissions)='object'),
 active boolean not null default true,
 version integer not null default 1,
 created_at timestamptz not null default now(),
 unique(business_id,username),
 foreign key(business_id,role) references public.business_profiles(business_id,role),
 check(username is null or username ~ '^[a-z0-9][a-z0-9._-]{2,39}$')
);
create index business_members_business on public.business_members(business_id);
create table public.auth_login_slots (
 slot_key text primary key,
 window_start timestamptz not null default now(),
 attempts integer not null default 1
);
alter table public.businesses enable row level security;
alter table public.business_profiles enable row level security;
alter table public.business_members enable row level security;
alter table public.auth_login_slots enable row level security;
revoke all on public.businesses,public.business_profiles,public.business_members,public.auth_login_slots from anon,authenticated;
grant select on public.businesses,public.business_profiles to authenticated;
grant select(user_id,business_id,username,display_name,role,permissions,active,version,created_at) on public.business_members to authenticated;
grant all on public.businesses,public.business_profiles,public.business_members,public.auth_login_slots to service_role;
create policy membership_self on public.business_members for select to authenticated using(user_id=(select auth.uid()) and active);
create policy business_member_read on public.businesses for select to authenticated using(owner_user_id=(select auth.uid()) or exists(select 1 from public.business_members m where m.business_id=id and m.user_id=(select auth.uid()) and m.active));
create policy business_profiles_read on public.business_profiles for select to authenticated using(exists(select 1 from public.business_members m where m.business_id=business_profiles.business_id and m.user_id=(select auth.uid()) and m.active));
create function public.bootstrap_business(p_owner uuid,p_name text) returns uuid language plpgsql security invoker set search_path='' as $$
declare business uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 select business_id into business from public.business_members where user_id=p_owner;
 if business is not null then return business; end if;
 insert into public.businesses(name,owner_user_id) values(p_name,p_owner) returning id into business;
 insert into public.business_profiles(business_id,role,name) values(business,'admin','Administrador / proprietário'),(business,'cashier','Caixa / responsável pela operação'),(business,'waiter','Garçom / atendimento');
 insert into public.business_members(user_id,business_id,display_name,role) values(p_owner,business,p_name,'admin');
 return business;
end $$;
revoke all on function public.bootstrap_business(uuid,text) from public,anon,authenticated;
grant execute on function public.bootstrap_business(uuid,text) to service_role;
grant select(id,user_id) on auth.sessions to service_role;
create function public.business_auth_session_valid(p_user uuid,p_session uuid) returns boolean language sql stable security invoker set search_path='' as $$ select exists(select 1 from auth.sessions where id=p_session and user_id=p_user) $$;
revoke all on function public.business_auth_session_valid(uuid,uuid) from public,anon,authenticated;
grant execute on function public.business_auth_session_valid(uuid,uuid) to service_role;
create function public.business_login_slot(p_key text) returns boolean language plpgsql security invoker set search_path='' as $$
declare current_attempts integer;
begin
 delete from public.auth_login_slots where window_start<now()-interval '1 day';
 insert into public.auth_login_slots(slot_key) values(p_key) on conflict(slot_key) do update set attempts=case when auth_login_slots.window_start<now()-interval '15 minutes' then 1 else auth_login_slots.attempts+1 end,window_start=case when auth_login_slots.window_start<now()-interval '15 minutes' then now() else auth_login_slots.window_start end returning attempts into current_attempts;
 return current_attempts<=10;
end $$;
revoke all on function public.business_login_slot(text) from public,anon,authenticated;
grant execute on function public.business_login_slot(text) to service_role;

