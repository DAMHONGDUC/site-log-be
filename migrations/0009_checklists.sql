-- F12: templates, their items, a run of a template at a location, and one result per item.
create table checklist_templates (
    id                uuid primary key,
    uid               text not null,
    rev               bigint not null,
    client_updated_at timestamptz not null,
    deleted_at        timestamptz,
    project_id        uuid,
    name              text not null,
    applies_to        text not null,
    is_built_in       boolean not null,
    usage_count       integer not null,
    unique (uid, id),
    foreign key (uid, project_id) references projects (uid, id) deferrable initially deferred
);
create index checklist_templates_uid_rev on checklist_templates (uid, rev);

create table checklist_template_items (
    id                     uuid primary key,
    uid                    text not null,
    rev                    bigint not null,
    client_updated_at      timestamptz not null,
    deleted_at             timestamptz,
    template_id            uuid not null,
    ordinal                integer not null,
    text                   text not null,
    default_severity       text not null check (default_severity in ('critical', 'major', 'minor')),
    requires_photo_on_fail boolean not null,
    unique (uid, id),
    foreign key (uid, template_id) references checklist_templates (uid, id) deferrable initially deferred
);
create index checklist_template_items_uid_rev on checklist_template_items (uid, rev);

create table checklist_runs (
    id                uuid primary key,
    uid               text not null,
    rev               bigint not null,
    client_updated_at timestamptz not null,
    deleted_at        timestamptz,
    template_id       uuid not null,
    session_id        uuid not null,
    location_id       uuid not null,
    started_at        timestamptz not null,
    completed_at      timestamptz,
    unique (uid, id),
    foreign key (uid, template_id) references checklist_templates (uid, id) deferrable initially deferred,
    foreign key (uid, session_id) references sessions (uid, id) deferrable initially deferred,
    foreign key (uid, location_id) references locations (uid, id) deferrable initially deferred
);
create index checklist_runs_uid_rev on checklist_runs (uid, rev);

create table checklist_results (
    id                uuid primary key,
    uid               text not null,
    rev               bigint not null,
    client_updated_at timestamptz not null,
    deleted_at        timestamptz,
    run_id            uuid not null,
    template_item_id  uuid not null,
    outcome           text check (outcome in ('pass', 'fail', 'na')),
    note              text not null,
    issue_id          uuid,
    answered_at       timestamptz,
    unique (uid, id),
    foreign key (uid, run_id) references checklist_runs (uid, id) deferrable initially deferred,
    foreign key (uid, template_item_id) references checklist_template_items (uid, id)
        deferrable initially deferred,
    foreign key (uid, issue_id) references issues (uid, id) deferrable initially deferred
);
create index checklist_results_uid_rev on checklist_results (uid, rev);
create unique index checklist_results_item_live on checklist_results (run_id, template_item_id)
    where deleted_at is null;

alter table issues
    add foreign key (uid, source_checklist_result_id) references checklist_results (uid, id)
        deferrable initially deferred;
