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
  return localDateFormatter(locale, style).format(utc);
}

// Building an `Intl.DateTimeFormat` costs about a tenth of a millisecond, and a table of Movimientos
// formats one date per row (500 rows, 50 ms): the formatter of each locale and style is made once.
const localDateFormatters = new Map<string, Intl.DateTimeFormat>();

function localDateFormatter(locale: string, style: DateStyle): Intl.DateTimeFormat {
  const key = `${locale}|${style}`;
  let formatter = localDateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { ...DATE_OPTIONS[style], timeZone: "UTC" });
    localDateFormatters.set(key, formatter);
  }
  return formatter;
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
 * The words of a weekday date from `Intl`, the way the app writes them: the weekday first and in
 * capitals, no comma ("Miércoles 21 de octubre"). The comma that es-UY puts after the weekday is
 * dropped and the first letter raised.
 */
function weekdayDateText(date: Date, timeZone: string, locale: string, withYear: boolean): string {
  const text = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone,
  })
    .formatToParts(date)
    .map((part) => (part.type === "literal" ? part.value.replace(/^,\s*/, " ") : part.value))
    .join("")
    .trim();
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
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
  return weekdayDateText(date, timeZone, locale, false);
}

/**
 * A movement's date (`YYYY-MM-DD`) with its weekday, as the day groups of Movimientos title it
 * ("Lunes 19 de octubre"; docs/diseno.md D19): formatted as is, with no time zone, so it can never
 * move to the neighbouring day. `year: true` adds the year ("Lunes 19 de octubre de 2025"), for a
 * date that is not of the current year. Throws a `RangeError` for a text that is not a real day.
 */
export function formatLocalWeekdayDate(
  date: string,
  options: { year?: boolean } = {},
  locale: string = DEFAULT_LOCALE,
): string {
  const utc = utcDateOf(date);
  if (!utc) throw new RangeError(`Expected a real YYYY-MM-DD date: "${date}"`);
  return weekdayDateText(utc, "UTC", locale, options.year === true);
}

/** `YYYY-MM`, the month filter of the list of movements: years 1900 to 2199, like the backend's pattern. */
const MONTH = /^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/;

/** Whether `text` is a month the backend accepts in `?month=` (`YYYY-MM`, years 1900 to 2199). */
export function isMonth(text: string): boolean {
  return MONTH.test(text);
}

/**
 * The current month (`YYYY-MM`) in the space's time zone: where Movimientos starts, and what its
 * "Mes siguiente" is compared with. `now` is a parameter so a test can fix it.
 */
export function currentMonthIn(timeZone: string, now: Date = new Date()): string {
  return todayInTimezone(timeZone, now).slice(0, 7);
}

/**
 * A month as the title of Movimientos writes it: "Octubre 2026" (the month in capitals, no "de").
 * Throws a `RangeError` for a text that is not a month the backend accepts.
 */
export function formatMonth(month: string, locale: string = DEFAULT_LOCALE): string {
  if (!isMonth(month)) throw new RangeError(`Expected a YYYY-MM month: "${month}"`);
  const [year, number] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
  const parts = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).formatToParts(new Date(Date.UTC(year, number - 1, 1)));
  const name = parts.find((part) => part.type === "month")?.value ?? "";
  return `${name.charAt(0).toLocaleUpperCase(locale)}${name.slice(1)} ${year}`;
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
