import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { CacheModule } from "@game/cache";
import { DbModule } from "@game/db";
import { QueuesModule } from "@game/events";
import { RealtimeModule } from "@game/realtime";
import { DepositWatchService } from "@game/wallet";
import { DepositWatchRunner } from "./deposit-watch.runner";
import { EventsController } from "./events.controller";
import { RealtimeProcessor } from "./realtime.processor";
import { SessionProcessor } from "./session.processor";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule,
    CacheModule,
    QueuesModule,
    RealtimeModule,
  ],
  controllers: [EventsController],
  providers: [
    RealtimeProcessor,
    SessionProcessor,
    DepositWatchService,
    DepositWatchRunner,
  ],
})
export class WorkerModule {}
