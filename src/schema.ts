import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const dailyLogs = sqliteTable(
    "daily_logs",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        foodName: text("food_name").notNull(),
        grams: integer("grams").notNull(),
        kcal: integer("kcal").notNull(),
        createdAt: text("created_at").default(sql`(date("now"))`).notNull(),

    }
)