import { DEFAULT_LOCALE } from "./locale";

/** `short` "15 oct.", `medium` "15 oct. 2026", `long` "15 de octubre de 2026". */
export type DateStyle = "short" | "medium" | "long";
export type InstantStyle = DateStyle | "time" | "dateTime";

const DATE_OPTIONS: Readonly<Record<DateStyle, Intl.DateTimeFormatOptions>> = {
  short: { day: "numeric", month: "short" },
  medium: { day: "numeric", month: "short", year: "numeric" },
  long: { day: "numeric", month: "long", year: "numeric" },
};

const TIME_OPTIONS: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

const INSTANT_OPTIONS: Readonly<Record<InstantStyle, Intl.DateTimeFormatOptions>> = {
  ...DATE_OPTIONS,
  time: TIME_OPTIONS,
  dateTime: { ...DATE_OPTIONS.medium, ...TIME_OPTIONS },
};

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// The first and last year of a date: those of Python's `datetime.date`, which the backend uses (0001 to 9999).
const MIN_YEAR = 1;
const MAX_YEAR = 9999;

// ISO 8601 with a mandatory `Z` or `±hh:mm` offset. Without one, `new Date(text)` reads the text
// in the device's time zone and the instant would silently change from phone to phone.
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Formats a transaction date (`YYYY-MM-DD`, a local date with no time). It is formatted as is,
 * with no time zone applied, so it can never move to the previous or next day.
 */
export function formatLocalDate(
  date: string,
  style: DateStyle = "medium",
  locale: string = DEFAULT_LOCALE,
): string {
  const match = LOCAL_DATE.exec(date);
  if (!match) throw new RangeError(`Expected a YYYY-MM-DD date: "${date}"`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new RangeError(`Not a real calendar date: "${date}"`);
  }
  return new Intl.DateTimeFormat(locale, { ...DATE_OPTIONS[style], timeZone: "UTC" }).format(utc);
}

/**
 * Formats an instant (`timestamptz`, UTC from the API) in the space's time zone
 * (`spaces.timezone`, an IANA name such as `America/Montevideo`). A string must carry its UTC
 * offset (`Z` or `±hh:mm`); a `Date` is already an exact instant.
 */
export function formatInstant(
  instant: string | Date,
  timeZone: string,
  style: InstantStyle = "dateTime",
  locale: string = DEFAULT_LOCALE,
): string {
  if (typeof instant === "string" && !ISO_INSTANT.test(instant)) {
    throw new RangeError(`Instant must be ISO 8601 with "Z" or a ±hh:mm offset: "${instant}"`);
  }
  const date = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid instant: "${String(instant)}"`);
  return new Intl.DateTimeFormat(locale, { ...INSTANT_OPTIONS[style], timeZone }).format(date);
}

/** Today's date (`YYYY-MM-DD`) in the space's time zone, e.g. the default for a new transaction. */
export function todayInTimezone(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * The `Date` (at 00:00 UTC) of a real calendar day written `YYYY-MM-DD`, or `null` if it is not one
 * ("2026-02-30"). The year starts at 1, like Python's `datetime.date` that the backend parses a
 * movement's date with: "0000-01-01" would pass a calendar check here and be a 422 there.
 */
function utcDateOf(date: string): Date | null {
  const match = LOCAL_DATE.exec(date);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < MIN_YEAR) return null;
  // `new Date(0)` is midnight UTC; `setUTCFullYear` (unlike `Date.UTC`) takes a year from 1 to 99 as is.
  const utc = new Date(0);
  utc.setUTCFullYear(year, month - 1, day);
  // "02-30" rolls over to March: it is not a real day if the parts do not come back as given.
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  return utc;
}

/** Whether `text` is a real calendar day written `YYYY-MM-DD` (what an `<input type="date">` gives, or ""). */
export function isLocalDate(text: string): boolean {
  return utcDateOf(text) !== null;
}

/**
 * The calendar day `days` after (or before, if negative) a local date, as `YYYY-MM-DD`. Pure
 * calendar arithmetic on the day, with no time zone and no daylight saving, so "yesterday" of
 * `todayInTimezone(space.timezone)` is `shiftLocalDate(today, -1)` and can never skip or repeat a
 * day. Throws a `RangeError` for a text that is not a real day, a `days` that is not an integer, or
 * a move out of years 0001 to 9999.
 */
export function shiftLocalDate(date: string, days: number): string {
  const utc = utcDateOf(date);
  if (!utc) throw new RangeError(`Expected a real YYYY-MM-DD date: "${date}"`);
  if (!Number.isInteger(days)) throw new RangeError(`Expected a whole number of days: ${days}`);
  utc.setUTCDate(utc.getUTCDate() + days);
  // Past the first or last day of the calendar there is no `YYYY-MM-DD` to give back.
  if (utc.getUTCFullYear() < MIN_YEAR || utc.getUTCFullYear() > MAX_YEAR) {
    throw new RangeError(`The date is out of range after moving ${days} days: "${date}"`);
  }
  const year = String(utc.getUTCFullYear()).padStart(4, "0");
  const month = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const day = String(utc.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * A date as the header of the Inicio writes it: the weekday first, in capitals, and no comma
 * ("Miércoles 21 de octubre"). It is "today" in the space's time zone (`spaces.timezone`), never
 * the device's: an instant near midnight must not name the neighbouring day. The words come from
 * `Intl`; only the comma that es-UY puts after the weekday is dropped and the first letter raised.
 */
export function formatWeekdayDate(
  instant: string | Date,
  timeZone: string,
  locale: string = DEFAULT_LOCALE,
): string {
  if (typeof instant === "string" && !ISO_INSTANT.test(instant)) {
    throw new RangeError(`Instant must be ISO 8601 with "Z" or a ±hh:mm offset: "${instant}"`);
  }
  const date = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid instant: "${String(instant)}"`);
  const text = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone,
  })
    .formatToParts(date)
    .map((part) => (part.type === "literal" ? part.value.replace(/^,\s*/, " ") : part.value))
    .join("")
    .trim();
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

/**
 * The day and the month of an instant in words, as the list of archived categories dates them
 * ("18 de octubre"; docs/diseno.md D19). The year is added only when it is not the current one in
 * the same zone ("18 de octubre de 2025"), so an old date is never taken for this year's. Both the
 * day and the year are those of the space's time zone (`spaces.timezone`), never the device's.
 * `now` is the moment taken as "today" (a parameter, so a test can fix it).
 */
export function formatInstantDayMonth(
  instant: string | Date,
  timeZone: string,
  now: Date = new Date(),
  locale: string = DEFAULT_LOCALE,
): string {
  if (typeof instant === "string" && !ISO_INSTANT.test(instant)) {
    throw new RangeError(`Instant must be ISO 8601 with "Z" or a ±hh:mm offset: "${instant}"`);
  }
  const date = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid instant: "${String(instant)}"`);
  const yearOf = (moment: Date) =>
    new Intl.DateTimeFormat("en-CA", { year: "numeric", timeZone }).format(moment);
  const sameYear = yearOf(date) === yearOf(now);
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone,
  }).format(date);
}
