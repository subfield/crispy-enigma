import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import { CacheService, REDIS_CLIENT } from "./cache.service";

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>("REDIS_URL", "redis://localhost:6380");
        return new Redis(url, {
          maxRetriesPerRequest: 3,
          // Let the app boot even if Redis is briefly unavailable.
          lazyConnect: false,
          retryStrategy: (times) => Math.min(times * 200, 3000),
        });
      },
    },
    CacheService,
  ],
  exports: [CacheService, REDIS_CLIENT],
})
export class CacheModule {}
