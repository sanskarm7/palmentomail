CREATE TABLE "emails" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"delivery_date" varchar(20),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "mail_pieces" (
	"id" serial PRIMARY KEY NOT NULL,
	"email_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"raw_sender_text" text,
	"img_hash" varchar(64),
	"img_storage_path" text,
	"llm_sender_name" text,
	"llm_recipient_name" text,
	"llm_confidence" integer,
	"llm_mail_type" text,
	"llm_summary" text,
	"llm_is_important" smallint,
	"llm_importance_reason" text,
	"llm_raw_json" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_pieces" ADD CONSTRAINT "mail_pieces_email_id_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_pieces" ADD CONSTRAINT "mail_pieces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;