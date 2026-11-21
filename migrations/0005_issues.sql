-- F08: issues, the photos attached to them, and saved phrases for quick typing.
create table issues (
    id                         uuid primary key,
    uid                        text not null,
    rev                        bigint not null,
    client_updated_at          timestamptz not null,
    deleted_at                 timestamptz,
    project_id                 uuid not null,
    location_id                uuid not null,
    title                      text not null,
    detail                     text not null,
    severity                   text not null check (severity in ('critical', 'major', 'minor')),
    status                     text not null check (status in ('open', 'inProgress', 'resolved', 'verified')),
    due_date                   date,
    assignee_name              text,
    trade                      text,
    plan_sheet_id              uuid,
    pin_x                      double precision,
    pin_y                      double precision,
    resolved_by_issue_id       uuid,
    source_checklist_result_id uuid,
    unique (uid, id),
    -- a pin is a sheet plus a point inside it (0…1), or nothing at all
    check (
        (plan_sheet_id is null and pin_x is null and pin_y is null)
        or (plan_sheet_id is not null and pin_x between 0 and 1 and pin_y between 0 and 1)
    ),
    foreign key (uid, project_id) references projects (uid, id) deferrable initially deferred,
    foreign key (uid, location_id) references locations (uid, id) deferrable initially deferred,
    foreign key (uid, resolved_by_issue_id) references issues (uid, id) deferrable initially deferred
);
create index issues_uid_rev on issues (uid, rev);

create table issue_captures (
    id                uuid primary key,
    uid               text not null,
    rev               bigint not null,
    client_updated_at timestamptz not null,
    deleted_at        timestamptz,
    issue_id          uuid not null,
    capture_id        uuid not null,
    foreign key (uid, issue_id) references issues (uid, id) deferrable initially deferred,
    foreign key (uid, capture_id) references captures (uid, id) deferrable initially deferred
);
create index issue_captures_uid_rev on issue_captures (uid, rev);
create unique index issue_captures_pair_live on issue_captures (issue_id, capture_id)
    where deleted_at is null;

create table phrases (
    id                uuid primary key,
    uid               text not null,
    rev               bigint not null,
    client_updated_at timestamptz not null,
    deleted_at        timestamptz,
    text              text not null,
    usage_count       integer not null
);
create index phrases_uid_rev on phrases (uid, rev);
create unique index phrases_text_live on phrases (uid, text) where deleted_at is null;
