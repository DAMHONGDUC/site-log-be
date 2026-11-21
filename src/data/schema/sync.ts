import {
  bigint,
  boolean,
  date,
  doublePrecision,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { PG_ENUM, TABLE } from '../../constants/db.js';
import { SESSION_STATES } from '../../constants/enums.js';
import { revColumn, sha256, syncedColumns, teamSyncedColumns, timestamptz } from './columns.js';

// Synced tables (migrations 0001–0009) and the company rev counter. Which of them the app may
// pull and push, and how, is decided by syncTables (modules/sync/tables.ts).

export const sessionState = pgEnum(PG_ENUM.sessionState, SESSION_STATES);

// One row for the whole company (F19).
export const syncCounter = pgTable(TABLE.syncCounter, {
  id: boolean().primaryKey().default(true),
  lastRev: revColumn().notNull().default(0),
  purgedThroughRev: revColumn().notNull().default(0),
});

export const projects = pgTable(TABLE.projects, {
  ...teamSyncedColumns(),
  name: text().notNull(),
  address: text(),
  clientName: text(),
  createdAt: timestamptz().notNull(),
});

export const locations = pgTable(TABLE.locations, {
  ...teamSyncedColumns(),
  projectId: uuid().notNull(),
  parentId: uuid(),
  code: text().notNull(),
  kind: text().notNull(),
  sortIndex: integer().notNull(),
});

export const sessions = pgTable(TABLE.sessions, {
  ...teamSyncedColumns(),
  projectId: uuid().notNull(),
  startedAt: timestamptz().notNull(),
  endedAt: timestamptz(),
  surveyorName: text().notNull(),
  note: text().notNull(),
  state: sessionState().notNull(),
});

export const captures = pgTable(TABLE.captures, {
  ...teamSyncedColumns(),
  projectId: uuid().notNull(),
  sessionId: uuid().notNull(),
  locationId: uuid(),
  kind: text().notNull(),
  sha256: sha256().notNull(),
  byteSize: bigint({ mode: 'number' }).notNull(),
  capturedAt: timestamptz().notNull(),
  timeConfidence: text().notNull(),
  latitude: doublePrecision(),
  longitude: doublePrecision(),
  horizontalAccuracy: doublePrecision(),
  deviceModel: text().notNull(),
  durationSeconds: doublePrecision(),
  deviceReading: jsonb(),
  remoteKey: text(),
  verificationCode: text(),
  excludedFromReport: boolean().notNull(),
  serverCreatedAt: timestamptz().notNull().defaultNow(),
});

export const issues = pgTable(TABLE.issues, {
  ...teamSyncedColumns(),
  projectId: uuid().notNull(),
  locationId: uuid().notNull(),
  title: text().notNull(),
  detail: text().notNull(),
  severity: text().notNull(),
  status: text().notNull(),
  dueDate: date(),
  assigneeName: text(),
  assigneeUid: text(),
  trade: text(),
  planSheetId: uuid(),
  pinX: doublePrecision(),
  pinY: doublePrecision(),
  resolvedByIssueId: uuid(),
  sourceChecklistResultId: uuid(),
  serverCreatedAt: timestamptz().notNull().defaultNow(),
});

export const issueCaptures = pgTable(TABLE.issueCaptures, {
  ...teamSyncedColumns(),
  projectId: uuid().notNull(),
  issueId: uuid().notNull(),
  captureId: uuid().notNull(),
});

// Personal rows: they keep uid instead of created_by.
export const phrases = pgTable(TABLE.phrases, {
  ...syncedColumns(),
  uid: text().notNull(),
  text: text().notNull(),
  usageCount: integer().notNull(),
});

export const annotations = pgTable(TABLE.annotations, {
  ...teamSyncedColumns(),
  projectId: uuid().notNull(),
  shapes: jsonb().notNull(),
});

export const reportBranding = pgTable(TABLE.reportBranding, {
  ...teamSyncedColumns(),
  companyName: text().notNull(),
  logoKey: text(),
  accentHex: text().notNull(),
  clientBlock: text().notNull(),
  footerText: text().notNull(),
});

export const planSheets = pgTable(TABLE.planSheets, {
  ...teamSyncedColumns(),
  projectId: uuid().notNull(),
  locationId: uuid(),
  name: text().notNull(),
  pageIndex: integer().notNull(),
  pixelWidth: integer().notNull(),
  pixelHeight: integer().notNull(),
  sha256: sha256().notNull(),
  remoteKey: text(),
});

export const checklistTemplates = pgTable(TABLE.checklistTemplates, {
  ...teamSyncedColumns(),
  projectId: uuid(),
  name: text().notNull(),
  appliesTo: text().notNull(),
  isBuiltIn: boolean().notNull(),
  usageCount: integer().notNull(),
});

export const checklistTemplateItems = pgTable(TABLE.checklistTemplateItems, {
  ...teamSyncedColumns(),
  projectId: uuid(),
  templateId: uuid().notNull(),
  ordinal: integer().notNull(),
  text: text().notNull(),
  defaultSeverity: text().notNull(),
  requiresPhotoOnFail: boolean().notNull(),
});

export const checklistRuns = pgTable(TABLE.checklistRuns, {
  ...teamSyncedColumns(),
  projectId: uuid().notNull(),
  templateId: uuid().notNull(),
  sessionId: uuid().notNull(),
  locationId: uuid().notNull(),
  startedAt: timestamptz().notNull(),
  completedAt: timestamptz(),
});

export const checklistResults = pgTable(TABLE.checklistResults, {
  ...teamSyncedColumns(),
  projectId: uuid().notNull(),
  runId: uuid().notNull(),
  templateItemId: uuid().notNull(),
  outcome: text(),
  note: text().notNull(),
  issueId: uuid(),
  answeredAt: timestamptz(),
});

// Every synced table by its SQL name, so the generic sync code reaches them from syncTables.
export const SYNCED_TABLES = {
  [TABLE.projects]: projects,
  [TABLE.locations]: locations,
  [TABLE.sessions]: sessions,
  [TABLE.captures]: captures,
  [TABLE.issues]: issues,
  [TABLE.issueCaptures]: issueCaptures,
  [TABLE.phrases]: phrases,
  [TABLE.annotations]: annotations,
  [TABLE.reportBranding]: reportBranding,
  [TABLE.planSheets]: planSheets,
  [TABLE.checklistTemplates]: checklistTemplates,
  [TABLE.checklistTemplateItems]: checklistTemplateItems,
  [TABLE.checklistRuns]: checklistRuns,
  [TABLE.checklistResults]: checklistResults,
} as const;
export type SyncedTableName = keyof typeof SYNCED_TABLES;
