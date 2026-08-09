# Popup selection affordances: make the bar findable, teach shift-range, add inline folder delete

Date: 2026-08-08
Status: approved, ready for implementation plan

Follows on from `2026-08-08-popup-multi-select-design.md`, which added checkbox
multi-select to the popup's folder-detail view. This spec addresses three gaps found
by clicking through the shipped feature.

## Problem

**1. The selection bar does not announce itself.** It appears in a stack of five
button rows and reads as one more row rather than as a response to what the user just
did. Its `Delete` sits roughly 40px above the orange `Append tabs` primary, so the two
compete. A louder entrance animation is the wrong fix: the area is already busy, and
stacked motion effects read as generated rather than designed.

**2. Shift-click range selection is undiscoverable.** Nothing on screen says it exists.
Escape-to-clear is likewise silent, though it matters less because `×` is visible and
does the same job.

**3. Folder rows have no inline delete.** Link rows inside a folder show a trash on
hover; folder rows on the home screen show only `+` and `↗`. Deleting a folder takes
two levels of menu. Bulk folder selection is explicitly NOT wanted: folders are few,
and the home screen should stay clean.

## Scope

**In:** accent-tinted selection bar plus de-emphasis of the competing action buttons; a
self-limiting shift-range hint; an inline folder-delete trash with a confirm; and a
copy fix on the existing Delete-folder dialog.

**Out:** more emoji accents, a custom/arbitrary color picker, bulk folder selection, and
the `Overwrite` dialog's separate false-restore claim (all four decided against
explicitly).

## 1. Selection bar emphasis

The bar reads as unrelated to the checkboxes that summoned it. Fix by tying it to them
with color they already share, and by quieting what is momentarily irrelevant.

### Accent tint

`SelectionBar` takes a new required prop:

```ts
/** Resolved CSS color for the folder's accent — the same value the row checkboxes fill with. */
accent: string;
```

`FolderDetail` already computes `checkColor = accentColor(collection.accent)` for
`LinkRow`, so this is a pass-through with no new resolution logic. Emoji and unset
accents fall back to `var(--accent)` exactly as the checkboxes do.

Applied as inline styles (the values are dynamic, so they cannot be Tailwind classes):

```ts
style={{
  borderColor: `color-mix(in srgb, ${accent} 55%, var(--line))`,
  backgroundColor: `color-mix(in srgb, ${accent} 8%, var(--surface))`,
}}
```

55% and 8% are starting values, tuned by eye after the first build. The relationship is
what matters: the bar is visibly the same hue as the ticked boxes, at a fraction of
their saturation, so it reads as belonging to them rather than to the button stack
below. No new hex literals; both values are `color-mix()` over a token-derived accent.

The existing `.bulk-bar` 200ms slide-up is unchanged. The problem was contrast, not
motion.

### De-emphasis of competing actions

While one or more links are selected, "Append tabs", "Overwrite", "Organize with AI",
and "Send" drop to `opacity-60` with a `transition-opacity`.

They stay **fully clickable**: no `disabled` attribute, no `pointer-events` change.
Appending tabs is a legitimate thing to do mid-selection; the dim says "probably not
what you want right now", not "unavailable". This distinction is why the dim is 60%
rather than the ~40% that would read as disabled.

**Apply the class to the four `Button`s individually, not to their shared wrapper.**
The wrapper would be tidier, but the folder `⋯` menu and `AccentPicker` render inside
it and would inherit the dim while open, which is wrong. Leaving `⋯` at full opacity is
also correct on its own terms: it is a menu affordance, not a folder action.

The `Dashboard` button below lives outside this section and is untouched. It is
navigation, not a folder action.

## 2. Shift-range hint

Inside `SelectionBar`, below the button row, rendered only when `count === 1`:

```
│  1 selected          Open 1    Delete    ×  │
│  ⇧ click another to select a range          │
```

