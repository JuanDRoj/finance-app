import { describe, expect, it } from "vitest";
import {
  formatInstant,
  formatInstantDayMonth,
  formatLocalDate,
  formatWeekdayDate,
  isLocalDate,
  shiftLocalDate,
  todayInTimezone,
} from "./dates";

describe("test environment", () => {
  it("runs with a negative-offset time zone, so a device-zone regression fails everywhere", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/Montevideo");
    expect(new Date(2026, 9, 15).getTimezoneOffset()).toBe(180);
  });
});

describe("formatLocalDate", () => {
  it("formats each style", () => {
    expect(formatLocalDate("2026-10-15", "short")).toBe("15 oct.");
    expect(formatLocalDate("2026-10-15", "medium")).toBe("15 oct. 2026");
    expect(formatLocalDate("2026-10-15", "long")).toBe("15 de octubre de 2026");
  });

  it("uses medium by default", () => {
    expect(formatLocalDate("2026-10-15")).toBe("15 oct. 2026");
  });

  it("never moves the day at year boundaries (no time zone is applied)", () => {
    expect(formatLocalDate("2026-01-01")).toBe("1 ene. 2026");
    expect(formatLocalDate("2026-12-31")).toBe("31 dic. 2026");
    expect(formatLocalDate("2028-02-29")).toBe("29 feb. 2028");
  });

  it("accepts an explicit locale", () => {
    expect(formatLocalDate("2026-10-15", "long", "en-US")).toBe("October 15, 2026");
  });

  it("rejects text that is not a YYYY-MM-DD date", () => {
    for (const value of ["", "15/10/2026", "2026-1-5", "2026-10-15T00:00:00Z", "hoy"]) {
      expect(() => formatLocalDate(value)).toThrow(RangeError);
    }
  });

  it("rejects dates that do not exist", () => {
    for (const value of ["2026-02-30", "2026-13-01", "2026-00-10", "2027-02-29", "2026-04-31"]) {
      expect(() => formatLocalDate(value)).toThrow(RangeError);
    }
  });
});

describe("formatInstant", () => {
  // 2026-10-15T02:30Z is still the 14th in Montevideo (UTC-3, no daylight saving).
  const instant = "2026-10-15T02:30:00Z";

  it("converts an instant to the day of the space's time zone", () => {
    expect(formatInstant(instant, "America/Montevideo", "medium")).toBe("14 oct. 2026");
    expect(formatInstant(instant, "UTC", "medium")).toBe("15 oct. 2026");
    expect(formatInstant(instant, "Asia/Tokyo", "medium")).toBe("15 oct. 2026");
  });

  it("formats the time of day in the time zone", () => {
    expect(formatInstant(instant, "America/Montevideo", "time")).toBe("11:30 p. m.");
    expect(formatInstant(instant, "UTC", "time")).toBe("2:30 a. m.");
  });

  it("formats date and time together by default", () => {
    expect(formatInstant(instant, "America/Montevideo")).toBe("14 oct. 2026, 11:30 p. m.");
  });

  it("follows daylight saving of the zone", () => {
    // Santiago: UTC-3 in January (summer time), UTC-4 in July.
    expect(formatInstant("2026-01-15T12:00:00Z", "America/Santiago", "time")).toBe("9:00 a. m.");
    expect(formatInstant("2026-07-15T12:00:00Z", "America/Santiago", "time")).toBe("8:00 a. m.");
  });

  it("accepts a Date and each date style", () => {
    const date = new Date(instant);
    expect(formatInstant(date, "America/Montevideo", "short")).toBe("14 oct.");
    expect(formatInstant(date, "America/Montevideo", "long")).toBe("14 de octubre de 2026");
  });

  it("accepts the offset forms the API can send", () => {
    for (const text of [
      "2026-10-15T02:30:00Z",
      "2026-10-15T02:30:00.123Z",
      "2026-10-15T02:30:00+00:00",
      "2026-10-14T23:30:00-03:00",
      "2026-10-15T02:30Z",
      // Pydantic serializes microseconds.
      "2026-10-15T02:30:00.123456Z",
      "2026-10-14T23:30:00.123456-03:00",
    ]) {
      expect(formatInstant(text, "America/Montevideo", "dateTime")).toBe(
        "14 oct. 2026, 11:30 p. m.",
      );
    }
  });

  it("formats microsecond instants by truncating, never rounding up to the next minute", () => {
    expect(formatInstant("2026-10-15T02:30:59.999999Z", "UTC", "time")).toBe("2:30 a. m.");
  });

  it("rejects text without a UTC offset, which would depend on the device zone", () => {
    for (const text of [
      "2026-10-15T02:30:00",
      "2026-10-15T02:30:00.123",
      "2026-10-15",
      "2026-10-15 02:30:00Z",
      "2026-10-15T02:30:00-0300",
      "2026-10-15T02:30:00+03",
    ]) {
      expect(() => formatInstant(text, "UTC")).toThrow(RangeError);
    }
  });

  it("rejects an invalid instant or time zone", () => {
    expect(() => formatInstant("not a date", "UTC")).toThrow(RangeError);
    expect(() => formatInstant(instant, "Mars/Olympus")).toThrow(RangeError);
  });
});

