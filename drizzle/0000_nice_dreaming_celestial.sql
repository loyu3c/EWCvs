CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`action` text NOT NULL,
	`details` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `election_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `employees` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`employee_number` text NOT NULL,
	`department` text NOT NULL,
	`unit` text NOT NULL,
	`incumbent` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_employees_employee_number` ON `employees` (`employee_number`);--> statement-breakpoint
CREATE TABLE `votes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`voter_employee_id` integer NOT NULL,
	`candidate_employee_id` integer NOT NULL,
	`receipt_code` text NOT NULL,
	`cast_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `votes_voter_employee_id_unique` ON `votes` (`voter_employee_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `votes_receipt_code_unique` ON `votes` (`receipt_code`);