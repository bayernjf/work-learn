import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import {
  createSessionInputSchema,
  generatePracticeFromMaterials,
  generatePracticeInputSchema,
  getUserPatternsFromItems,
  getUserPatternsInputSchema,
  saveMaterialInputSchema,
  saveQuestionTranslationInputSchema,
  type PracticeMaterial,
  type PracticeQuestion,
  type QuestionTranslation,
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
};

type QuestionRow = {
  id: string;
  session_id: string;
  source: string;
  question: string;
  translation: string;
  topic: string | null;
  created_at: string;
};

type SessionRow = {
  id: string;
  source: string;
  topic: string | null;
  created_at: string;
};

export const DEFAULT_DB_PATH = join(homedir(), ".work-learn", "work-learn.db");
export const DEFAULT_NOTES_DIR = join(homedir(), ".work-learn", "notes");

const schema = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  topic TEXT,
  created_at TEXT NOT NULL
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
  created_at TEXT NOT NULL
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
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS qt_session_norm_idx ON question_translations(session_id, question_norm);
CREATE INDEX IF NOT EXISTS materials_created_idx ON learning_materials(created_at DESC);
CREATE TABLE IF NOT EXISTS review_items (
  id TEXT PRIMARY KEY,
  material_id TEXT NOT NULL REFERENCES learning_materials(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  due_at TEXT NOT NULL,
  interval_days INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  created_at TEXT NOT NULL
);
`;

/** Collapse a question to a comparable form for exact-dedupe. */
export const normalizeQuestion = (q: string): string => q.trim().toLowerCase().replace(/\s+/g, " ");

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
  }

  close(): void {
    this.db.close();
  }

  createSession(input: unknown) {
    const parsed = createSessionInputSchema.parse(input);
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare("INSERT INTO sessions (id, source, topic, created_at) VALUES (?, ?, ?, ?)")
      .run(id, parsed.source, parsed.topic ?? null, createdAt);
    return { id, source: parsed.source, topic: parsed.topic ?? null, createdAt };
  }

  saveMaterial(input: unknown) {
    const parsed = saveMaterialInputSchema.parse(input) as SaveMaterialInput & { sessionId: string };
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO learning_materials
         (id, session_id, source, topic, original_text, explanation, useful_expressions, corrections, vocabulary, practice_prompts, tags, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        createdAt
      );

    // A saved material feeds the local review queue, mirroring the cloud.
    this.db
      .prepare("INSERT INTO review_items (id, material_id, due_at, created_at) VALUES (?, ?, ?, ?)")
      .run(crypto.randomUUID(), id, createdAt, createdAt);

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
         (id, session_id, source, question, question_norm, translation, topic, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, parsed.sessionId, parsed.source, parsed.question, norm, parsed.translation, parsed.topic ?? null, createdAt);

    return { id, sessionId: parsed.sessionId, source: parsed.source, question: parsed.question, translation: parsed.translation, topic: parsed.topic, createdAt };
  }

  searchCorpus(query?: string) {
    const trimmed = query?.trim();
    const like = trimmed ? `%${trimmed}%` : null;

    const materials = (
      like
        ? this.db
            .prepare(
              `SELECT * FROM learning_materials
               WHERE original_text LIKE ? OR topic LIKE ? OR explanation LIKE ? OR useful_expressions LIKE ? OR vocabulary LIKE ?
               ORDER BY created_at DESC`
            )
            .all(like, like, like, like, like)
        : this.db.prepare("SELECT * FROM learning_materials ORDER BY created_at DESC").all()
    ) as MaterialRow[];

    const questions = (
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

    return {
      materials: materials.map(toMaterial),
      questions: questions.map(toQuestion)
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
         WHERE review_items.status = 'pending' AND review_items.due_at <= ?
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
    return generatePracticeFromMaterials(this.recentMaterials(50) as PracticeMaterial[], parsed);
  }

  getUserPatterns(input: unknown) {
    const parsed = getUserPatternsInputSchema.parse(input);
    return getUserPatternsFromItems(this.recentMaterials(100) as PracticeMaterial[], this.recentQuestions(100) as PracticeQuestion[], parsed);
  }

  markMastered(reviewId: string) {
    const result = this.db
      .prepare(
        `UPDATE review_items SET status = 'completed', completed_at = ?, interval_days = 1
         WHERE id = ? AND status = 'pending'`
      )
      .run(new Date().toISOString(), reviewId);
    if (result.changes === 0) throw new Error("Review item not found or already completed");
    return { id: reviewId, status: "completed" };
  }

  /** All local-only rows, ready to be pushed to the cloud. */
  unsynced() {
    const sessions = this.db.prepare("SELECT * FROM sessions ORDER BY created_at").all() as SessionRow[];
    const materials = this.db.prepare("SELECT * FROM learning_materials WHERE sync_status = 'local_only' ORDER BY created_at").all() as MaterialRow[];
    const questions = this.db.prepare("SELECT * FROM question_translations WHERE sync_status = 'local_only' ORDER BY created_at").all() as QuestionRow[];
    return {
      sessions: sessions.map(toSession),
      materials: materials.map(toMaterial),
      questions: questions.map(toQuestion)
    };
  }

  /** Mark rows as synced after a successful push. */
  markSynced(ids: { materials: string[]; questions: string[] }) {
    const now = new Date().toISOString();
    const markMaterial = this.db.prepare("UPDATE learning_materials SET sync_status = 'synced', synced_at = ? WHERE id = ?");
    const markQuestion = this.db.prepare("UPDATE question_translations SET sync_status = 'synced', synced_at = ? WHERE id = ?");
    const tx = this.db.transaction(() => {
      for (const id of ids.materials) markMaterial.run(now, id);
      for (const id of ids.questions) markQuestion.run(now, id);
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
    createdAt: row.created_at
  };
}

function toSession(row: SessionRow) {
  return {
    id: row.id,
    source: row.source,
    topic: row.topic,
    createdAt: row.created_at
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
  generatePractice: (input: unknown) => store.generatePractice(input),
  getUserPatterns: (input: unknown) => store.getUserPatterns(input)
});

export type LocalContext = ReturnType<typeof createLocalContext>;
