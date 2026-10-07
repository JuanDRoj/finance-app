import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const publicDir = new URL("../../public/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, publicDir), "utf8");

const manifest = JSON.parse(read("site.webmanifest")) as {
  name: string;
  short_name: string;
  theme_color: string;
  icons: { src: string }[];
};

describe("Kanza brand assets (kit v2, public/)", () => {
  it("names the app Kanza in the manifest", () => {
    expect(manifest.name).toBe("Kanza");
    expect(manifest.short_name).toBe("Kanza");
  });

  it("uses the light `primary` token as the manifest theme color", () => {
    const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
    const primary = /:root\s*\{[^}]*--primary:\s*(#[0-9a-f]{6})/i.exec(css)?.[1];
    expect(manifest.theme_color.toLowerCase()).toBe(primary?.toLowerCase());
  });

  it("ships every icon the manifest points to", () => {
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      expect(existsSync(new URL(`.${icon.src}`, publicDir)), icon.src).toBe(true);
    }
  });

  it("ships the files that layout.tsx registers and the login uses", () => {
    for (const file of [
      "favicon.ico",
      "favicon.svg",
      "apple-touch-icon.png",
      "site.webmanifest",
      "brand/kanza-icon.svg",
      "brand/kanza-peek.svg",
    ]) {
      expect(existsSync(new URL(file, publicDir)), file).toBe(true);
    }
  });

  it("keeps only approved Kanza SVGs in public/brand (no third-party logo library)", () => {
    const files = readdirSync(new URL("brand/", publicDir)).sort();
    expect(files).toEqual([
      "kanza-icon.svg",
      "kanza-lockup-horizontal-dark.svg",
      "kanza-lockup-horizontal.svg",
      "kanza-lockup-vertical.svg",
      "kanza-peek.svg",
    ]);
  });

  it("has no scripts inside the SVGs", () => {
    for (const file of [
      "favicon.svg",
      ...readdirSync(new URL("brand/", publicDir)).map((f) => `brand/${f}`),
    ]) {
      expect(read(file).toLowerCase(), file).not.toContain("<script");
    }
  });
});
