create or replace function public.route_feedback_publication()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.publish_to_github := new.category = 'system';
  return new;
end;
$$;

revoke execute on function public.route_feedback_publication()
from public, anon, authenticated;

create trigger route_feedback_publication_before_insert
before insert on public.feedback
for each row execute function public.route_feedback_publication();
