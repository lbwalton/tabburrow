/**
 * The pure decisions behind "search a topic, tick what you want, open it all"
 * (#17) — shared by BOTH search surfaces (the dashboard's `SearchOverlay` and
 * the popup's inline results in `FoldersHome`) so the two can't drift on what
 * the open button opens or when it stops to confirm.
 *
 * Selection state itself is `lib/selection.ts` (the same toggle/range model
 * the link grid uses); the actual tab-opening is `lib/restore.ts`'s
 * `openLinks`. This module is only the glue between them, kept pure so it's
 * unit-testable — the same split `lib/searchNav.ts` already uses for the
 * overlay's arrow-key navigation.
 */

import { needsRestoreConfirm } from "./restore";

export interface SearchOpenPlan {
  /** The urls to open, in display order. */
  urls: string[];
  /** `urls.length`, for the label and the confirm copy. */
  count: number;
  /** The open button's text. */
  label: string;
  /** Whether this batch is big enough to confirm before opening. */
  needsConfirm: boolean;
  /** True when the plan covers every result because nothing is ticked. */
  isOpenAll: boolean;
}

/**
 * What the search surface's single open action should do right now.
 *
 * An EMPTY selection means "open everything this search found" — that's the
 * one-click "open all N results" the issue asks for, and it's why the button
 * is useful before the user has ticked anything. A non-empty selection
 * narrows it to exactly the ticked rows. Either way the order is the results'
 * display order, so tabs open in the order they're listed.
 *
 * `links` should be the links the surface is actually SHOWING (post-cap,
 * post-slice), never the full result set: the button must never open a row
 * the user can't see, which is also what keeps its count honest.
 */
export function planSearchOpen<T extends { id: string; url: string }>(
  links: readonly T[],
  selected: ReadonlySet<string>,
): SearchOpenPlan {
  const isOpenAll = selected.size === 0;
  const chosen = isOpenAll ? links : links.filter((l) => selected.has(l.id));
  const urls = chosen.map((l) => l.url);
  return {
    urls,
    count: urls.length,
    label: isOpenAll ? `Open all ${urls.length}` : `Open ${urls.length}`,
    // Reuses the app's existing "that's a lot of tabs" threshold rather than
    // inventing a second one — see `needsRestoreConfirm` (RESTORE_CONFIRM_THRESHOLD).
    needsConfirm: needsRestoreConfirm(urls.length),
    isOpenAll,
  };
}

/** The inline confirm's question for a batch of `count` tabs. */
export function openConfirmMessage(count: number): string {
  return `Open ${count} tabs?`;
}

/**
 * The accessible name for a result row's select checkbox. Includes the title
 * so a screen reader (and Playwright's `getByRole`) can tell one row's
 * checkbox from another's.
 */
export function selectLabel(title: string): string {
  return `Select ${title}`;
}
