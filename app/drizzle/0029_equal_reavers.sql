ALTER TABLE `expense` ADD `is_paid` number DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `transaction_match_rule` ADD `expense_id` text REFERENCES expense(id);--> statement-breakpoint
ALTER TABLE `transaction_match_rule` ADD `amount` integer;