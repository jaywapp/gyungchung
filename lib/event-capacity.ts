export const NEAR_CAPACITY_REMAINING = 2;

export type CapacityStatus = "unlimited" | "available" | "nearly_full" | "full" | "over_capacity";

export type EventCapacity = {
  capacity: number | null;
  memberCount: number;
  guestCount: number;
  totalCount: number;
  remaining: number | null;
  status: CapacityStatus;
};

/** Capacity always includes RSVP members and guests assigned by an officer. */
export function getEventCapacity(capacity: number | null | undefined, memberCount: number, guestCount: number): EventCapacity {
  const totalCount = memberCount + guestCount;
  if (!capacity || capacity < 1) return { capacity: null, memberCount, guestCount, totalCount, remaining: null, status: "unlimited" };

  const remaining = capacity - totalCount;
  const status: CapacityStatus = remaining < 0 ? "over_capacity" : remaining === 0 ? "full" : remaining <= NEAR_CAPACITY_REMAINING ? "nearly_full" : "available";
  return { capacity, memberCount, guestCount, totalCount, remaining, status };
}
