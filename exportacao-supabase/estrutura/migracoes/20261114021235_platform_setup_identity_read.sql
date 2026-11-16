-- Migration registrada no Supabase. Rever antes de aplicar em outro ambiente.
grant select(id,email) on auth.users to service_role;
