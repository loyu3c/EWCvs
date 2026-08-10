CREATE INDEX `idx_audit_logs_created_at` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_employees_department_unit` ON `employees` (`department`,`unit`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_votes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`voter_employee_id` integer NOT NULL,
	`candidate_employee_id` integer NOT NULL,
	`receipt_code` text NOT NULL,
	`cast_at` text NOT NULL,
	FOREIGN KEY (`voter_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`candidate_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_votes`("id", "voter_employee_id", "candidate_employee_id", "receipt_code", "cast_at") SELECT "id", "voter_employee_id", "candidate_employee_id", "receipt_code", "cast_at" FROM `votes`;--> statement-breakpoint
DROP TABLE `votes`;--> statement-breakpoint
ALTER TABLE `__new_votes` RENAME TO `votes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `votes_voter_employee_id_unique` ON `votes` (`voter_employee_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `votes_receipt_code_unique` ON `votes` (`receipt_code`);--> statement-breakpoint
CREATE INDEX `idx_votes_candidate` ON `votes` (`candidate_employee_id`);