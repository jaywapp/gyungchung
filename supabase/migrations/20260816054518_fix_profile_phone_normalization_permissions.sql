-- The profile write trigger runs as the caller and delegates phone cleanup to
-- this pure helper, so authenticated writers need permission to execute it.
grant execute on function private.normalize_member_phone(text)
to authenticated, service_role;
