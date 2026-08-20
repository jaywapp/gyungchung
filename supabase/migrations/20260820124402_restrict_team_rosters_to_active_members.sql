drop policy if exists "Event team members are public"
on public.event_team_members;

create policy "Active members read event team members"
on public.event_team_members
for select
to authenticated
using ((select private.is_active_member()));
