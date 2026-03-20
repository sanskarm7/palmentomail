import {
  pgTable,
  varchar,
  text,
  integer,
  serial,
  smallint,
  timestamp,
  boolean,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: varchar("id", { length: 255 }).primaryKey(), // Google sub
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const emails = pgTable("emails", {
  id: varchar("id", { length: 255 }).primaryKey(), // Google sub
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  deliveryDate: varchar("delivery_date", { length: 20 }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const mailPieces = pgTable("mail_pieces", {
  id: serial("id").primaryKey(),
  emailId: varchar("email_id", { length: 255 })
    .notNull()
    .references(() => emails.id, { onDelete: 'cascade' }),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  rawSenderText: text("raw_sender_text"),
  imgHash: varchar("img_hash", { length: 64 }),
  imgStoragePath: text("img_storage_path"),
  // LLM fields
  llmSenderName: text("llm_sender_name"),
  llmRecipientName: text("llm_recipient_name"),
  llmConfidence: integer("llm_confidence"), // 0–100
  llmMailType: text("llm_mail_type"),
  llmSummary: text("llm_summary"),
  llmIsImportant: smallint("llm_is_important"),
  llmImportanceReason: text("llm_importance_reason"),
  llmRawJson: text("llm_raw_json"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const appConfig = pgTable("app_config", {
  id: varchar("id", { length: 255 }).primaryKey(), // e.g. 'google_refresh_token'
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const accessCodes = pgTable("access_codes", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});
