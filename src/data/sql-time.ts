import { sql, type SQL } from 'drizzle-orm';

// Time arithmetic done by Postgres, so every row compares against the database clock.

export function daysFromNow(days: number): SQL<Date> {
  return sql<Date>`now() + make_interval(days => ${days})`;
}

export function daysAgo(days: number): SQL<Date> {
  return sql<Date>`now() - make_interval(days => ${days})`;
}

// `interval` is a Postgres interval text from DURATIONS ("30 minutes").
export function intervalAgo(interval: string): SQL<Date> {
  return sql<Date>`now() - ${interval}::interval`;
}
