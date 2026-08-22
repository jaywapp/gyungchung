-- service_role already has narrow EXECUTE grants on the private helpers it
-- needs, but without schema USAGE those grants cannot be exercised by profile
-- protection triggers. USAGE does not grant access to any private object by
-- itself; the existing object-level grants remain the security boundary.
grant usage on schema private to service_role;
