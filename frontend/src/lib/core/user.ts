import type { UserRead } from "./data/me";

/**
 * The name to show for a user: their `display_name`; without one, the part of the email before
 * the last `@` (docs/decisiones-producto.md: it is never stored). An email with no `@`, or with
 * nothing before it, is shown whole.
 */
export function displayNameOf(user: Pick<UserRead, "display_name" | "email">): string {
  const name = user.display_name?.trim();
  if (name) return name;

  const email = user.email.trim();
  const at = email.lastIndexOf("@");
  return at > 0 ? email.slice(0, at) : email;
}

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** The first letter or digit of a word, upper case in Spanish; `null` if it has none. */
function firstLetterOrDigit(word: string): string | null {
  const first = Array.from(word).find((character) => LETTER_OR_DIGIT.test(character));
  return first === undefined ? null : first.toLocaleUpperCase("es");
}

/**
 * The letters of the avatar: the first letter (or digit) of each of the first two words of
 * `displayNameOf(user)`, upper case in Spanish: "Juan David" is "JD", "Ana María Pérez Gómez" is
 * "AM", "Ana" is "A". A word with no letter or digit (an emoji, "-") is skipped, not counted as
 * one of the two. `null` when the name has none (for example `!!!`): the avatar then shows a
 * generic person icon instead of an odd character. It goes through `Array.from`, so a letter
 * outside the BMP is kept whole.
 */
export function initialsOf(user: Pick<UserRead, "display_name" | "email">): string | null {
  const initials = displayNameOf(user)
    .split(/\s+/u)
    .map(firstLetterOrDigit)
    .filter((initial): initial is string => initial !== null)
    .slice(0, 2);
  return initials.length === 0 ? null : initials.join("");
}
