import { Controller, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { MessagePattern, Payload } from "@nestjs/microservices";
import type { Queue } from "bullmq";
import {
  BULL_QUEUES,
  CHANNEL_EVENTS,
  COMMANDS,
  ROUTING_KEYS,
  type BetSettledEvent,
  type GameSessionDto,
  type GameSlug,
  type MinesCashoutPayload,
  type MinesRevealPayload,
  type MinesStartPayload,
  type PlaceBetPayload,
  type RpcEnvelope,
  type RpcResult,
  type SessionEvent,
  type SessionIdPayload,
  type SettledBet,
  type StartSessionPayload,
  type TowersCashoutPayload,
  type TowersRevealPayload,
  type TowersStartPayload,
} from "@game/contracts";
import { EventsService } from "@game/events";
import { RealtimeService } from "@game/realtime";
import { PlayService } from "@game/wallet";
import { randomUUID } from "node:crypto";

@Controller()
export class EngineController {
  private readonly logger = new Logger(EngineController.name);

  constructor(
    private readonly play: PlayService,
    private readonly events: EventsService,
    private readonly realtime: RealtimeService,
    @InjectQueue(BULL_QUEUES.realtime) private readonly realtimeQueue: Queue,
    @InjectQueue(BULL_QUEUES.session) private readonly sessionQueue: Queue,
  ) {}

  @MessagePattern(COMMANDS.ping)
  ping() {
    return { ok: true, data: { service: "engine" } };
  }

  @MessagePattern(COMMANDS.startSession)
  async startSession(@Payload() envelope: RpcEnvelope<StartSessionPayload>) {
    const result = await this.play.startSession(envelope.userId, envelope.payload.gameSlug);
    if (result.ok) {
      await this.fanoutSession(envelope.userId, result.data, "started");
    }
    return result;
  }

  @MessagePattern(COMMANDS.endSession)
  async endSession(@Payload() envelope: RpcEnvelope<SessionIdPayload>) {
    const result = await this.play.endSession(envelope.userId, envelope.payload.sessionId);
    if (result.ok) {
      const event: SessionEvent = {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        userId: envelope.userId,
        sessionId: envelope.payload.sessionId,
        gameSlug: "",
      };
      await this.events.publish(ROUTING_KEYS.sessionEnded, event);
      await this.sessionQueue.add("ended", event);
    }
    return result;
  }

  @MessagePattern(COMMANDS.getSession)
  getSession(@Payload() envelope: RpcEnvelope<SessionIdPayload>) {
    return this.play.getSession(envelope.userId, envelope.payload.sessionId);
  }

  @MessagePattern(COMMANDS.placeBet)
  async placeBet(@Payload() envelope: RpcEnvelope<PlaceBetPayload>): Promise<RpcResult<SettledBet>> {
    const { sessionId, slug, stake, selection } = envelope.payload;
    const result = await this.play.placeBet(
      envelope.userId,
      sessionId,
      slug as GameSlug,
      stake,
      selection,
    );
    if (result.ok) {
      await this.fanoutBet(envelope.userId, result.data).catch((error) =>
        this.logger.error("Fan-out after bet failed", error as Error),
      );
    }
    return result;
  }

  @MessagePattern(COMMANDS.minesStart)
  async minesStart(@Payload() envelope: RpcEnvelope<MinesStartPayload>) {
    const result = await this.play.startMines(
      envelope.userId,
      envelope.payload.sessionId,
      envelope.payload.stake,
      envelope.payload.mineCount,
    );
    if (result.ok) {
      await this.events.publish(ROUTING_KEYS.minesStarted, {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        userId: envelope.userId,
        ...result.data,
      });
    }
    return result;
  }

  @MessagePattern(COMMANDS.minesReveal)
  async minesReveal(@Payload() envelope: RpcEnvelope<MinesRevealPayload>) {
    const result = await this.play.revealMines(
      envelope.userId,
      envelope.payload.sessionId,
      envelope.payload.reference,
      envelope.payload.tile,
    );
    if (result.ok) {
      await this.events.publish(ROUTING_KEYS.minesSettled, {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        userId: envelope.userId,
        ...result.data,
      });
      await this.realtimeQueue.add("mines", {
        userId: envelope.userId,
        sessionId: envelope.payload.sessionId,
        event: CHANNEL_EVENTS.minesUpdated,
        payload: result.data,
      });
    }
    return result;
  }

  @MessagePattern(COMMANDS.minesCashout)
  async minesCashout(@Payload() envelope: RpcEnvelope<MinesCashoutPayload>) {
    const result = await this.play.cashOutMines(
      envelope.userId,
      envelope.payload.sessionId,
      envelope.payload.reference,
    );
    if (result.ok) {
      await this.events.publish(ROUTING_KEYS.minesSettled, {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        userId: envelope.userId,
        ...result.data,
      });
      if (result.data.status === "cashed_out") {
        await this.fanoutBet(envelope.userId, {
          reference: result.data.reference,
          sessionId: envelope.payload.sessionId,
          gameSlug: "mines",
          won: true,
          stake: 0,
          multiplier: result.data.multiplier,
          payout: result.data.payout ?? 0,
          outcome: { minePositions: result.data.minePositions ?? [], revealed: result.data.revealed },
          serverSeedHash: "",
          clientSeed: "",
          nonce: 0,
          balance: result.data.balance ?? 0,
          settledAt: new Date().toISOString(),
        });
      }
    }
    return result;
  }

  @MessagePattern(COMMANDS.minesOpen)
  minesOpen(@Payload() envelope: RpcEnvelope<SessionIdPayload>) {
    return this.play.getOpenMines(envelope.userId, envelope.payload.sessionId);
  }

  @MessagePattern(COMMANDS.towersStart)
  async towersStart(@Payload() envelope: RpcEnvelope<TowersStartPayload>) {
    const result = await this.play.startTowers(
      envelope.userId,
      envelope.payload.sessionId,
      envelope.payload.stake,
      envelope.payload.difficulty,
    );
    if (result.ok) {
      await this.events.publish(ROUTING_KEYS.towersStarted, {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        userId: envelope.userId,
        ...result.data,
      });
    }
    return result;
  }

  @MessagePattern(COMMANDS.towersReveal)
  async towersReveal(@Payload() envelope: RpcEnvelope<TowersRevealPayload>) {
    const result = await this.play.revealTowers(
      envelope.userId,
      envelope.payload.sessionId,
      envelope.payload.reference,
      envelope.payload.tile,
    );
    if (result.ok) {
      await this.events.publish(ROUTING_KEYS.towersSettled, {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        userId: envelope.userId,
        ...result.data,
      });
      await this.realtimeQueue.add("towers", {
        userId: envelope.userId,
        sessionId: envelope.payload.sessionId,
        event: CHANNEL_EVENTS.towersUpdated,
        payload: result.data,
      });
    }
    return result;
  }

  @MessagePattern(COMMANDS.towersCashout)
  async towersCashout(@Payload() envelope: RpcEnvelope<TowersCashoutPayload>) {
    const result = await this.play.cashOutTowers(
      envelope.userId,
      envelope.payload.sessionId,
      envelope.payload.reference,
    );
    if (result.ok) {
      await this.events.publish(ROUTING_KEYS.towersSettled, {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        userId: envelope.userId,
        ...result.data,
      });
      if (result.data.status === "cashed_out") {
        await this.fanoutBet(envelope.userId, {
          reference: result.data.reference,
          sessionId: envelope.payload.sessionId,
          gameSlug: "towers",
          won: true,
          stake: 0,
          multiplier: result.data.multiplier,
          payout: result.data.payout ?? 0,
          outcome: { traps: result.data.traps ?? [], picks: result.data.picks },
          serverSeedHash: "",
          clientSeed: "",
          nonce: 0,
          balance: result.data.balance ?? 0,
          settledAt: new Date().toISOString(),
        });
      }
    }
    return result;
  }

  @MessagePattern(COMMANDS.towersOpen)
  towersOpen(@Payload() envelope: RpcEnvelope<SessionIdPayload>) {
    return this.play.getOpenTowers(envelope.userId, envelope.payload.sessionId);
  }

  private async fanoutBet(userId: string, bet: SettledBet) {
    const event: BetSettledEvent = {
      eventId: randomUUID(),
      occurredAt: bet.settledAt,
      userId,
      betReference: bet.reference,
      sessionId: bet.sessionId,
      gameSlug: bet.gameSlug,
      stake: bet.stake,
      multiplier: bet.multiplier,
      payout: bet.payout,
      won: bet.won,
      outcome: bet.outcome,
      wasControlled: false,
    };

    await this.realtime.publishToUser(userId, CHANNEL_EVENTS.betSettled, bet);
    if (bet.sessionId) {
      await this.realtime.publishToSession(
        bet.sessionId,
        CHANNEL_EVENTS.betSettled,
        bet,
      );
    }
    if (bet.won && bet.payout > 0) {
      await this.realtime.publishToLobby(CHANNEL_EVENTS.liveWin, {
        gameSlug: bet.gameSlug,
        payout: bet.payout,
        multiplier: bet.multiplier,
      });
    }

    await this.events.publish(ROUTING_KEYS.betSettled, event);
    await this.realtimeQueue.add("bet", {
      userId,
      sessionId: bet.sessionId,
      event: CHANNEL_EVENTS.betSettled,
      payload: bet,
    });
    await this.sessionQueue.add("history", {
      sessionId: bet.sessionId,
      item: {
        reference: bet.reference,
        won: bet.won,
        stake: bet.stake,
        multiplier: bet.multiplier,
        payout: bet.payout,
        status: bet.won ? "won" : "lost",
        outcome: bet.outcome,
        settledAt: bet.settledAt,
      },
    });
  }

  private async fanoutSession(
    userId: string,
    session: GameSessionDto,
    kind: "started" | "ended",
  ) {
    const event: SessionEvent = {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      userId,
      sessionId: session.id,
      gameSlug: session.gameSlug,
    };
    await this.events.publish(
      kind === "started" ? ROUTING_KEYS.sessionStarted : ROUTING_KEYS.sessionEnded,
      event,
    );
    await this.realtimeQueue.add(kind, {
      userId,
      sessionId: session.id,
      event: kind === "started" ? CHANNEL_EVENTS.sessionStarted : CHANNEL_EVENTS.sessionEnded,
      payload: session,
    });
  }
}
