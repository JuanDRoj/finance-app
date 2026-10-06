import { Plus, Tray } from "@phosphor-icons/react/ssr";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { focusRingForced } from "@/components/ui/focus";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/core/data/errors";
import { describeApiError } from "@/lib/core/i18n";
import { formatMoney } from "@/lib/core/money";
import { AuditPanel } from "./_components/audit-panel";
import { LoadingDemo } from "./_components/loading-demo";
import { ToastDemo } from "./_components/toast-demo";

// Component catalog: only a route in `next dev` (this file is `page.dev.tsx`; see
// lib/env/page-extensions.ts). Every base component in its states, at 360 px and up.

const UYU = { code: "UYU", exponent: 2 } as const;
const AMOUNTS = [155050, 1234567, 9, 100000000, 888888];
const VARIANTS = ["default", "secondary", "outline", "ghost", "destructive", "link"] as const;
const VARIANT_LABELS: Record<(typeof VARIANTS)[number], string> = {
  default: "Principal",
  secondary: "Secundario",
  outline: "Contorno",
  ghost: "Fantasma",
  destructive: "Destructivo",
  link: "Enlace",
};

function Section({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-heading text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

function State({ name, children }: Readonly<{ name: string; children: ReactNode }>) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-sm font-bold text-muted-foreground">{name}</p>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

const NOT_FOUND = describeApiError(
  new ApiError(404, { detail: "Space not found", code: "space_not_found" }),
);
const VALIDATION = describeApiError(
  new ApiError(422, {
    detail: [{ type: "missing", loc: ["body", "name"], msg: "Field required" }],
  }),
);
const SERVER = describeApiError(
  new ApiError(500, { detail: "Internal server error", code: "internal_error" }),
);
const NETWORK = describeApiError(new TypeError("Failed to fetch"));

export default function CatalogPage() {
  return (
    <AppShell
      title="Catálogo"
      actions={
        <Button variant="ghost" size="sm">
          Cerrar sesión
        </Button>
      }
    >
      <div className="flex flex-col gap-8">
        <p className="text-sm text-muted-foreground">
          Solo en local (`npm run dev`). Cambia el tema del sistema para ver claro y oscuro y
          estrecha la ventana a 360 px. Con Tab ves el foco real; &quot;Foco&quot; aplica el mismo
          anillo sin esperar.
        </p>

        <Section title="Botones">
          {VARIANTS.map((variant) => (
            <Card key={variant} variant="solid">
              <CardHeader>
                <CardTitle as="h3" className="text-base">
                  {VARIANT_LABELS[variant]}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <State name="Normal">
                  <Button variant={variant}>Guardar</Button>
                  <Button variant={variant} size="sm">
                    Guardar
                  </Button>
                </State>
                <State name="Foco">
                  <Button variant={variant} className={focusRingForced}>
                    Guardar
                  </Button>
                </State>
                <State name="Deshabilitado">
                  <Button variant={variant} disabled>
                    Guardar
                  </Button>
                </State>
                <State name="Cargando">
                  <Button variant={variant} loading>
                    Guardando…
                  </Button>
                </State>
              </CardContent>
            </Card>
          ))}
          <Card variant="solid">
            <CardHeader>
              <CardTitle as="h3" className="text-base">
                Solo icono (44 px) y cargando de verdad
              </CardTitle>
              <CardDescription>
                Toca el botón: pasa por &quot;cargando&quot; dos segundos.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <Button size="icon" aria-label="Agregar gasto">
                <Plus aria-hidden weight="bold" />
              </Button>
              <LoadingDemo />
              <Button>Etiqueta muy larga para un botón que debe caber en 360 px</Button>
            </CardContent>
          </Card>
        </Section>

        <Section title="Campos">
          <Card variant="solid">
            <Field
              label="Correo electrónico"
              type="email"
              autoComplete="email"
              placeholder="tu@correo.com"
            />
            <Field label="Foco" className={focusRingForced} defaultValue="Con anillo de foco" />
            <Field label="Deshabilitado" disabled defaultValue="No editable" />
            <Field
              label="Monto"
              inputMode="decimal"
              description="Hasta 2 decimales."
              defaultValue="1550,50"
            />
            <Field label="Contraseña" type="password" error="La contraseña es demasiado corta." />
            <Field
              label="Un nombre de cuenta con una etiqueta larguísima que tiene que partirse en varias líneas sin romper nada"
              optional
              defaultValue="Ahorros"
              error="Este es un mensaje de error muy largo para comprobar que se parte en varias líneas y que el icono no se deforma a 360 px de ancho."
            />
          </Card>
        </Section>

        <Section title="Tarjetas">
          <Card>
            <CardHeader>
              <CardTitle>Neto del mes</CardTitle>
              <CardDescription>Glass sobre el fondo decorativo (token card)</CardDescription>
            </CardHeader>
            <CardContent className="font-heading text-4xl leading-[1.1] font-semibold tracking-tight tabular-nums">
              {formatMoney(155050, UYU)}
            </CardContent>
          </Card>
          <Card variant="solid">
            <CardHeader>
              <CardTitle>Superficie sólida</CardTitle>
              <CardDescription>Para formularios y cuando el glass no es posible</CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>
                Una categoría con un nombre larguísimo que no cabe en una sola línea de 360 px
              </CardTitle>
            </CardHeader>
            <CardContent className="font-heading text-2xl font-semibold tabular-nums break-all">
              {formatMoney("900719925474099100", UYU)}
            </CardContent>
          </Card>
        </Section>

        <Section title="Alertas (errores del backend)">
          <Alert title={NOT_FOUND.title}>{NOT_FOUND.message}</Alert>
          <Alert title={VALIDATION.title}>{VALIDATION.message}</Alert>
          <Alert
            title={SERVER.title}
            action={
              <Button size="sm" variant="outline">
                Reintentar
              </Button>
            }
          >
            {SERVER.message}
          </Alert>
          <Alert title={NETWORK.title}>{NETWORK.message}</Alert>
          <Alert variant="info" title="Todo al día">
            No tienes movimientos pendientes de confirmar.
          </Alert>
        </Section>

        <Section title="Carga y vacío">
          <Card variant="solid">
            <div aria-busy="true" className="flex flex-col gap-3">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          </Card>
          <Card variant="solid">
            <EmptyState
              icon={<Tray aria-hidden weight="duotone" className="size-[22px]" />}
              title="Aún no tienes gastos"
              description="Registra el primero y verás aquí tus movimientos del mes."
              action={<Button size="sm">Agregar gasto</Button>}
            />
          </Card>
        </Section>

        <Section title="Avisos con Deshacer">
          <ToastDemo />
        </Section>

        <Section title="Cifras (tnum)">
          <Card variant="solid">
            <CardDescription>
              Si las cifras son tabulares, &quot;1111&quot; y &quot;8888&quot; miden lo mismo y los
              montos se alinean por la derecha.
            </CardDescription>
            <ul className="flex flex-col gap-1 text-right font-heading text-lg font-semibold tabular-nums">
              {AMOUNTS.map((amount) => (
                <li key={amount}>{formatMoney(amount, UYU)}</li>
              ))}
            </ul>
            <p className="font-heading text-lg font-semibold tabular-nums">
              1111 / 8888 (Montserrat)
            </p>
            <p className="font-sans text-base tabular-nums">1111 / 8888 (Karla)</p>
          </Card>
        </Section>

        <Section title="Auditoría de esta página">
          <Card variant="solid">
            <AuditPanel />
          </Card>
        </Section>
      </div>
    </AppShell>
  );
}