describe("todayInTimezone", () => {
  it("returns the local date of the zone, crossing midnight UTC", () => {
    const now = new Date("2026-10-15T02:30:00Z");
    expect(todayInTimezone("America/Montevideo", now)).toBe("2026-10-14");
    expect(todayInTimezone("UTC", now)).toBe("2026-10-15");
    expect(todayInTimezone("Pacific/Auckland", now)).toBe("2026-10-15");
  });

  it("handles year boundaries", () => {
    const now = new Date("2026-12-31T23:30:00Z");
    expect(todayInTimezone("Asia/Tokyo", now)).toBe("2027-01-01");
    expect(todayInTimezone("America/Montevideo", now)).toBe("2026-12-31");
  });

  it("rejects an invalid time zone", () => {
    expect(() => todayInTimezone("Mars/Olympus")).toThrow(RangeError);
  });
});

describe("isLocalDate", () => {
  it("accepts a real calendar day written YYYY-MM-DD", () => {
    expect(isLocalDate("2026-10-26")).toBe(true);
    expect(isLocalDate("2028-02-29")).toBe(true);
    expect(isLocalDate("2026-12-31")).toBe(true);
  });

  it("rejects what an empty or half-typed date input gives, and days that do not exist", () => {
    expect(isLocalDate("")).toBe(false);
    expect(isLocalDate("2026-10")).toBe(false);
    expect(isLocalDate("26-10-2026")).toBe(false);
    expect(isLocalDate("2026-13-01")).toBe(false);
    expect(isLocalDate("2026-02-30")).toBe(false);
    expect(isLocalDate("2027-02-29")).toBe(false);
    expect(isLocalDate("2026-10-26T00:00:00")).toBe(false);
    expect(isLocalDate(" 2026-10-26")).toBe(false);
  });

  it("starts at year 1, like the date of the backend (Python): year 0 would be a 422 there", () => {
    expect(isLocalDate("0000-01-01")).toBe(false);
    expect(isLocalDate("0000-12-31")).toBe(false);
    expect(isLocalDate("0001-01-01")).toBe(true);
    expect(isLocalDate("0050-06-15")).toBe(true);
    expect(isLocalDate("9999-12-31")).toBe(true);
  });
});

