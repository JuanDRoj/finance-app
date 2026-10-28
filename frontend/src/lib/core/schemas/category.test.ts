import { describe, expect, it } from "vitest";
import {
  CATEGORY_ICON_KEYS,
  CATEGORY_NAME_MAX_LENGTH,
  DEFAULT_CATEGORY_ICON,
  categoryEditFieldOf,
  categoryEditSchema,
  categoryEditValuesOf,
  categoryFormDefaults,
  categoryFormFieldOf,
  categoryFormSchema,
} from "./category";
import { CATEGORY_ICON_NAMES } from "../i18n";

const PARENT_ID = "0b0f1a5e-6f0b-4c7c-9d3a-2f4a9b9c0010";

function parse(values: Partial<Parameters<typeof categoryFormSchema.safeParse>[0]> = {}) {
  return categoryFormSchema.safeParse({ ...categoryFormDefaults(), name: "Gimnasio", ...values });
}

function messages(result: ReturnType<typeof parse>) {
  if (result.success) return {};
  return Object.fromEntries(
    result.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
  );
}

describe("the icon list", () => {
  it("has the 66 keys of the names, in the backend's order", () => {
    expect(CATEGORY_ICON_KEYS).toEqual(Object.keys(CATEGORY_ICON_NAMES));
    expect(CATEGORY_ICON_KEYS).toHaveLength(66);
    expect(DEFAULT_CATEGORY_ICON).toBe("tag");
  });
});

describe("categoryFormDefaults", () => {
  it("starts as a principal expense category with the generic icon", () => {
    expect(categoryFormDefaults()).toEqual({
      kind: "expense",
      name: "",
      parentId: "",
      icon: "tag",
    });
  });

  it("takes the kind and the principal from where the form was opened", () => {
    expect(categoryFormDefaults({ kind: "income", parentId: PARENT_ID })).toEqual({
      kind: "income",
      name: "",
      parentId: PARENT_ID,
      icon: "tag",
    });
  });
});

describe("categoryFormSchema", () => {
  it("turns a principal category into the body of POST, with no parent_id", () => {
    const result = parse({ kind: "income", icon: "barbell" });
    expect(result.success && result.data).toEqual({
      name: "Gimnasio",
      kind: "income",
      icon: "barbell",
    });
    expect(result.success && "parent_id" in result.data).toBe(false);
  });

  it("sends the principal of a subcategory as parent_id", () => {
    const result = parse({ parentId: PARENT_ID });
    expect(result.success && result.data).toEqual({
      name: "Gimnasio",
      kind: "expense",
      icon: "tag",
      parent_id: PARENT_ID,
    });
  });

  it("trims the name", () => {
    const result = parse({ name: "  Gimnasio\t" });
    expect(result.success && result.data.name).toBe("Gimnasio");
  });

  it("asks for a name: empty and blank are the same error", () => {
    expect(messages(parse({ name: "" })).name).toBe("Escribe un nombre.");
    expect(messages(parse({ name: "    " })).name).toBe("Escribe un nombre.");
  });

  it("accepts 80 characters and refuses 81, counting code points", () => {
    expect(parse({ name: "a".repeat(CATEGORY_NAME_MAX_LENGTH) }).success).toBe(true);
    expect(messages(parse({ name: "a".repeat(81) })).name).toBe("Usa como máximo 80 caracteres.");
    // An emoji is two UTF-16 units but one character for the backend: 80 of them are accepted.
    expect(parse({ name: "🛒".repeat(80) }).success).toBe(true);
    expect(parse({ name: "🛒".repeat(81) }).success).toBe(false);
  });

  it("accepts the accents and the punctuation of real names", () => {
    expect(parse({ name: "Cafés y «meriendas» — 2x1" }).success).toBe(true);
  });

  it("refuses a kind or an icon that is not on the list", () => {
    expect(messages(parse({ kind: "transfer" as never })).kind).toBe("Elige un tipo.");
    expect(messages(parse({ icon: "rocket" as never })).icon).toBe("Elige un ícono.");
    expect(messages(parse({ icon: "" as never })).icon).toBe("Elige un ícono.");
  });

  it("accepts every icon of the list", () => {
    for (const icon of CATEGORY_ICON_KEYS) expect(parse({ icon }).success).toBe(true);
  });

  it("reports every problem at once", () => {
    expect(messages(parse({ name: "", icon: "x" as never }))).toEqual({
      name: "Escribe un nombre.",
      icon: "Elige un ícono.",
    });
  });
});

