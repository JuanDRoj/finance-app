"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { CategoryEditForm } from "@/components/categories/category-edit-form";
import { CategoryForm } from "@/components/categories/category-form";
import { CategoryPanelSheet } from "@/components/categories/category-panel-sheet";
import { SelectField } from "@/components/select-field";
import { Button } from "@/components/ui/button";
import type { ApiClient } from "@/lib/core/data/api-client";
import type { CategoryRead } from "@/lib/core/data/categories";

// Demos of the forms of a category (KAN-96): "Nueva categoría" and "Editar categoría" as pages (below
// 1024 px, each in a 360 px frame with its fixed bar) and as the side panel, with the real components
// and a **scripted API client** (the catalog has no session). Selects choose the data (normal or the
// worst case: names of 80 characters, no spaces, emoji, other alphabets, a principal with twelve
// subcategories, thirty principals to choose from, an icon this frontend does not know) and what the
// "server" answers, so the 409 of a repeated name, the 422 and the failures can be seen on purpose.

const SPACE = { id: "00000000-0000-4000-8000-000000000000" };

export const ARCHIVED_AT = "2026-10-18T15:00:00Z";

export function category(
  id: string,
  name: string,
  icon: CategoryRead["icon"],
  overrides: Partial<CategoryRead> = {},
): CategoryRead {
  return {
    id: `00000000-0000-4000-8000-${id.padStart(12, "0")}`,
    name,
    icon,
    kind: "expense",
    parent_id: null,
    archived_at: null,
    ...overrides,
  };
}

export const idOf = (id: string) => `00000000-0000-4000-8000-${id.padStart(12, "0")}`;

/** The default categories, a few archived ones (Mascotas with Veterinaria, Viajes) and an income. */
export const NORMAL: CategoryRead[] = [
  category("1", "Comida", "fork-knife"),
  category("2", "Transporte", "car"),
  category("3", "Hogar", "house"),
  category("4", "Ropa", "t-shirt"),
  category("5", "Ocio", "game-controller"),
  category("6", "Trabajo", "briefcase", { kind: "income" }),
  category("10", "Supermercado", "shopping-cart", { parent_id: idOf("1") }),
  category("11", "Restaurantes", "bowl-food", { parent_id: idOf("1") }),
  category("12", "Combustible", "gas-pump", { parent_id: idOf("2") }),
  category("13", "Taxi y apps", "taxi", { parent_id: idOf("2") }),
  category("14", "Sueldo", "money", { kind: "income", parent_id: idOf("6") }),
  category("20", "Mascotas", "paw-print", { archived_at: ARCHIVED_AT }),
  category("21", "Veterinaria", "stethoscope", { parent_id: idOf("20"), archived_at: ARCHIVED_AT }),
  category("22", "Viajes", "airplane-tilt", {
    parent_id: idOf("5"),
    archived_at: "2026-10-02T15:00:00Z",
  }),
];

/** An 80-character name with spaces (the most the backend accepts) that has to wrap. */
const LONG_NAME =
  "Gastos del consorcio, expensas comunes y fondo de reserva del edificio de Pocitos".slice(0, 80);
/** 80 characters with nothing to break at: the browser cannot wrap it. */
const UNBREAKABLE_NAME =
  "Super/Feria/Almacén/Verdulería/Carnicería/Panadería/Rotisería/Kiosco/Farmacia/Otras".slice(
    0,
    80,
  );

/** The same list as the worst case: the longest names, other alphabets, emoji and a lot of everything. */
export const WORST: CategoryRead[] = [
  category("1", LONG_NAME, "fork-knife"),
  category("2", UNBREAKABLE_NAME, "car"),
  category("3", "🛒 Compras del súper 🍎", "house"),
  category("4", "A", "t-shirt"),
  category("5", "مصاريف البيت", "game-controller"),
  category("6", "日常の買い物と「ご褒美」", "briefcase", { kind: "income" }),
  category("7", "Con «comillas» y “comillas”", "tag"),
  // A principal with twelve active subcategories: the help of "Archivar categoría" counts them.
  ...Array.from({ length: 12 }, (_, index) =>
    category(`${100 + index}`, `Subcategoría ${index + 1} de ${LONG_NAME.slice(0, 20)}`, "tag", {
      parent_id: idOf("1"),
    }),
  ),
  category("30", UNBREAKABLE_NAME, "taxi", { parent_id: idOf("2") }),
  // Thirty more principals: "Dentro de" is a long list of long names.
  ...Array.from({ length: 30 }, (_, index) =>
    category(
      `${200 + index}`,
      `Categoría principal número ${index + 1} con un nombre largo`,
      "star",
    ),
  ),
  // An icon the backend added after this frontend was built: it must show the generic tag.
  category("40", "Con un ícono nuevo", "a-future-icon" as CategoryRead["icon"]),
  category("20", "Mascotas", "paw-print", { archived_at: ARCHIVED_AT }),
  category("21", LONG_NAME.slice(0, 40), "stethoscope", {
    parent_id: idOf("20"),
    archived_at: ARCHIVED_AT,
  }),
];

