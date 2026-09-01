import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { RealtimeModule } from "@game/realtime";
import { JwtGuard } from "./auth/jwt.guard";
import { PresenceGuard } from "./auth/presence.guard";
import { EngineClient } from "./engine.client";
import { GatewayController } from "./gateway.controller";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), RealtimeModule],
  controllers: [GatewayController],
  providers: [EngineClient, JwtGuard, PresenceGuard],
})
export class GatewayModule {}
