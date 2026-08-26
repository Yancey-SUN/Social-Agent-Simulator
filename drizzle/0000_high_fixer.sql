CREATE TABLE `experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	`status` text DEFAULT 'running' NOT NULL,
	`population` integer NOT NULL,
	`rounds` integer NOT NULL,
	`concurrency` integer NOT NULL,
	`model_a` text NOT NULL,
	`model_b` text NOT NULL,
	`prompt_a` text NOT NULL,
	`prompt_b` text NOT NULL,
	`config_json` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`estimated_cost_micros` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_experiments_created_at` ON `experiments` (`created_at`);--> statement-breakpoint
CREATE TABLE `matches` (
	`id` text PRIMARY KEY NOT NULL,
	`experiment_id` text NOT NULL,
	`persona_a_id` text NOT NULL,
	`persona_b_id` text NOT NULL,
	`variant` text NOT NULL,
	`score` real NOT NULL,
	`relation_type` text NOT NULL,
	`research_json` text NOT NULL,
	`status` text DEFAULT 'research' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_matches_experiment_score` ON `matches` (`experiment_id`,`score`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`experiment_id` text NOT NULL,
	`persona_id` text NOT NULL,
	`variant` text NOT NULL,
	`turn_index` integer NOT NULL,
	`speaker` text NOT NULL,
	`content` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_messages_experiment_persona` ON `messages` (`experiment_id`,`persona_id`);--> statement-breakpoint
CREATE INDEX `idx_messages_variant` ON `messages` (`experiment_id`,`variant`);--> statement-breakpoint
CREATE TABLE `outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`experiment_id` text NOT NULL,
	`match_id` text NOT NULL,
	`checkpoint` text NOT NULL,
	`accepted_a` integer NOT NULL,
	`accepted_b` integer NOT NULL,
	`messages_exchanged` integer DEFAULT 0 NOT NULL,
	`relationship_alive` integer DEFAULT false NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_outcomes_match_checkpoint` ON `outcomes` (`match_id`,`checkpoint`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`experiment_id` text NOT NULL,
	`persona_id` text NOT NULL,
	`variant` text NOT NULL,
	`profile_json` text NOT NULL,
	`readiness` real NOT NULL,
	`evidence_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_profiles_experiment_variant` ON `profiles` (`experiment_id`,`variant`);
--> statement-breakpoint
PRAGMA optimize;
