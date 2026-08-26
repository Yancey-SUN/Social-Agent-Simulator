import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const experiments = sqliteTable("experiments", {
  id: text("id").primaryKey(), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(), completedAt: integer("completed_at", { mode: "timestamp_ms" }), status: text("status").notNull().default("running"), population: integer("population").notNull(), rounds: integer("rounds").notNull(), concurrency: integer("concurrency").notNull(), modelA: text("model_a").notNull(), modelB: text("model_b").notNull(), promptA: text("prompt_a").notNull(), promptB: text("prompt_b").notNull(), configJson: text("config_json").notNull(), inputTokens: integer("input_tokens").notNull().default(0), outputTokens: integer("output_tokens").notNull().default(0), estimatedCostMicros: integer("estimated_cost_micros").notNull().default(0),
}, (t) => [index("idx_experiments_created_at").on(t.createdAt)]);

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(), experimentId: text("experiment_id").notNull(), personaId: text("persona_id").notNull(), variant: text("variant").notNull(), turnIndex: integer("turn_index").notNull(), speaker: text("speaker").notNull(), content: text("content").notNull(), model: text("model").notNull(), promptVersion: text("prompt_version").notNull(), inputTokens: integer("input_tokens").notNull().default(0), outputTokens: integer("output_tokens").notNull().default(0), latencyMs: integer("latency_ms").notNull().default(0), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [index("idx_messages_experiment_persona").on(t.experimentId, t.personaId), index("idx_messages_variant").on(t.experimentId, t.variant)]);

export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(), experimentId: text("experiment_id").notNull(), personaId: text("persona_id").notNull(), variant: text("variant").notNull(), profileJson: text("profile_json").notNull(), readiness: real("readiness").notNull(), evidenceJson: text("evidence_json").notNull(), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [index("idx_profiles_experiment_variant").on(t.experimentId, t.variant)]);

export const matches = sqliteTable("matches", {
  id: text("id").primaryKey(), experimentId: text("experiment_id").notNull(), personaAId: text("persona_a_id").notNull(), personaBId: text("persona_b_id").notNull(), variant: text("variant").notNull(), score: real("score").notNull(), relationType: text("relation_type").notNull(), researchJson: text("research_json").notNull(), status: text("status").notNull().default("research"), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [index("idx_matches_experiment_score").on(t.experimentId, t.score)]);

export const outcomes = sqliteTable("outcomes", {
  id: text("id").primaryKey(), experimentId: text("experiment_id").notNull(), matchId: text("match_id").notNull(), checkpoint: text("checkpoint").notNull(), acceptedA: integer("accepted_a", { mode: "boolean" }).notNull(), acceptedB: integer("accepted_b", { mode: "boolean" }).notNull(), messagesExchanged: integer("messages_exchanged").notNull().default(0), relationshipAlive: integer("relationship_alive", { mode: "boolean" }).notNull().default(false), note: text("note").notNull().default(""), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [index("idx_outcomes_match_checkpoint").on(t.matchId, t.checkpoint)]);
