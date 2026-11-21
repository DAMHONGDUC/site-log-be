-- F05: one row per photo, video or voice note. Evidence columns never change after insert.
create table captures (
    id                   uuid primary key,
    uid                  text not null,
    rev                  bigint not null,
    client_updated_at    timestamptz not null,
    deleted_at           timestamptz,
    project_id           uuid not null,
    session_id           uuid not null,
    location_id          uuid,
    kind                 text not null check (kind in ('photo', 'video', 'audio')),
    sha256               char(64) not null check (sha256 ~ '^[0-9a-f]{64}$'),
    byte_size            bigint not null check (byte_size > 0),
    captured_at          timestamptz not null,
    time_confidence      text not null,
    latitude             double precision,
    longitude            double precision,
    horizontal_accuracy  double precision,
    device_model         text not null,
    duration_seconds     double precision,
    device_reading       jsonb,
    remote_key           text,
    verification_code    text,
    excluded_from_report boolean not null,
    unique (uid, id),
    -- a basement has no GPS: both coordinates or neither
    check ((latitude is null) = (longitude is null)),
    foreign key (uid, project_id) references projects (uid, id) deferrable initially deferred,
    foreign key (uid, session_id) references sessions (uid, id) deferrable initially deferred,
    foreign key (uid, location_id) references locations (uid, id) deferrable initially deferred
);
create index captures_uid_rev on captures (uid, rev);
create unique index captures_sha_live on captures (project_id, sha256) where deleted_at is null;
