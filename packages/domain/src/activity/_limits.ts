/**
 * Numerical safety bounds applied at the wire-shape boundary for
 * Activity-related Zod schemas. Each value here is a payload-shape cap
 * (rejects unbounded payloads, keeps memory and serialization
 * predictable) — not a product cap. Where a value pins a real-world
 * limit (id length, seconds in a day) the rationale is named below.
 *
 * Centralizing the constants lets call sites read as intent
 * (`MAX_AUDIENCE_USER_IDS`) rather than naked numbers, and a future
 * change lands in one place. Tests pin them where they're load-bearing
 * (e.g., `MAX_PARTS_PER_ACTIVITY`).
 */

/**
 * Identifier columns are TEXT(64) in the relational schema. cuid2 is 24
 * chars; the cap is generous enough for any UUID variant while keeping
 * pathological keys out.
 */
export const MAX_ID_LENGTH = 64;

/** Title fields across the codebase share this cap. */
export const MAX_TITLE_LENGTH = 200;

/** Description / long-form prompt cap. Matches `descriptionField` in routes. */
export const MAX_LONG_TEXT_LENGTH = 4_000;

/**
 * Embed URL cap. 2 KB is the practical browser limit for a URL that
 * still renders without tooling complaining; anything larger is almost
 * certainly an attempt to abuse the field.
 */
export const MAX_URL_LENGTH = 2_000;

/**
 * Quiz prompt + reflection mid-length text. 2 KB balances "enough for a
 * paragraph-length prompt" with "not a dumping ground."
 */
export const MAX_PROMPT_LENGTH = 2_000;

/**
 * One day in seconds — caps `startSeconds` / `endSeconds` on the
 * audio/video Part bodies. Real media beyond a day is implausible v1.
 */
export const MAX_MEDIA_OFFSET_SECONDS = 86_400;

/**
 * A single activity holds at most this many Parts. Ranks and reorders
 * stay UI-tractable below ~20; the cap is set above to leave room for
 * authoring patterns (a reading + listen + reflection batch per week
 * across a long unit) without turning into runaway data.
 */
export const MAX_PARTS_PER_ACTIVITY = 50;

/** Library refs cap. Mirrors `MAX_PARTS_PER_ACTIVITY` because each Part can attach one. */
export const MAX_LIBRARY_REFS_PER_ACTIVITY = 50;

/**
 * Cross-activity prereq + suggested-sequence edge caps. A higher value
 * suggests a tangled DAG that should be re-modelled as separate tracks.
 */
export const MAX_CROSS_ACTIVITY_EDGES = 20;

/**
 * Audience subset upper bound. `subset` is an opt-in narrowing for one-off
 * pairings; a track that needs more than 500 explicit recipients should
 * be using `everyone_enrolled` and authoring discipline, not a giant list.
 */
export const MAX_AUDIENCE_USER_IDS = 500;

/** Quiz options per question — multiple-choice rarely exceeds 10. */
export const MAX_QUIZ_OPTIONS_PER_QUESTION = 10;

/** Quiz option text cap. A long option suggests the prompt should carry the framing. */
export const MAX_QUIZ_OPTION_TEXT = 500;

/** Quiz questions per quiz — a Part with more belongs in two activities. */
export const MAX_QUIZ_QUESTIONS = 50;
