-- Every other position column in the schema is limited to the five roster codes:
-- guest_players.preferred_position, event_guest_players.guest_position,
-- membership_applications.preferred_position and event_team_members.participant_position.
-- public.profiles.position was the one exception and stayed free text, so a value an
-- officer typed by hand ('공격수', 'LW, RW') survived until save_event_teams copied it into
-- event_team_members.participant_position, where the check constraint rejected the row
-- and aborted the whole team generation.

-- Members record more than one position ('LW, RW, LWB'), which the roster codes cannot
-- express. Keep the wording they typed in position_detail so narrowing position to a
-- single code stays reversible and the detail is still available to show later.
alter table public.profiles
add column if not exists position_detail text;

comment on column public.profiles.position_detail is
  'Free-text position wording as the member entered it. position holds the single roster code derived from it.';

-- Reads the first entry of a list like 'LW, RW, LWB' and maps it onto a roster code.
-- Returns null for anything unrecognised, which the guard below turns into a hard failure
-- rather than silent data loss.
create function private.normalize_roster_position(raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case upper(btrim((regexp_split_to_array(raw, '[,/|·&]'))[1]))
    when 'GK' then 'GK'
    when 'G' then 'GK'
    when '골키퍼' then 'GK'
    when '키퍼' then 'GK'
    when '골리' then 'GK'
    when 'DF' then 'DF'
    when 'DEF' then 'DF'
    when 'D' then 'DF'
    when 'CB' then 'DF'
    when 'LB' then 'DF'
    when 'RB' then 'DF'
    when 'WB' then 'DF'
    when 'LWB' then 'DF'
    when 'RWB' then 'DF'
    when 'FB' then 'DF'
    when 'SW' then 'DF'
    when '수비' then 'DF'
    when '수비수' then 'DF'
    when '센터백' then 'DF'
    when '풀백' then 'DF'
    when '윙백' then 'DF'
    when '리베로' then 'DF'
    when 'MF' then 'MF'
    when 'M' then 'MF'
    when 'CM' then 'MF'
    when 'DM' then 'MF'
    when 'AM' then 'MF'
    when 'CDM' then 'MF'
    when 'CAM' then 'MF'
    when 'CMF' then 'MF'
    when 'DMF' then 'MF'
    when 'AMF' then 'MF'
    when 'LM' then 'MF'
    when 'RM' then 'MF'
    when '미드' then 'MF'
    when '미들' then 'MF'
    when '미드필더' then 'MF'
    when '수비형미드필더' then 'MF'
    when '공격형미드필더' then 'MF'
    when 'FW' then 'FW'
    when 'F' then 'FW'
    when 'ST' then 'FW'
    when 'CF' then 'FW'
    when 'SS' then 'FW'
    when 'LW' then 'FW'
    when 'RW' then 'FW'
    when 'LWF' then 'FW'
    when 'RWF' then 'FW'
    when 'WF' then 'FW'
    when '공격' then 'FW'
    when '공격수' then 'FW'
    when '스트라이커' then 'FW'
    when '윙어' then 'FW'
    when '윙포워드' then 'FW'
    when 'ANY' then 'ANY'
    when '무관' then 'ANY'
    when '상관없음' then 'ANY'
    when '전천후' then 'ANY'
    when '아무데나' then 'ANY'
    else null
  end;
$$;

revoke all on function private.normalize_roster_position(text)
from public, anon, authenticated, service_role;

-- Refuse to run rather than blank out a position nobody taught this migration to read.
-- Add the missing wording to the case above and rerun.
do $$
declare
  unmapped text[];
begin
  select array_agg(distinct profile."position")
  into unmapped
  from public.profiles as profile
  where profile."position" is not null
    and btrim(profile."position") <> ''
    and private.normalize_roster_position(profile."position") is null;

  if unmapped is not null then
    raise exception 'Cannot map these position values onto a roster code: %', unmapped;
  end if;
end;
$$;

-- Only rows whose wording carries more than the roster code need to keep the original.
update public.profiles as profile
set position_detail = profile."position"
where profile."position" is not null
  and btrim(profile."position") <> ''
  and profile.position_detail is null
  and profile."position" is distinct from private.normalize_roster_position(profile."position");

-- Rows that already hold a roster code are left alone so protect_account_roles_before_write,
-- which fires on every profile update, never runs for a row this migration does not change.
-- A blank string normalises to null, which is how it reaches the roster codes as "no position".
update public.profiles as profile
set "position" = private.normalize_roster_position(profile."position")
where profile."position" is not null
  and profile."position" is distinct from private.normalize_roster_position(profile."position");

alter table public.profiles
add constraint profiles_position_check
check ("position" is null or "position" in ('GK', 'DF', 'MF', 'FW', 'ANY'));

drop function private.normalize_roster_position(text);
