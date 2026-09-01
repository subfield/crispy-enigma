import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { RealtimeService } from "@game/realtime";
import type { AuthUser } from "./auth.types";

/**
 * Refuses play unless this user currently holds an Ably connection.
 *
 * The browser enters presence on `smink:user:{id}` after connecting. If that
 * entry is missing, the player is offline as far as the engine is concerned.
 */
@Injectable()
export class PresenceGuard implements CanActivate {
  constructor(private readonly realtime: RealtimeService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.realtime.enabled) {
      throw new ServiceUnavailableException(
        "Play is paused until realtime is connected. Check the status in the header.",
      );
    }

    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const userId = request.user?.userId;
    if (!userId) return false;

    const present = await this.realtime.isUserPresent(userId);
    if (present) return true;

    // Presence from a just-opened connection can lag the REST read by a beat.
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (await this.realtime.isUserPresent(userId)) return true;

    throw new ServiceUnavailableException(
      "You are not connected. Wait for the live indicator before playing.",
    );
  }
}
