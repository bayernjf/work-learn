# Reuse Tracking

## Goal

Work Learn should measure whether saved English is actually reused in real AI work conversations, not merely collected. Reuse tracking is intentionally different from quiz-style practice: it stays inside the user's normal workflow and records active vocabulary growth at the moment the user needs it.

The product does **not** treat one expression as the single correct answer. One intent can have several valid expressions. They differ by register, scene, team convention, and tone. Reuse features should expand the user's choices, not grade their wording as wrong.

## Data Model

### `intents`

An intent cluster represents one communicative goal, for example "make a database change available in production". Multiple expressions can belong to the same intent.

Clustering is conservative. Early versions can leave `intent_id` empty rather than aggressively merging expressions. Users must eventually be able to split and merge clusters.

### `saved_expressions`

This table elevates high-value expressions from `learning_materials.useful_expressions` into trackable entities.

Key fields:

- `text`: the saved expression, such as `roll out a migration`;
- `text_norm`: a normalized form for deterministic matching;
- `register`: `formal`, `neutral`, or `casual`;
- `scene`: free-form labels such as `pr`, `chat`, `docs`, or `comment`;
- `note`: optional context describing nuance;
- `reuse_count`, `first_reused_at`, and `last_reused_at`: derived usage signals.

One normalized expression is unique per user. Saving another material containing the same expression does not duplicate it.

### `reuse_events`

Append-only events. Each event records that the user wrote a saved expression in a later conversation.

Key fields:

- `expression_id`: the saved expression that matched;
- `session_id` and `source`: where reuse happened;
- `matched_text`: the text the user actually wrote;
- `context_snippet`: a short redacted surrounding snippet;
- `match_kind`: `exact`, `variant`, or `nudge`;
- `confidence`: `0` to `1`.

`nudge` records when Work Learn suggested an alternative but the user did not adopt it. This lets future nudges become less noisy.

## Matching Strategy

### Phase 1: Deterministic matching

The first implementation uses no model. It normalizes text by lowercasing, normalizing Unicode, replacing punctuation and whitespace with single spaces, and trimming.

The current user message or document is treated as a haystack. A saved expression counts as reused when its normalized form appears as a phrase in that haystack. This avoids semantic false positives and keeps the feature explainable.

### Phase 2: Model-assisted matching

A later version can let the host agent identify the user's intent and detect same-intent variants. Low-confidence matches should not be recorded automatically; they can become suggestions instead.

## Nudge Rules

Nudges must sound like expansion, never correction. Product safeguards: at most one nudge per agent turn; never nudge while the user is writing code, shell commands, or pure Chinese; expressions repeatedly ignored should be deprioritized; users can disable nudges.

## Metrics

The useful progress signals are:

- **Active vocabulary**: saved expressions reused at least once;
- **Expression breadth**: intents where the user has actively used two or more expressions;
- **Sleeping expressions**: saved expressions never reused; these stay quiet unless the user opens them.

## Delivery Plan

1. Add the storage schema and sync support.
2. Create saved expression entities when a material is saved.
3. Add `record_reuse` to MCP/API/local store with deterministic phrase matching.
4. Add a Web reuse dashboard and expression metadata editing. ✅ P1-b dashboard shipped for active vocabulary, cross-context reuse, sleeping expressions, and recent events; expression metadata editing remains future work.
5. Add deterministic `suggest_reuse` (same-intent expansion, at most one nudge per turn). ✅
6. Add rate limiting, a user-facing off switch, and `configure_reuse_nudges` for MCP/CLI/Web. ✅
7. Add conservative model-assisted intent clustering after enough data exists.

