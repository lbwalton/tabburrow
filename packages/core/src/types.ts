export interface Collection {
  id: string;
  name: string;
  accent: string | null;
  position: string;
  isShared: boolean;
  shareSlug: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface Link {
  id: string;
  collectionId: string;
  url: string;
  title: string;
  faviconUrl: string | null;
  note: string | null;
  tags: string[];
  position: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface TabInfo {
  url: string;
  title: string;
  faviconUrl?: string;
  pinned?: boolean;
}

export interface SessionWindow {
  tabs: TabInfo[];
}

export interface SessionSnapshot {
  id: string;
  name: string | null;
  kind: "manual" | "auto";
  windows: SessionWindow[];
  createdAt: number;
}

export interface PendingOp {
  id?: number;
  table: "collections" | "links";
  rowId: string;
  queuedAt: number;
}
