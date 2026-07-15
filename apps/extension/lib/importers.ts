import type { BurrowDB, Collection, Link, SessionSnapshot } from "@tabburrow/core";
import { createCollection, getDB, importData, saveTabs } from "@tabburrow/core";
import { isHttpUrl } from "./tabs";

// --- Shared plan shape --------------------------------------------------
//
// The Chrome-bookmarks and Toby importers both reduce their source format
// down to this same normalized plan before touching the database: one
// collection per named group, each carrying the http(s)-only links that
// belong to it. `applyImportPlan` (IO, below) is the one place that turns a
// plan into actual `createCollection`/`saveTabs` calls — dedupe-by-URL,
// position assignment, etc. all come for free from those repo functions.

export interface ImportPlanLink {
  url: string;
  title: string;
}

export interface ImportPlanCollection {
  name: string;
  links: ImportPlanLink[];
}

export interface ImportPlan {
  collections: ImportPlanCollection[];
}

/** Uniform result shape for all three importers' IO wrappers (importBurrowJson's own core `importData` also reports a sessions count — dropped here for a single shared shape across all three). */
export interface ImportCounts {
  collections: number;
  links: number;
}

/** "Imported 3 collections, 12 links from Chrome bookmarks." (singular-aware) — the Settings pane's post-import toast text. */
export function formatImportResult(sourceLabel: string, result: ImportCounts): string {
  const c = result.collections === 1 ? "collection" : "collections";
  const l = result.links === 1 ? "link" : "links";
  return `Imported ${result.collections} ${c}, ${result.links} ${l} from ${sourceLabel}.`;
}

async function applyImportPlan(plan: ImportPlan, db: BurrowDB): Promise<ImportCounts> {
  let links = 0;
  for (const planCollection of plan.collections) {
    const collection = await createCollection(planCollection.name, undefined, db);
    const saved = await saveTabs(
      collection.id,
      planCollection.links.map((l) => ({ url: l.url, title: l.title })),
      db,
    );
    links += saved.length;
  }
  return { collections: plan.collections.length, links };
}

// --- 1. Chrome bookmarks (Netscape bookmarks HTML) ----------------------
//
// Real bookmark exports are lenient, not-quite-HTML: `<DT>`/`<p>` are never
// explicitly closed, and browsers' own HTML parsers auto-correct that in
// ways that differ subtly by engine (a nested `<DL>` can end up either a
// CHILD of the `<DT>` it follows, or a SIBLING of it — both are plausible
// outcomes of the same markup depending on the parser's implied-end-tag
// rules). `significantChildren` below flattens `<dt>`/`<p>` wrappers
// transparently and treats `<h3>`/`<a>`/`<dl>` as the only meaningful
// tokens, so `walk` sees the identical token sequence regardless of which
// way a given parser nested things — robust to that ambiguity rather than
// betting on one specific shape.

function* significantChildren(el: Element): Generator<Element> {
  for (const child of Array.from(el.children)) {
    const tag = child.tagName.toLowerCase();
    if (tag === "h3" || tag === "a" || tag === "dl") {
      yield child;
    } else if (tag === "dt" || tag === "p") {
      // Transparent wrappers: flatten their significant children into the
      // current scope instead of starting a new one.
      yield* significantChildren(child);
    }
    // Anything else (comments, <title>, stray text nodes' element siblings,
    // etc.) carries no structural meaning here — skipped.
  }
}

/**
 * Walks the bookmarks tree rooted at `doc`'s first `<dl>`, producing an
 * `ImportPlan`. Folders → collections; a folder nested inside another
 * flattens to `"Parent / Child"`. Bookmarks with no enclosing folder land in
 * an `"Imported bookmarks"` collection. Non-http(s) hrefs (`javascript:`,
 * `place:`, etc.) are dropped. A folder that ends up with zero direct links
 * (only sub-folders, or genuinely empty) contributes no collection of its
 * own — its sub-folders are still processed on their own merits.
 */
