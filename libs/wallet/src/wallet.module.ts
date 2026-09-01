import { Global, Module } from "@nestjs/common";
import { PlayService } from "./play.service";
import { WalletService } from "./wallet.service";

@Global()
@Module({
  providers: [WalletService, PlayService],
  exports: [WalletService, PlayService],
})
export class WalletModule {}
