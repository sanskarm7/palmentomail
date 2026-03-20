CREATE TABLE `messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`gmail_msg_id` varchar(255) NOT NULL,
	`delivery_date` varchar(20),
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
	CONSTRAINT `messages_id` PRIMARY KEY(`id`),
	CONSTRAINT `messages_gmail_msg_id_unique` UNIQUE(`gmail_msg_id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(255) NOT NULL,
	`email` varchar(255) NOT NULL,
	`name` varchar(255),
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `messages` ADD CONSTRAINT `messages_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;