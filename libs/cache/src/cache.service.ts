import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import type Redis from "ioredis";

export const REDIS_CLIENT = Symbol("REDIS_CLIENT");

@Injectable()
export class CacheService implements OnApplicationShutdown {
  private readonly logger = new Logger(CacheService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  get client(): Redis {
    return this.redis;
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    if (!raw) return null;

    try {
      return JSON.parse(raw) as T;
    } catch {
      this.logger.warn(`Discarding unparseable cache value at ${key}`);
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const payload = JSON.stringify(value);
    if (ttlSeconds) {
      await this.redis.set(key, payload, "EX", ttlSeconds);
    } else {
      await this.redis.set(key, payload);
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length > 0) await this.redis.del(...keys);
  }

  /**
   * Best-effort lock, used to stop a player double-submitting a bet from two
   * tabs. Returns null when the lock is already held.
   */
  async acquireLock(key: string, ttlSeconds = 10): Promise<string | null> {
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = await this.redis.set(`lock:${key}`, token, "EX", ttlSeconds, "NX");
    return result === "OK" ? token : null;
  }

  /** Only releases the lock if this caller still owns it. */
  async releaseLock(key: string, token: string): Promise<void> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await this.redis.eval(script, 1, `lock:${key}`, token);
  }

  async isHealthy(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === "PONG";
    } catch {
      return false;
    }
  }

  async onApplicationShutdown() {
    await this.redis.quit().catch(() => undefined);
  }
}
