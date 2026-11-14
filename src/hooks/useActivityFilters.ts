import { useMemo, useState } from "react";
import type { Activity } from "../types";
import { useActivityStore } from "../stores/activityStore";
import { parseUtcDate } from "../lib/activityFormat";

export type SortBy = "date" | "name" | "duration";
export type SortDirection = "asc" | "desc";

export function useActivityFilters(activities: Activity[]) {
  const filterSport = useActivityStore((s) => s.filterSport);
  const setFilterSport = useActivityStore((s) => s.setFilterSport);

  const [searchQuery, setSearchQuery] = useState("");
  const [minDurationMinutes, setMinDurationMinutes] = useState("");
  const [maxDurationMinutes, setMaxDurationMinutes] = useState("");
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [sortBy, setSortBy] = useState<SortBy>("date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const filtered = useMemo(() => {
    const minSec = minDurationMinutes ? Number(minDurationMinutes) * 60 : null;
    const maxSec = maxDurationMinutes ? Number(maxDurationMinutes) * 60 : null;
    const fromTs = dateFrom ? dateFrom.getTime() : null;
    const toTs = dateTo ? (dateTo.getTime() + 86399999) : null;

    return activities.filter((a) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!`${a.activity_name} ${a.file_name} ${a.sport}`.toLowerCase().includes(q)) return false;
      }
      if (filterSport !== "all" && a.sport !== filterSport) return false;
      const ts = parseUtcDate(a.start_ts_utc).getTime();
      if (Number.isFinite(ts)) {
        if (fromTs !== null && ts < fromTs) return false;
        if (toTs !== null && ts > toTs) return false;
      }
      if (minSec !== null && Number.isFinite(minSec) && a.duration_s < minSec) return false;
      if (maxSec !== null && Number.isFinite(maxSec) && a.duration_s > maxSec) return false;
      return true;
    });
  }, [activities, filterSport, minDurationMinutes, maxDurationMinutes, dateFrom, dateTo, searchQuery]);

  const sortedForList = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      if (sortBy === "name") {
        const cmp = (a.activity_name || a.file_name).localeCompare(b.activity_name || b.file_name, undefined, { sensitivity: "base" });
        return sortDirection === "asc" ? cmp : -cmp;
      }
      if (sortBy === "duration") {
        return sortDirection === "asc" ? a.duration_s - b.duration_s : b.duration_s - a.duration_s;
      }
      const aTs = parseUtcDate(a.start_ts_utc).getTime();
      const bTs = parseUtcDate(b.start_ts_utc).getTime();
      const aSafe = Number.isFinite(aTs) ? aTs : 0;
      const bSafe = Number.isFinite(bTs) ? bTs : 0;
      return sortDirection === "asc" ? aSafe - bSafe : bSafe - aSafe;
    });
    return list;
  }, [filtered, sortBy, sortDirection]);

  const sports = useMemo(
    () => Array.from(new Set(activities.map((a) => a.sport).filter(Boolean))),
    [activities]
  );

  const hasFilters = Boolean(
    filterSport !== "all" || dateFrom || dateTo || minDurationMinutes || maxDurationMinutes || searchQuery
  );

  const clearFilters = () => {
    setDateFrom(undefined); setDateTo(undefined);
    setMinDurationMinutes(""); setMaxDurationMinutes("");
    setFilterSport("all"); setSearchQuery("");
  };

  return {
    filterSport, setFilterSport,
    searchQuery, setSearchQuery,
    minDurationMinutes, setMinDurationMinutes,
    maxDurationMinutes, setMaxDurationMinutes,
    dateFrom, setDateFrom,
    dateTo, setDateTo,
    sortBy, setSortBy,
    sortDirection, setSortDirection,
    filtered, sortedForList, sports, hasFilters, clearFilters,
  };
}

export type ActivityFilters = ReturnType<typeof useActivityFilters>;