- Uses `Kbd` from `@tabburrow/ui` for the `⇧` chip. This matches the established hint
  pattern in the dashboard's `SearchOverlay` footer (`↑ ↓ navigate · Enter open ·
  Esc close`), so it is a reuse of the product's existing vocabulary, not a new one.
- Text is `text-[11px]` in `var(--text-2)`.

Structurally this changes `SelectionBar`'s root from a flex **row** to a flex **column**
holding two children: the existing row (count + buttons, unchanged), and the hint line.
The hint's appearance and disappearance changes the bar's height by roughly 18px, which
nudges the action stack below it. That shift is acceptable and in fact reinforces item
1: the bar is the thing that just changed. Do not reserve blank space for the hint when
it is absent, which would trade a small honest shift for permanent dead space in a
360px panel.

**No stored preference and no dismiss control.** The hint is present exactly when
shift-click is possible and useful: a range needs an anchor, so at zero selected there
is nothing to teach, and at two or more the user has evidently worked it out. The
condition is self-limiting, which is why this needs no "don't show again" state to
persist, sync, or migrate.

Escape-to-clear is deliberately not advertised. `×` is visible in the bar and does the
same job, so the hint budget is spent on the gesture that has no visible equivalent.

## 3. Inline folder delete

`FolderRow` gains a trash button in its existing hover/focus action group, alongside
`+` (add current tab) and `↗` (open all).

**Placed last, rightmost.** This deviates from `LinkRow`, which renders its trash
first. Deliberate: `↗` opens every tab in the folder and is the most-used control on
the row. Putting a folder-deleting trash immediately beside it invites precisely the
mis-click that costs the most. Distance from the hot control is worth the local
inconsistency.

Styling matches `LinkRow`'s trash exactly (`h-7 w-7`, `rounded-[6px]`,
`text-[var(--text-2)]`, `hover:text-[var(--accent)]`), so the two rows feel like one
system despite the ordering difference.

**It confirms.** `LinkRow`'s trash deletes one link in a single click with no dialog,
because one link is cheap to lose. A folder takes all of its links with it. `FolderRow`
therefore owns its own confirm `Dialog`, mirroring how `LinkRow` owns its
`EditLinkPopover`:

> **Delete "Research"?**
> Delete Research and its 5 links? This can't be undone.

Pluralize `link`/`links` on the count, matching every other dialog in the popup.

`FolderRow` already imports `getDB` and runs its own `listLinks` live query, so it does
the write itself (`softDeleteCollection`, then `sendSyncNudge()`) rather than
prop-drilling a handler through `FoldersHome`. It gains `Button` and `Dialog` imports
from `@tabburrow/ui` and `softDeleteCollection` from `@tabburrow/core`.

Even confirmed, this is still faster than today's path (`⋯` → Delete folder → confirm)
and it closes the inconsistency where link rows have an inline delete and folder rows
do not.

## 4. Copy fix on the existing Delete-folder dialog

`FolderDetail`'s Delete-folder dialog currently ends "You can restore it from the
dashboard." That is false: `restoreLinks` / `restoreCollection` have exactly two call
sites, both driven by a 6-second undo toast that fires only for deletes initiated in
the dashboard, and no UI anywhere exposes soft-deleted records.

Replace with "This can't be undone.", matching the bulk-delete dialog.

This is in scope specifically because item 3 promotes folder deletion from two menu
levels down to one hover-click. Making a destructive path easier to reach while it
still promises a recovery that does not exist is the wrong order of operations.

The `Overwrite` dialog's equivalent claim ("you can undo from the dashboard") is
knowingly left alone, to keep this change scoped.

## Testing

All four items are popup UI and `chrome.*` behavior, so they belong in the Playwright
suite, not vitest — per `apps/extension/vitest.config.ts`'s stated split (only pure
`lib/` functions get unit tests). No new pure logic is introduced, so there is nothing
for vitest to cover.

In `e2e/specs/r10-folder-actions.spec.ts`:

1. **The hint is self-limiting.** Tick one box, assert the shift hint is visible. Tick
   a second, assert it is gone. Untick back to one, assert it returns.
2. **De-emphasis toggles.** With nothing selected, assert "Append tabs" is at full
   opacity. Tick a box, assert it is dimmed. Clear, assert it returns. Assert it stays
   clickable throughout (not `disabled`).

In `e2e/specs/r10-popup-hub.spec.ts` (which already covers the home screen's folder
rows and their hover actions):

3. **Inline folder delete confirms.** Hover a folder row, click the trash, assert the
   confirm dialog appears naming the folder and its link count. Cancel, assert the
   folder is still listed. Trash again, confirm, assert the folder is gone.
4. **The trash does not sit next to `↗`.** Assert the action group's order is `+`, `↗`,
   trash, so a future refactor that reorders them fails loudly rather than silently
   re-creating the mis-click hazard.

The accent tint is deliberately **not** asserted in e2e. A test pinning a computed
`color-mix()` string would break on any tuning of the 55%/8% values while proving
nothing about whether it reads correctly, which is a judgment only a human eye settles.

## Files touched

| File | Change |
| --- | --- |
| `entrypoints/popup/SelectionBar.tsx` | `accent` prop, tinted border/surface, shift hint at `count === 1` |
| `entrypoints/popup/FolderDetail.tsx` | Pass `accent`; dim the four action buttons while selected; Delete-folder copy fix |
| `entrypoints/popup/FolderRow.tsx` | Trash button (last), confirm `Dialog`, `softDeleteCollection` + `sendSyncNudge` |
| `e2e/specs/r10-folder-actions.spec.ts` | Hint and de-emphasis tests |
| `e2e/specs/r10-popup-hub.spec.ts` | Inline folder-delete tests |

## Deliberately excluded

- **More emoji accents.** Considered and declined.
- **A custom / arbitrary color picker.** The 8 swatches are all `color-mix()` over brand
  tokens, and `accents.test.ts` asserts no swatch contains a raw hex. A free picker
  would allow colors that fail contrast on the Deep Green ground, look wrong under
  `[data-theme="paper"]`, and now also break the checkbox fill, which inherits the
  folder accent.
- **Bulk folder selection.** Folders are few and high-stakes; the home screen stays a
  clean list.
- **A persistent shortcut-help panel or toggle.** The dashboard's Settings pane already
  lists keyboard shortcuts; duplicating that in a 360px popup adds a surface to
  maintain for a hint that the `count === 1` rule delivers at the better moment.
- **Fixing the `Overwrite` dialog's false-restore claim.** Same bug class as item 4,
  scoped out by explicit decision.
