import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { DepositWatchService } from "@game/wallet";

@Injectable()
export class DepositWatchRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DepositWatchRunner.name);

  constructor(private readonly watch: DepositWatchService) {}

  onModuleInit() {
    this.watch.start();
    this.logger.log("Deposit watcher started");
  }

  onModuleDestroy() {
    this.watch.stop();
  }
}
