/* ── Shared SVG icons ────────────────────────────────────────────── */

export type Icon =
  | "clock"
  | "calendar"
  | "distance"
  | "speed"
  | "heart"
  | "mountain"
  | "power"
  | "cadence"
  | "battery"
  | "avg"
  | "flame"
  | "vo2";

const svgProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function IconDistance() {
  return <svg width="18" height="18" viewBox="0 0 24 24" {...svgProps}><path d="M12 21s7-5.5 7-11a7 7 0 10-14 0c0 5.5 7 11 7 11z" /><circle cx="12" cy="10" r="2.6" /></svg>;
}
export function IconMapPin() {
  return <svg width="16" height="16" viewBox="0 0 24 24" {...svgProps}><path d="M12 21s7-5.5 7-11a7 7 0 10-14 0c0 5.5 7 11 7 11z" /><circle cx="12" cy="10" r="2.6" /></svg>;
}
export function IconMapPinOff() {
  return <svg width="16" height="16" viewBox="0 0 24 24" {...svgProps}><path d="M12 21s7-5.5 7-11a7 7 0 00-10.5-6.1" /><path d="M5.5 5.5A7 7 0 005 10c0 5.5 7 11 7 11" /><circle cx="12" cy="10" r="2.6" /><line x1="3" y1="3" x2="21" y2="21" /></svg>;
}
export function IconClock() {
  return <svg width="18" height="18" viewBox="0 0 24 24" {...svgProps}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>;
}
export function IconCalendar() {
  return <svg width="18" height="18" viewBox="0 0 24 24" {...svgProps}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>;
}
export function IconSpeed() {
  return <svg width="18" height="18" viewBox="0 0 24 24" {...svgProps}><path d="M13 2L4 14h7l-1 8 10-12h-7l1-8z" /></svg>;
}
export function IconHeart() {
  return <svg width="18" height="18" viewBox="0 0 24 24" {...svgProps}><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0016.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 002 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" /></svg>;
}
export function IconMountain() {
  return <svg width="18" height="18" viewBox="0 0 24 24" {...svgProps}><path d="m8 3 4 8 5-5 5 15H2L8 3z" /></svg>;
}
export function IconAvg() {
  return <svg width="18" height="18" viewBox="0 0 24 24" {...svgProps}><line x1="4" y1="20" x2="20" y2="4" /><circle cx="6" cy="6" r="2" /><circle cx="18" cy="18" r="2" /></svg>;
}
export function IconCadence() {
  return <svg width="18" height="18" viewBox="0 0 24 24" {...svgProps}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.5" /><path d="M12 4v3" /><path d="M20 12h-3" /><path d="M12 20v-3" /><path d="M4 12h3" /></svg>;
}
export function IconBattery() {
  return <svg width="18" height="18" viewBox="0 0 24 24" {...svgProps}><rect x="2" y="7" width="18" height="10" rx="2" /><line x1="22" y1="11" x2="22" y2="13" /><path d="M8 10l3 2-3 2" /><path d="M14 10v4" /></svg>;
}
export function IconSearch() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...svgProps}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>;
}
export function IconSort() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...svgProps}><line x1="6" y1="7" x2="18" y2="7" /><line x1="9" y1="12" x2="18" y2="12" /><line x1="12" y1="17" x2="18" y2="17" /></svg>;
}
export function IconSortDirection({ direction }: { direction: "asc" | "desc" }) {
  return direction === "asc"
    ? <svg width="14" height="14" viewBox="0 0 24 24" {...svgProps}><polyline points="7 11 12 6 17 11" /><line x1="12" y1="18" x2="12" y2="7" /></svg>
    : <svg width="14" height="14" viewBox="0 0 24 24" {...svgProps}><polyline points="7 13 12 18 17 13" /><line x1="12" y1="6" x2="12" y2="17" /></svg>;
}
export function IconMenu() {
  return <svg width="18" height="18" viewBox="0 0 24 24" {...svgProps}><line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" /></svg>;
}
export function IconSun() {
  return <svg width="16" height="16" viewBox="0 0 24 24" {...svgProps}><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>;
}
export function IconMoon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" {...svgProps}><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></svg>;
}
export function IconPaper() {
  return <svg width="16" height="16" viewBox="0 0 24 24" {...svgProps}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></svg>;
}
export function IconSettings() {
  return <svg width="16" height="16" viewBox="0 0 24 24" {...svgProps}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>;
}
export function IconLogout() {
  return <svg width="16" height="16" viewBox="0 0 24 24" {...svgProps}><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>;
}
export function IconRefresh() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...svgProps}><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" /></svg>;
}
export function IconChevron() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>;
}
export function IconCollapse() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...svgProps}><polyline points="11 17 6 12 11 7" /><polyline points="18 17 13 12 18 7" /></svg>;
}
export function IconExpand() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...svgProps}><polyline points="13 17 18 12 13 7" /><polyline points="6 17 11 12 6 7" /></svg>;
}
export function IconPower() {
  return <svg width="18" height="18" viewBox="0 0 24 24" {...svgProps}><path d="M18.36 6.64a9 9 0 11-12.73 0" /><line x1="12" y1="2" x2="12" y2="12" /></svg>;
}
export function IconEdit() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...svgProps}><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>;
}
export function IconTrash() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...svgProps}><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>;
}
export function IconCheck() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...svgProps}><polyline points="20 6 9 17 4 12" /></svg>;
}
export function IconX() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...svgProps}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>;
}
export function IconDownload() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...svgProps}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>;
}
export function IconFile() {
  return <svg width="14" height="14" viewBox="0 0 24 24" {...svgProps}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>;
}
export function IconBarChart({ size = 32 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>;
}
export function IconClipboard() {
  return <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" /></svg>;
}
export function IconFlame() {
  return <svg width="18" height="18" viewBox="0 0 24 24" {...svgProps}><path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z" /></svg>;
}
export function IconVo2() {
  return <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M4.882 19q-1.203 0-2.042-.854Q2 17.293 2 16.073v-4.161q0-1.007.433-1.886q.433-.878 1.223-1.487l4.113-3.227q.427-.333.656-.813t.229-1.026V2h1v1.473q0 .546.238 1.026t.672.813l4.094 3.226q.784.61 1.217 1.488q.433.879.433 1.885v.32h-1v-.32q0-.763-.339-1.43t-.927-1.15L11.54 7.375v10.987q-.489-.373-.748-.951q-.258-.578-.252-1.338V6.608L9.154 5.48L7.75 6.608v9.465q.006 1.212-.83 2.07T4.882 19m.009-1q.784 0 1.325-.571t.534-1.356V7.375L4.266 9.331q-.608.483-.937 1.15Q3 11.149 3 11.911v4.162q0 .804.553 1.366q.553.561 1.338.561m8.801 1q-.31 0-.539-.23t-.23-.54v-3.845q0-.31.23-.54t.54-.23h2.346q.309 0 .539.23t.23.54v3.846q0 .31-.23.54q-.23.229-.54.229zm.116-.885h2.115V14.5h-2.115zM18.192 21v-2.366q0-.326.222-.548q.22-.22.548-.22h2.269V16.5h-3.039v-.885h3.154q.327 0 .548.222q.222.22.222.548v1.596q0 .327-.222.548q-.221.221-.548.221h-2.269v1.366h3.038V21zm-4.769-8.315" /></svg>;
}
