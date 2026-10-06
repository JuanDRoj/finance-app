import { describe, expect, it } from "vitest";
import { formatInstant, formatLocalDate, todayInTimezone } from "./dates";

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
