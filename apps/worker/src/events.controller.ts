import { Controller } from "@nestjs/common";
import { EventPattern, Payload } from "@nestjs/microservices";
import { CHANNEL_EVENTS, ROUTING_KEYS, type BetSettledEvent } from "@game/contracts";
import { RealtimeService } from "@game/realtime";

/**
 * Second path for the same facts the engine already queued on BullMQ.
 *
 * Other Oraixo services can bind to `smink.events` without talking HTTP to
 * the gateway. This worker is the Smink-side consumer of that bus.
 */
@Controller()
export class EventsController {
  constructor(private readonly realtime: RealtimeService) {}

  @EventPattern(ROUTING_KEYS.betSettled)
  async onBetSettled(@Payload() event: BetSettledEvent) {
    if (!event.won || event.payout <= 0) return;
    await this.realtime.publishToLobby(CHANNEL_EVENTS.liveWin, {
      gameSlug: event.gameSlug,
      payout: event.payout,
      multiplier: event.multiplier,
      userId: event.userId,
    });
  }
}
