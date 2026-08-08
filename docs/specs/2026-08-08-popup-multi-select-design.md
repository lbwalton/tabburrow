# Popup multi-select: open several saved links at once

Date: 2026-08-08
Status: approved, ready for implementation plan

## Problem

Inside a folder in the popup (`FolderDetail`), the only way to open more than one
saved link is the header's all-or-nothing "Open all" (`↗`). Opening three links out
of twelve means three trips: each click on a `LinkRow` opens an active tab, which
dismisses the popup, so the user must reopen it and navigate back into the folder
every time.

The dashboard already solves this (`LinkGrid` + `BulkBar`: cmd/ctrl-click toggles,
shift-click ranges, a bulk bar offers "Open all"). The popup has none of it.

## Scope

**In:** multi-select in the popup's folder detail view, via visible checkboxes,
with shift-click range selection, and a selection bar offering "Open N" and
"Delete".

**Out (this spec):** the dashboard. Its selection stays modifier-only and therefore
undiscoverable. That inconsistency is a known, accepted, deferred cost: after this
ships, the popup teaches selection visibly and the dashboard does not. Revisit as a
follow-up.

## Interaction model

A permanent checkbox column on every link row. No mode to enter, no modifier key to
discover.

| Gesture | Result |
| --- | --- |
| Click the checkbox | Toggle that link's selection |
| Shift-click a checkbox | Select the contiguous range from the anchor |
| Click the row body | Unchanged: open that one link in an active tab (popup closes) |
| `Escape` | Clear the selection (unless a dialog or menu owns the key) |

Keeping "click the row body opens" intact matters: it is the reason people enter a
folder, and it is already the dashboard's plain-click behavior, so the two surfaces
stay consistent on the gesture that fires most often.

The checkbox and the row body are distinct hit targets, so a mis-aimed click opens a
tab and dismisses the popup, losing the in-progress selection. This is the main
ergonomic risk of the chosen model. It is mitigated by the checkbox's generous
28px wrapper, not eliminated. Accepted in exchange for avoiding a selection mode.

## Visual anatomy

The popup root is `w-[22.5rem]` (360px) with `px-4`, leaving 328px of row width.

```
[ 16px box ][ 8px ][ 16px favicon ][ 8px ][ title, flex-1 ][ row actions ]
```

The checkbox is a **sibling of** the row-body `<button>`, never inside it. The row
body is already a button (it opens the link), and nesting an input inside a button is
invalid HTML with unpredictable click behavior. Today's row is
`<div class="group relative flex …"><button>favicon + title</button><div>actions</div></div>`;
the checkbox becomes a new first child of that outer `div`.

- Gross cost to the title is 24px. The row body button's existing `px-2` drops to
  `pl-0` (the checkbox now provides the left inset), so the net loss is roughly 16px.
- The visible box is 16px; its wrapper is `h-7 w-7` (28px) so the target clears the
  24px minimum without a chunky-looking control.
- `AddLinkRow` takes a matching left indent so its `+` stays aligned with the
  favicon column. Without this the list reads as broken.

### Checkbox styling

Not a native checkbox. The OS default paints in system blue and would be the only
element on screen ignoring the token system.

`appearance-none`, with:

- Unchecked: `border-[var(--line-hi)]`, transparent fill, hover to `var(--text-2)`.
  `Input` uses the fainter `--line` at rest and normally a checkbox would match it,
  but `--line` is 11% opacity: a clean hairline around a 200px field, nearly invisible
  around a 16px box on the dark green ground. The whole point of this control is being
  seen without being discovered, so it takes the 20% step.
- Checked: filled, with an inline SVG tick in `var(--btn-fg)`. That token exists for a
  foreground on a solid accent fill, was picked for WCAG AA contrast against the orange,
  and is theme-stable. `var(--bg-ground)` would have been the intuitive choice and is
  wrong: it flips to light kraft under `[data-theme="paper"]`, giving a pale tick on an
  orange box.
- Focus: the repo's standard `focus-visible:ring-2 focus-visible:ring-[var(--accent)]`.

The checked fill uses **the collection's own accent** so selecting inside "Research"
looks different from selecting inside "Recipes". `collection.accent` is already in
scope in `FolderDetail`.

Important: `accent` is not always a color. It can be an emoji glyph (see
`lib/accents.ts`, `ACCENT_EMOJIS`). Resolve it exactly as `FolderRow`'s `AccentDot`
does:

