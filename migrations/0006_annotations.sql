-- F09: the vector markup drawn on a capture. One row per capture: id is the capture id.
create table annotations (
    id                uuid primary key,
    uid               text not null,
    rev               bigint not null,
    client_updated_at timestamptz not null,
    deleted_at        timestamptz,
    shapes            jsonb not null,
    foreign key (uid, id) references captures (uid, id) deferrable initially deferred
);
create index annotations_uid_rev on annotations (uid, rev);