type DataChoice = "normal" | "worst";
const DATA_CHOICES: Record<DataChoice, string> = {
  normal: "Datos normales",
  worst:
    "Peor caso (nombres de 80 caracteres, sin espacios, emoji, otros alfabetos, 12 subcategorías, 30 principales)",
};
const DATA: Record<DataChoice, CategoryRead[]> = { normal: NORMAL, worst: WORST };

/** What can be edited in each dataset: [id, what it is]. */
const EDITABLE: Record<DataChoice, readonly (readonly [string, string])[]> = {
  normal: [
    ["2", "Una principal con 2 subcategorías (Transporte)"],
    ["13", "Una subcategoría (Taxi y apps)"],
    ["4", "Una principal sin subcategorías (Ropa)"],
    ["6", "Un ingreso (Trabajo)"],
  ],
  worst: [
    ["1", "Nombre de 80 caracteres y 12 subcategorías"],
    ["2", "Nombre de 80 caracteres sin espacios"],
    ["3", "Nombre con emoji"],
    ["5", "Nombre en árabe"],
    ["4", "Nombre de una letra"],
    ["40", "Un ícono que este frontend no conoce"],
    ["30", "Una subcategoría de nombre sin espacios"],
  ],
};

export type CategoryOutcome = "ok" | "never" | "taken" | "fields" | "parent" | "server" | "offline";
const OUTCOMES: Record<CategoryOutcome, string> = {
  ok: "Todo bien (tarda 1 s)",
  never: "Se queda cargando (nunca responde)",
  taken: "409: el nombre ya está en uso (escribe «Mascotas» o «Comida»)",
  fields: "422: marca el nombre",
  parent: "422: la categoría principal está archivada",
  server: "500: error del servidor",
  offline: "Sin conexión",
};

const never = () => new Promise<never>(() => {});
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const answer = (status: number, data?: unknown) =>
  status < 400
    ? { data, response: new Response(null, { status }) }
    : { error: data, response: new Response(null, { status }) };

/** An API client that answers as `now` says; the list of the space is `list` (archived ones on request). */
export function scriptedApi(
  now: CategoryOutcome,
  list: CategoryRead[],
  instant: boolean,
): ApiClient {
  async function mutate(path: string, init?: { body?: Record<string, unknown> }) {
    if (now === "never") return never();
    if (now === "offline") throw new TypeError("Failed to fetch");
    if (now === "server") return answer(500, { code: "internal_error", detail: "Boom" });
    const isCreate = path.endsWith("/categories");
    const isUpdate = path.endsWith("{category_id}");
    if (now === "taken" && (isCreate || isUpdate)) {
      return answer(409, {
        code: "category_name_taken",
        detail: "A category with this name already exists",
      });
    }
    if (now === "fields" && (isCreate || isUpdate)) {
      return answer(422, {
        detail: [{ type: "string_too_long", loc: ["body", "name"], msg: "Too long" }],
      });
    }
    if (now === "parent" && isCreate) {
      return answer(422, {
        detail: [
          {
            type: "category_parent_archived",
            loc: ["body", "parent_id"],
            msg: "The parent is archived",
          },
        ],
      });
    }
    if (!instant) await wait(1000);
    const found = (id: string) => list.find((item) => item.id === id);
    const pathId = (init as { params?: { path?: { category_id?: string } } } | undefined)?.params
      ?.path?.category_id;
    const target = pathId ? found(pathId) : undefined;
    if (path.endsWith("/archive")) {
      return answer(200, { ...target, archived_at: new Date().toISOString() });
    }
    if (path.endsWith("/unarchive")) return answer(200, { ...target, archived_at: null });
    if (isUpdate) return answer(200, { ...target, ...init?.body });
    return answer(201, { id: idOf("999"), parent_id: null, archived_at: null, ...init?.body });
  }
  return {
    async GET(_path: string, init?: { params?: { query?: { include_archived?: boolean } } }) {
      if (now === "offline") throw new TypeError("Failed to fetch");
      const all = init?.params?.query?.include_archived === true;
      return answer(200, all ? list : list.filter((item) => item.archived_at === null));
    },
    PATCH: (path: string, init: { body?: Record<string, unknown> }) => mutate(path, init as never),
    POST: (path: string, init: { body?: Record<string, unknown> }) => mutate(path, init as never),
  } as unknown as ApiClient;
}

export function Isolated({ children }: Readonly<{ children: ReactNode }>) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * A 360 px phone for a form that is a page. The frame has a `transform` and clips: that makes it the
 * containing block of the `fixed` bar at the bottom of the form (`PageFooter`), which then sits at
 * the bottom of the frame instead of the window, and the inner box scrolls under it.
 */
function PhoneFrame({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-sm font-bold">{title}</p>
      <div className="relative h-160 w-full max-w-90 transform-gpu overflow-hidden rounded-tile border border-border bg-background">
        <div className="h-full overflow-y-auto overscroll-contain p-4">{children}</div>
      </div>
    </div>
  );
}

