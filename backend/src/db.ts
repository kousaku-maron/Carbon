import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as authSchema from "../db/schema/auth";
import * as appSchema from "../db/schema/app";
import * as shareSchema from "../db/schema/share";

function normalizeDatabaseUrl(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    // neon-http on Workers does not need channel binding; drop it for compatibility.
    url.searchParams.delete("channel_binding");
    return url.toString();
  } catch {
    return databaseUrl;
  }
}

export function createDb(databaseUrl: string) {
  const sql = neon(normalizeDatabaseUrl(databaseUrl));
  return drizzle(sql, {
    schema: {
      ...authSchema,
      ...appSchema,
      ...shareSchema,
    },
  });
}

export type Database = ReturnType<typeof createDb>;