export function planFromBookmarksDocument(doc: Document): ImportPlan {
  const rootLinks: ImportPlanLink[] = [];
  const byPath = new Map<string, ImportPlanLink[]>();

  function addLink(path: string[], link: ImportPlanLink) {
    if (path.length === 0) {
      rootLinks.push(link);
      return;
    }
    const name = path.join(" / ");
    const existing = byPath.get(name);
    if (existing) existing.push(link);
    else byPath.set(name, [link]);
  }

  function walk(el: Element, path: string[]) {
    let pendingFolderName: string | null = null;
    for (const sig of significantChildren(el)) {
      const tag = sig.tagName.toLowerCase();
      if (tag === "h3") {
        pendingFolderName = sig.textContent?.trim() || "Untitled folder";
      } else if (tag === "a") {
        const href = sig.getAttribute("href");
        if (href && isHttpUrl(href)) {
          addLink(path, { url: href, title: sig.textContent?.trim() || href });
        }
      } else if (tag === "dl") {
        const nextPath = pendingFolderName !== null ? [...path, pendingFolderName] : path;
        pendingFolderName = null; // consumed — an immediately-following DL is this folder's contents
        walk(sig, nextPath);
      }
    }
  }

  const rootDl = doc.querySelector("dl");
  if (rootDl) walk(rootDl, []);

  const collections: ImportPlanCollection[] = [];
  if (rootLinks.length > 0) collections.push({ name: "Imported bookmarks", links: rootLinks });
  for (const [name, links] of byPath) {
    if (links.length > 0) collections.push({ name, links });
  }
  return { collections };
}

/** Pure parsing core: HTML string -> ImportPlan, via DOMParser (available in the dashboard's page context). */
export function parseChromeBookmarksHtml(html: string): ImportPlan {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return planFromBookmarksDocument(doc);
}

export async function importChromeBookmarksHtml(html: string, db: BurrowDB = getDB()): Promise<ImportCounts> {
  return applyImportPlan(parseChromeBookmarksHtml(html), db);
}

// --- 2. Toby JSON ---------------------------------------------------------

interface TobyCard {
  title?: unknown;
  url?: unknown;
}

interface TobyList {
  title?: unknown;
  cards?: unknown;
}

interface TobyExport {
  lists?: unknown;
}

/** Pure parsing core: Toby's `{lists:[{title,cards:[{title,url}]}]}` export -> ImportPlan. One collection per list, in order; a missing/blank list title falls back to "Imported list". Non-http(s) or url-less cards are dropped. Throws (with a user-facing message) on invalid JSON or a shape that isn't a Toby export. */
export function parseTobyJson(json: string): ImportPlan {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const lists = (data as TobyExport | null)?.lists;
  if (!data || typeof data !== "object" || !Array.isArray(lists)) {
    throw new Error("That doesn't look like a Toby export (missing \"lists\").");
  }

  const collections: ImportPlanCollection[] = (lists as TobyList[]).map((list) => {
    const cards = Array.isArray(list.cards) ? (list.cards as TobyCard[]) : [];
    const links: ImportPlanLink[] = cards
      .filter((card): card is { title?: unknown; url: string } => typeof card.url === "string" && isHttpUrl(card.url))
      .map((card) => ({
        url: card.url,
        title: typeof card.title === "string" && card.title.trim() ? card.title.trim() : card.url,
      }));
    const name = typeof list.title === "string" && list.title.trim() ? list.title.trim() : "Imported list";
    return { name, links };
  });

  return { collections };
}

export async function importTobyJson(json: string, db: BurrowDB = getDB()): Promise<ImportCounts> {
  return applyImportPlan(parseTobyJson(json), db);
}

// --- 3. TabBurrow's own export (id-preserving upsert) ---------------------

interface BurrowExportShape {
  version?: unknown;
  collections?: unknown;
  links?: unknown;
  sessions?: unknown;
}

export interface BurrowImportPayload {
  collections: Collection[];
  links: Link[];
  sessions: SessionSnapshot[];
}

/** Pure parsing core: validates + version-checks a TabBurrow export JSON string, returning the payload `@tabburrow/core`'s `importData` expects. Throws (with a user-facing message) on invalid JSON, an unsupported version, or a missing collections/links/sessions array. */
export function parseBurrowJson(json: string): BurrowImportPayload {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  if (!data || typeof data !== "object") {
    throw new Error("That doesn't look like a TabBurrow export.");
  }
  const obj = data as BurrowExportShape;
  if (obj.version !== 1) {
    throw new Error(`Unsupported TabBurrow export version "${String(obj.version)}" (expected 1).`);
  }
  if (!Array.isArray(obj.collections) || !Array.isArray(obj.links) || !Array.isArray(obj.sessions)) {
    throw new Error("That doesn't look like a TabBurrow export (missing collections/links/sessions).");
  }
  return {
    collections: obj.collections as Collection[],
    links: obj.links as Link[],
    sessions: obj.sessions as SessionSnapshot[],
  };
}

export async function importBurrowJson(json: string, db: BurrowDB = getDB()): Promise<ImportCounts> {
  const payload = parseBurrowJson(json);
  const result = await importData(payload, db);
  return { collections: result.collections, links: result.links };
}
