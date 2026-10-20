# CrabbyTab design system

CrabbyTab's admin UI uses a neutral, minimal style: white / zinc-950 surfaces,
hairline zinc borders, one indigo accent, Inter, and dense tables built for
tab-room screens. It is plain Tailwind CSS 3 plus `lucide-react` icons. There is
no component library; the primitives live in `src/components/ui/`.

## Tokens

Tokens are CSS variables in `src/app/globals.css`, exposed to Tailwind through
semantic names in `tailwind.config.ts`. Colours are stored as RGB channels, so
opacity modifiers work (`bg-accent/10`, `bg-overlay/50`).

| Tailwind name | Use |
| --- | --- |
| `background` | Page canvas behind cards and the sidebar |
| `surface` | Cards, top bar, menus, dialogs, table frames |
| `muted` | Subtle fills: table headers, hover rows, active nav item |
| `border`, `border-strong` | Hairlines; `strong` for inputs and secondary buttons |
| `fg`, `fg-muted`, `fg-subtle` | Body text, secondary text, icons and placeholders only |
| `accent` (+ `hover`, `fg`, `subtle`, `text`) | Primary actions, focus rings, selection; `accent-text` for links |
| `success`, `warning`, `danger`, `info` (+ `subtle`, `border`) | Status text/icon on a `subtle` fill with a `border` |
| `danger-solid` | Destructive button fill |
| `overlay` | Dialog and drawer backdrops |

Other tokens:

- **Radius:** `rounded-sm` 4px (badges), `rounded-md` 6px (controls, buttons), `rounded-lg` 8px (cards, dialogs, tables).
- **Layout:** `h-topbar` / `top-topbar` (48px), `w-sidebar` (240px), `max-w-content` (1280px).
- **Spacing:** Tailwind's 4px scale. Page sections use `space-y-6`; cards use `p-4` (`px-4 py-3` for headers); dense table cells use `px-3 py-1.5`.
- **Type scale:** 11px captions and table headers (`text-[11px]`, uppercase, `tracking-wide`); 12px help text and dense data (`text-xs`); 13px default UI text (`text-[13px]`); 15px section titles (`text-[15px]`); 20px page titles (`text-xl`); 24px stat values (`text-2xl`). Numbers in tables use `tabular-nums` (applied by `<Table>`) or `font-mono` (`<TD numeric>`).
- **Elevation:** borders, not shadows. `shadow-lg` is reserved for floating layers (menus, dialogs, toasts).

## Light and dark mode

- `<html data-theme="light|dark">` is set before first paint by `themeInitScript` (`src/lib/theme`), from the viewer's saved choice (`localStorage["crabbytab:theme"]`: `light`, `dark` or `system`). `system` follows `prefers-color-scheme` and updates live.
- Dark tokens apply only inside an element with the `themed` class. The tournament shell has it. The login, home and public pages are not themed yet and stay light.
- **Don't use `dark:` variants or hard-coded colours** (`bg-white`, `text-gray-900`, hex values) in new code. The tokens switch automatically.
- `theme-light` forces the light palette within a subtree. The shell wraps every tournament page that has not been migrated in a `theme-light` panel, so its hard-coded colours stay legible in dark mode. When you migrate a page, add its path to `THEMED_SUBPATHS` in `src/components/layout/TournamentChrome.tsx` (or, for a route with dynamic segments, its prefix to `THEMED_PREFIXES`).
- `theme-projector` is a high-contrast palette for the projector display (`/[slug]/display`): black canvas, white text, a yellow accent and saturated side colours. It ignores the viewer's light/dark choice.
- Users switch theme from the top-bar theme button, or from the account menu on small screens.

## Components (`src/components/ui/`)

