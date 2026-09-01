import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { Transport } from "@nestjs/microservices";
import { EXCHANGES, QUEUES } from "@game/contracts";
import { WorkerModule } from "./worker.module";

async function bootstrap() {
  const app = await NestFactory.create(WorkerModule);
  const config = app.get(ConfigService);
  const logger = new Logger("Worker");

  app.connectMicroservice({
    transport: Transport.RMQ,
    options: {
      urls: [config.get<string>("RABBITMQ_URL", "amqp://guest:guest@localhost:5672")],
      queue: QUEUES.workerEvents,
      queueOptions: { durable: true },
      exchange: config.get<string>("RABBITMQ_EXCHANGE", EXCHANGES.events),
      exchangeType: "topic",
      routingKey: "bet.settled",
      wildcards: true,
      prefetchCount: 32,
      noAck: true,
    },
  });

  await app.startAllMicroservices();
  logger.log(`Worker consuming ${QUEUES.workerEvents} and BullMQ queues`);
}

bootstrap();
