"use client";

import { useMemo, useState } from "react";
import { NewCategoryAction } from "@/app/categorias/_components/new-category-action";
import { CategoriesScreen } from "@/app/categorias/_components/categories-screen";
import { SelectField } from "@/components/select-field";
import { Button } from "@/components/ui/button";
import type { ApiClient } from "@/lib/core/data/api-client";
import type { CategoryRead } from "@/lib/core/data/categories";
import {
  ARCHIVED_AT,
  Isolated,
  NORMAL,
  WORST,
  category,
  idOf,
  scriptedApi,
  type CategoryOutcome,
} from "./category-demos";

// The screen Categorías (KAN-77) with the real components and a **scripted API client** (the catalog
// has no session): selects choose the data (normal, the worst case, many, none active, one) and what
// the "server" answers, to see every state: loading, error, the list and the failures of archiving
// and unarchiving. The scripted server does not change the list, so a created, renamed or archived
// category does not move on screen; what is shown is the request, the toast and the invalidation.

const SPACE = { id: "00000000-0000-4000-8000-000000000000", timezone: "America/Montevideo" };

/** 40 principals with 12 subcategories each, and 30 archived ones: 520 rows, the most a list should be. */
export function manyCategories(): CategoryRead[] {
  const rows: CategoryRead[] = [];
  for (let main = 0; main < 40; main += 1) {
    const kind = main < 30 ? "expense" : "income";
    const id = `${1000 + main}`;
    rows.push(
      category(id, `Categoría principal número ${main + 1} con un nombre largo`, "star", { kind }),
    );
    for (let sub = 0; sub < 12; sub += 1) {
      rows.push(
        category(`${id}${sub}`, `Subcategoría ${sub + 1} de la principal ${main + 1}`, "tag", {
          kind,
          parent_id: idOf(id),
        }),
      );
    }
  }
  for (let index = 0; index < 30; index += 1) {
    rows.push(
      category(
        `${5000 + index}`,
        `Archivada ${index + 1} con un nombre bastante largo`,
        "box" as never,
        {
          kind: index % 3 === 0 ? "income" : "expense",
          archived_at: ARCHIVED_AT,
        },
      ),
    );
  }
  return rows;
}

/** No active category, only archived ones: both kinds show their empty state and the list below. */
const NONE_ACTIVE: CategoryRead[] = NORMAL.map((item) =>
  item.archived_at === null ? { ...item, archived_at: "2026-09-01T15:00:00Z" } : item,
);

/** One principal with one subcategory, and an income with none: the singular of every count. */
const ONE: CategoryRead[] = [
  category("1", "Comida", "fork-knife"),
  category("2", "Supermercado", "shopping-cart", { parent_id: idOf("1") }),
  category("3", "Trabajo", "briefcase", { kind: "income" }),
];

export type ScreenData = "normal" | "worst" | "many" | "none" | "one";
const DATA_CHOICES: Record<ScreenData, string> = {
  normal: "Datos normales (con archivadas)",
  worst: "Peor caso (80 caracteres, sin espacios, emoji, otros alfabetos, un ícono nuevo)",
  many: "Muchas (40 principales con 12 subcategorías y 30 archivadas)",
  none: "Ninguna activa (solo archivadas)",
  one: "Una principal con una subcategoría",
};
let manyCache: CategoryRead[] | undefined;
const DATA: Record<ScreenData, () => CategoryRead[]> = {
  normal: () => NORMAL,
  worst: () => WORST,
  many: () => (manyCache ??= manyCategories()),
  none: () => NONE_ACTIVE,
  one: () => ONE,
};

export type ListLoad = "ok" | "loading" | "error";
const LOAD_CHOICES: Record<ListLoad, string> = {
  ok: "Carga bien",
  loading: "Se queda cargando",
  error: "Falla al cargar (500)",
};

const OUTCOMES: Partial<Record<CategoryOutcome, string>> = {
  ok: "Todo bien (tarda 1 s)",
  never: "Se queda cargando (nunca responde)",
  server: "500: error del servidor",
  offline: "Sin conexión",
};

/** The scripted client, with the load of the list as asked: the mutations answer as `scripted` says. */
function screenApi(load: ListLoad, scripted: ApiClient): ApiClient {
  if (load === "ok") return scripted;
  return {
    ...scripted,
    GET: () =>
      load === "loading"
        ? new Promise(() => {})
        : Promise.resolve({
            error: { code: "internal_error", detail: "Boom" },
            response: new Response(null, { status: 500 }),
          }),
  } as unknown as ApiClient;
}

/**
 * The screen Categorías with every state: `instant` (for tests) answers without latency. The header
 * action is the real one (it starts the form on the tab the list shows).
 */
export function CategoryScreenDemo({ instant = false }: Readonly<{ instant?: boolean }>) {
  const [data, setData] = useState<ScreenData>("normal");
  const [load, setLoad] = useState<ListLoad>("ok");
  const [outcome, setOutcome] = useState<CategoryOutcome>("ok");
  const [round, setRound] = useState(0);
  const list = useMemo(() => DATA[data](), [data]);
  const api = useMemo(
    () => screenApi(load, scriptedApi(outcome, list, instant)),
    [load, outcome, list, instant],
  );

  return (
    <Isolated key={`${data}-${load}-${round}`}>
      <div className="flex flex-col gap-4">
        <div className="grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SelectField
            label="Qué categorías hay"
            value={data}
            onChange={(event) => setData(event.target.value as ScreenData)}
          >
            {(Object.keys(DATA_CHOICES) as ScreenData[]).map((key) => (
              <option key={key} value={key}>
                {DATA_CHOICES[key]}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Cómo carga la lista"
            value={load}
            onChange={(event) => setLoad(event.target.value as ListLoad)}
          >
            {(Object.keys(LOAD_CHOICES) as ListLoad[]).map((key) => (
              <option key={key} value={key}>
                {LOAD_CHOICES[key]}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Qué responde el servidor al archivar, desarchivar o guardar"
            value={outcome}
            onChange={(event) => setOutcome(event.target.value as CategoryOutcome)}
          >
            {(Object.keys(OUTCOMES) as CategoryOutcome[]).map((key) => (
              <option key={key} value={key}>
                {OUTCOMES[key]}
              </option>
            ))}
          </SelectField>
        </div>
        <p className="text-sm text-muted-foreground">
          La pantalla de abajo es la real. Bajo 1024 px, el segmentado Gastos · Ingresos elige el
          tipo (queda en <code>?tipo=</code> de esta página) y tocar una fila lleva a su página;
          desde 1024 px se ven los dos tipos, y «Editar», «Agregar subcategoría» y el nombre de una
          fila abren el panel lateral con este servidor de mentira. «Archivar» y «Desarchivar»
          muestran el aviso: la lista de mentira no cambia. En «Muchas» mira cuánto tarda en dibujar
          y en responder al tocar.
        </p>
        <div className="flex items-center justify-between gap-3 rounded-tile border border-border p-3">
          <span className="text-sm font-bold">Acción de la cabecera (lee el tipo de la lista)</span>
          <NewCategoryAction />
        </div>
        <CategoriesScreen space={SPACE} api={api} />
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" size="sm" onClick={() => setRound((n) => n + 1)}>
            Empezar de nuevo
          </Button>
        </div>
      </div>
    </Isolated>
  );
}
