import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';

export const folders = pgTable(
  'folders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('folders_user_parent_idx').on(table.userId, table.parentId),
    index('folders_user_parent_name_idx').on(table.userId, table.parentId, table.name),
  ]
);

export const notes = pgTable(
  'notes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    folderId: uuid('folder_id').references(() => folders.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('notes_created_at_idx').on(table.createdAt),
    index('notes_user_created_at_idx').on(table.userId, table.createdAt),
    index('notes_user_folder_updated_at_idx').on(table.userId, table.folderId, table.updatedAt),
  ]
);

// ── GitHub Sync ──────────────────────────────────────────────

export const syncConnections = pgTable(
  'sync_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    repoOwner: text('repo_owner').notNull(),
    repoName: text('repo_name').notNull(),
    branch: text('branch').notNull().default('main'),
    basePath: text('base_path').notNull().default(''),
    status: text('status').notNull().default('active'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('sync_conn_user_idx').on(table.userId),
    uniqueIndex('sync_conn_user_repo_idx').on(table.userId, table.repoOwner, table.repoName),
  ]
);

export const noteSyncState = pgTable(
  'note_sync_state',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => syncConnections.id, { onDelete: 'cascade' }),
    noteId: uuid('note_id')
      .references(() => notes.id, { onDelete: 'set null' }),
    filePath: text('file_path').notNull(),
    lastContentHash: text('last_content_hash').notNull(),
    lastRepoCommitSha: text('last_repo_commit_sha'),
    lastSyncedNoteUpdatedAt: timestamp('last_synced_note_updated_at', { withTimezone: true }),
    lastFileSha: text('last_file_sha'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('note_sync_conn_idx').on(table.connectionId),
    uniqueIndex('note_sync_conn_note_idx').on(table.connectionId, table.noteId),
    uniqueIndex('note_sync_conn_path_idx').on(table.connectionId, table.filePath),
  ]
);

export const syncEvents = pgTable(
  'sync_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => syncConnections.id, { onDelete: 'cascade' }),
    direction: text('direction').notNull(),
    eventType: text('event_type').notNull(),
    noteId: uuid('note_id'),
    filePath: text('file_path'),
    commitSha: text('commit_sha'),
    status: text('status').notNull(),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('sync_events_conn_idx').on(table.connectionId),
    index('sync_events_created_idx').on(table.connectionId, table.createdAt),
  ]
);
