export const defaultCalendarView = "dayGridMonth";
export const legacyCalendarDefaultView = "timeGridWeek";
export function migrateCalendarDefaultView(view, migrationAlreadyApplied = false) {
  if (migrationAlreadyApplied) return view;
  return view === legacyCalendarDefaultView ? defaultCalendarView : view;
}
