-- F10: one branding row per user, shared by all their devices.
create table report_branding (
    id                uuid primary key,
    uid               text not null,
    rev               bigint not null,
    client_updated_at timestamptz not null,
    deleted_at        timestamptz,
    company_name      text not null,
    logo_key          text,
    accent_hex        text not null check (accent_hex ~ '^#[0-9A-Fa-f]{6}$'),
    client_block      text not null,
    footer_text       text not null
);
create index report_branding_uid_rev on report_branding (uid, rev);
create unique index report_branding_one_live on report_branding (uid) where deleted_at is null;
