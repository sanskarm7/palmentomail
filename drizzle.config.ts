import { defineConfig } from "drizzle-kit";
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  tablesFilter: ["users", "emails", "mail_pieces", "app_config", "access_codes"],
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
