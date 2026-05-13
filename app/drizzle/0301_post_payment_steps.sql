CREATE TABLE `post_payment_step` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`client_id` text NOT NULL,
	`inquiry_id` text NOT NULL,
	`stripe_session_id` text NOT NULL,
	`step` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`completed_at` text,
	`payload` text,
	`created_at` text DEFAULT current_timestamp NOT NULL,
	`updated_at` text DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`),
	FOREIGN KEY (`client_id`) REFERENCES `client`(`id`),
	FOREIGN KEY (`inquiry_id`) REFERENCES `hosting_inquiry`(`id`)
);
--> statement-breakpoint
CREATE INDEX `post_payment_step_session_idx` ON `post_payment_step` (`stripe_session_id`);
--> statement-breakpoint
CREATE INDEX `post_payment_step_status_idx` ON `post_payment_step` (`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `post_payment_step_uniq` ON `post_payment_step` (`stripe_session_id`, `step`);
--> statement-breakpoint
ALTER TABLE `hosting_account` ADD `stripe_subscription_id` text;
--> statement-breakpoint
CREATE INDEX `hosting_account_stripe_sub_idx` ON `hosting_account` (`stripe_subscription_id`);
