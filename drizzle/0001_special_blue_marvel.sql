CREATE TABLE `failures` (
	`id` text PRIMARY KEY NOT NULL,
	`experiment_id` text NOT NULL,
	`persona_id` text DEFAULT '' NOT NULL,
	`variant` text DEFAULT 'A' NOT NULL,
	`stage` text NOT NULL,
	`error_code` text DEFAULT 'UNKNOWN' NOT NULL,
	`message` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_failures_experiment_created_at` ON `failures` (`experiment_id`,`created_at`);