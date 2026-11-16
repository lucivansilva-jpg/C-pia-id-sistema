-- Migration registrada no Supabase. Rever antes de aplicar em outro ambiente.
create policy auth_login_slots_backend_only on public.auth_login_slots for all to service_role using(true) with check(true);
