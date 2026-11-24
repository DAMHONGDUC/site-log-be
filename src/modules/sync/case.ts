import { SYNC_COLUMN, SNAKE_SEPARATOR } from '../../constants/data/sync.js';
// JSON uses camelCase (clientUpdatedAt), SQL uses snake_case (client_updated_at).

export function snakeToCamel(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase());
}

export function camelToSnake(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `${SNAKE_SEPARATOR}${letter.toLowerCase()}`);
}

// Server-only columns: never sent back.
const HIDDEN: string[] = [SYNC_COLUMN.uid, SYNC_COLUMN.serverCreatedAt];

// A database row → the JSON the app receives (created_by becomes createdBy).
export function rowToJson(row: Record<string, unknown>): Record<string, unknown> {
  const json: Record<string, unknown> = {};

  for (const [column, value] of Object.entries(row)) {
    if (HIDDEN.includes(column)) {
      continue;
    }
    json[snakeToCamel(column)] = value;
  }

  return json;
}
