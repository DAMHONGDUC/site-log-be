-- F19: one company, four roles, projects shared between their members.
-- Rows belong to a project and keep who made them (created_by); the company has one rev counter.

create type member_role as enum ('admin', 'manager', 'inspector', 'viewer');

create table members (
    uid             text primary key,
    email           text not null,
    name            text not null default '',
    role            member_role not null,
    -- set when access changes; the next pull answers resyncRequired and clears it
    resync_required boolean not null default false,
    created_at      timestamptz not null default now(),
    last_seen_at    timestamptz,
    removed_at      timestamptz
);
create unique index members_email_live on members (lower(email)) where removed_at is null;

create table invitations (
    id           uuid primary key default gen_random_uuid(),
    email        text not null,
    role         member_role not null,
    project_ids  uuid[] not null default '{}',
    -- only the SHA-256 of the token is stored
    token_hash   bytea not null unique,
    invited_by   text not null,
    created_at   timestamptz not null default now(),
    expires_at   timestamptz not null,
    accepted_at  timestamptz,
    accepted_by  text,
    cancelled_at timestamptz
);
create index invitations_open on invitations (lower(email))
    where accepted_at is null and cancelled_at is null;

create table project_members (
    project_id uuid not null,
    uid        text not null references members (uid),
    added_by   text,
    added_at   timestamptz not null default now(),
    primary key (project_id, uid)
);
create index project_members_uid on project_members (uid);

-- Append-only audit: never updated, never deleted.
create table member_events (
    id            bigserial primary key,
    at            timestamptz not null default now(),
    actor_uid     text,
    type          text not null check (type in ('invited', 'invite_resent', 'invite_cancelled',
                      'joined', 'role_changed', 'projects_changed', 'removed', 'account_deleted')),
    subject_uid   text,
    invitation_id uuid,
    detail        jsonb not null default '{}'
);

-- 1. Drop the per-user foreign keys and unique (uid, id) keys of every synced table.
do $$
declare
    r record;
    synced text[] := array['projects', 'locations', 'sessions', 'captures', 'issues', 'issue_captures',
        'phrases', 'annotations', 'report_branding', 'plan_sheets', 'checklist_templates',
        'checklist_template_items', 'checklist_runs', 'checklist_results'];
begin
    for r in select conrelid::regclass::text as tbl, conname from pg_constraint
              where contype = 'f' and conrelid::regclass::text = any (synced)
    loop
        execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    end loop;
    for r in select conrelid::regclass::text as tbl, conname from pg_constraint
              where contype = 'u' and conrelid::regclass::text = any (synced)
                and pg_get_constraintdef(oid) = 'UNIQUE (uid, id)'
    loop
        execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    end loop;
end $$;

-- 2. Child tables get the project of their parent.
alter table issue_captures add column project_id uuid;
update issue_captures c set project_id = i.project_id from issues i where i.id = c.issue_id;
alter table annotations add column project_id uuid;
update annotations a set project_id = c.project_id from captures c where c.id = a.id;
alter table checklist_template_items add column project_id uuid;
update checklist_template_items i set project_id = t.project_id
  from checklist_templates t where t.id = i.template_id;
alter table checklist_runs add column project_id uuid;
update checklist_runs r set project_id = s.project_id from sessions s where s.id = r.session_id;
alter table checklist_results add column project_id uuid;
update checklist_results x set project_id = r.project_id from checklist_runs r where r.id = x.run_id;
-- Rows whose parent was never synced cannot be placed in a project: drop them.
delete from issue_captures where project_id is null;
delete from annotations where project_id is null;
delete from checklist_results where project_id is null;
delete from checklist_runs where project_id is null;
alter table issue_captures alter column project_id set not null;
alter table annotations alter column project_id set not null;
alter table checklist_runs alter column project_id set not null;
alter table checklist_results alter column project_id set not null;

-- 3. uid → created_by: the row belongs to the company; phrases stay personal.
alter table projects rename column uid to created_by;
alter table locations rename column uid to created_by;
alter table sessions rename column uid to created_by;
alter table captures rename column uid to created_by;
alter table issues rename column uid to created_by;
alter table issue_captures rename column uid to created_by;
alter table annotations rename column uid to created_by;
alter table report_branding rename column uid to created_by;
alter table plan_sheets rename column uid to created_by;
alter table checklist_templates rename column uid to created_by;
alter table checklist_template_items rename column uid to created_by;
alter table checklist_runs rename column uid to created_by;
alter table checklist_results rename column uid to created_by;

-- 4. Pull reads (project_id, rev); projects read by (id); company rows by rev.
drop index projects_uid_rev, locations_uid_rev, sessions_uid_rev, captures_uid_rev, issues_uid_rev,
    issue_captures_uid_rev, annotations_uid_rev, report_branding_uid_rev, plan_sheets_uid_rev,
    checklist_templates_uid_rev, checklist_template_items_uid_rev, checklist_runs_uid_rev,
    checklist_results_uid_rev;
create index projects_rev on projects (rev);
create index locations_project_rev on locations (project_id, rev);
create index sessions_project_rev on sessions (project_id, rev);
create index captures_project_rev on captures (project_id, rev);
create index issues_project_rev on issues (project_id, rev);
create index issue_captures_project_rev on issue_captures (project_id, rev);
create index annotations_project_rev on annotations (project_id, rev);
create index report_branding_rev on report_branding (rev);
create index plan_sheets_project_rev on plan_sheets (project_id, rev);
create index checklist_templates_project_rev on checklist_templates (project_id, rev);
create index checklist_template_items_project_rev on checklist_template_items (project_id, rev);
create index checklist_runs_project_rev on checklist_runs (project_id, rev);
create index checklist_results_project_rev on checklist_results (project_id, rev);

