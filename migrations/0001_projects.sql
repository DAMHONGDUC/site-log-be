-- F03: the first synced tables. Every synced table has the same five sync columns.
-- Foreign keys include uid, so a row can only point at a parent of the same user,
-- and are deferred, so one push batch may insert a child before its parent.

create type session_state as enum ('draft', 'active', 'closed', 'exported');

create table projects (
    id                uuid primary key,
    uid               text not null,
    rev               bigint not null,
    client_updated_at timestamptz not null,
    deleted_at        timestamptz,
    name              text not null,
    address           text,
    client_name       text,
    created_at        timestamptz not null,
    unique (uid, id)
);
create index projects_uid_rev on projects (uid, rev);

create table locations (
    id                uuid primary key,
    uid               text not null,
    rev               bigint not null,
    client_updated_at timestamptz not null,
    deleted_at        timestamptz,
    project_id        uuid not null,
    parent_id         uuid,
    code              text not null,
    kind              text not null check (kind in ('floor', 'unit', 'room')),
    sort_index        integer not null,
    unique (uid, id),
    foreign key (uid, project_id) references projects (uid, id) deferrable initially deferred,
    foreign key (uid, parent_id) references locations (uid, id) deferrable initially deferred
);
create index locations_uid_rev on locations (uid, rev);
create unique index locations_code_live on locations (project_id, code) where deleted_at is null;

create table sessions (
    id                uuid primary key,
    uid               text not null,
    rev               bigint not null,
    client_updated_at timestamptz not null,
    deleted_at        timestamptz,
    project_id        uuid not null,
    started_at        timestamptz not null,
    ended_at          timestamptz,
    surveyor_name     text not null,
    note              text not null,
    state             session_state not null,
    unique (uid, id),
    foreign key (uid, project_id) references projects (uid, id) deferrable initially deferred
);
create index sessions_uid_rev on sessions (uid, rev);