```ts
const fill = collection.accent && isCssColorAccent(collection.accent)
  ? collection.accent
  : "var(--accent)";
```

No new hex literals. Every value stays a token `var()` or a `color-mix()` over
tokens, matching `accents.ts`'s stated rule.

## The selection bar

```
│  2 selected      Open 2      Delete      ×   │
```

- **Placement:** inline, between the scrolling link list and the `border-t` divider
  above "Append tabs" / "Overwrite". Not `fixed` like the dashboard's `BulkBar`;
  a 360px panel has no long scroll to outrun, and `fixed` would need the same
  brittle offset math `BulkBar.tsx` documents.
- **Appears** once one or more links are selected, reusing the existing `.bulk-bar`
  class in `assets/tailwind.css` for its 200ms slide-up. That class owns only the
  transition, so it is reusable as-is; positioning stays in the JSX.
- **Count** uses `var(--font-mono)`, matching `BulkBar`'s treatment, so the two
  surfaces read as one product.
- **"Open N" is a ghost button, not primary.** "Append tabs" is already an orange
  primary roughly 40px below it, and two orange buttons that close together compete
  for the eye. The bar's own bordered surface carries the emphasis instead.
- **"Delete"** uses `variant="danger"`, matching `BulkBar`.
- **`×`** clears the selection.

## State architecture

The load-bearing decision: `lib/selection.ts` is already DOM-free and already
covered by `selection.test.ts`. The popup reuses it verbatim. **This feature adds no
new selection logic.**

`lib/click-intent.ts` is *not* reused. It resolves plain/cmd/shift clicks on a card
body, which is the dashboard's model, not this one. It stays a dashboard concern.

### `FolderDetail`

- Owns `const [selection, setSelection] = useState(emptySelection())`, mirroring
  `LinkGrid`.
- `order = links.map((l) => l.id)`. `listLinks` returns position-ordered links, so
  this is the display order a shift-range measures against.
- A prune effect on `links` change, copied from `LinkGrid`, so a link removed from
  another surface cannot leave a dangling selected id. `pruneSelection` returns the
  same reference when nothing changed, so this does not cause an extra render.
- An `Escape` handler that clears the selection, bailing when something else owns
  the key. It has three load-bearing parts, and all three are required:

  **1. A focused-text-entry bail, checked first.** A positive allowlist
  (`TEXT_ENTRY_TYPES`: `text`, `url`, `search`, `email`, `password`, `tel`,
  `number`), not a bare `instanceof HTMLInputElement`:

  ```ts
  const active = document.activeElement;
  const inTextEntry =
    (active instanceof HTMLInputElement && TEXT_ENTRY_TYPES.has(active.type)) ||
    active instanceof HTMLTextAreaElement;
  if (inTextEntry) return;
  ```

  The direction of this list matters. A checkbox *is* an `HTMLInputElement`, and
  `LinkRow`'s checkbox keeps focus after the click that ticks it (the row's key
  doesn't change, so React keeps the same DOM node mounted). A bare
  `instanceof HTMLInputElement` check would therefore bail on every checkbox click,
  disabling this feature's own clear-selection gesture immediately after the user
  uses it. An allowlist avoids that because it only bails for the input *types*
  that mean "I'm mid-edit, Escape should revert me" — the rename `Input` and both
  `AddLinkRow` fields. It also fails in the harmless direction: a type nobody has
  thought of yet falls through to *clearing the selection*, not to silently
  disabling the shortcut. An exclusion list would fail the other way — any new
  text-like input added later and forgotten in the list would silently break the
  shortcut again, which is exactly the kind of defect this spec is trying to keep
  out of the code a second time.

  **2. A competing-surface bail:**

  ```ts
  if (document.querySelector("dialog[open], [role='menu'], [role='dialog']")) return;
  ```

  That selector covers the folder `⋯` menu and every per-row `⋯` menu
  (`[role="menu"]`), every native `<dialog>` on the page — the Overwrite /
  Delete-folder / bulk-delete confirms this file renders directly, plus the ones
  `SendMenu`, `OpenAllButton`, and `EditLinkPopover` render — and `AccentPicker`.
  `AccentPicker` is a `<div role="dialog">`, not a native `<dialog>`, and it is
  reachable from this very view via `⋯` → "Change color"; without its own clause,
  dismissing the color picker with Escape would also silently wipe the selection
  the user just built.

  **3. The listener is registered on the capture phase**, not bubble:

  ```ts
  window.addEventListener("keydown", handleKeyDown, true);
  // ...
  return () => window.removeEventListener("keydown", handleKeyDown, true);
  ```

  Both the `add` and the `remove` need that trailing `true` — the capture flag is
  part of a listener's identity, so a bubble-phase `removeEventListener` silently
  fails to detach and leaks one live listener per mount.

  This is not a stylistic choice; it is required for parts 1 and 2 to be correct
  at all. Both guards decide by reading the DOM — what's focused, what's mounted —
  and React 18 flushes a keydown handler's `setState` **synchronously**, because
  `keydown` is a discrete event. That means by the time a *bubble*-phase listener
  on `window` runs, any competing surface that reacted to the same Escape keypress
  has already torn itself down: the rename `Input` has unmounted and
  `activeElement` is back on `<body>`, `AccentPicker` has unmounted and
  `[role="dialog"]` matches nothing. A bubble listener reads an empty room and
  wipes a selection the user never asked to lose — this was tried and it does not
  work. Capture runs `window → document → target`, ahead of React's
  root-container listeners and therefore ahead of any unmount or blur triggered by
  this same keypress, which is the only point at which the guards see the DOM the
  user actually pressed Escape in. **Do not convert this back to bubble phase.**
  The guard bodies (parts 1 and 2) are correct; bubble-phase timing is not.

  Subtle and worth not "fixing" later: `LinkRow`'s own `Escape` listener is a
  separate, bubble-phase listener on `document`, and both fire for the same
  keypress. The two-step "first Escape closes the menu, second Escape clears the
  selection" behavior holds because this capture-phase listener runs *first* and
  still sees `[role="menu"]` mounted (nothing has flushed yet at capture time), so
  it bails and lets `LinkRow`'s own bubble-phase listener close the menu on that
  same keypress. Only the *following* Escape, with no menu left to see, clears the
  selection.

