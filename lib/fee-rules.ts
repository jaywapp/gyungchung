/**
 * Standard dues, shared by every screen that shows or pre-fills a fee. The
 * database fee trigger applies the same amounts on insert, so a change here
 * must ship with a matching migration.
 */
export const FEE_AMOUNTS = {
  managerMonthly: 15000,
  memberMonthly: 30000,
  perEvent: 10000,
} as const;

export const formatWon = (amount: number) => `${amount.toLocaleString("ko-KR")}원`;

/** The three plans as short badges for the fee page header. */
export const feeRuleBadges = [
  `관리자 월 ${formatWon(FEE_AMOUNTS.managerMonthly)}`,
  `일반회원 월 ${formatWon(FEE_AMOUNTS.memberMonthly)}`,
  `참여 시 ${formatWon(FEE_AMOUNTS.perEvent)}`,
];
