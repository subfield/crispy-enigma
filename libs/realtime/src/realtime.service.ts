import { Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as Ably from "ably";
import { channels, type ChannelEvent } from "@game/contracts";

@Injectable()
export class RealtimeService implements OnApplicationShutdown {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly rest: Ably.Rest | null;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>("ABLY_API_KEY");

    if (!apiKey) {
      this.logger.warn("ABLY_API_KEY is not set. Realtime publishing is disabled.");
      this.rest = null;
      return;
    }

    this.rest = new Ably.Rest({ key: apiKey });
  }

  get enabled(): boolean {
    return this.rest !== null;
  }

  /**
   * Issues a browser token scoped to just this user's channels.
   *
   * The API key never leaves the server, and the capability object is what
   * stops one player subscribing to another player's results.
   */
  async createTokenRequest(userId: string, sessionId?: string) {
    if (!this.rest) {
      throw new Error("Realtime is not configured. Set ABLY_API_KEY.");
    }

    const capability: { [key: string]: string[] } = {
      [channels.user(userId)]: ["subscribe", "presence"],
      [channels.lobby()]: ["subscribe"],
      [channels.session(sessionId ?? "*")]: ["subscribe"],
    };

    return this.rest.auth.createTokenRequest({
      clientId: userId,
      capability: capability as never,
      ttl: 60 * 60 * 1000,
    });
  }

  /**
   * Publishing is deliberately fire-and-forget. It happens after the database
   * transaction has committed, so a failure here must never surface as a
   * failed bet — the HTTP response already carries the authoritative result.
   */
  async publish(channel: string, event: ChannelEvent, payload: unknown): Promise<void> {
    if (!this.rest) return;

    try {
      await this.rest.channels.get(channel).publish(event, payload);
    } catch (error) {
      this.logger.error(`Failed publishing ${event} to ${channel}`, error as Error);
    }
  }

  async publishToUser(userId: string, event: ChannelEvent, payload: unknown) {
    await this.publish(channels.user(userId), event, payload);
  }

  async publishToSession(sessionId: string, event: ChannelEvent, payload: unknown) {
    await this.publish(channels.session(sessionId), event, payload);
  }

  async publishToLobby(event: ChannelEvent, payload: unknown) {
    await this.publish(channels.lobby(), event, payload);
  }

  /** True when a client with this id currently holds an Ably connection. */
  async isUserPresent(userId: string): Promise<boolean> {
    if (!this.rest) return false;

    try {
      const page = await this.rest.channels.get(channels.user(userId)).presence.get({ limit: 1 });
      return page.items.length > 0;
    } catch {
      return false;
    }
  }

  onApplicationShutdown() {
    // Ably Rest has no shutdown hook in this SDK version.
  }
}
