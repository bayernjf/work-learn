import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import {
  createSessionInputSchema,
  findReuseMatches,
  normalizeReuseText,
  normalizeQuestion,
  generatePracticeFromItems,
  generatePracticeInputSchema,
  getUserPatternsFromItems,
  getUserPatternsInputSchema,
  saveMaterialInputSchema,
  saveQuestionTranslationInputSchema,
  recordReuseInputSchema,
  redactSecrets,
  syncBatchInputSchema,
  type PracticeMaterial,
  type PracticeQuestion,
  type QuestionTranslation,
  type RecordReuseInput,
  type SaveMaterialInput,
  type SaveQuestionTranslationInput
} from "@work-learn/shared-schema";

/**
 * Local-first storage.
 *
 * The local SQLite database is the authoritative source. The cloud (Supabase)
 * is only ever a sync copy pushed from here, and the markdown export is a
 * regenerable mirror of this database. Nothing stored here needs a token: the
 * stdio MCP server and CLI work offline.
 */

export type SyncStatus = "local_only" | "synced";

type MaterialRow = {
  id: string;
  session_id: string;
  source: string;
  topic: string;
  original_text: string;
  explanation: string;
  useful_expressions: string;
  corrections: string;
  vocabulary: string;
  practice_prompts: string;
  tags: string;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  synced_at: string | null;
};

type QuestionRow = {
  id: string;
  session_id: string;
  source: string;
  question: string;
  translation: string;
  topic: string | null;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  synced_at: string | null;
};

type SessionRow = {
  id: string;
  source: string;
  topic: string | null;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  synced_at: string | null;
};

type ReviewRow = {
  id: string;
  material_id: string;
  status: "pending" | "completed" | "snoozed";
  due_at: string;
  interval_days: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  synced_at: string | null;
};

type IntentRow = {
  id: string;
  label: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  synced_at: string | null;
};

type SavedExpressionRow = {
  id: string;
  material_id: string | null;
  intent_id: string | null;
  text: string;
  text_norm: string;
  register: "formal" | "neutral" | "casual" | null;
  scene: string | null;
  note: string | null;
  reuse_count: number;
  first_reused_at: string | null;
  last_reused_at: string | null;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  synced_at: string | null;
};

type ReuseEventRow = {
  id: string;
  expression_id: string;
  session_id: string | null;
  source: string | null;
  matched_text: string;
  context_snippet: string | null;
  match_kind: "exact" | "variant" | "nudge";
  confidence: number;
  created_at: string;
  sync_status: SyncStatus;
  synced_at: string | null;
};

export const DEFAULT_DB_PATH = join(homedir(), ".work-learn", "work-learn.db");
export const DEFAULT_BACKUP_DIR = join(homedir(), ".work-learn", "backups");
export const DEFAULT_NOTES_DIR = join(homedir(), ".work-learn", "notes");

const REQUIRED_TABLES = ["sessions", "learning_materials", "question_translations", "review_items", "intents", "saved_expressions", "reuse_events", "sync_meta", "sync_tombstones"];

