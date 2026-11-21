-- F15: the verify worker claims one upload at a time; a crashed claim expires and is retried.
alter table uploads add column verify_claimed_at timestamptz;
create index uploads_to_verify on uploads (completed_at)
    where state = 'completed' and verify_state = 'registered';
