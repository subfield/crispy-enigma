import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Transport } from "@nestjs/microservices";
import { config as loadEnv } from "dotenv";
import { QUEUES } from "@game/contracts";
import { EngineModule } from "./engine.module";

loadEnv();

async function bootstrap() {
  const logger = new Logger("Engine");
  const url = process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672";

  const app = await NestFactory.createMicroservice(EngineModule, {
    transport: Transport.RMQ,
    options: {
      urls: [url],
      queue: QUEUES.engineRpc,
      queueOptions: { durable: true },
      prefetchCount: 16,
      noAck: true,
    },
  });

  await app.listen();
  logger.log(`Engine RPC listening on ${QUEUES.engineRpc}`);
}

bootstrap().catch((error) => {
  console.error("Engine failed to start", error);
  process.exit(1);
});
