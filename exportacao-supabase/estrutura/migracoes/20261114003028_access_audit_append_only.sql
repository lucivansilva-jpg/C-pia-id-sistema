-- Migration registrada no Supabase. Rever antes de aplicar em outro ambiente.
revoke update,delete,truncate on public.access_audit from service_role;
