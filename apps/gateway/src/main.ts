import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import { GatewayModule } from "./gateway.module";
import { EngineClient } from "./engine.client";

async function bootstrap() {
  const app = await NestFactory.create(GatewayModule);
  const config = app.get(ConfigService);
  const logger = new Logger("Gateway");

  app.use(helmet());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const corsEnv = config.get<string>("CORS_ORIGINS", "http://localhost:5642");
  const origin = corsEnv.split(",").map((value) => value.trim());
  app.enableCors({
    origin,
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
  });

  await app.get(EngineClient).connect();

  const port = Number(config.get("PORT") ?? 4100);
  await app.listen(port, "0.0.0.0");
  logger.log(`Gateway listening on http://localhost:${port}`);
}

bootstrap();
