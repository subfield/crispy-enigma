import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ClientProxy, ClientProxyFactory, Transport } from "@nestjs/microservices";
import { firstValueFrom, timeout } from "rxjs";
import { COMMANDS, QUEUES, type Command, type RpcEnvelope, type RpcResult } from "@game/contracts";

@Injectable()
export class EngineClient {
  private readonly logger = new Logger(EngineClient.name);
  private readonly client: ClientProxy;

  constructor(config: ConfigService) {
    this.client = ClientProxyFactory.create({
      transport: Transport.RMQ,
      options: {
        urls: [config.get<string>("RABBITMQ_URL", "amqp://guest:guest@localhost:5672")],
        queue: QUEUES.engineRpc,
        queueOptions: { durable: true },
      },
    });
  }

  async send<TPayload, TResult>(
    command: Command,
    userId: string,
    payload: TPayload,
  ): Promise<RpcResult<TResult>> {
    const envelope: RpcEnvelope<TPayload> = { userId, payload };
    try {
      return await firstValueFrom(
        this.client
          .send<RpcResult<TResult>, RpcEnvelope<TPayload>>(command, envelope)
          .pipe(timeout(8_000)),
      );
    } catch (error) {
      this.logger.error(
        `Engine RPC ${command} failed`,
        error instanceof Error ? error.stack : String(error),
      );
      return {
        ok: false,
        error: "Play is paused right now. Try again in a moment.",
        code: "UNAVAILABLE",
      };
    }
  }

  async ping(): Promise<boolean> {
    try {
      const result = await firstValueFrom(
        this.client
          .send<RpcResult<{ service: string }>, RpcEnvelope<Record<string, never>>>(
            COMMANDS.ping,
            { userId: "health", payload: {} },
          )
          .pipe(timeout(2_000)),
      );
      return result.ok === true;
    } catch {
      return false;
    }
  }

  async connect() {
    await this.client.connect();
  }
}