-- 5. Rows point only at rows of the same project.
alter table locations add unique (project_id, id);
alter table sessions add unique (project_id, id);
alter table captures add unique (project_id, id);
alter table issues add unique (project_id, id);
alter table plan_sheets add unique (project_id, id);
alter table checklist_runs add unique (project_id, id);
alter table checklist_results add unique (project_id, id);

alter table locations
    add foreign key (project_id) references projects (id) deferrable initially deferred,
    add foreign key (project_id, parent_id) references locations (project_id, id) deferrable initially deferred;
alter table sessions
    add foreign key (project_id) references projects (id) deferrable initially deferred;
alter table captures
    add foreign key (project_id) references projects (id) deferrable initially deferred,
    add foreign key (project_id, session_id) references sessions (project_id, id) deferrable initially deferred,
    add foreign key (project_id, location_id) references locations (project_id, id) deferrable initially deferred;
alter table plan_sheets
    add foreign key (project_id) references projects (id) deferrable initially deferred,
    add foreign key (project_id, location_id) references locations (project_id, id) deferrable initially deferred;
alter table issues
    add foreign key (project_id) references projects (id) deferrable initially deferred,
    add foreign key (project_id, location_id) references locations (project_id, id) deferrable initially deferred,
    add foreign key (project_id, resolved_by_issue_id) references issues (project_id, id) deferrable initially deferred,
    add foreign key (project_id, plan_sheet_id) references plan_sheets (project_id, id) deferrable initially deferred,
    add foreign key (project_id, source_checklist_result_id) references checklist_results (project_id, id)
        deferrable initially deferred;
alter table issue_captures
    add foreign key (project_id, issue_id) references issues (project_id, id) deferrable initially deferred,
    add foreign key (project_id, capture_id) references captures (project_id, id) deferrable initially deferred;
alter table annotations
    add foreign key (project_id, id) references captures (project_id, id) deferrable initially deferred;
alter table checklist_templates
    add foreign key (project_id) references projects (id) deferrable initially deferred;
alter table checklist_template_items
    add foreign key (template_id) references checklist_templates (id) deferrable initially deferred;
alter table checklist_runs
    add foreign key (template_id) references checklist_templates (id) deferrable initially deferred,
    add foreign key (project_id, session_id) references sessions (project_id, id) deferrable initially deferred,
    add foreign key (project_id, location_id) references locations (project_id, id) deferrable initially deferred;
alter table checklist_results
    add foreign key (project_id, run_id) references checklist_runs (project_id, id) deferrable initially deferred,
    add foreign key (template_item_id) references checklist_template_items (id) deferrable initially deferred,
    add foreign key (project_id, issue_id) references issues (project_id, id) deferrable initially deferred;
alter table project_members
    add foreign key (project_id) references projects (id) deferrable initially deferred;

-- 6. One report branding row for the whole company: keep the newest live one.
update report_branding set deleted_at = now()
 where deleted_at is null
   and id <> (select id from report_branding where deleted_at is null order by client_updated_at desc limit 1);
drop index report_branding_one_live;
create unique index report_branding_one_live on report_branding ((true)) where deleted_at is null;

-- 7. New columns: a member assignee, the server time a row was first stored (for "own, same day"),
--    the push kinds a device wants (null = all).
alter table issues add column assignee_uid text;
alter table issues add column server_created_at timestamptz not null default now();
alter table captures add column server_created_at timestamptz not null default now();
alter table devices add column kinds text[];

-- 8. One company rev counter. Old revs overlapped between users: renumber every row once;
--    every device starts again from 0 (members are created with resync_required = true).
create table sync_counter (
    id                 boolean primary key default true check (id),
    last_rev           bigint not null default 0,
    purged_through_rev bigint not null default 0
);
create temporary sequence renumber_rev;
update projects set rev = nextval('renumber_rev');
update locations set rev = nextval('renumber_rev');
update sessions set rev = nextval('renumber_rev');
update captures set rev = nextval('renumber_rev');
update plan_sheets set rev = nextval('renumber_rev');
update checklist_templates set rev = nextval('renumber_rev');
update checklist_template_items set rev = nextval('renumber_rev');
update checklist_runs set rev = nextval('renumber_rev');
update checklist_results set rev = nextval('renumber_rev');
update issues set rev = nextval('renumber_rev');
update issue_captures set rev = nextval('renumber_rev');
update annotations set rev = nextval('renumber_rev');
update phrases set rev = nextval('renumber_rev');
update report_branding set rev = nextval('renumber_rev');
insert into sync_counter (last_rev)
select coalesce(max(rev), 0) from (
    select rev from projects union all select rev from locations union all select rev from sessions
    union all select rev from captures union all select rev from plan_sheets
    union all select rev from checklist_templates union all select rev from checklist_template_items
    union all select rev from checklist_runs union all select rev from checklist_results
    union all select rev from issues union all select rev from issue_captures
    union all select rev from annotations union all select rev from phrases
    union all select rev from report_branding
) all_revs;
drop table sync_state;

-- 9. File keys follow the project: one completed upload per key, whoever uploaded it.
drop index uploads_completed_key;
create unique index uploads_completed_key on uploads (object_key) where state = 'completed';
drop index uploads_snapshot;
create index uploads_snapshot on uploads (session_id, state);
