-- T21: lets a collection owner opt a share page into search-engine indexing.
-- Share pages default to `robots: noindex` unless this is true (see
-- docs/plans/2026-07-15-tabburrow-build.md, share page section).
alter table public.collections add column allow_index boolean not null default false;
