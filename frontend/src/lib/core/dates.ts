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
 * (`spaces.timezone`, an IANA name such as `America/Montevideo`).
 */
export function formatInstant(
  instant: string | Date,
  timeZone: string,
  style: InstantStyle = "dateTime",
  locale: string = DEFAULT_LOCALE,
): string {
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