### `LinkRow`

Gains three **required** props:

```ts
selected: boolean;
checkColor: string;   // the already-resolved CSS color for the checked fill
onToggle: (id: string, shiftKey: boolean) => void;
```

`checkColor` arrives pre-resolved rather than as the raw `collection.accent`, so
`accentColor` runs once per folder instead of once per row, and `LinkRow` never needs
to know that an accent can be an emoji.

Required, not optional: `LinkRow` has exactly one call site (`FolderDetail`), so
optional props would only create dead branches. (Note: `SearchOverlay.tsx` defines
its own local component also named `LinkRow`. It is unrelated and untouched.)

The checkbox is controlled by `checked={selected}`. A native checkbox's `onClick`
carries `shiftKey`, so no keyboard-state tracking is needed; `nextSelection` decides
the result and React renders it.

## Behaviors

### Open N

1. `openLinks(selectedUrls)` from `lib/restore.ts`. It opens `active: false`
   background tabs, so **the popup stays open**.
2. Clear the selection.
3. `flash(...)`, reusing `FolderDetail`'s existing `flash` helper, pluralized the
   way every other message in this file already is:
   `Opened ${n} ${n === 1 ? "tab" : "tabs"}.`
4. On partial failure, `openFailureMessage(result.failed)` into the existing
   `error` line.

**No 15-link confirm.** `needsRestoreConfirm` guards the header's `↗` because that
button can open an entire folder on one click. Hand-ticking 16 checkboxes is already
deliberate, and the dashboard's `BulkBar` does not confirm either. The header's `↗`
keeps its confirm, unchanged.

### Delete N

1. A confirm `Dialog`, following the Overwrite / Delete-folder precedent already in
   this file. Unlike the dashboard, the popup has no undo toast, so removing several
   links on one click needs a beat.

   The copy says **"This can't be undone."** and deliberately does *not* offer a
   restore. `softDeleteLinks` is a soft delete at the data layer, but no UI anywhere
   exposes soft-deleted links: the dashboard's only recovery path is a 6-second undo
   toast that fires exclusively for deletes initiated *in the dashboard*, and
   `SettingsPane` uses `deletedAt` only to count live links. The two pre-existing
   dialogs in this file (Overwrite, Delete-folder) both promise a dashboard undo that
   does not exist for popup-initiated actions. That is a known, pre-existing bug left
   out of this feature's scope; do not copy their wording.
2. `softDeleteLinks(ids, db)`.
3. `sendSyncNudge()`, matching every other write path in this file.
4. Clear the selection and `flash`.

The per-row hover delete keeps its current no-confirm behavior. One link is cheap to
lose; several are not.

### Unchanged