/**
 * The forms of a category: "Nueva categoría" and "Editar categoría" as pages (each in its 360 px
 * frame) and as the side panel, plus the icon picker inside both. `instant` (for tests) answers
 * without latency.
 */
export function CategoryFormsDemo({ instant = false }: Readonly<{ instant?: boolean }>) {
  const [data, setData] = useState<DataChoice>("normal");
  const [outcome, setOutcome] = useState<CategoryOutcome>("ok");
  const [editId, setEditId] = useState<string>("2");
  const [round, setRound] = useState(0);
  // What the panel shows stays while it leaves, so its title does not change during the exit.
  const [panel, setPanel] = useState<"new" | "sub" | "edit">("new");
  const [panelOpen, setPanelOpen] = useState(false);
  const [log, setLog] = useState<string | null>(null);
  const list = DATA[data];
  const editable = EDITABLE[data];
  const effectiveEditId = editable.some(([id]) => id === editId)
    ? editId
    : (editable[0]?.[0] ?? "");
  const editing = list.find((item) => item.id === idOf(effectiveEditId)) ?? list[0]!;
  const api = useMemo(() => scriptedApi(outcome, list, instant), [outcome, list, instant]);
  // The principal that "Agregar subcategoría" starts on: the first active principal of the data.
  const principal = list.find((item) => item.parent_id === null && item.archived_at === null);

  function openPanel(which: "new" | "sub" | "edit") {
    setPanel(which);
    setPanelOpen(true);
  }

  return (
    <Isolated key={`${data}-${round}`}>
      <div className="flex flex-col gap-4">
        <div className="grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SelectField
            label="Qué datos"
            value={data}
            onChange={(event) => setData(event.target.value as DataChoice)}
          >
            {(Object.keys(DATA_CHOICES) as DataChoice[]).map((key) => (
              <option key={key} value={key}>
                {DATA_CHOICES[key]}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Qué responde el servidor al crear, guardar o archivar"
            value={outcome}
            onChange={(event) => setOutcome(event.target.value as CategoryOutcome)}
          >
            {(Object.keys(OUTCOMES) as CategoryOutcome[]).map((key) => (
              <option key={key} value={key}>
                {OUTCOMES[key]}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Qué categoría se edita"
            value={effectiveEditId}
            onChange={(event) => setEditId(event.target.value)}
          >
            {editable.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </SelectField>
        </div>
        <p className="text-sm text-muted-foreground">
          Abajo, los formularios como páginas (bajo 1024 px), cada uno en un marco de 360 px con su
          botón fijo al pie. Con «409» escribe «Mascotas» (archivada: ofrece «Desarchivar») o
          «Comida» (activa: solo el aviso). En «Datos normales» hay una principal archivada
          (Mascotas con Veterinaria) y Viajes, una subcategoría de Ocio archivada por su cuenta. Los
          botones abren el panel lateral (de 440 px, con el selector de 8 columnas).
        </p>
        <div className="grid items-start gap-5 md:grid-cols-2">
          <PhoneFrame title="Nueva categoría (página)">
            <CategoryForm
              key={round}
              space={SPACE}
              categories={list}
              variant="page"
              api={api}
              onDone={(created) =>
                setLog(`Se guardó «${created.name}»: el contenedor sale del formulario.`)
              }
            />
          </PhoneFrame>
          <PhoneFrame title="Editar categoría (página)">
            <CategoryEditForm
              key={`${round}-${editing.id}`}
              category={editing}
              categories={list}
              space={SPACE}
              variant="page"
              api={api}
              onDone={(saved) => setLog(saved ? "Se guardaron los cambios." : "No había cambios.")}
              onArchived={() =>
                setLog("La categoría se archivó: el contenedor sale del formulario.")
              }
            />
          </PhoneFrame>
        </div>
        {log ? (
          <p role="status" className="text-sm font-bold">
            {log}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setLog(null);
              setRound((n) => n + 1);
            }}
          >
            Empezar de nuevo
          </Button>
          <Button variant="secondary" size="sm" onClick={() => openPanel("new")}>
            Abrir el panel «Nueva categoría»
          </Button>
          <Button variant="secondary" size="sm" onClick={() => openPanel("sub")}>
            Abrir el panel «Nueva categoría» desde «Agregar subcategoría»
          </Button>
          <Button variant="secondary" size="sm" onClick={() => openPanel("edit")}>
            Abrir el panel «Editar categoría»
          </Button>
        </div>
        <CategoryPanelSheet
          open={panelOpen}
          mode={panel === "edit" ? "edit" : "new"}
          space={SPACE}
          categoryId={editing.id}
          defaults={panel === "sub" && principal ? { parentId: principal.id } : undefined}
          onClose={() => setPanelOpen(false)}
          api={api}
        />
      </div>
    </Isolated>
  );
}
