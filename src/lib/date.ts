/**
 * Date helpers for week-based analytics.
 *
 * The dashboard treats weeks as Monday -> Sunday (ISO 8601), not Sunday -> Saturday.
 */

/** Monday = 0 ... Sunday = 6. */
export function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/**
 * Returns a new Date set to local midnight of the Monday that starts the week
 * containing `date`.
 */
export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - mondayIndex(d));
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Local YYYY-MM-DD key. Unlike `toISOString()`, this does not shift the date
 * across timezone boundaries.
 */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
