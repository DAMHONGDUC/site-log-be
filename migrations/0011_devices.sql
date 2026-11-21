-- F16: FCM registration tokens, one row per installed app.
create table devices (
    token       text primary key,
    uid         text not null,
    platform    text not null check (platform in ('ios', 'android')),
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
create index devices_uid on devices (uid);
