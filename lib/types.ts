export type AccountRole = "member" | "manager" | "admin";

export interface MembershipApplication {
  member_id: string;
  name: string;
  phone: string;
  birth_date: string;
  residence: string;
  preferred_position: "GK" | "DF" | "MF" | "FW" | "ANY";
  submitted_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: AccountRole;
  position: string | null;
  jersey_number: number | null;
  joined_at: string;
  status: "active" | "inactive" | "pending";
  membership_application?: MembershipApplication | null;
}

export interface Notice {
  id: string;
  title: string;
  body: string;
  is_pinned: boolean;
  created_at: string;
}

export interface Event {
  id: string;
  title: string;
  starts_at: string;
  venue: string;
  address: string | null;
  note: string | null;
  capacity: number | null;
  is_competitive: boolean;
  team_mode: "random" | "balanced" | null;
  event_guest_players?: EventGuestPlayer[];
  event_teams?: EventTeam[];
}

export interface EventGuestPlayer {
  event_id: string;
  guest_player_id: string;
  guest_name: string;
  guest_position: "GK" | "DF" | "MF" | "FW" | "ANY" | null;
  created_at: string;
}

export interface GuestPlayer {
  id: string;
  name: string;
  phone: string | null;
  preferred_position: "GK" | "DF" | "MF" | "FW" | "ANY" | null;
  note: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  appearance_count: number;
}

export interface EventTeamMember {
  id: string;
  event_id: string;
  event_team_id: string;
  profile_id: string | null;
  guest_player_id: string | null;
  participant_name: string;
  participant_position: "GK" | "DF" | "MF" | "FW" | "ANY" | null;
  goals: number;
  rating: number | null;
}

export interface EventTeam {
  id: string;
  event_id: string;
  team_number: number;
  team_name: string;
  score: number | null;
  generation_mode: "random" | "balanced";
  event_team_members: EventTeamMember[];
}

export interface Fee {
  id: string;
  member_id: string;
  month: string;
  amount: number;
  status: "paid" | "unpaid" | "exempt";
  paid_at: string | null;
  profiles?: Pick<Profile, "name"> | null;
}

export interface Attendance {
  event_id: string;
  member_id: string;
  status: "going" | "not_going" | "undecided";
  checked_in_at: string | null;
  checked_in_by: string | null;
}

export interface MemberRanking {
  member_id: string;
  member_name: string;
  attendance_count: number;
  paid_fee_count: number;
  total_score: number;
}

export interface EventMomResult {
  event_id: string;
  candidate_profile_id: string;
  candidate_name: string;
  vote_count: number;
  mom_rank: number;
}

export interface EventMomVote {
  event_id: string;
  voter_id: string;
  candidate_profile_id: string;
  voted_at: string;
}

export interface MomLeaderboardEntry {
  member_id: string;
  member_name: string;
  first_place_count: number;
  second_place_count: number;
  third_place_count: number;
  total_votes: number;
}

export interface Feedback {
  id: string;
  author_id: string;
  category: "operation" | "system" | "facility" | "finance" | "safety" | "other";
  title: string;
  body: string;
  is_anonymous: boolean;
  status: "received" | "reviewing" | "resolved" | "closed";
  officer_response: string | null;
  created_at: string;
}

export type ParticipationKind = "election" | "poll" | "survey";
export type QuestionType = "single_choice" | "multiple_choice" | "short_text" | "long_text" | "rating" | "yes_no";

export interface ParticipationOption {
  id: string;
  question_id: string;
  label: string;
  description: string | null;
  candidate_profile_id: string | null;
  position: number;
}

export interface ParticipationQuestion {
  id: string;
  form_id: string;
  prompt: string;
  type: QuestionType;
  is_required: boolean;
  position: number;
  min_value: number | null;
  max_value: number | null;
  participation_options: ParticipationOption[];
}

export interface ParticipationForm {
  id: string;
  kind: ParticipationKind;
  title: string;
  description: string | null;
  status: "draft" | "open" | "closed" | "archived";
  starts_at: string | null;
  ends_at: string | null;
  secret_ballot: boolean;
  show_results: boolean;
  participation_questions: ParticipationQuestion[];
}

export interface ParticipationSubmission {
  id: string;
  form_id: string;
  participant_id: string;
  submitted_at: string;
}

export interface RolePermission {
  role: AccountRole;
  permission: string;
}
