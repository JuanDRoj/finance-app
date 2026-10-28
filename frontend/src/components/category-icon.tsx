import {
  AirplaneTilt,
  Baby,
  Bank,
  Barbell,
  Basket,
  BeerStein,
  Bed,
  Bicycle,
  BookOpen,
  BowlFood,
  Briefcase,
  Bus,
  Cake,
  Car,
  ChartLineUp,
  Coffee,
  Coins,
  DeviceMobile,
  Dog,
  DotsThreeCircle,
  Drop,
  FirstAidKit,
  ForkKnife,
  GameController,
  GasPump,
  Gift,
  GraduationCap,
  Hamburger,
  Hammer,
  Heart,
  Heartbeat,
  House,
  Key,
  Laptop,
  Lightbulb,
  Lightning,
  Martini,
  Money,
  MonitorPlay,
  Motorcycle,
  MusicNotes,
  PawPrint,
  Percent,
  Pill,
  PiggyBank,
  Pizza,
  Plant,
  Popcorn,
  Receipt,
  Scissors,
  ShoppingBag,
  ShoppingCart,
  Star,
  Stethoscope,
  Storefront,
  Suitcase,
  Tag,
  Taxi,
  Tent,
  Tooth,
  Train,
  TShirt,
  Wallet,
  WifiHigh,
  Wine,
  Wrench,
} from "@phosphor-icons/react/ssr";
import type { CategoryIconKey } from "@/lib/core/data/categories";
import { cn } from "@/lib/utils";

/** Any Phosphor icon (the library does not export its `Icon` type from the `/ssr` entry). */
type PhosphorIcon = typeof Tag;

/**
 * The fixed list of icons a category can have, key to Phosphor component (docs/diseno.md D19). The
 * key is the Phosphor name in kebab-case, the same the backend stores
 * (`backend/app/modules/categories/icons.py`, published as an `enum` in `openapi.json`), and the
 * component is that name in PascalCase. It is typed with the generated union of keys, so the
 * compiler fails here if the backend adds an icon (the map is missing it) or drops one (the map has
 * an extra key). The order is the backend's. The Spanish names of the icons (what the icon picker
 * reads out) are not here but in the one map of translations, `CATEGORY_ICON_NAMES` of
 * `lib/core/i18n.ts` (KAN-96), typed the same way; this file only maps keys to components.
 */
export const CATEGORY_ICONS: Readonly<Record<CategoryIconKey, PhosphorIcon>> = {
  // Food and shopping
  "fork-knife": ForkKnife,
  "bowl-food": BowlFood,
  pizza: Pizza,
  hamburger: Hamburger,
  coffee: Coffee,
  "beer-stein": BeerStein,
  wine: Wine,
  cake: Cake,
  "shopping-cart": ShoppingCart,
  basket: Basket,
  "shopping-bag": ShoppingBag,
  storefront: Storefront,
  // Transport
  car: Car,
  "gas-pump": GasPump,
  bus: Bus,
  taxi: Taxi,
  train: Train,
  motorcycle: Motorcycle,
  bicycle: Bicycle,
  "airplane-tilt": AirplaneTilt,
  // Home and services
  house: House,
  key: Key,
  bed: Bed,
  lightbulb: Lightbulb,
  lightning: Lightning,
  drop: Drop,
  "device-mobile": DeviceMobile,
  "wifi-high": WifiHigh,
  wrench: Wrench,
  hammer: Hammer,
  plant: Plant,
  // Health and personal care
  heartbeat: Heartbeat,
  stethoscope: Stethoscope,
  pill: Pill,
  "first-aid-kit": FirstAidKit,
  tooth: Tooth,
  barbell: Barbell,
  scissors: Scissors,
  heart: Heart,
  // Leisure
  "game-controller": GameController,
  popcorn: Popcorn,
  "music-notes": MusicNotes,
  "monitor-play": MonitorPlay,
  martini: Martini,
  suitcase: Suitcase,
  tent: Tent,
  // Education, family and gifts
  "graduation-cap": GraduationCap,
  "book-open": BookOpen,
  baby: Baby,
  "paw-print": PawPrint,
  dog: Dog,
  gift: Gift,
  "t-shirt": TShirt,
  // Money and work
  briefcase: Briefcase,
  laptop: Laptop,
  money: Money,
  coins: Coins,
  wallet: Wallet,
  bank: Bank,
  "piggy-bank": PiggyBank,
  receipt: Receipt,
  "chart-line-up": ChartLineUp,
  percent: Percent,
  star: Star,
  tag: Tag,
  "dots-three-circle": DotsThreeCircle,
};

/**
 * The icon of a category (docs/diseno.md D5, D19), duotone by default as every category icon is.
 * Only the glyph: the tile it sits in (44 px in the grid of categories, 42 px in Categorías, 40 px
 * in a table row) belongs to the screen. Decorative (`aria-hidden`): the name of the category next
 * to it says what it is. Works in Server and Client Components.
 */
export function CategoryIcon({
  icon,
  weight = "duotone",
  className,
}: Readonly<{
  icon: string;
  weight?: "duotone" | "regular" | "fill";
  className?: string;
}>) {
  // Read from the module-level map right here, not returned by a helper function: the React lint rule
  // flags a component that a call returns during render. A key the map does not know (the backend
  // added an icon the frontend has not caught up with yet) is the generic tag, never an error or a
  // missing icon; `hasOwn` keeps `constructor` and the like from being read as icons.
  const Icon = Object.hasOwn(CATEGORY_ICONS, icon) ? CATEGORY_ICONS[icon as CategoryIconKey] : Tag;
  return <Icon aria-hidden weight={weight} className={cn("shrink-0", className)} />;
}
