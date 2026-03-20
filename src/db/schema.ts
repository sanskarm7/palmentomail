import {
  mysqlTable,
  varchar,
  text,
  int,
  tinyint,
  timestamp,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: varchar("id", { length: 255 }).primaryKey(), // Google sub
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const emails = mysqlTable("emails", {
  id: varchar("id", { length: 255 }).primaryKey(), // Google sub
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id),
  deliveryDate: varchar("delivery_date", { length: 20 }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const mailPieces = mysqlTable("mail_pieces", {
  id: int("id").primaryKey().autoincrement(),
  emailId: varchar("email_id", { length: 255 })
    .notNull()
    .references(() => emails.id),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id),
  rawSenderText: text("raw_sender_text"),
  imgHash: varchar("img_hash", { length: 64 }),
  // LLM fields — populated at ingest time by Gemini (or future local LLM)
  llmSenderName: text("llm_sender_name"),
  llmRecipientName: text("llm_recipient_name"),
  llmConfidence: int("llm_confidence"), // 0–100 (represents 0.00–1.00 confidence)
  llmMailType: text("llm_mail_type"),
  llmSummary: text("llm_summary"),
  llmIsImportant: tinyint("llm_is_important", { unsigned: true }),
  llmImportanceReason: text("llm_importance_reason"),
  llmRawJson: text("llm_raw_json"),
  createdAt: timestamp("created_at").defaultNow(),
});