describe("categoryFormFieldOf", () => {
  it("maps the fields of the backend's body to the form's", () => {
    expect(categoryFormFieldOf("name")).toBe("name");
    expect(categoryFormFieldOf("kind")).toBe("kind");
    expect(categoryFormFieldOf("icon")).toBe("icon");
    expect(categoryFormFieldOf("parent_id")).toBe("parentId");
  });

  it("has no field for anything else, nor for a name that is an object property", () => {
    expect(categoryFormFieldOf("extra")).toBeUndefined();
    expect(categoryFormFieldOf("constructor")).toBeUndefined();
    expect(categoryFormFieldOf("")).toBeUndefined();
  });
});

describe("categoryEditSchema", () => {
  const category = { name: "Transporte", icon: "car" } as const;
  const schema = categoryEditSchema(category);

  it("starts from the category's own values", () => {
    expect(categoryEditValuesOf(category)).toEqual({ name: "Transporte", icon: "car" });
  });

  it("sends an empty body when nothing changed: nothing to save", () => {
    const result = schema.safeParse(categoryEditValuesOf(category));
    expect(result.success && result.data).toEqual({});
  });

  it("sends only the name when only the name changed, and only the icon when only the icon did", () => {
    const renamed = schema.safeParse({ name: "Movilidad", icon: "car" });
    expect(renamed.success && renamed.data).toEqual({ name: "Movilidad" });
    const reicon = schema.safeParse({ name: "Transporte", icon: "bus" });
    expect(reicon.success && reicon.data).toEqual({ icon: "bus" });
    const both = schema.safeParse({ name: " Movilidad ", icon: "bus" });
    expect(both.success && both.data).toEqual({ name: "Movilidad", icon: "bus" });
  });

  it("counts a name that differs only in case as a change, and the spaces at the ends as none", () => {
    const upper = schema.safeParse({ name: "TRANSPORTE", icon: "car" });
    expect(upper.success && upper.data).toEqual({ name: "TRANSPORTE" });
    const spaced = schema.safeParse({ name: "  Transporte ", icon: "car" });
    expect(spaced.success && spaced.data).toEqual({});
  });

  it("asks for a name of 1 to 80 characters and an icon of the list", () => {
    expect(schema.safeParse({ name: " ", icon: "car" }).success).toBe(false);
    expect(schema.safeParse({ name: "a".repeat(81), icon: "car" }).success).toBe(false);
    expect(schema.safeParse({ name: "a".repeat(80), icon: "car" }).success).toBe(true);
    expect(schema.safeParse({ name: "Ok", icon: "nope" }).success).toBe(false);
  });

  it("lets a category keep an icon this frontend does not know, and does not send it", () => {
    const future = categoryEditSchema({ name: "Nueva", icon: "a-future-icon" as never });
    const renamed = future.safeParse({ name: "Otra", icon: "a-future-icon" });
    expect(renamed.success && renamed.data).toEqual({ name: "Otra" });
    // ...but nobody can choose one that is not on the list.
    expect(future.safeParse({ name: "Nueva", icon: "another-unknown" }).success).toBe(false);
  });

  it("points a 422 only at the name and the icon", () => {
    expect(categoryEditFieldOf("name")).toBe("name");
    expect(categoryEditFieldOf("icon")).toBe("icon");
    expect(categoryEditFieldOf("kind")).toBeUndefined();
    expect(categoryEditFieldOf("parent_id")).toBeUndefined();
  });
});
