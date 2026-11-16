-- Migration registrada no Supabase. Rever antes de aplicar em outro ambiente.
-- Contas novas somente por provisionamento administrativo do backend.
-- O marcador é app_metadata, que não pode ser definido pelo usuário em signup.
-- Não atribui perfis ou empresas: estes continuam nas tabelas protegidas.
create schema if not exists app_internal;
revoke all on schema app_internal from public,anon,authenticated;
grant usage on schema app_internal to supabase_auth_admin;
create function app_internal.require_managed_registration() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if coalesce(new.raw_app_meta_data->>'managed_by_platform','false')<>'true' then
  raise exception using errcode='42501',message='User registration requires administrative provisioning';
 end if;
 return new;
end $$;
revoke all on function app_internal.require_managed_registration() from public,anon,authenticated;
grant execute on function app_internal.require_managed_registration() to supabase_auth_admin;
create trigger require_managed_registration before insert on auth.users for each row execute function app_internal.require_managed_registration();

