export type Role = "admin" | "member";

export interface Profile {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: Role;
  position: string | null;
  jersey_number: number | null;
  joined_at: string;
  status: "active" | "inactive";
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
