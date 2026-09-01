import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { CacheModule } from "@game/cache";
import { DbModule } from "@game/db";
import { EventsModule, QueuesModule } from "@game/events";
import { RealtimeModule } from "@game/realtime";
import { WalletModule } from "@game/wallet";
import { EngineController } from "./engine.controller";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule,
    CacheModule,
    EventsModule,
    QueuesModule,
    RealtimeModule,
    WalletModule,
  ],
  controllers: [EngineController],
})
export class EngineModule {}
