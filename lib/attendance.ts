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

/** Count each row once instead of rescanning the complete history for every event. */
export function countAttendanceByEvent(records: Attendance[]) {
  const counts = new Map<string, { present: number; late: number; absent: number }>();
  for (const record of records) {
    const status = getCheckInStatus(record);
    if (!status) continue;
    const eventCounts = counts.get(record.event_id) ?? { present: 0, late: 0, absent: 0 };
    eventCounts[status]++;
    counts.set(record.event_id, eventCounts);
  }
  return counts;
}