| Component | Notes |
| --- | --- |
| `Button` | `variant`: `primary` (one per area), `secondary`, `ghost`, `danger`. `size`: `sm`, `md`, `lg`. `loading` shows a spinner, disables the button and sets `aria-busy`. Use `buttonClasses()` to style a `<Link>` as a button. |
| `IconButton` | Icon-only. Requires `label`, which becomes the `aria-label` and the tooltip. `iconButtonClasses()` styles links. |
| `Input`, `Select`, `Textarea` | Pass `label`, `help` and `error`. They wire up `htmlFor`, `aria-describedby` and `aria-invalid`. Without a visible label, pass `aria-label`. `Input` takes an optional `leadingIcon`. |
| `Checkbox`, `Switch` | Both have a visible label and an optional description. `Switch` uses `role="switch"`; use it for settings that apply immediately. |
| `Card`, `CardHeader`, `CardBody`, `Section` | Framed region / unframed titled region. |
| `SegmentedControl` | A few mutually exclusive options side by side (WAI-ARIA radio group): arrow keys, Home/End, roving tab stop; the selected option is marked by fill and border. Used for the three-state motion release. |
| `Badge`, `StatusPill` | `Badge` is a neutral or toned label. `StatusPill` always renders an icon *and* text. Use it for any state (draft/confirmed, online/offline). |
| `TableContainer`, `Table`, `THead`, `TR`, `TH`, `TD`, `TableEmpty` | Dense rows separated by hairlines, no zebra striping. Rows are highlighted on hover. Pass `numeric` to `TD` for right-aligned mono figures. For a sticky header, give the `TableContainer` a max height (e.g. `max-h-[calc(100vh-16rem)]`). Without one the header scrolls with the page. Show `TableEmpty` when a table has no rows. |
| `Tabs`, `TabPanel` | WAI-ARIA tabs with arrow/Home/End keys. Use the same `id` on both. |
| `Dialog` | `role="dialog"` or `"alertdialog"`, with a focus trap, Escape to close, backdrop click, and focus restored on close. `dismissible={false}` while saving. Renders in place (no portal) so it inherits the theme scope. Use it instead of hand-rolled `fixed inset-0` modals. |
| `ConfirmActionDialog` | Confirmation built on `Dialog`. Focus starts on "No, cancel". |
| `DropdownMenu` (+ `Item`, `RadioItem`, `Label`, `Separator`) | Menu button pattern: arrow keys, Escape, and focus returns to the trigger. Items can be links (`href`) or actions (`onSelect`). |
| `ToastProvider`, `useToast` | Transient notifications in an `aria-live` region. Errors stay until dismissed. The tournament shell provides the provider. Use toasts for confirmations, not for errors the user must act on (use inline `Alert` or field errors for those). |
| `Alert` | Inline message box with a tone icon. Pass `role="alert"` for errors that need immediate attention. |
| `Skeleton`, `EmptyState`, `ProgressBar` | Loading placeholder (decorative; pair it with a status message), an empty view with an optional action, and a labelled progress bar. |
| `PageHeader` | The page's single `<h1>`, with an optional description, meta row and actions. |
| `SideBadge` | Debate position label with the abbreviation as its text. Side colours are token-backed, so they work in both themes. |
| `ThemeToggle`, `ThemeMenuItems`, `useThemePreference` | Theme controls used by the shell. |

Helpers: `cn()` (clsx + tailwind-merge), `focusRing` (the standard focus-visible ring), and `useFocusTrap()`.

## App shell (`src/components/layout/`)

- **Top bar (`Navbar`):** navigation drawer button (below `lg`), home, tournament switcher, round switcher (with "New round…" for admins, at every width), sync status, upload/download, public tab, theme, and account menu.
- **Sidebar:** grouped as Overview, Setup, Round (the active round's tools), Results, Public and Admin. Admin-only links follow the same permission checks as before. Below `lg` the sidebar is a modal drawer with a focus trap.
- **Content:** `max-w-content`, padded `px-3`→`lg:px-6`.

## Usage rules

1. Build new UI from the primitives. If one is missing, add it to `src/components/ui/` rather than styling a one-off.
2. Use semantic tokens only. Don't use raw palette colours, hex values or `dark:` variants.
3. Use one `primary` button per region. Everything else is `secondary` or `ghost`. Destructive actions use `danger` and go through `ConfirmActionDialog`.
4. Keep tables dense. Right-align numbers. Show placeholders as `—`. Every table needs an empty state.
5. Keep page structure predictable: `PageHeader`, then filters/tabs, then content, then secondary controls.
6. Don't use gradients, heavy shadows or decorative animation. Transitions are limited to colour/opacity and respect `prefers-reduced-motion`.

## Accessibility rules

- Never convey status by colour alone. Pair colour with text and/or an icon (`StatusPill`, W/L badges, "(all ballots confirmed)" screen-reader text).
- Every control has an accessible name: a visible `<label>`, `IconButton`'s `label`, or `aria-label`.
- Every interactive element has a visible focus style (`focusRing`). Don't remove outlines without a replacement.
- Dialogs, the drawer and menus trap or manage focus, close on Escape, and return focus to their trigger.
- Use one `<h1>` per page (`PageHeader`). Sections use `<h2>`.
- Use `role="status"` for progress messages and `role="alert"` for errors.
- Body text uses `fg` or `fg-muted`, both at least 4.5:1 contrast on `surface` in both themes. `fg-subtle` is only for icons, placeholders and non-essential meta.
- Touch targets are at least 28px (`sm` controls). Prefer `md` (32px) on mobile-first screens.

## Migration status

Rebuilt on the system so far: the shell, tournament overview, results overview and standings. Every other tournament page still uses legacy Tailwind colours and renders in the `theme-light` panel. The shared `.tabby-table` class and side badges are token-backed, so they already match the new palette.