const schema = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  topic TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'local_only',
  synced_at TEXT
);
CREATE TABLE IF NOT EXISTS learning_materials (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  topic TEXT NOT NULL,
  original_text TEXT NOT NULL,
  explanation TEXT NOT NULL DEFAULT '',
  useful_expressions TEXT NOT NULL DEFAULT '[]',
  corrections TEXT NOT NULL DEFAULT '[]',
  vocabulary TEXT NOT NULL DEFAULT '[]',
  practice_prompts TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  sync_status TEXT NOT NULL DEFAULT 'local_only',
  synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS question_translations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  question TEXT NOT NULL,
  question_norm TEXT NOT NULL,
  translation TEXT NOT NULL,
  topic TEXT,
  sync_status TEXT NOT NULL DEFAULT 'local_only',
  synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS qt_session_norm_idx ON question_translations(session_id, question_norm);
CREATE INDEX IF NOT EXISTS materials_created_idx ON learning_materials(created_at DESC);
CREATE TABLE IF NOT EXISTS review_items (
  id TEXT PRIMARY KEY,
  material_id TEXT NOT NULL UNIQUE REFERENCES learning_materials(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  due_at TEXT NOT NULL,
  interval_days INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'local_only',
  synced_at TEXT
);
CREATE TABLE IF NOT EXISTS intents (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'local_only',
  synced_at TEXT
);
CREATE TABLE IF NOT EXISTS saved_expressions (
  id TEXT PRIMARY KEY,
  material_id TEXT REFERENCES learning_materials(id) ON DELETE SET NULL,
  intent_id TEXT REFERENCES intents(id) ON DELETE SET NULL,
  text TEXT NOT NULL,
  text_norm TEXT NOT NULL,
  register TEXT CHECK(register IN ('formal','neutral','casual')),
  scene TEXT,
  note TEXT,
  reuse_count INTEGER NOT NULL DEFAULT 0,
  first_reused_at TEXT,
  last_reused_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'local_only',
  synced_at TEXT,
  UNIQUE(text_norm)
);
CREATE TABLE IF NOT EXISTS reuse_events (
  id TEXT PRIMARY KEY,
  expression_id TEXT NOT NULL REFERENCES saved_expressions(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  source TEXT,
  matched_text TEXT NOT NULL,
  context_snippet TEXT,
  match_kind TEXT NOT NULL DEFAULT 'exact' CHECK(match_kind IN ('exact','variant','nudge')),
  confidence REAL NOT NULL DEFAULT 1 CHECK(confidence BETWEEN 0 AND 1),
  created_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'local_only',
  synced_at TEXT
);
CREATE INDEX IF NOT EXISTS expressions_norm_idx ON saved_expressions(text_norm);
CREATE INDEX IF NOT EXISTS reuse_events_expression_idx ON reuse_events(expression_id, created_at DESC);
CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_tombstones (
  id TEXT NOT NULL,
  entity TEXT NOT NULL CHECK(entity IN ('session','material','question','review')),
  deleted_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'local_only',
  synced_at TEXT,
  PRIMARY KEY (entity, id)
);
`;

/** Collapse a question to a comparable form for exact-dedupe. */
const jsonOrEmpty = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export type LocalStoreOptions = {
  dbPath?: string;
};

export class LocalStore {
  private db: Database.Database;

  constructor(options: LocalStoreOptions = {}) {
    const dbPath = options.dbPath ?? DEFAULT_DB_PATH;
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(schema);
    this.migrate();
  }

  private columns(table: string) {
    return new Set((this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name));
  }

  private migrate() {
    const now = new Date().toISOString();
    const ensureColumn = (table: string, name: string, definition: string) => {
      if (!this.columns(table).has(name)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    };
    ensureColumn("sessions", "updated_at", `TEXT NOT NULL DEFAULT '${now}'`);
    ensureColumn("sessions", "sync_status", "TEXT NOT NULL DEFAULT 'local_only'");
    ensureColumn("sessions", "synced_at", "TEXT");
    ensureColumn("learning_materials", "updated_at", `TEXT NOT NULL DEFAULT '${now}'`);
    ensureColumn("question_translations", "updated_at", `TEXT NOT NULL DEFAULT '${now}'`);
    ensureColumn("review_items", "updated_at", `TEXT NOT NULL DEFAULT '${now}'`);
    ensureColumn("review_items", "sync_status", "TEXT NOT NULL DEFAULT 'local_only'");
    ensureColumn("review_items", "synced_at", "TEXT");
    this.db.exec(`CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS sync_tombstones (
      id TEXT NOT NULL,
      entity TEXT NOT NULL CHECK(entity IN ('session','material','question','review','intent','expression','reuse_event')),
      deleted_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'local_only',
      synced_at TEXT,
      PRIMARY KEY (entity, id)
    );`);
    this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS review_material_unique_idx ON review_items(material_id);`);
    this.widenTombstoneEntities();
  }

  private widenTombstoneEntities() {
    const row = this.db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sync_tombstones'")
      .get() as { sql?: string } | undefined;
    if (row?.sql?.includes("'reuse_event'")) return;
    this.db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      CREATE TABLE sync_tombstones_new (
        id TEXT NOT NULL,
        entity TEXT NOT NULL CHECK(entity IN ('session','material','question','review','intent','expression','reuse_event')),
        deleted_at TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'local_only',
        synced_at TEXT,
        PRIMARY KEY (entity, id)
      );
      INSERT INTO sync_tombstones_new (id, entity, deleted_at, sync_status, synced_at)
      SELECT id, entity, deleted_at, sync_status, synced_at FROM sync_tombstones;
      DROP TABLE sync_tombstones;
      ALTER TABLE sync_tombstones_new RENAME TO sync_tombstones;
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
  }

  close(): void {
    this.db.close();
  }


  static validateDatabase(dbPath: string) {
    if (!existsSync(dbPath)) throw new Error(`Database file not found: ${dbPath}`);
    let db: Database.Database | undefined;
    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true });
      const tables = new Set(
        (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name)
      );
      for (const table of REQUIRED_TABLES) {
        if (!tables.has(table)) throw new Error(`Backup is missing the ${table} table`);
      }
      const integrity = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
      if (integrity.integrity_check !== "ok") throw new Error(`Backup failed SQLite integrity check: ${integrity.integrity_check}`);
      return { dbPath, tables: REQUIRED_TABLES.filter((table) => tables.has(table)) };
    } finally {
      db?.close();
    }
  }

  static restoreBackup(backupPath: string, dbPath: string = DEFAULT_DB_PATH) {
    LocalStore.validateDatabase(backupPath);
    mkdirSync(dirname(dbPath), { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const previousDatabaseBackup = existsSync(dbPath) ? `${dbPath}.before-restore-${timestamp}` : undefined;
    if (previousDatabaseBackup) copyFileSync(dbPath, previousDatabaseBackup);
    copyFileSync(backupPath, dbPath);
    for (const sidecar of [`${dbPath}-wal`, `${dbPath}-shm`]) {
      if (existsSync(sidecar)) rmSync(sidecar, { force: true });
    }
    return { restoredFrom: backupPath, dbPath, previousDatabaseBackup };
  }


  createSession(input: unknown) {
    const parsed = createSessionInputSchema.parse(input);
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare("INSERT INTO sessions (id, source, topic, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, parsed.source, parsed.topic ?? null, createdAt, createdAt);
    return { id, source: parsed.source, topic: parsed.topic ?? null, createdAt, updatedAt: createdAt };
  }

  saveMaterial(input: unknown) {
    const parsed = saveMaterialInputSchema.parse(input) as SaveMaterialInput & { sessionId: string };
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO learning_materials
         (id, session_id, source, topic, original_text, explanation, useful_expressions, corrections, vocabulary, practice_prompts, tags, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        parsed.sessionId,
        parsed.source,
        parsed.topic,
        parsed.originalText,
        parsed.explanation ?? "",
        JSON.stringify(parsed.usefulExpressions),
        JSON.stringify(parsed.corrections),
        JSON.stringify(parsed.vocabulary),
        JSON.stringify(parsed.practicePrompts),
        JSON.stringify(parsed.tags),
        createdAt,
        createdAt
      );

    // A saved material feeds the local review queue, mirroring the cloud.
    this.db
      .prepare("INSERT INTO review_items (id, material_id, due_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(crypto.randomUUID(), id, createdAt, createdAt, createdAt);

    const insertExpression = this.db.prepare(
      `INSERT INTO saved_expressions
       (id, material_id, text, text_norm, scene, created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'local_only')
       ON CONFLICT(text_norm) DO NOTHING`
    );
    for (const value of parsed.usefulExpressions) {
      const text = value.trim();
      if (text) insertExpression.run(crypto.randomUUID(), id, text, normalizeReuseText(text), parsed.source, createdAt, createdAt);
    }

    return { id, sessionId: parsed.sessionId, source: parsed.source, topic: parsed.topic, createdAt };
  }

  saveQuestionTranslation(input: unknown) {
    const parsed = saveQuestionTranslationInputSchema.parse(input) as SaveQuestionTranslationInput;
    const norm = normalizeQuestion(parsed.question);

    // Exact dedupe within the same session: a re-asked question is not stored twice.
    const existing = this.db
      .prepare(
        `SELECT id FROM question_translations
         WHERE session_id = ? AND question_norm = ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(parsed.sessionId, norm) as { id: string } | undefined;
    if (existing) return { skipped: true, existingId: existing.id };

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO question_translations
         (id, session_id, source, question, question_norm, translation, topic, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, parsed.sessionId, parsed.source, parsed.question, norm, parsed.translation, parsed.topic ?? null, createdAt, createdAt);

    return { id, sessionId: parsed.sessionId, source: parsed.source, question: parsed.question, translation: parsed.translation, topic: parsed.topic, createdAt };
  }

  searchCorpus(query?: string, filters: { source?: string; tag?: string } = {}) {
    const trimmed = query?.trim();
    const like = trimmed ? `%${trimmed}%` : null;

    let materialRows = (
      like
        ? this.db
            .prepare(
              `SELECT * FROM learning_materials
               WHERE original_text LIKE ? OR topic LIKE ? OR explanation LIKE ? OR useful_expressions LIKE ? OR vocabulary LIKE ? OR tags LIKE ?
               ORDER BY created_at DESC`
            )
            .all(like, like, like, like, like, like)
        : this.db.prepare("SELECT * FROM learning_materials ORDER BY created_at DESC").all()
    ) as MaterialRow[];
    if (filters.source) materialRows = materialRows.filter((row) => row.source === filters.source);
    if (filters.tag) {
      materialRows = materialRows.filter((row) => jsonOrEmpty(row.tags).includes(filters.tag as string));
    }

    let questionRows = (
      like
        ? this.db
            .prepare(
              `SELECT * FROM question_translations
               WHERE question LIKE ? OR translation LIKE ? OR topic LIKE ?
               ORDER BY created_at DESC`
            )
            .all(like, like, like)
        : this.db.prepare("SELECT * FROM question_translations ORDER BY created_at DESC").all()
    ) as QuestionRow[];
    if (filters.source) questionRows = questionRows.filter((row) => row.source === filters.source);

    return {
      materials: materialRows.map(toMaterial),
      questions: questionRows.map(toQuestion)
    };
  }

  getReviewItems() {
    return this.db
      .prepare(
        `SELECT review_items.id AS review_id, review_items.status, review_items.due_at,
                learning_materials.id AS material_id, learning_materials.original_text,
                learning_materials.topic, learning_materials.created_at
         FROM review_items
         JOIN learning_materials ON learning_materials.id = review_items.material_id
         WHERE review_items.status IN ('pending', 'snoozed') AND review_items.due_at <= ?
         ORDER BY review_items.due_at ASC`
      )
      .all(new Date().toISOString());
  }

  recentMaterials(limit = 10) {
    return (this.db
      .prepare("SELECT * FROM learning_materials ORDER BY created_at DESC LIMIT ?")
      .all(limit) as MaterialRow[]).map(toMaterial);
  }

  recentQuestions(limit = 50) {
    return (this.db
      .prepare("SELECT * FROM question_translations ORDER BY created_at DESC LIMIT ?")
      .all(limit) as QuestionRow[]).map(toQuestion);
  }

  generatePractice(input: unknown) {
    const parsed = generatePracticeInputSchema.parse(input);
    return generatePracticeFromItems(
      this.recentMaterials(50) as PracticeMaterial[],
      this.recentQuestions(50) as PracticeQuestion[],
      parsed
    );
  }

  getUserPatterns(input: unknown) {
    const parsed = getUserPatternsInputSchema.parse(input);
    return getUserPatternsFromItems(this.recentMaterials(100) as PracticeMaterial[], this.recentQuestions(100) as PracticeQuestion[], parsed);
  }

  recordReuse(input: unknown) {
    const parsed = recordReuseInputSchema.parse(input) as RecordReuseInput;
    const safeText = redactSecrets(parsed.text).text;
    const safeContext = parsed.contextSnippet ? redactSecrets(parsed.contextSnippet).text : null;
    const expressions = (this.db
      .prepare("SELECT id, text FROM saved_expressions")
      .all() as Array<{ id: string; text: string }>);
    const matches = findReuseMatches(safeText, expressions);
    const recordedAt = new Date().toISOString();
    const insertEvent = this.db.prepare(
      `INSERT INTO reuse_events
       (id, expression_id, session_id, source, matched_text, context_snippet, match_kind, confidence, created_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'local_only')`
    );
    const touchExpression = this.db.prepare(
      `UPDATE saved_expressions
       SET reuse_count = reuse_count + 1,
           first_reused_at = COALESCE(first_reused_at, ?),
           last_reused_at = ?,
           updated_at = ?,
           sync_status = 'local_only'
       WHERE id = ?`
    );
    const tx = this.db.transaction(() => {
      for (const match of matches) {
        insertEvent.run(
          crypto.randomUUID(),
          match.expressionId,
          parsed.sessionId ?? null,
          parsed.source ?? null,
          match.matchedText,
          safeContext,
          match.matchKind,
          match.confidence,
          recordedAt
        );
        touchExpression.run(recordedAt, recordedAt, recordedAt, match.expressionId);
      }
    });
    tx();
    return { recordedAt, recorded: matches.length, matches };
  }

  markMastered(reviewId: string) {
    const result = this.db
      .prepare(
        `UPDATE review_items SET status = 'completed', completed_at = ?, interval_days = 1, updated_at = ?, sync_status = 'local_only'
         WHERE id = ? AND status = 'pending'`
      )
      .run(new Date().toISOString(), new Date().toISOString(), reviewId);
    if (result.changes === 0) throw new Error("Review item not found or already completed");
    return { id: reviewId, status: "completed" };
  }

  snoozeReview(reviewId: string, days = 1) {
    const dueAt = new Date(Date.now() + days * 86_400_000).toISOString();
    const result = this.db
      .prepare(
        `UPDATE review_items SET status = 'snoozed', due_at = ?, updated_at = ?, sync_status = 'local_only'
         WHERE id = ? AND status IN ('pending', 'snoozed')`
      )
      .run(dueAt, new Date().toISOString(), reviewId);
    if (result.changes === 0) throw new Error("Review item not found or already completed");
    return { id: reviewId, status: "snoozed" as const, dueAt };
  }

  /** Record a deletion so it can be pushed to other devices. */
  private recordTombstone(entity: "session" | "material" | "question" | "review", id: string, deletedAt: string) {
    this.db
      .prepare(
        `INSERT INTO sync_tombstones (id, entity, deleted_at, sync_status)
         VALUES (?, ?, ?, 'local_only')
         ON CONFLICT(entity, id) DO UPDATE SET deleted_at = excluded.deleted_at, sync_status = 'local_only'`
      )
      .run(id, entity, deletedAt);
  }

  /** Delete a material (and its review via cascade) and record tombstones. */
  deleteMaterial(materialId: string) {
    const deletedAt = new Date().toISOString();
    const review = this.db.prepare("SELECT id FROM review_items WHERE material_id = ?").get(materialId) as { id: string } | undefined;
    const tx = this.db.transaction(() => {
      if (review) {
        this.recordTombstone("review", review.id, deletedAt);
        this.db.prepare("DELETE FROM review_items WHERE material_id = ?").run(materialId);
      }
      this.recordTombstone("material", materialId, deletedAt);
      this.db.prepare("DELETE FROM learning_materials WHERE id = ?").run(materialId);
    });
    tx();
    return { id: materialId, deletedAt };
  }

  /** Delete a question/translation pair and record a tombstone. */
  deleteQuestion(questionId: string) {
    const deletedAt = new Date().toISOString();
    const tx = this.db.transaction(() => {
      this.recordTombstone("question", questionId, deletedAt);
      this.db.prepare("DELETE FROM question_translations WHERE id = ?").run(questionId);
    });
    tx();
    return { id: questionId, deletedAt };
  }

  /** Local rows that still need to be pushed, including review state. */
  unsynced() {
    const sessions = this.db.prepare("SELECT * FROM sessions WHERE sync_status = 'local_only' ORDER BY created_at").all() as SessionRow[];
    const materials = this.db.prepare("SELECT * FROM learning_materials WHERE sync_status = 'local_only' ORDER BY created_at").all() as MaterialRow[];
    const questions = this.db.prepare("SELECT * FROM question_translations WHERE sync_status = 'local_only' ORDER BY created_at").all() as QuestionRow[];
    const reviews = this.db.prepare("SELECT * FROM review_items WHERE sync_status = 'local_only' ORDER BY created_at").all() as ReviewRow[];
    const intents = this.db.prepare("SELECT * FROM intents WHERE sync_status = 'local_only' ORDER BY created_at").all() as IntentRow[];
    const expressions = this.db.prepare("SELECT * FROM saved_expressions WHERE sync_status = 'local_only' ORDER BY created_at").all() as SavedExpressionRow[];
    const reuseEvents = this.db.prepare("SELECT * FROM reuse_events WHERE sync_status = 'local_only' ORDER BY created_at").all() as ReuseEventRow[];
    const tombstones = (this.db.prepare("SELECT * FROM sync_tombstones WHERE sync_status = 'local_only'").all() as Array<{ id: string; entity: string; deleted_at: string }>)
      .map((row) => ({ id: row.id, entity: row.entity, deletedAt: row.deleted_at }));
    return {
      sessions: sessions.map(toSession),
      materials: materials.map(toMaterial),
      questions: questions.map(toQuestion),
      reviews: reviews.map(toReview),
      intents: intents.map(toIntent),
      expressions: expressions.map(toSavedExpression),
      reuseEvents: reuseEvents.map(toReuseEvent),
      tombstones
    };
  }


  backupTo(destinationPath: string) {
    mkdirSync(dirname(destinationPath), { recursive: true });
    if (resolve(destinationPath) === resolve(this.db.name)) throw new Error("Backup destination must be different from the current database");
    this.db.pragma("wal_checkpoint(TRUNCATE)");
    copyFileSync(this.db.name, destinationPath);
    LocalStore.validateDatabase(destinationPath);
    return { backupPath: destinationPath, dbPath: this.db.name, stats: this.stats() };
  }

  getMeta(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM sync_meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value;
  }

  setMeta(key: string, value: string) {
    this.db.prepare("INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  lastPulledAt(): string | null {
    return this.getMeta("last_pulled_at") ?? null;
  }

  stats() {
    const count = (table: string) => (this.db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count;
    const max = (table: string) => (this.db.prepare(`SELECT max(updated_at) AS updated_at FROM ${table}`).get() as { updated_at: string | null }).updated_at;
    const batch = this.unsynced();
    return {
      dbPath: this.db.name,
      lastPulledAt: this.lastPulledAt(),
      counts: {
        sessions: count("sessions"),
        materials: count("learning_materials"),
        questions: count("question_translations"),
        reviews: count("review_items"),
        intents: count("intents"),
        expressions: count("saved_expressions"),
        reuseEvents: count("reuse_events"),
        tombstones: count("sync_tombstones")
      },
      pending: {
        sessions: batch.sessions.length,
        materials: batch.materials.length,
        questions: batch.questions.length,
        reviews: batch.reviews.length,
        intents: batch.intents.length,
        expressions: batch.expressions.length,
        reuseEvents: batch.reuseEvents.length,
        tombstones: batch.tombstones.length
      },
      latestUpdatedAt: max("learning_materials")
    };
  }

  /** Apply a cloud snapshot using last-write-wins by updated_at. */
  applyRemoteBatch(batch: unknown) {
    const parsed = syncBatchInputSchema.parse(batch);
    const now = new Date().toISOString();
    const upsertSession = this.db.prepare(`
      INSERT INTO sessions (id, source, topic, created_at, updated_at, sync_status, synced_at)
      VALUES (@id, @source, @topic, @createdAt, @updatedAt, 'synced', @now)
      ON CONFLICT(id) DO UPDATE SET
        source = excluded.source, topic = excluded.topic, updated_at = excluded.updated_at,
        sync_status = 'synced', synced_at = excluded.synced_at
      WHERE excluded.updated_at >= sessions.updated_at
    `);
    const upsertMaterial = this.db.prepare(`
      INSERT INTO learning_materials
        (id, session_id, source, topic, original_text, explanation, useful_expressions, corrections, vocabulary, practice_prompts, tags, created_at, updated_at, sync_status, synced_at)
      VALUES (@id, @sessionId, @source, @topic, @originalText, @explanation, @usefulExpressions, @corrections, @vocabulary, @practicePrompts, @tags, @createdAt, @updatedAt, 'synced', @now)
      ON CONFLICT(id) DO UPDATE SET
        session_id = excluded.session_id, source = excluded.source, topic = excluded.topic,
        original_text = excluded.original_text, explanation = excluded.explanation,
        useful_expressions = excluded.useful_expressions, corrections = excluded.corrections,
        vocabulary = excluded.vocabulary, practice_prompts = excluded.practice_prompts, tags = excluded.tags,
        updated_at = excluded.updated_at, sync_status = 'synced', synced_at = excluded.synced_at
      WHERE excluded.updated_at >= learning_materials.updated_at
    `);
    const upsertQuestion = this.db.prepare(`
      INSERT INTO question_translations
        (id, session_id, source, question, question_norm, translation, topic, created_at, updated_at, sync_status, synced_at)
      VALUES (@id, @sessionId, @source, @question, @questionNorm, @translation, @topic, @createdAt, @updatedAt, 'synced', @now)
      ON CONFLICT(id) DO UPDATE SET
        session_id = excluded.session_id, source = excluded.source, question = excluded.question,
        question_norm = excluded.question_norm, translation = excluded.translation, topic = excluded.topic,
        updated_at = excluded.updated_at, sync_status = 'synced', synced_at = excluded.synced_at
      WHERE excluded.updated_at >= question_translations.updated_at
    `);
    const findReviewByMaterial = this.db.prepare("SELECT id, updated_at FROM review_items WHERE material_id = ?");
    const updateReviewByMaterial = this.db.prepare(`
      UPDATE review_items SET id = @id, status = @status, due_at = @dueAt, interval_days = @intervalDays,
        completed_at = @completedAt, updated_at = @updatedAt, sync_status = 'synced', synced_at = @now
      WHERE material_id = @materialId AND @updatedAt >= updated_at
    `);
    const insertReview = this.db.prepare(`
      INSERT INTO review_items (id, material_id, status, due_at, interval_days, completed_at, created_at, updated_at, sync_status, synced_at)
      VALUES (@id, @materialId, @status, @dueAt, @intervalDays, @completedAt, @createdAt, @updatedAt, 'synced', @now)
    `);
    const upsertIntent = this.db.prepare(`
      INSERT INTO intents (id, label, description, created_at, updated_at, sync_status, synced_at)
      VALUES (@id, @label, @description, @createdAt, @updatedAt, 'synced', @now)
      ON CONFLICT(id) DO UPDATE SET
        label = excluded.label, description = excluded.description, updated_at = excluded.updated_at,
        sync_status = 'synced', synced_at = excluded.synced_at
      WHERE excluded.updated_at >= intents.updated_at
    `);
    const upsertExpression = this.db.prepare(`
      INSERT INTO saved_expressions
        (id, material_id, intent_id, text, text_norm, register, scene, note, reuse_count, first_reused_at, last_reused_at, created_at, updated_at, sync_status, synced_at)
      VALUES (@id, @materialId, @intentId, @text, @textNorm, @register, @scene, @note, @reuseCount, @firstReusedAt, @lastReusedAt, @createdAt, @updatedAt, 'synced', @now)
      ON CONFLICT(id) DO UPDATE SET
        material_id = excluded.material_id, intent_id = excluded.intent_id, text = excluded.text, text_norm = excluded.text_norm,
        register = excluded.register, scene = excluded.scene, note = excluded.note, reuse_count = excluded.reuse_count,
        first_reused_at = excluded.first_reused_at, last_reused_at = excluded.last_reused_at, updated_at = excluded.updated_at,
        sync_status = 'synced', synced_at = excluded.synced_at
      WHERE excluded.updated_at >= saved_expressions.updated_at
    `);
    const upsertReuseEvent = this.db.prepare(`
      INSERT INTO reuse_events
        (id, expression_id, session_id, source, matched_text, context_snippet, match_kind, confidence, created_at, sync_status, synced_at)
      VALUES (@id, @expressionId, @sessionId, @source, @matchedText, @contextSnippet, @matchKind, @confidence, @createdAt, 'synced', @now)
      ON CONFLICT(id) DO NOTHING
    `);
    const counts = { sessions: 0, materials: 0, questions: 0, reviews: 0, intents: 0, expressions: 0, reuseEvents: 0, tombstones: 0 };
    const tx = this.db.transaction(() => {
      for (const row of parsed.sessions) {
        upsertSession.run({ ...row, now });
        counts.sessions++;
      }
      for (const row of parsed.materials) {
        upsertMaterial.run({ ...row, usefulExpressions: JSON.stringify(row.usefulExpressions), corrections: JSON.stringify(row.corrections), vocabulary: JSON.stringify(row.vocabulary), practicePrompts: JSON.stringify(row.practicePrompts), tags: JSON.stringify(row.tags), now });
        counts.materials++;
      }
      for (const row of parsed.questions) {
        upsertQuestion.run({ ...row, questionNorm: normalizeQuestion(row.question), now });
        counts.questions++;
      }
      for (const row of parsed.reviews) {
        const existing = findReviewByMaterial.get(row.materialId) as { id: string; updated_at: string } | undefined;
        if (existing) updateReviewByMaterial.run({ ...row, now });
        else insertReview.run({ ...row, now });
        counts.reviews++;
      }
      for (const row of parsed.intents) {
        upsertIntent.run({ ...row, now });
        counts.intents++;
      }
      for (const row of parsed.expressions) {
        const existingByNorm = this.db.prepare("SELECT id FROM saved_expressions WHERE text_norm = ?").get(row.textNorm) as { id: string } | undefined;
        if (!existingByNorm || existingByNorm.id === row.id) upsertExpression.run({ ...row, now });
        counts.expressions++;
      }
      for (const row of parsed.reuseEvents) {
        const expressionExists = this.db.prepare("SELECT id FROM saved_expressions WHERE id = ?").get(row.expressionId);
        if (expressionExists) upsertReuseEvent.run({ ...row, now });
        counts.reuseEvents++;
      }
      const deleteSession = this.db.prepare("DELETE FROM sessions WHERE id = ? AND ? >= updated_at");
      const deleteMaterial = this.db.prepare("DELETE FROM learning_materials WHERE id = ? AND ? >= updated_at");
      const deleteQuestion = this.db.prepare("DELETE FROM question_translations WHERE id = ? AND ? >= updated_at");
      const deleteReview = this.db.prepare("DELETE FROM review_items WHERE id = ? AND ? >= updated_at");
      const deleteIntent = this.db.prepare("DELETE FROM intents WHERE id = ? AND ? >= updated_at");
      const deleteExpression = this.db.prepare("DELETE FROM saved_expressions WHERE id = ? AND ? >= updated_at");
      const deleteReuseEvent = this.db.prepare("DELETE FROM reuse_events WHERE id = ? AND ? >= ?");
      const upsertTombstone = this.db.prepare(`
        INSERT INTO sync_tombstones (id, entity, deleted_at, sync_status, synced_at)
        VALUES (?, ?, ?, 'synced', ?)
        ON CONFLICT(entity, id) DO UPDATE SET deleted_at = excluded.deleted_at, sync_status = 'synced', synced_at = excluded.synced_at
      `);
      for (const t of parsed.tombstones) {
        if (t.entity === "session") deleteSession.run(t.id, t.deletedAt);
        else if (t.entity === "material") deleteMaterial.run(t.id, t.deletedAt);
        else if (t.entity === "question") deleteQuestion.run(t.id, t.deletedAt);
        else if (t.entity === "review") deleteReview.run(t.id, t.deletedAt);
        else if (t.entity === "intent") deleteIntent.run(t.id, t.deletedAt);
        else if (t.entity === "expression") deleteExpression.run(t.id, t.deletedAt);
        else if (t.entity === "reuse_event") deleteReuseEvent.run(t.id, t.deletedAt);
        upsertTombstone.run(t.id, t.entity, t.deletedAt, now);
        counts.tombstones++;
      }
    });
    tx();
    return counts;
  }

  /** Mark rows as synced after a successful push. */
  markSynced(ids: { sessions?: string[]; materials?: string[]; questions?: string[]; reviews?: string[]; intents?: string[]; expressions?: string[]; reuseEvents?: string[]; tombstones?: Array<{ id: string; entity: string }> }) {
    const now = new Date().toISOString();
    const statements: Array<[string, string[]]> = [
      ["sessions", ids.sessions ?? []],
      ["learning_materials", ids.materials ?? []],
      ["question_translations", ids.questions ?? []],
      ["review_items", ids.reviews ?? []],
      ["intents", ids.intents ?? []],
      ["saved_expressions", ids.expressions ?? []],
      ["reuse_events", ids.reuseEvents ?? []]
    ];
    const tombstoneIds = ids.tombstones ?? [];
    const tx = this.db.transaction(() => {
      for (const [table, ids] of statements) {
        const stmt = this.db.prepare(`UPDATE ${table} SET sync_status = 'synced', synced_at = ? WHERE id = ?`);
        for (const id of ids) stmt.run(now, id);
      }
    });
    const markTombstone = this.db.prepare("UPDATE sync_tombstones SET sync_status = 'synced', synced_at = ? WHERE id = ? AND entity = ?");
    for (const t of tombstoneIds) markTombstone.run(now, t.id, t.entity);
    tx();
  }

  /** Distinct dates that have at least one material or question, ascending. */
  listDates(): string[] {
    const rows = this.db
      .prepare(
        `SELECT substr(created_at, 1, 10) AS d FROM learning_materials
         UNION
         SELECT substr(created_at, 1, 10) AS d FROM question_translations
         ORDER BY d`
      )
      .all() as Array<{ d: string }>;
    return rows.map((r) => r.d);
  }

  /** Regenerate a day's markdown mirror, overwriting any existing file. */
  exportMarkdown(date: string, notesDir = DEFAULT_NOTES_DIR): string {
    const like = `${date}%`;
    const materials = this.db.prepare("SELECT * FROM learning_materials WHERE created_at LIKE ? ORDER BY created_at").all(like) as MaterialRow[];
    const questions = this.db.prepare("SELECT * FROM question_translations WHERE created_at LIKE ? ORDER BY created_at").all(like) as QuestionRow[];

    const lines: string[] = [];
    lines.push(`# ${date} · Work Learn`);
    lines.push("");
    lines.push(`> ${materials.length + questions.length} items`);
    lines.push("");

    for (const q of questions) {
      const time = q.created_at.slice(11, 16);
      lines.push(`## [Q&A] ${time} — ${q.question}`);
      lines.push("");
      lines.push(`**地道英文**：${q.translation}`);
      if (q.topic) lines.push(`标签：${q.topic}`);
      lines.push("");
    }

    for (const m of materials) {
      const time = m.created_at.slice(11, 16);
      lines.push(`## [Material] ${time} — ${m.original_text}`);
      lines.push("");
      const corrections = jsonOrEmpty(m.corrections);
      if (corrections.length) lines.push(`更正：${corrections.join(" / ")}`);
      if (m.explanation) lines.push(`为什么：${m.explanation}`);
      const vocab = jsonOrEmpty(m.vocabulary);
      if (vocab.length) lines.push(`词汇：${vocab.join(", ")}`);
      const tags = jsonOrEmpty(m.tags);
      if (tags.length) lines.push(`标签：${tags.join(", ")}`);
      lines.push("");
    }

    const [year, month] = date.split("-") as [string, string];
    const filePath = join(notesDir, year, month, `${date}.md`);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, lines.join("\n"), "utf8");
    return filePath;
  }
}

function toMaterial(row: MaterialRow) {
  return {
    id: row.id,
    sessionId: row.session_id,
    source: row.source,
    topic: row.topic,
    originalText: row.original_text,
    explanation: row.explanation,
    usefulExpressions: jsonOrEmpty(row.useful_expressions),
    corrections: jsonOrEmpty(row.corrections),
    vocabulary: jsonOrEmpty(row.vocabulary),
    practicePrompts: jsonOrEmpty(row.practice_prompts),
    tags: jsonOrEmpty(row.tags),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toReview(row: ReviewRow) {
  return {
    id: row.id,
    materialId: row.material_id,
    status: row.status,
    dueAt: row.due_at,
    intervalDays: row.interval_days,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toIntent(row: IntentRow) {
  return {
    id: row.id,
    label: row.label,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toSavedExpression(row: SavedExpressionRow) {
  return {
    id: row.id,
    materialId: row.material_id,
    intentId: row.intent_id,
    text: row.text,
    textNorm: row.text_norm,
    register: row.register,
    scene: row.scene,
    note: row.note,
    reuseCount: row.reuse_count,
    firstReusedAt: row.first_reused_at,
    lastReusedAt: row.last_reused_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toReuseEvent(row: ReuseEventRow) {
  return {
    id: row.id,
    expressionId: row.expression_id,
    sessionId: row.session_id,
    source: row.source,
    matchedText: row.matched_text,
    contextSnippet: row.context_snippet,
    matchKind: row.match_kind,
    confidence: row.confidence,
    createdAt: row.created_at
  };
}

function toQuestion(row: QuestionRow): QuestionTranslation {
  return {
    id: row.id,
    sessionId: row.session_id,
    source: row.source,
    question: row.question,
    translation: row.translation,
    topic: row.topic ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toSession(row: SessionRow) {
  return {
    id: row.id,
    source: row.source,
    topic: row.topic,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * A context shaped exactly like `WorkLearnContext` from `@work-learn/mcp-server`,
 * so the stdio MCP server can run offline against this local store instead of
 * calling the HTTP API.
 */
export const createLocalContext = (store: LocalStore) => ({
  createSession: (input: unknown) => store.createSession(input),
  saveMaterial: (input: unknown) => store.saveMaterial(input),
  saveQuestionTranslation: (input: unknown) => store.saveQuestionTranslation(input),
  searchCorpus: (query?: string) => store.searchCorpus(query),
  getReviewItems: () => store.getReviewItems(),
  markMastered: (reviewId: string) => store.markMastered(reviewId),
  snoozeReview: (reviewId: string, days?: number) => store.snoozeReview(reviewId, days),
  generatePractice: (input: unknown) => store.generatePractice(input),
  getUserPatterns: (input: unknown) => store.getUserPatterns(input),
  recordReuse: (input: unknown) => store.recordReuse(input)
});

export type LocalContext = ReturnType<typeof createLocalContext>;
