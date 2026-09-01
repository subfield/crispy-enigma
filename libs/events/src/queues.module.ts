import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BullModule } from "@nestjs/bullmq";
import { BULL_QUEUES } from "@game/contracts";

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get<string>("REDIS_URL", "redis://localhost:6380"),
        },
      }),
    }),
    BullModule.registerQueue({ name: BULL_QUEUES.realtime }, { name: BULL_QUEUES.session }),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
