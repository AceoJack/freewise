const money = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
// Dates are stored as plain YYYY-MM-DD, so format them in UTC to avoid shifting a day.
const dayFormat = new Intl.DateTimeFormat('en-AU', { day: 'numeric', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat('en-AU', { month: 'short', timeZone: 'UTC' });
const monthYearFormat = new Intl.DateTimeFormat('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
// Timestamps are real instants, so show them in the device's own time zone.
const timestampFormat = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFormat = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

const asDate = (isoDate) => new Date(`${isoDate}T00:00:00Z`);

export const formatMoney = (cents) => money.format(cents / 100);

// "2026-10-26" -> { day: "26", month: "Oct" }
export const dayParts = (isoDate) => ({ day: dayFormat.format(asDate(isoDate)), month: monthFormat.format(asDate(isoDate)) });

// "2026-10-26" -> "October 2026"
export const formatMonthYear = (isoDate) => monthYearFormat.format(asDate(isoDate));

// "2026-10-26T03:15:00.000Z" -> "26 Oct 2026"
export const formatTimestamp = (iso) => timestampFormat.format(new Date(iso));

// "2026-10-26T03:15:00.000Z" -> "26 Oct, 2:15 pm" (in the device's time zone)
export const formatDateTime = (iso) => dateTimeFormat.format(new Date(iso));

// Today's date on this device, as YYYY-MM-DD.
export const todayLocal = () => new Date().toLocaleDateString('en-CA');
