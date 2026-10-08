import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname } from "node:path/posix";
import { describe, expect, it } from "vitest";

// fonts.json is the only place that lists the font files and their SHA-256 (the README explains
// the procedure and never repeats a hash). This guards what ships: the bytes that were reviewed,
// no binary nobody registered, and the license (SIL OFL) that must travel with each font.
const fontsDir = new URL("./", import.meta.url);

type FontEntry = {
  file: string;
  family: string;
  sha256: string;
  license: string;
  css: string;
  source?: string;
  note?: string;
};

const { files } = JSON.parse(readFileSync(new URL("fonts.json", fontsDir), "utf8")) as {
  files: FontEntry[];
};

const sha256Of = (file: string) =>
  createHash("sha256")
    .update(readFileSync(new URL(file, fontsDir)))
    .digest("hex");

// Any font binary, not only the .woff2 that the app loads today: a .ttf or .otf left in the folder
// would also ship without a registered hash and license.
const FONT_FILE = /\.(woff2?|ttf|otf)$/i;

// Every font file under src/app/fonts/, as a path relative to it (e.g. "karla/karla-latin-variable.woff2").
function fontFiles(dir: URL = fontsDir, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return fontFiles(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`);
    }
    return FONT_FILE.test(entry.name) ? [`${prefix}${entry.name}`] : [];
  });
}

describe("versioned fonts (src/app/fonts)", () => {
  it("lists at least one font", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((entry) => [entry.file, entry] as const))(
    "%s has the SHA-256 that fonts.json records",
    (_file, entry) => {
      expect(
        existsSync(new URL(entry.file, fontsDir)),
        `${entry.file} is listed in fonts.json but missing`,
      ).toBe(true);
      expect(
        sha256Of(entry.file),
        `${entry.file} changed. If you replaced the font on purpose, update its sha256 in fonts.json (and review it visually).`,
      ).toBe(entry.sha256);
    },
  );

  it("has no font file (.woff, .woff2, .ttf, .otf) that fonts.json does not list, and no entry without its file", () => {
    const listed = files.map((entry) => entry.file).sort();
    expect(fontFiles().sort()).toEqual(listed);
  });

  it.each(files.map((entry) => [entry.file, entry] as const))(
    "%s ships with its SIL OFL license (OFL.txt) in the same folder",
    (_file, entry) => {
      expect(
        dirname(entry.license),
        `${entry.license} must be in the same folder as ${entry.file} (${dirname(entry.file)}), not in another one or in a subfolder`,
      ).toBe(dirname(entry.file));
      expect(
        basename(entry.license),
        `The license of ${entry.file} must be named OFL.txt, not ${basename(entry.license)}`,
      ).toBe("OFL.txt");
      const text = readFileSync(new URL(entry.license, fontsDir), "utf8");
      expect(text).toMatch(/^Copyright /);
      expect(text).toContain("SIL OPEN FONT LICENSE");
    },
  );
});
