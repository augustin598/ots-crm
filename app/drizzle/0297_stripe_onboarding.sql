-- Client: auto-onboarding + Stripe customer cache
ALTER TABLE `client` ADD `legal_type` text;
ALTER TABLE `client` ADD `signup_source` text;
ALTER TABLE `client` ADD `onboarding_status` text DEFAULT 'active' NOT NULL;
ALTER TABLE `client` ADD `stripe_customer_id` text;

-- HostingProduct: lazy-created Stripe Price/Product IDs
ALTER TABLE `hosting_product` ADD `stripe_price_id` text;
ALTER TABLE `hosting_product` ADD `stripe_product_id` text;

-- Invoice: Stripe identifiers for reconciliation
ALTER TABLE `invoice` ADD `stripe_payment_intent_id` text;
ALTER TABLE `invoice` ADD `stripe_session_id` text;
ALTER TABLE `invoice` ADD `stripe_subscription_id` text;

-- HostingInquiry: link la Checkout Session + client conversion
ALTER TABLE `hosting_inquiry` ADD `stripe_checkout_session_id` text;
ALTER TABLE `hosting_inquiry` ADD `client_created` integer DEFAULT 0 NOT NULL;
ALTER TABLE `hosting_inquiry` ADD `client_created_at` text;
ALTER TABLE `hosting_inquiry` ADD `proforma_invoice_id` text;

-- Webhook idempotency log
CREATE TABLE `processed_stripe_event` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`tenant_id` text,
	`processed_at` text DEFAULT (current_date) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`)
);
CREATE INDEX `processed_stripe_event_processed_at_idx` ON `processed_stripe_event` (`processed_at`);
CREATE INDEX `processed_stripe_event_type_idx` ON `processed_stripe_event` (`event_type`);