The header's `↗` "Open all" keeps meaning *all* links, not the selection. Its
`aria-label` already says so explicitly.

## Accessibility

- Real `<input type="checkbox">` elements, so native semantics carry. The list stays
  a plain list; it does **not** become `role="listbox"` with
  `aria-multiselectable`. Checkboxes plus listbox semantics conflict, and the grid's
  listbox pattern exists because it has no checkboxes.
- Each checkbox gets `aria-label={`Select ${link.title}`}`.
- The selection bar is `role="toolbar"` with `aria-label="Selection actions"`,
  matching `BulkBar`.
- Tab order per row becomes checkbox, row body, delete, `⋯`. The last two are
  already focusable today despite being `opacity-0`, so this adds one stop per row.

## Testing

This repo splits coverage deliberately, and `apps/extension/vitest.config.ts` says so
in its own comment: *"Only pure `lib/` functions are unit tested here — no `chrome.*`
mocking, no DOM/component rendering."* Component and `chrome.*` behavior is covered by
the Playwright suite driving a real built extension. This feature follows that split:

- **Vitest:** one new pure function, `accentColor` in `lib/accents.ts`. The selection
  reducer underneath (`nextSelection`, `pruneSelection`) is already covered by
  `selection.test.ts` and gains nothing new.
- **No vitest component tests.** There is no `@testing-library/react` in the package
  and the config comment rules the category out. A test asserting React plumbing would
  be a defect here, not coverage.
- **Playwright:** the real coverage, appended to `e2e/specs/r10-folder-actions.spec.ts`,
  which already covers this exact surface (Append, Overwrite, Add link, inline trash,
  header `+`, rename) and runs local-only against Dexie with no sign-in. This mirrors
  how the dashboard's bulk-select is covered in `t09-grid-dnd.spec.ts`. Five cases:
  toggle and count, shift-range with a fixed anchor, `Open N` (background tabs, popup
  survives, selection clears), bulk delete with its confirm, and Escape's guard.

  The Escape case is the one worth calling out by name, not folding into "toggle and
  count": it alone covers six sub-cases, because the guard has three moving parts
  (see the `FolderDetail` section above) and each competing surface exercises a
  different one of them — checkbox-focused clear (the core flow, and the one a bare
  `instanceof HTMLInputElement` check would break), rename cancel (text-entry bail),
  the add-link field (text-entry bail, second input), the accent picker (the
  `role="dialog"` div, not a native `<dialog>`), a per-row `⋯` menu (the
  capture-vs-bubble ordering itself: this is the sub-case that fails if the listener
  is ever moved back to bubble), and the native bulk-delete confirm dialog
  (`dialog[open]`).

The inline-trash test in that file is the one to watch: it shares the row markup the
checkbox column changes, so it doubles as the regression guard.

Manual smoke checks during implementation, ahead of the e2e run:

1. Tick two checkboxes, confirm the bar appears with "2 selected".
2. Shift-click a third further down, confirm the contiguous range fills in and the
   anchor does not move on a second shift-click.
3. "Open N", confirm background tabs open, the popup stays open, and the selection
   clears.
4. Click a row body mid-selection, confirm it still opens one active tab.
5. `Escape` with a row's `⋯` menu open, confirm the menu closes and the selection
   survives; `Escape` again clears the selection.
6. Delete two links, confirm the dialog, confirm they vanish and sync nudges.
7. Check a folder with an emoji accent, confirm the checkbox falls back to
   `var(--accent)` rather than rendering broken.

## Files touched

| File | Change |
| --- | --- |
| `entrypoints/popup/FolderDetail.tsx` | Selection state, prune + Escape effects, renders the bar, bulk open/delete handlers, delete confirm dialog |
| `entrypoints/popup/LinkRow.tsx` | Checkbox column, `selected` / `onToggle` props |
| `entrypoints/popup/SelectionBar.tsx` | New. The popup's selection bar |
| `entrypoints/popup/AddLinkRow.tsx` | Left indent to match the checkbox column |
| `lib/selection.ts` | None. Reused as-is |

## Deliberately excluded

- **A "select all" header checkbox.** The header's `↗` "Open all" already covers the
  dominant case.
- **"Move to…".** Needs a `listCollections` load `FolderDetail` does not currently
  do, plus a `<select>` crowded into a 328px bar.
- **Marquee / drag-to-select.**
- **Keyboard shift+arrow ranging.** The dashboard has no keyboard range either;
  adding one here would make the popup the more capable surface for no stated
  reason.
