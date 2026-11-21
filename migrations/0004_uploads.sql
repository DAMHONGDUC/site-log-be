-- F06: server-only (not synced). One row per upload job; the backend never stores the bytes.
create type upload_mode  as enum ('single', 'multipart');
create type upload_state as enum ('created', 'completed', 'aborted');
create type verify_state as enum ('registered', 'verified', 'mismatch');

create table uploads (
    id                uuid primary key default gen_random_uuid(),
    uid               text not null,
    object_key        text not null,
    project_id        uuid,
    session_id        uuid,
    sha256            char(64) not null check (sha256 ~ '^[0-9a-f]{64}$'),
    byte_size         bigint not null check (byte_size > 0),
    content_type      text not null,
    mode              upload_mode not null,
    s3_upload_id      text,
    part_count        integer,
    state             upload_state not null default 'created',
    verification_code text unique,
    verify_state      verify_state,
    verified_at       timestamptz,
    created_at        timestamptz not null default now(),
    completed_at      timestamptz,
    constraint multipart_needs_s3_id check (mode <> 'multipart' or s3_upload_id is not null),
    constraint completed_needs_code check (state <> 'completed' or verification_code is not null)
);
create unique index uploads_completed_key on uploads (uid, object_key) where state = 'completed';
create index uploads_snapshot on uploads (uid, session_id, state);
create index uploads_abandoned on uploads (created_at) where state = 'created';
