import { Plus, Tag, Tray } from "@phosphor-icons/react/ssr";
import Image from "next/image";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { focusRingForced } from "@/components/ui/focus";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/core/data/errors";
import { describeApiError } from "@/lib/core/i18n";
import { formatMoney } from "@/lib/core/money";
import { MoreList } from "@/components/more-list";
import type { MoreSection } from "@/components/nav-sections";
import { AuditPanel } from "./_components/audit-panel";
import {
  BottomSheetDemo,
  DialogDemo,
  MoneyDemo,
  PanelDemo,
  PickersDemo,
} from "./_components/base-demos";
import { LoadingDemo } from "./_components/loading-demo";
import { NavPreview } from "./_components/nav-preview";
import { SessionDemo } from "./_components/session-demo";
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

// An extreme user for the avatar menu: a name and an email that do not fit in one line anywhere.
const DEMO_USER = {
  display_name:
    "Ana María de los Ángeles Fernández-Rodríguez y Pérez de la Cruz Montenegro Villanueva",
  email:
    "ana.maria.de.los.angeles.fernandez.rodriguez.perez.montenegro@un-dominio-muy-largo.example.com",
};

// What hangs from "Más" at the end of Hito 1 (the app lists it once Categorías exists, FE-21).
const DEMO_MORE: readonly MoreSection[] = [
  {
    id: "categories",
    href: "/categorias",
    label: "Categorías",
    icon: Tag,
    description: "Crea, renombra y archiva las tuyas",
  },
  {
    id: "long",
    href: "/largo",
    label:
      "Una sección con un nombre larguísimo que tiene que partirse en varias líneas sin desbordar",
    icon: Tag,
    description:
      "Y una descripción también larguísima, para ver que la fila crece y el chevron no se aplasta",
  },
];

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

