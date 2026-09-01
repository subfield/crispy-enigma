import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { BULL_QUEUES, CHANNEL_EVENTS, type ChannelEvent } from "@game/contracts";
import { RealtimeService } from "@game/realtime";

interface RealtimeJob {
  userId: string;
  sessionId?: string | null;
  event: ChannelEvent;
  payload: unknown;
}

@Processor(BULL_QUEUES.realtime)
export class RealtimeProcessor extends WorkerHost {
  private readonly logger = new Logger(RealtimeProcessor.name);

  constructor(private readonly realtime: RealtimeService) {
    super();
  }

  async process(job: Job<RealtimeJob>): Promise<void> {
    const { userId, sessionId, event, payload } = job.data;

    await this.realtime.publishToUser(userId, event, payload);

    if (sessionId) {
      await this.realtime.publishToSession(sessionId, event, payload);
    }

    if (event === CHANNEL_EVENTS.betSettled) {
      const bet = payload as { won?: boolean; payout?: number; gameSlug?: string; multiplier?: number };
      if (bet.won && (bet.payout ?? 0) > 0) {
        await this.realtime.publishToLobby(CHANNEL_EVENTS.liveWin, {
          gameSlug: bet.gameSlug,
          payout: bet.payout,
          multiplier: bet.multiplier,
        });
      }
    }

    this.logger.debug(`Published ${event} for ${userId}`);
  }
}
