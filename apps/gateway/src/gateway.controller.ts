import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Min } from "class-validator";
import type { GameSlug, TowersDifficulty } from "@game/contracts";
import { COMMANDS } from "@game/contracts";
import { RealtimeService } from "@game/realtime";
import { CurrentUser } from "./auth/current-user.decorator";
import { JwtGuard } from "./auth/jwt.guard";
import { PresenceGuard } from "./auth/presence.guard";
import type { AuthUser } from "./auth/auth.types";
import { EngineClient } from "./engine.client";

class TokenBody {
  @IsOptional()
  @IsString()
  sessionId?: string;
}

class StartSessionBody {
  @IsString()
  gameSlug!: string;
}

class PlaceBetBody {
  @IsString()
  sessionId!: string;

  @IsString()
  slug!: GameSlug;

  @IsNumber()
  @Min(0.01)
  stake!: number;

  @IsObject()
  selection!: Record<string, unknown>;
}

class MinesStartBody {
  @IsString()
  sessionId!: string;

  @IsNumber()
  @Min(0.01)
  stake!: number;

  @IsInt()
  @Min(1)
  mineCount!: number;
}

class MinesRevealBody {
  @IsString()
  sessionId!: string;

  @IsString()
  reference!: string;

  @IsInt()
  @Min(0)
  tile!: number;
}

class MinesCashoutBody {
  @IsString()
  sessionId!: string;

  @IsString()
  reference!: string;
}

class TowersStartBody {
  @IsString()
  sessionId!: string;

  @IsNumber()
  @Min(0.01)
  stake!: number;

  @IsIn(["easy", "medium", "hard", "expert"])
  difficulty!: TowersDifficulty;
}

class TowersRevealBody {
  @IsString()
  sessionId!: string;

  @IsString()
  reference!: string;

  @IsInt()
  @Min(0)
  tile!: number;
}

class TowersCashoutBody {
  @IsString()
  sessionId!: string;

  @IsString()
  reference!: string;
}

@Controller("v1")
export class GatewayController {
  constructor(
    private readonly engine: EngineClient,
    private readonly realtime: RealtimeService,
  ) {}

  @Get("health")
  async health() {
    const engine = await this.engine.ping();
    return {
      ok: true,
      engine,
      realtime: this.realtime.enabled,
      service: "smink-gateway",
    };
  }

  @Post("realtime/token")
  @UseGuards(JwtGuard)
  async token(@CurrentUser() user: AuthUser, @Body() body: TokenBody) {
    return this.realtime.createTokenRequest(user.userId, body.sessionId);
  }

  @Post("sessions")
  @UseGuards(JwtGuard, PresenceGuard)
  startSession(@CurrentUser() user: AuthUser, @Body() body: StartSessionBody) {
    return this.engine.send(COMMANDS.startSession, user.userId, { gameSlug: body.gameSlug });
  }

  @Post("sessions/:id/end")
  @UseGuards(JwtGuard)
  endSession(@CurrentUser() user: AuthUser, @Param("id") sessionId: string) {
    return this.engine.send(COMMANDS.endSession, user.userId, { sessionId });
  }

  @Get("sessions/:id")
  @UseGuards(JwtGuard)
  getSession(@CurrentUser() user: AuthUser, @Param("id") sessionId: string) {
    return this.engine.send(COMMANDS.getSession, user.userId, { sessionId });
  }

  @Post("play")
  @UseGuards(JwtGuard, PresenceGuard)
  play(@CurrentUser() user: AuthUser, @Body() body: PlaceBetBody) {
    return this.engine.send(COMMANDS.placeBet, user.userId, body);
  }

  @Post("mines/start")
  @UseGuards(JwtGuard, PresenceGuard)
  minesStart(@CurrentUser() user: AuthUser, @Body() body: MinesStartBody) {
    return this.engine.send(COMMANDS.minesStart, user.userId, body);
  }

  @Post("mines/reveal")
  @UseGuards(JwtGuard, PresenceGuard)
  minesReveal(@CurrentUser() user: AuthUser, @Body() body: MinesRevealBody) {
    return this.engine.send(COMMANDS.minesReveal, user.userId, body);
  }

  @Post("mines/cashout")
  @UseGuards(JwtGuard, PresenceGuard)
  minesCashout(@CurrentUser() user: AuthUser, @Body() body: MinesCashoutBody) {
    return this.engine.send(COMMANDS.minesCashout, user.userId, body);
  }

  @Get("mines/open/:sessionId")
  @UseGuards(JwtGuard)
  minesOpen(@CurrentUser() user: AuthUser, @Param("sessionId") sessionId: string) {
    return this.engine.send(COMMANDS.minesOpen, user.userId, { sessionId });
  }

  @Post("towers/start")
  @UseGuards(JwtGuard, PresenceGuard)
  towersStart(@CurrentUser() user: AuthUser, @Body() body: TowersStartBody) {
    return this.engine.send(COMMANDS.towersStart, user.userId, body);
  }

  @Post("towers/reveal")
  @UseGuards(JwtGuard, PresenceGuard)
  towersReveal(@CurrentUser() user: AuthUser, @Body() body: TowersRevealBody) {
    return this.engine.send(COMMANDS.towersReveal, user.userId, body);
  }

  @Post("towers/cashout")
  @UseGuards(JwtGuard, PresenceGuard)
  towersCashout(@CurrentUser() user: AuthUser, @Body() body: TowersCashoutBody) {
    return this.engine.send(COMMANDS.towersCashout, user.userId, body);
  }

  @Get("towers/open/:sessionId")
  @UseGuards(JwtGuard)
  towersOpen(@CurrentUser() user: AuthUser, @Param("sessionId") sessionId: string) {
    return this.engine.send(COMMANDS.towersOpen, user.userId, { sessionId });
  }
}
