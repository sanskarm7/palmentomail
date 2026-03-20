CREATE TABLE `emails` (
	`id` varchar(255) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`delivery_date` varchar(20),
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `emails_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `mail_pieces` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email_id` varchar(255) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`raw_sender_text` text,
	`img_hash` varchar(64),
	`llm_sender_name` text,
	`llm_confidence` int,
	`llm_mail_type` text,
	`llm_summary` text,
	`llm_is_important` tinyint unsigned,
	`llm_importance_reason` text,
	`llm_raw_json` text,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `mail_pieces_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
DROP TABLE `messages`;--> statement-breakpoint
ALTER TABLE `emails` ADD CONSTRAINT `emails_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `mail_pieces` ADD CONSTRAINT `mail_pieces_email_id_emails_id_fk` FOREIGN KEY (`email_id`) REFERENCES `emails`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `mail_pieces` ADD CONSTRAINT `mail_pieces_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;