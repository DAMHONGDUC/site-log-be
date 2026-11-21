-- F04: one row per user. Locking it serializes that user's writes, so revs are commit-ordered.
create table sync_state (
    uid                text primary key,
    last_rev           bigint not null default 0,
    -- highest rev removed by the tombstone purge; an older cursor must resync from 0
    purged_through_rev bigint not null default 0,
    created_at         timestamptz not null default now()
);