describe("shiftLocalDate", () => {
  it("moves a day back and forward", () => {
    expect(shiftLocalDate("2026-10-26", -1)).toBe("2026-10-25");
    expect(shiftLocalDate("2026-10-26", 1)).toBe("2026-10-27");
    expect(shiftLocalDate("2026-10-26", 0)).toBe("2026-10-26");
    expect(shiftLocalDate("2026-10-26", -30)).toBe("2026-09-26");
  });

  it("crosses the end of a month, of a year and a leap day", () => {
    expect(shiftLocalDate("2026-11-01", -1)).toBe("2026-10-31");
    expect(shiftLocalDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftLocalDate("2028-03-01", -1)).toBe("2028-02-29");
    expect(shiftLocalDate("2027-01-01", -1)).toBe("2026-12-31");
    expect(shiftLocalDate("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("does not skip or repeat a day when the clocks change (it has no time zone)", () => {
    // Montevideo has no daylight saving now; New York changed its clocks on 2026-11-01 and 2026-03-08.
    expect(shiftLocalDate("2026-11-02", -1)).toBe("2026-11-01");
    expect(shiftLocalDate("2026-11-01", -1)).toBe("2026-10-31");
    expect(shiftLocalDate("2026-03-09", -1)).toBe("2026-03-08");
    expect(shiftLocalDate("2026-03-08", -1)).toBe("2026-03-07");
  });

  it("gives yesterday of the space's today", () => {
    // 02:30 UTC on the 15th is still the 14th in Montevideo: yesterday is the 13th.
    const today = todayInTimezone("America/Montevideo", new Date("2026-10-15T02:30:00Z"));
    expect(shiftLocalDate(today, -1)).toBe("2026-10-13");
  });

  it("keeps a four-digit year", () => {
    expect(shiftLocalDate("0999-12-31", 1)).toBe("1000-01-01");
    expect(shiftLocalDate("1000-01-01", -1)).toBe("0999-12-31");
  });

  it("throws a RangeError when the move leaves years 0001 to 9999", () => {
    expect(shiftLocalDate("0001-01-02", -1)).toBe("0001-01-01");
    expect(() => shiftLocalDate("0001-01-01", -1)).toThrow(RangeError);
    expect(shiftLocalDate("9999-12-30", 1)).toBe("9999-12-31");
    expect(() => shiftLocalDate("9999-12-31", 1)).toThrow(RangeError);
    // A date of year 0 is not a date to begin with.
    expect(() => shiftLocalDate("0000-01-01", 1)).toThrow(RangeError);
  });

  it("throws a RangeError for a date that is not a real day or days that are not whole", () => {
    expect(() => shiftLocalDate("", 1)).toThrow(RangeError);
    expect(() => shiftLocalDate("2026-02-30", 1)).toThrow(RangeError);
    expect(() => shiftLocalDate("2026-10-26", 0.5)).toThrow(RangeError);
    expect(() => shiftLocalDate("2026-10-26", Number.NaN)).toThrow(RangeError);
  });
});

describe("formatWeekdayDate", () => {
  it("writes the weekday in capitals, without a comma, and the day and month in words", () => {
    // 21 October 2026 is a Wednesday.
    expect(formatWeekdayDate("2026-10-21T15:00:00Z", "America/Montevideo")).toBe(
      "Miércoles 21 de octubre",
    );
    expect(formatWeekdayDate("2026-10-19T15:00:00Z", "America/Montevideo")).toBe(
      "Lunes 19 de octubre",
    );
    expect(formatWeekdayDate("2026-01-01T15:00:00Z", "America/Montevideo")).toBe(
      "Jueves 1 de enero",
    );
  });

  it("uses the day of the space's time zone, not of the UTC instant nor of the device", () => {
    // 01:30 UTC of Thursday the 22nd is still Wednesday the 21st at 22:30 in Montevideo (UTC-3)...
    expect(formatWeekdayDate("2026-10-22T01:30:00Z", "America/Montevideo")).toBe(
      "Miércoles 21 de octubre",
    );
    // ...and already Thursday in Madrid (UTC+2 in October).
    expect(formatWeekdayDate("2026-10-22T01:30:00Z", "Europe/Madrid")).toBe("Jueves 22 de octubre");
  });

  it("accepts a Date, the instant of 'now'", () => {
    expect(formatWeekdayDate(new Date("2026-10-21T15:00:00Z"), "America/Montevideo")).toBe(
      "Miércoles 21 de octubre",
    );
  });

  it("rejects an instant with no offset and an invalid one, like formatInstant", () => {
    expect(() => formatWeekdayDate("2026-10-21T15:00:00", "America/Montevideo")).toThrow(
      RangeError,
    );
    expect(() => formatWeekdayDate(new Date("nope"), "America/Montevideo")).toThrow(RangeError);
  });
});

describe("formatInstantDayMonth", () => {
  const NOW = new Date("2026-10-28T15:00:00Z");

  it("writes the day and the month in words, with no year in the current one", () => {
    expect(formatInstantDayMonth("2026-10-18T15:00:00Z", "America/Montevideo", NOW)).toBe(
      "18 de octubre",
    );
    expect(formatInstantDayMonth("2026-01-02T15:00:00Z", "America/Montevideo", NOW)).toBe(
      "2 de enero",
    );
  });

  it("adds the year when it is not the current one", () => {
    expect(formatInstantDayMonth("2025-10-18T15:00:00Z", "America/Montevideo", NOW)).toBe(
      "18 de octubre de 2025",
    );
  });

  it("uses the day and the year of the space's zone, not of UTC nor of the device", () => {
    // 02:00 UTC of 1 January 2027 is still 31 December 2026 at 23:00 in Montevideo (UTC-3)...
    const instant = "2027-01-01T02:00:00Z";
    expect(formatInstantDayMonth(instant, "America/Montevideo", NOW)).toBe("31 de diciembre");
    // ...and already 2027 in Madrid, which is not the current year there.
    expect(formatInstantDayMonth(instant, "Europe/Madrid", NOW)).toBe("1 de enero de 2027");
  });

  it("takes 'today' from now, in the same zone: new year's eve is not last year's date", () => {
    const newYear = new Date("2027-01-01T01:00:00Z"); // still 2026 in Montevideo
    expect(formatInstantDayMonth("2026-10-18T15:00:00Z", "America/Montevideo", newYear)).toBe(
      "18 de octubre",
    );
  });

  it("accepts a Date and rejects an instant with no offset or an invalid one", () => {
    expect(formatInstantDayMonth(new Date("2026-10-18T15:00:00Z"), "America/Montevideo", NOW)).toBe(
      "18 de octubre",
    );
    expect(() => formatInstantDayMonth("2026-10-18T15:00:00", "America/Montevideo", NOW)).toThrow(
      RangeError,
    );
    expect(() => formatInstantDayMonth(new Date("nope"), "America/Montevideo", NOW)).toThrow(
      RangeError,
    );
  });
});
