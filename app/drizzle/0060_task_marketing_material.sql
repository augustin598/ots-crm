CREATE TABLE `task_marketing_material` (
    `id` text PRIMARY KEY NOT NULL,
    `tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
    `task_id` text NOT NULL REFERENCES `task`(`id`) ON DELETE CASCADE,
    `marketing_material_id` text NOT NULL REFERENCES `marketing_material`(`id`) ON DELETE CASCADE,
    `added_by_user_id` text NOT NULL REFERENCES `user`(`id`),
    `created_at` timestamp NOT NULL DEFAULT current_timestamp
);

CREATE UNIQUE INDEX `task_marketing_material_task_material_idx` ON `task_marketing_material` (`task_id`, `marketing_material_id`);
CREATE INDEX `task_marketing_material_material_idx` ON `task_marketing_material` (`marketing_material_id`);
