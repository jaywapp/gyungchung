-- Every other position column in the schema is limited to the five roster codes:
-- guest_players.preferred_position, event_guest_players.guest_position,
-- membership_applications.preferred_position and event_team_members.participant_position.
-- public.profiles.position was the one exception and stayed free text, so a value an
-- officer typed by hand ('공격수') survived until save_event_teams copied it into
-- event_team_members.participant_position, where the check constraint rejected the row
-- and aborted the whole team generation.

update public.profiles
set "position" = case upper(btrim("position"))
  when 'GK' then 'GK'
  when '골키퍼' then 'GK'
  when '키퍼' then 'GK'
  when 'DF' then 'DF'
  when 'DEF' then 'DF'
  when 'CB' then 'DF'
  when 'LB' then 'DF'
  when 'RB' then 'DF'
  when 'WB' then 'DF'
  when '수비' then 'DF'
  when '수비수' then 'DF'
  when 'MF' then 'MF'
  when 'CM' then 'MF'
  when 'DM' then 'MF'
  when 'AM' then 'MF'
  when 'LM' then 'MF'
  when 'RM' then 'MF'
  when '미드' then 'MF'
  when '미들' then 'MF'
  when '미드필더' then 'MF'
  when 'FW' then 'FW'
  when 'ST' then 'FW'
  when 'CF' then 'FW'
  when 'LW' then 'FW'
  when 'RW' then 'FW'
  when '공격' then 'FW'
  when '공격수' then 'FW'
  when '스트라이커' then 'FW'
  when 'ANY' then 'ANY'
  when '무관' then 'ANY'
  when '상관없음' then 'ANY'
  when '전천후' then 'ANY'
  else null
end
-- Rows that already hold a roster code are left alone so protect_account_roles_before_write,
-- which fires on every profile update, never runs for a row this migration does not change.
where "position" is not null
  and "position" not in ('GK', 'DF', 'MF', 'FW', 'ANY');

alter table public.profiles
add constraint profiles_position_check
check ("position" is null or "position" in ('GK', 'DF', 'MF', 'FW', 'ANY'));
