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
  generateAdaptivePracticeInputSchema,
  generateAdaptivePractice,
  getPracticeHistoryInputSchema,
  recordPracticeInputSchema,
  chatCompletion,
  getUserPatternsFromItems,
  getUserPatternsInputSchema,
  clusterIntentsInputSchema,
  listExpressionsInputSchema,
  listIntentsInputSchema,
  mergeIntentsInputSchema,
  saveMaterialInputSchema,
  saveQuestionTranslationInputSchema,
  splitIntentInputSchema,
  recordReuseInputSchema,
  redactSecrets,
  defaultReuseNudgeSettings,
  suggestReuse,
  suggestReuseInputSchema,
  summarizeReuse,
  reuseNudgeSettingsSchema,
  updateReuseNudgeSettingsSchema,
  scheduleNextReview,
  type ReviewGrade,
  syncBatchInputSchema,
  type ClusterIntentsInput,
  type ListExpressionsInput,
  type ListIntentsInput,
  type MergeIntentsInput,
  type PracticeMaterial,
  type PracticeQuestion,
  type QuestionTranslation,
  type RecordReuseInput,
  type RecordPracticeInput,
  type GetPracticeHistoryInput,
  type PracticeRecord,
  type PracticeExercise,
  type GenerateAdaptivePracticeInput,
  type ReuseNudgeSettings,
  type SaveMaterialInput,
  type SplitIntentInput,
  type SuggestReuseInput,
  type UpdateReuseNudgeSettings,
  type SaveQuestionTranslationInput,
  type WorkLearnContext,
  type LocalSyncStore,
  type SyncBatchInput,
  type SyncPushCounts,
  type MarkSyncedInput
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

type PracticeRecordRow = {
  id: string;
  material_id: string | null;
  question_id: string | null;
  exercise_type: string;
  focus: string;
  prompt: string;
  user_answer: string;
  is_correct: number | null;
  status: "pending" | "remembered" | "practice_again";
  created_at: string;
  sync_status: SyncStatus;
  synced_at: string | null;
};

export const DEFAULT_DB_PATH = join(homedir(), ".work-learn", "work-learn.db");
export const DEFAULT_BACKUP_DIR = join(homedir(), ".work-learn", "backups");
export const DEFAULT_NOTES_DIR = join(homedir(), ".work-learn", "notes");

const REQUIRED_TABLES = ["sessions", "learning_materials", "question_translations", "review_items", "intents", "saved_expressions", "reuse_events", "practice_records", "sync_meta", "sync_tombstones"];

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
CREATE TABLE IF NOT EXISTS practice_records (
  id TEXT PRIMARY KEY,
  material_id TEXT REFERENCES learning_materials(id) ON DELETE CASCADE,
  question_id TEXT REFERENCES question_translations(id) ON DELETE CASCADE,
  exercise_type TEXT NOT NULL CHECK(exercise_type IN ('reuse','recall','correction','apply','question','mcq','fill','scenario')),
  focus TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  user_answer TEXT NOT NULL DEFAULT '',
  is_correct INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','remembered','practice_again')),
  created_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'local_only',
  synced_at TEXT
);
CREATE INDEX IF NOT EXISTS practice_records_created_idx ON practice_records(created_at DESC);
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

export class LocalStore implements LocalSyncStore {
  private db: Database.Database;

