-- F11: floor plan pages. Issues could name a sheet since F08; now the database checks it.
create table plan_sheets (
    id                uuid primary key,
    uid               text not null,
    rev               bigint not null,
    client_updated_at timestamptz not null,
    deleted_at        timestamptz,
    project_id        uuid not null,
    location_id       uuid,
    name              text not null,
    page_index        integer not null check (page_index >= 0),
    pixel_width       integer not null check (pixel_width > 0),
    pixel_height      integer not null check (pixel_height > 0),
    sha256            char(64) not null check (sha256 ~ '^[0-9a-f]{64}$'),
    remote_key        text,
    unique (uid, id),
    foreign key (uid, project_id) references projects (uid, id) deferrable initially deferred,
    foreign key (uid, location_id) references locations (uid, id) deferrable initially deferred
);
create index plan_sheets_uid_rev on plan_sheets (uid, rev);

alter table issues
    add foreign key (uid, plan_sheet_id) references plan_sheets (uid, id) deferrable initially deferred;
