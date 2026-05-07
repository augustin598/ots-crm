CREATE TABLE `access_capability` (
	`id` text PRIMARY KEY NOT NULL,
	`domain` text NOT NULL,
	`group_label` text NOT NULL,
	`label` text NOT NULL,
	`description` text,
	`unsafe_unless_role` text,
	`created_at` timestamp DEFAULT current_date NOT NULL
);
