export type AdminFilterRow<T> = {
  item: T;
  searchValues: Array<string | null | undefined>;
  status?: string;
};

export function filterAdminRows<T>(rows: AdminFilterRow<T>[], query: string, status = "all") {
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");

  return rows.filter((row) => {
    if (status !== "all" && row.status !== status) return false;
    return normalizedQuery.length === 0 || row.searchValues.some((value) => value?.toLocaleLowerCase("ko-KR").includes(normalizedQuery));
  });
}