  constructor(options: LocalStoreOptions = {}) {
    const dbPath = options.dbPath ?? process.env.WORK_LEARN_DB_PATH ?? DEFAULT_DB_PATH;
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

  recordPractice(input: unknown) {
    const parsed = recordPracticeInputSchema.parse(input) as RecordPracticeInput;
    const recordedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO practice_records
         (id, material_id, question_id, exercise_type, focus, prompt, user_answer, is_correct, status, created_at, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local_only')`
      )
      .run(
        crypto.randomUUID(),
        parsed.materialId ?? null,
        parsed.questionId ?? null,
        parsed.exerciseType,
        parsed.focus,
        parsed.prompt,
        parsed.userAnswer,
        parsed.isCorrect === null || parsed.isCorrect === undefined ? null : parsed.isCorrect ? 1 : 0,
        parsed.status,
        recordedAt
      );
    return { id: "", recordedAt };
  }

  getPracticeHistory(input: unknown) {
    const parsed = getPracticeHistoryInputSchema.parse(input) as GetPracticeHistoryInput;
    let query = "SELECT * FROM practice_records ORDER BY created_at DESC";
    const params: unknown[] = [];
    if (parsed.onlyMistakes) {
      query = "SELECT * FROM practice_records WHERE is_correct = 0 ORDER BY created_at DESC";
    }
    query += ` LIMIT ${parsed.limit ?? 50}`;
    const rows = this.db.prepare(query).all(...params) as PracticeRecordRow[];
    return rows.map(toPracticeRecordRow);
  }

  async generateAdaptivePractice(input: unknown) {
    const parsed = generateAdaptivePracticeInputSchema.parse(input) as GenerateAdaptivePracticeInput;
    const mistakes = this.getPracticeHistory({ onlyMistakes: true, limit: 40 });
    const context = parsed.context.length
      ? parsed.context
      : mistakes.map((m) => ({ kind: "mistake" as const, text: m.prompt || m.focus }));
    try {
      const exercises = await generateAdaptivePractice({ ...parsed, context }, chatCompletion);
      return { generatedAt: new Date().toISOString(), materials: [], questions: [], exercises, mode: "adaptive" as const };
    } catch {
      const fallback = this.generatePractice({ limit: parsed.count, materialId: parsed.materialId });
      return { ...fallback, mode: "adaptive_fallback" as const };
    }
  }

  getReuseSummary() {
    const expressions = (this.db
      .prepare("SELECT * FROM saved_expressions ORDER BY updated_at DESC")
      .all() as SavedExpressionRow[]).map(toSavedExpression);
    const events = (this.db
      .prepare("SELECT * FROM reuse_events ORDER BY created_at DESC")
      .all() as ReuseEventRow[]).map(toReuseEvent);
    return summarizeReuse(expressions, events);
  }

  getReuseNudgeSettings(): ReuseNudgeSettings {
    const row = this.db.prepare("SELECT value FROM sync_meta WHERE key = ?").get("reuse_nudge_settings") as { value: string } | undefined;
    if (!row) return defaultReuseNudgeSettings();
    return reuseNudgeSettingsSchema.parse({ ...defaultReuseNudgeSettings(), ...JSON.parse(row.value) });
  }

  updateReuseNudgeSettings(input: unknown): ReuseNudgeSettings {
    const parsed = updateReuseNudgeSettingsSchema.parse(input) as UpdateReuseNudgeSettings;
    const current = this.getReuseNudgeSettings();
    const next: ReuseNudgeSettings = {
      ...current,
      ...parsed,
      updatedAt: new Date().toISOString()
    };
    this.db.prepare("INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run("reuse_nudge_settings", JSON.stringify(next));
    return next;
  }

  suggestReuse(input: unknown) {
    const parsed = suggestReuseInputSchema.parse(input) as SuggestReuseInput;
    const safeText = redactSecrets(parsed.text).text;
    const now = new Date().toISOString();
    const settings = this.getReuseNudgeSettings();
    const expressions = (this.db
      .prepare("SELECT * FROM saved_expressions ORDER BY updated_at DESC")
      .all() as SavedExpressionRow[]).map(toSavedExpression);
    const events = (this.db
      .prepare("SELECT expression_id, match_kind, created_at FROM reuse_events ORDER BY created_at DESC")
      .all() as Array<{ expression_id: string; match_kind: "exact" | "variant" | "nudge"; created_at: string }>)
      .map((row) => ({ expressionId: row.expression_id, matchKind: row.match_kind, createdAt: row.created_at }));
    const result = suggestReuse(safeText, expressions, { source: parsed.source, limit: parsed.limit }, { settings, events, now });
    const suggestion = result.suggestions[0];
    if (suggestion) {
      this.db.prepare(
        `INSERT INTO reuse_events
         (id, expression_id, session_id, source, matched_text, context_snippet, match_kind, confidence, created_at, sync_status)
         VALUES (?, ?, NULL, ?, ?, NULL, 'nudge', 0.5, ?, 'local_only')`
      ).run(crypto.randomUUID(), suggestion.expressionId, parsed.source ?? null, suggestion.text, now);
    }
    return result;
  }

  listExpressions(input: unknown = {}) {
    const parsed = listExpressionsInputSchema.parse(input) as ListExpressionsInput;
    let rows = (this.db.prepare("SELECT * FROM saved_expressions ORDER BY updated_at DESC").all() as SavedExpressionRow[]).map(toSavedExpression);
    if (parsed.includeUnclustered) rows = rows.filter((row) => row.intentId === null);
    if (parsed.intentId !== undefined) rows = rows.filter((row) => parsed.intentId === null ? row.intentId === null : row.intentId === parsed.intentId);
    return rows.slice(0, parsed.limit);
  }

  clusterIntents(input: unknown) {
    const parsed = clusterIntentsInputSchema.parse(input) as ClusterIntentsInput;
    const now = new Date().toISOString();
    const insertIntent = this.db.prepare(
      `INSERT INTO intents (id, label, description, created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, 'local_only')`
    );
    const assignExpression = this.db.prepare(
      `UPDATE saved_expressions SET intent_id = ?, updated_at = ?, sync_status = 'local_only' WHERE id = ?`
    );
    const created: Array<{ id: string; label: string; description: string | null; expressionIds: string[] }> = [];
    const tx = this.db.transaction(() => {
      for (const group of parsed.groups) {
        const id = crypto.randomUUID();
        insertIntent.run(id, group.label, group.description ?? null, now, now);
        for (const expressionId of group.expressionIds) assignExpression.run(id, now, expressionId);
        created.push({ id, label: group.label, description: group.description ?? null, expressionIds: group.expressionIds });
      }
    });
    tx();
    return { clusteredAt: now, intents: created };
  }

  mergeIntents(input: unknown) {
    const parsed = mergeIntentsInputSchema.parse(input) as MergeIntentsInput;
    if (parsed.sourceIntentId === parsed.targetIntentId) throw new Error("Source and target intents must differ");
    const source = this.db.prepare("SELECT id FROM intents WHERE id = ?").get(parsed.sourceIntentId) as { id: string } | undefined;
    const target = this.db.prepare("SELECT id FROM intents WHERE id = ?").get(parsed.targetIntentId) as { id: string } | undefined;
    if (!source) throw new Error("Source intent not found");
    if (!target) throw new Error("Target intent not found");
    const now = new Date().toISOString();
    const moved = this.db.prepare("SELECT id FROM saved_expressions WHERE intent_id = ?").all(parsed.sourceIntentId) as Array<{ id: string }>;
    const tx = this.db.transaction(() => {
      this.db.prepare("UPDATE saved_expressions SET intent_id = ?, updated_at = ?, sync_status = 'local_only' WHERE intent_id = ?")
        .run(parsed.targetIntentId, now, parsed.sourceIntentId);
      this.db.prepare("UPDATE intents SET updated_at = ?, sync_status = 'local_only' WHERE id = ?").run(now, parsed.targetIntentId);
      this.recordTombstone("intent", parsed.sourceIntentId, now);
      this.db.prepare("DELETE FROM intents WHERE id = ?").run(parsed.sourceIntentId);
    });
    tx();
    return { mergedAt: now, sourceIntentId: parsed.sourceIntentId, targetIntentId: parsed.targetIntentId, movedExpressionIds: moved.map((row) => row.id) };
  }

  splitIntent(input: unknown) {
    const parsed = splitIntentInputSchema.parse(input) as SplitIntentInput;
    const source = this.db.prepare("SELECT id FROM intents WHERE id = ?").get(parsed.intentId) as { id: string } | undefined;
    if (!source) throw new Error("Intent not found");
    const allIds = new Set(parsed.groups.flatMap((group) => group.expressionIds));
    if (allIds.size !== parsed.groups.reduce((sum, group) => sum + group.expressionIds.length, 0)) throw new Error("An expression cannot be assigned to more than one split group");
    const now = new Date().toISOString();
    const insertIntent = this.db.prepare(
      `INSERT INTO intents (id, label, description, created_at, updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, 'local_only')`
    );
    const assignExpression = this.db.prepare(
      `UPDATE saved_expressions SET intent_id = ?, updated_at = ?, sync_status = 'local_only' WHERE id = ? AND intent_id = ?`
    );
    const created: Array<{ id: string; label: string; description: string | null; expressionIds: string[] }> = [];
    const tx = this.db.transaction(() => {
      for (const group of parsed.groups) {
        const id = crypto.randomUUID();
        insertIntent.run(id, group.label, group.description ?? null, now, now);
        for (const expressionId of group.expressionIds) {
          const result = assignExpression.run(id, now, expressionId, parsed.intentId);
          if (result.changes === 0) throw new Error(`Expression ${expressionId} does not belong to the intent being split`);
        }
        created.push({ id, label: group.label, description: group.description ?? null, expressionIds: group.expressionIds });
      }
      const remaining = this.db.prepare("SELECT count(*) AS count FROM saved_expressions WHERE intent_id = ?").get(parsed.intentId) as { count: number };
      if (remaining.count === 0) {
        this.recordTombstone("intent", parsed.intentId, now);
        this.db.prepare("DELETE FROM intents WHERE id = ?").run(parsed.intentId);
      }
    });
    tx();
    return { splitAt: now, sourceIntentId: parsed.intentId, intents: created, sourceDeleted: !this.db.prepare("SELECT id FROM intents WHERE id = ?").get(parsed.intentId) };
  }

  listIntents(input: unknown = {}) {
    const parsed = listIntentsInputSchema.parse(input) as ListIntentsInput;
    const intentRows = this.db
      .prepare("SELECT id, label, description, created_at, updated_at FROM intents ORDER BY updated_at DESC LIMIT ?")
      .all(parsed.limit) as IntentRow[];
    const exprRows = (this.db
      .prepare("SELECT * FROM saved_expressions ORDER BY updated_at DESC LIMIT ?")
      .all(parsed.expressionLimit) as SavedExpressionRow[])
      .map(toSavedExpression);
    const byIntent = new Map<string, ReturnType<typeof toSavedExpression>[]>();
    const unclustered: ReturnType<typeof toSavedExpression>[] = [];
    for (const expr of exprRows) {
      if (expr.intentId) {
        const arr = byIntent.get(expr.intentId);
        if (arr) arr.push(expr);
        else byIntent.set(expr.intentId, [expr]);
      } else {
        unclustered.push(expr);
      }
    }
    const intents = intentRows.map((row) => ({
      intent: { id: row.id, label: row.label, description: row.description, createdAt: row.created_at, updatedAt: row.updated_at },
      expressions: byIntent.get(row.id) ?? []
    }));
    return { intents, unclustered };
  }

  markMastered(reviewId: string, grade: ReviewGrade = "good") {
    const row = this.db
      .prepare("SELECT interval_days FROM review_items WHERE id = ? AND status = 'pending'")
      .get(reviewId) as { interval_days: number } | undefined;
    if (!row) throw new Error("Review item not found or already completed");
    const { intervalDays, dueAt, mastered } = scheduleNextReview(row.interval_days ?? 0, grade);
    const result = this.db
      .prepare(
        mastered
          ? `UPDATE review_items SET status = 'completed', completed_at = ?, interval_days = ?, updated_at = ?, sync_status = 'local_only' WHERE id = ? AND status = 'pending'`
          : `UPDATE review_items SET status = 'pending', due_at = ?, interval_days = ?, updated_at = ?, sync_status = 'local_only' WHERE id = ? AND status = 'pending'`
      )
      // dueAt comes from the scheduler; writing the current time here reschedules
      // the item to be due immediately, which defeats spaced repetition entirely.
      .run(dueAt, intervalDays, new Date().toISOString(), reviewId);
    if (result.changes === 0) throw new Error("Review item not found or already completed");
    return { id: reviewId, status: mastered ? ("completed" as const) : ("pending" as const), dueAt, intervalDays };
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
  private recordTombstone(entity: "session" | "material" | "question" | "review" | "intent" | "expression" | "reuse_event", id: string, deletedAt: string) {
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
        // The review tombstone is keyed by material_id, not by the review row
        // id: each end generates its own review id for the same material, so a
        // deletion recorded under the local id would miss the row everywhere
        // else and leave a ghost. material_id is the stable 1:1 key.
        this.recordTombstone("review", materialId, deletedAt);
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
  unsynced(): SyncBatchInput {
    const sessions = this.db.prepare("SELECT * FROM sessions WHERE sync_status = 'local_only' ORDER BY created_at").all() as SessionRow[];
    const materials = this.db.prepare("SELECT * FROM learning_materials WHERE sync_status = 'local_only' ORDER BY created_at").all() as MaterialRow[];
    const questions = this.db.prepare("SELECT * FROM question_translations WHERE sync_status = 'local_only' ORDER BY created_at").all() as QuestionRow[];
    const reviews = this.db.prepare("SELECT * FROM review_items WHERE sync_status = 'local_only' ORDER BY created_at").all() as ReviewRow[];
    const intents = this.db.prepare("SELECT * FROM intents WHERE sync_status = 'local_only' ORDER BY created_at").all() as IntentRow[];
    const expressions = this.db.prepare("SELECT * FROM saved_expressions WHERE sync_status = 'local_only' ORDER BY created_at").all() as SavedExpressionRow[];
    const reuseEvents = this.db.prepare("SELECT * FROM reuse_events WHERE sync_status = 'local_only' ORDER BY created_at").all() as ReuseEventRow[];
    const practiceRecords = this.db.prepare("SELECT * FROM practice_records WHERE sync_status = 'local_only' ORDER BY created_at").all() as PracticeRecordRow[];
    const tombstones = (this.db.prepare("SELECT * FROM sync_tombstones WHERE sync_status = 'local_only'").all() as Array<{ id: string; entity: string; deleted_at: string }>)
      .map((row) => ({ id: row.id, entity: row.entity, deletedAt: row.deleted_at }));
    // The output is validated by the cloud on every push (syncToCloud parses
    // the batch), so asserting the protocol shape here confirms a runtime fact
    // in types rather than making an unchecked claim.
    return {
      sessions: sessions.map(toSession),
      materials: materials.map(toMaterial),
      questions: questions.map(toQuestion),
      reviews: reviews.map(toReview),
      intents: intents.map(toIntent),
      expressions: expressions.map(toSavedExpression),
      reuseEvents: reuseEvents.map(toReuseEvent),
      practiceRecords: practiceRecords.map(toPracticeRecordRow),
      tombstones
    } as SyncBatchInput;
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

  setLastPulledAt(iso: string) {
    this.setMeta("last_pulled_at", iso);
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
        practiceRecords: count("practice_records"),
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
        practiceRecords: batch.practiceRecords.length,
        tombstones: batch.tombstones.length
      },
      latestUpdatedAt: max("learning_materials")
    };
  }

  /** Count materials and questions created since the start of the local day. */
  countCreatedToday() {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (ISO sorts lexicographically)
    const materials = (this.db.prepare("SELECT count(*) AS count FROM learning_materials WHERE created_at >= ?").get(`${today}T00:00:00`) as { count: number }).count;
    const questions = (this.db.prepare("SELECT count(*) AS count FROM question_translations WHERE created_at >= ?").get(`${today}T00:00:00`) as { count: number }).count;
    return { materials, questions, total: materials + questions };
  }

  /** Apply a cloud snapshot using last-write-wins by updated_at. */
  applyRemoteBatch(batch: unknown): SyncPushCounts {
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
    const upsertPracticeRecord = this.db.prepare(`
      INSERT INTO practice_records
        (id, material_id, question_id, exercise_type, focus, prompt, user_answer, is_correct, status, created_at, sync_status, synced_at)
      VALUES (@id, @materialId, @questionId, @exerciseType, @focus, @prompt, @userAnswer, @isCorrect, @status, @createdAt, 'synced', @now)
      ON CONFLICT(id) DO NOTHING
    `);
    // practice_records has NOT NULL-less FKs declared ON DELETE CASCADE here but
    // SET NULL in the cloud, so a record can outlive its parent in one store and
    // not the other. Skip orphans instead of failing the whole batch.
    const practiceMaterialExists = this.db.prepare("SELECT id FROM learning_materials WHERE id = ?");
    const practiceQuestionExists = this.db.prepare("SELECT id FROM question_translations WHERE id = ?");
    const counts = { sessions: 0, materials: 0, questions: 0, reviews: 0, intents: 0, expressions: 0, reuseEvents: 0, practiceRecords: 0, tombstones: 0 };
    // Parent ids that exist locally or arrive in this batch. The cloud keeps a
    // material or question alive after its session is deleted (SET NULL); the
    // local FK is NOT NULL, so such an orphan must be skipped, not written.
    const knownSessionIds = new Set((this.db.prepare("SELECT id FROM sessions").all() as Array<{ id: string }>).map((row) => row.id));
    const knownMaterialIds = new Set((this.db.prepare("SELECT id FROM learning_materials").all() as Array<{ id: string }>).map((row) => row.id));
    for (const row of parsed.sessions) knownSessionIds.add(row.id);
    for (const row of parsed.materials) knownMaterialIds.add(row.id);
    const tx = this.db.transaction(() => {
      for (const row of parsed.sessions) {
        upsertSession.run({ ...row, now });
        counts.sessions++;
      }
      for (const row of parsed.materials) {
        if (!knownSessionIds.has(row.sessionId)) continue;
        upsertMaterial.run({ ...row, usefulExpressions: JSON.stringify(row.usefulExpressions), corrections: JSON.stringify(row.corrections), vocabulary: JSON.stringify(row.vocabulary), practicePrompts: JSON.stringify(row.practicePrompts), tags: JSON.stringify(row.tags), now });
        counts.materials++;
      }
      for (const row of parsed.questions) {
        if (!knownSessionIds.has(row.sessionId)) continue;
        upsertQuestion.run({ ...row, questionNorm: normalizeQuestion(row.question), now });
        counts.questions++;
      }
      for (const row of parsed.reviews) {
        if (!knownMaterialIds.has(row.materialId)) continue;
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
      for (const row of parsed.practiceRecords) {
        if (row.materialId && !practiceMaterialExists.get(row.materialId)) continue;
        if (row.questionId && !practiceQuestionExists.get(row.questionId)) continue;
        const inserted = upsertPracticeRecord.run({
          ...row,
          isCorrect: row.isCorrect === null ? null : row.isCorrect ? 1 : 0,
          now
        });
        if (inserted.changes > 0) counts.practiceRecords++;
      }
      const deleteSession = this.db.prepare("DELETE FROM sessions WHERE id = ? AND ? >= updated_at");
      const deleteMaterial = this.db.prepare("DELETE FROM learning_materials WHERE id = ? AND ? >= updated_at");
      const deleteQuestion = this.db.prepare("DELETE FROM question_translations WHERE id = ? AND ? >= updated_at");
      // A review tombstone carries the material id (reviews are 1:1 with
      // materials and review ids drift between ends), so match on it.
      const deleteReview = this.db.prepare("DELETE FROM review_items WHERE material_id = ? AND ? >= updated_at");
      const deleteIntent = this.db.prepare("DELETE FROM intents WHERE id = ? AND ? >= updated_at");
      const deleteExpression = this.db.prepare("DELETE FROM saved_expressions WHERE id = ? AND ? >= updated_at");
      // reuse_events carries no updated_at -- it is append-only -- so a tombstone
      // can only ever mean "gone", not "superseded".
      const deleteReuseEvent = this.db.prepare("DELETE FROM reuse_events WHERE id = ?");
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
        else if (t.entity === "reuse_event") deleteReuseEvent.run(t.id);
        upsertTombstone.run(t.id, t.entity, t.deletedAt, now);
        counts.tombstones++;
      }
    });
    tx();
    return counts;
  }

  /**
   * Mark rows as synced after a successful push.
   *
   * The mutable tables only stamp the exact `updated_at` that was in the pushed
   * batch: a row edited while the batch was in flight has a newer timestamp and
   * must stay unsynced, or the stamp would silently swallow the newer edit.
   * reuse_events and practice_records are append-only, so their ids carry no
   * version. Tombstones are stamped inside the same transaction instead of
   * racing it.
   */
  markSynced(rows: MarkSyncedInput) {
    const now = new Date().toISOString();
    const versioned: Array<[string, Array<{ id: string; updatedAt: string }>]> = [
      ["sessions", rows.sessions ?? []],
      ["learning_materials", rows.materials ?? []],
      ["question_translations", rows.questions ?? []],
      ["review_items", rows.reviews ?? []],
      ["intents", rows.intents ?? []],
      ["saved_expressions", rows.expressions ?? []]
    ];
    const tx = this.db.transaction(() => {
      for (const [table, entries] of versioned) {
        const stmt = this.db.prepare(`UPDATE ${table} SET sync_status = 'synced', synced_at = ? WHERE id = ? AND updated_at = ?`);
        for (const entry of entries) stmt.run(now, entry.id, entry.updatedAt);
      }
      const stamp = (table: string, ids: string[]) => {
        const stmt = this.db.prepare(`UPDATE ${table} SET sync_status = 'synced', synced_at = ? WHERE id = ?`);
        for (const id of ids) stmt.run(now, id);
      };
      stamp("reuse_events", rows.reuseEvents ?? []);
      stamp("practice_records", rows.practiceRecords ?? []);
      const markTombstone = this.db.prepare("UPDATE sync_tombstones SET sync_status = 'synced', synced_at = ? WHERE id = ? AND entity = ?");
      for (const t of rows.tombstones ?? []) markTombstone.run(now, t.id, t.entity);
    });
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

function toPracticeRecordRow(row: PracticeRecordRow): PracticeRecord {
  return {
    id: row.id,
    materialId: row.material_id,
    questionId: row.question_id,
    exerciseType: row.exercise_type as PracticeRecord["exerciseType"],
    focus: row.focus,
    prompt: row.prompt,
    userAnswer: row.user_answer,
    isCorrect: row.is_correct === null ? null : row.is_correct === 1,
    status: row.status,
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
 * The offline context for the stdio MCP server: structurally checked against
 * the shared `WorkLearnContext` contract at compile time, so a method added
 * to the cloud or HTTP context without this one fails the build.
 */
export const createLocalContext = (store: LocalStore): WorkLearnContext => ({
  createSession: (input: unknown) => store.createSession(input),
  saveMaterial: (input: unknown) => store.saveMaterial(input),
  saveQuestionTranslation: (input: unknown) => store.saveQuestionTranslation(input),
  searchCorpus: (query?: string) => store.searchCorpus(query),
  getReviewItems: () => store.getReviewItems(),
  markMastered: (reviewId: string) => store.markMastered(reviewId),
  snoozeReview: (reviewId: string, days?: number) => store.snoozeReview(reviewId, days),
  generatePractice: (input: unknown) => store.generatePractice(input),
  getUserPatterns: (input: unknown) => store.getUserPatterns(input),
  recordPractice: (input: unknown) => store.recordPractice(input),
  getPracticeHistory: (input: unknown) => store.getPracticeHistory(input),
  generateAdaptivePractice: (input: unknown) => store.generateAdaptivePractice(input),
  recordReuse: (input: unknown) => store.recordReuse(input),
  getReuseSummary: () => store.getReuseSummary(),
  suggestReuse: (input: unknown) => store.suggestReuse(input),
  getReuseNudgeSettings: () => store.getReuseNudgeSettings(),
  updateReuseNudgeSettings: (input: unknown) => store.updateReuseNudgeSettings(input),
  listExpressions: (input: unknown) => store.listExpressions(input),
  clusterIntents: (input: unknown) => store.clusterIntents(input),
  mergeIntents: (input: unknown) => store.mergeIntents(input),
  splitIntent: (input: unknown) => store.splitIntent(input),
  listIntents: (input: unknown) => store.listIntents(input)
});

export type LocalContext = ReturnType<typeof createLocalContext>;
