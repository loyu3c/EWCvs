CREATE TABLE `admin_credentials` (
	`id` integer PRIMARY KEY NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`iterations` integer NOT NULL,
	`session_version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
