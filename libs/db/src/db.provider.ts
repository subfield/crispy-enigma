import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export const DRIZZLE = Symbol("DRIZZLE");

export type Database = PostgresJsDatabase<typeof schema>;

export function createDatabase(connectionString: string): {
  db: Database;
  client: postgres.Sql;
} {
  /*
   * Bets run inside transactions, so the pool needs room for concurrent
   * players. postgres-js defaults to 10; the gateway is the only writer.
   */
  const client = postgres(connectionString, { max: 20 });
  return { db: drizzle(client, { schema }), client };
}