export default async function CatalogPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ title?: string | string[]; bar?: string | string[] }> }>) {
  // `/catalog?title=...` tries a long header title (it wraps to two lines, then is cut).
  // `/catalog?bar=off` leaves out the bottom bar, as a form screen does: the toast of the demo
  // below then sits at its base offset instead of 20 px above the bar.
  const { title, bar } = await searchParams;
  const headerTitle = (Array.isArray(title) ? title[0] : title)?.slice(0, 200) || "Catálogo";
  const hideBottomNav = (Array.isArray(bar) ? bar[0] : bar) === "off";
  return (
    <AppShell
      title={headerTitle}
      user={DEMO_USER}
      space={{ name: "Mi espacio", currency: { code: "UYU", exponent: 2 } }}
      hideBottomNav={hideBottomNav}
    >
      <div className="flex flex-col gap-8">
        <p className="text-sm text-muted-foreground">
          Solo en local (`npm run dev`). Cambia el tema del sistema para ver claro y oscuro y
          estrecha la ventana a 360 px (o ensánchala hasta 1440 px: desde 1024 px aparece la barra
          lateral). Con Tab ves el foco real; &quot;Foco&quot; aplica el mismo anillo sin esperar.
          El menú del avatar trae un usuario de nombre y correo larguísimos. Con{" "}
          <code>?bar=off</code> la página no lleva barra inferior (como un formulario).
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
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="demo-email">Correo electrónico</FieldLabel>
                <Input
                  id="demo-email"
                  type="email"
                  autoComplete="email"
                  placeholder="tu@correo.com"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="demo-focus">Foco</FieldLabel>
                <Input
                  id="demo-focus"
                  className={focusRingForced}
                  defaultValue="Con anillo de foco"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="demo-disabled">Deshabilitado</FieldLabel>
                <Input id="demo-disabled" disabled defaultValue="No editable" />
              </Field>
              <Field>
                <FieldLabel htmlFor="demo-amount">Monto</FieldLabel>
                <Input
                  id="demo-amount"
                  inputMode="decimal"
                  aria-describedby="demo-amount-description"
                  defaultValue="1550,50"
                />
                <FieldDescription id="demo-amount-description">Hasta 2 decimales.</FieldDescription>
              </Field>
              <Field data-invalid>
                <FieldLabel htmlFor="demo-password">Contraseña</FieldLabel>
                <Input
                  id="demo-password"
                  type="password"
                  aria-invalid
                  aria-describedby="demo-password-error"
                />
                <FieldError id="demo-password-error">La contraseña es demasiado corta.</FieldError>
              </Field>
              <Field data-invalid>
                <FieldLabel htmlFor="demo-long">
                  <span>
                    Un nombre de cuenta con una etiqueta larguísima que tiene que partirse en varias
                    líneas sin romper nada
                    <span className="font-normal text-muted-foreground"> (opcional)</span>
                  </span>
                </FieldLabel>
                <Input
                  id="demo-long"
                  aria-invalid
                  aria-describedby="demo-long-error"
                  defaultValue="Ahorros"
                />
                <FieldError id="demo-long-error">
                  Este es un mensaje de error muy largo para comprobar que se parte en varias líneas
                  y que el icono no se deforma a 360 px de ancho.
                </FieldError>
              </Field>
            </FieldGroup>
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
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Tray aria-hidden weight="duotone" />
                </EmptyMedia>
                <EmptyTitle>Aún no tienes gastos</EmptyTitle>
                <EmptyDescription>
                  Registra el primero y verás aquí tus movimientos del mes.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button size="sm">Agregar gasto</Button>
              </EmptyContent>
            </Empty>
          </Card>
        </Section>

        <Section title="Navegación del Hito 1">
          <p className="text-sm text-muted-foreground">
            La navegación completa del final del Hito 1, con las piezas reales (la app solo muestra
            lo que ya existe). La barra inferior y la lateral de esta página son las de verdad:
            aparecen según el ancho. Los toques de aquí abajo no navegan.
          </p>
          <NavPreview />
        </Section>

        <Section title="Pantalla Más (solo bajo 1024 px en la app)">
          <MoreList sections={DEMO_MORE} />
        </Section>

        <Section title="Avisos con Deshacer">
          <ToastDemo />
        </Section>

        <Section title="Sesión (cookie en el navegador)">
          <SessionDemo />
        </Section>

        <Section title="Tarjeta de escritorio (variante tile)">
          <p className="text-sm text-muted-foreground">
            Bajo 1024 px es glass, como las de arriba; desde 1024 px es una tarjeta sólida (
            <code>surface</code>, borde, radio 20, 24 px de relleno). Ensancha la ventana para verla
            cambiar. El contenedor del ícono usa <code>primary-soft</code>.
          </p>
          <div className="grid gap-3 lg:grid-cols-2">
            <Card variant="tile">
              <span
                aria-hidden
                className="flex size-10.5 items-center justify-center rounded-icon bg-primary-soft text-primary"
              >
                <Tray weight="duotone" className="size-5.5" />
              </span>
              <CardHeader>
                <CardTitle>Moneda de tu espacio</CardTitle>
                <CardDescription>Peso uruguayo · UYU</CardDescription>
              </CardHeader>
            </Card>
            <Card variant="tile">
              <CardHeader>
                <CardTitle>
                  Una tarjeta con un título larguísimo que tiene que partirse en varias líneas sin
                  desbordar a 360 px ni a 1024 px
                </CardTitle>
                <CardDescription>{formatMoney("900719925474099100", UYU)}</CardDescription>
              </CardHeader>
            </Card>
          </div>
        </Section>

        <Section title="El grillo (estado vacío)">
          <Card variant="tile" className="items-center text-center lg:flex-row lg:text-left">
            {/* Decorative: the title next to it already says what happens. 120 px, 140 px on desktop. */}
            <Image
              src="/brand/kanza-symbol.svg"
              alt=""
              width={140}
              height={140}
              className="size-30 shrink-0 lg:size-35"
            />
            <CardHeader className="lg:items-start">
              <CardTitle>Empieza por tus cuentas</CardTitle>
              <CardDescription>
                Agrega dónde está tu dinero hoy: un banco, tu efectivo o una tarjeta.
              </CardDescription>
            </CardHeader>
          </Card>
        </Section>

        <Section title="Campo de dinero">
          <p className="text-sm text-muted-foreground">
            El símbolo sale de la moneda del espacio (nunca un &quot;$&quot; fijo). Con el teclado
            decimal en el móvil. Las dos últimas pruebas dicen qué entiende{" "}
            <code>parseMoneyInput</code> de lo que escribes (acepta &quot;,&quot; o &quot;.&quot;, y
            un &quot;-&quot; inicial).
          </p>
          <Card variant="solid">
            <MoneyDemo />
          </Card>
        </Section>

        <Section title="Selector y control segmentado">
          <Card variant="solid">
            <PickersDemo />
          </Card>
        </Section>

        <Section title="Panel lateral, hoja inferior y diálogo">
          <p className="text-sm text-muted-foreground">
            En la app, el panel (440 px, <code>glass-strong</code>) es de 1024 px en adelante y la
            hoja inferior de menos de 1024 px; aquí se abren en cualquier ancho. Todos atrapan el
            foco, cierran con Escape y con el velo, y devuelven el foco al botón que los abrió. La
            hoja siempre termina con un &quot;Cancelar&quot; visible.
          </p>
          <div className="flex flex-wrap gap-3">
            <PanelDemo />
            <PanelDemo long />
            <BottomSheetDemo />
            <DialogDemo />
          </div>
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
