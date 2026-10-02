import type { Attendance, Event, Profile } from "./types";

const seasonYearFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", year: "numeric" });
export function getSeasonYear(value: string | Date) {
  return Number(seasonYearFormatter.format(typeof value === "string" ? new Date(value) : value));
}

export interface EventWinningMember {
  event_id: string;
  member_id: string;
}

export interface SeasonRank {
  member_id: string;
  member_name: string;
  count: number;
  rank: number;
}

export function buildSeasonRankings(
  year: number,
  events: Event[],
  attendance: Attendance[],
  winners: EventWinningMember[],
  profiles: Profile[],
) {
  const members = new Map(profiles.filter((profile) => profile.status === "active" && !profile.is_test_account).map((profile) => [profile.id, profile.name]));
  const seasonEvents = events.filter((event) => getSeasonYear(event.starts_at) === year);
  const eventIds = new Set(seasonEvents.map((event) => event.id));
  const wins = new Map<string, number>();
  const goals = new Map<string, number>();
  const visits = new Map<string, number>();
  const increment = (counts: Map<string, number>, memberId: string | null, amount = 1) => {
    if (memberId && members.has(memberId)) counts.set(memberId, (counts.get(memberId) ?? 0) + amount);
  };
  const uniqueWinners = new Set<string>();
  for (const winner of winners) {
    if (!eventIds.has(winner.event_id)) continue;
    const key = `${winner.event_id}:${winner.member_id}`;
    if (!uniqueWinners.has(key)) {
      increment(wins, winner.member_id);
      uniqueWinners.add(key);
    }
  }
  const checkedIn = new Set<string>();
  for (const record of attendance) {
    if (!eventIds.has(record.event_id) || !(record.check_in_status === "present" || record.check_in_status === "late" || (record.check_in_status === null && Boolean(record.checked_in_at)))) continue;
    const key = `${record.event_id}:${record.member_id}`;
    if (!checkedIn.has(key)) {
      increment(visits, record.member_id);
      checkedIn.add(key);
    }
  }
  for (const event of seasonEvents) {
    if (event.event_matches?.length) {
      for (const match of event.event_matches) {
        for (const scorer of match.event_match_scorers) increment(goals, scorer.profile_id, scorer.goals);
      }
    } else {
      for (const team of event.event_teams ?? []) {
        for (const member of team.event_team_members) increment(goals, member.profile_id, member.goals);
      }
    }
  }
  const topFive = (counts: Map<string, number>): SeasonRank[] => {
    const sorted = [...counts].filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1] || (members.get(a[0]) ?? "").localeCompare(members.get(b[0]) ?? "", "ko"));
    return sorted.slice(0, 5).map(([member_id, count]) => ({
      member_id,
      member_name: members.get(member_id) ?? "",
      count,
      rank: sorted.findIndex(([, candidate]) => candidate === count) + 1,
    }));
  };
  return { wins: topFive(wins), goals: topFive(goals), attendance: topFive(visits) };
}
