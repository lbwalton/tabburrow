-- T18: server-clock read backing the sync cursor.
--
-- apps/extension/lib/sync-transport.ts's pullSince calls this RPC FIRST —
-- before running its two .gt("updated_at", cursor) reads — and returns ITS
-- value as `serverNow`, not a client Date.now(). That ordering is the whole
-- point: the cursor SyncEngine advances to becomes a floor taken BEFORE the
-- pull's own reads run, not after. A row written between this call and the
-- reads finishing has an updated_at that could land on either side of that
-- floor, but it can never be silently missed forever — its updated_at is
-- still greater than the OLD (pre-this-cycle) cursor, so it's picked up
-- again on the very next sync cycle and safely deduped by mergeRow's LWW
-- rule (packages/core/src/sync/merge.ts). Reading the clock AFTER the pull
-- instead would risk the opposite: a row committed during the pull could
-- have an updated_at newer than a post-pull "now" reading raced against, and
-- then advancing the cursor past it would skip that row forever.
create or replace function public.server_now_ms() returns bigint
language sql stable as $$
  select (extract(epoch from now()) * 1000)::bigint
$$;

grant execute on function public.server_now_ms() to authenticated;
