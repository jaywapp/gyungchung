export type OfficerRole = "member" | "president" | "vice_president" | "treasurer";

export interface Profile {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: OfficerRole;
  position: string | null;
  jersey_number: number | null;
  joined_at: string;
  status: "active" | "inactive" | "pending";
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
  role: OfficerRole;
  permission: string;
}
