import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import amqp, { type AmqpConnectionManager, type ChannelWrapper } from "amqp-connection-manager";
import type { ConfirmChannel } from "amqplib";
import { EXCHANGES, type RoutingKey } from "@game/contracts";

@Injectable()
export class EventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventsService.name);
  private connection: AmqpConnectionManager | null = null;
  private channel: ChannelWrapper | null = null;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const url = this.config.get<string>("RABBITMQ_URL", "amqp://guest:guest@localhost:5672");
    const exchange = this.config.get<string>("RABBITMQ_EXCHANGE", EXCHANGES.events);

    this.connection = amqp.connect([url]);
    this.channel = this.connection.createChannel({
      json: true,
      setup: async (ch: ConfirmChannel) => {
        await ch.assertExchange(exchange, "topic", { durable: true });
      },
    });

    this.connection.on("connect", () => this.logger.log("RabbitMQ events publisher connected"));
    this.connection.on("disconnect", (err) =>
      this.logger.warn(`RabbitMQ events publisher disconnected: ${err?.err?.message ?? "unknown"}`),
    );
  }

  /**
   * Fire-and-forget. Called after Postgres has committed. A drop here must
   * never fail a bet — the gateway already returned the authoritative result.
   */
  async publish(routingKey: RoutingKey, payload: unknown): Promise<void> {
    if (!this.channel) return;

    const exchange = this.config.get<string>("RABBITMQ_EXCHANGE", EXCHANGES.events);

    try {
      await this.channel.publish(exchange, routingKey, payload, {
        persistent: true,
        contentType: "application/json",
      });
    } catch (error) {
      this.logger.error(`Failed publishing ${routingKey}`, error as Error);
    }
  }

  async onModuleDestroy() {
    await this.channel?.close();
    await this.connection?.close();
  }
}
