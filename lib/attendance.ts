import type { Attendance } from "@/lib/types";

/**
 * Check-in state, read the same way everywhere. Rows created before
 * `check_in_status` existed only carry `checked_in_at`, so a bare timestamp
 * still counts as 출석 rather than reading as "미체크".
 */
export function getCheckInStatus(record?: Attendance): Attendance["check_in_status"] {
  return record?.check_in_status ?? (record?.checked_in_at ? "present" : null);
}

/** 지각도 경기에는 뛴 것이므로 MOM 투표와 출석 집계에서는 출석으로 센다. */
export function isCheckedIn(record?: Attendance) {
  const status = getCheckInStatus(record);
  return status === "present" || status === "late";
}
