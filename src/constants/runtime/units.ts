// Unit conversions and fixed-width text cuts.
export const MS_PER_SECOND = 1000;

export const TEXT_CUT = {
  // "2026-11-07T00:00:00Z" → "2026-11-07"
  isoDate: 10,
  // First characters of a project id printed as a reference on /verify.
  projectRef: 8,
} as const;

// Postgres type ids whose parsing the server overrides (pg.types).
export const PG_TYPE_ID = { int8: 20, date: 1082 } as const;
