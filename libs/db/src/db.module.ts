import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type postgres from "postgres";
import { createDatabase, type Database, DRIZZLE } from "./db.provider";

const PG_CONNECTION = Symbol("PG_CONNECTION");

interface Connection {
  db: Database;
  client: postgres.Sql;
}

function resolveConnectionString(config: ConfigService): string {
  const mode = config.get<string>("CONNECTION_MODE", "local");
  const url =
    mode === "local"
      ? config.get<string>("DATABASE_URL_LOCAL")
      : config.get<string>("DATABASE_URL_NEON");

  if (!url) {
    throw new Error(
      `No database URL for CONNECTION_MODE=${mode}. Set DATABASE_URL_LOCAL or DATABASE_URL_NEON.`,
    );
  }

  return url;
}

@Global()
@Module({
  providers: [
    {
      provide: PG_CONNECTION,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Connection =>
        createDatabase(resolveConnectionString(config)),
    },
    {
      provide: DRIZZLE,
      inject: [PG_CONNECTION],
      useFactory: (connection: Connection) => connection.db,
    },
  ],
  exports: [DRIZZLE],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(PG_CONNECTION) private readonly connection: Connection) {}

  async onApplicationShutdown() {
    await this.connection.client.end({ timeout: 5 });
  }
}
