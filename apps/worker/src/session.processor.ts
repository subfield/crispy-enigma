import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { BULL_QUEUES, type SessionHistoryItem } from "@game/contracts";
import { CacheService } from "@game/cache";

interface HistoryJob {
  sessionId: string | null;
  item: SessionHistoryItem;
}

@Processor(BULL_QUEUES.session)
export class SessionProcessor extends WorkerHost {
  constructor(private readonly cache: CacheService) {
    super();
  }

  async process(job: Job<HistoryJob | { sessionId: string }>): Promise<void> {
    if (job.name === "ended") {
      const sessionId = (job.data as { sessionId: string }).sessionId;
      await this.cache.del(`session:${sessionId}:history`);
      return;
    }

    const { sessionId, item } = job.data as HistoryJob;
    if (!sessionId) return;

    const key = `session:${sessionId}:history`;
    const existing = (await this.cache.get<SessionHistoryItem[]>(key)) ?? [];
    await this.cache.set(key, [item, ...existing].slice(0, 50), 60 * 60 * 12);
  }
}
