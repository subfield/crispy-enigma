import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { jwtVerify } from "jose";
import type { AuthUser } from "./auth.types";

const COOKIE_LOCAL = "smink_localhost_session";
const COOKIE_PROD = "smink_session";

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  const parts = header.split(";");
  for (const part of parts) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: AuthUser;
    }>();

    const bearer = request.headers.authorization;
    const tokenFromHeader =
      bearer?.startsWith("Bearer ") ? bearer.slice("Bearer ".length) : undefined;
    const tokenFromCookie =
      readCookie(request.headers.cookie, COOKIE_LOCAL) ??
      readCookie(request.headers.cookie, COOKIE_PROD);

    const token = tokenFromHeader ?? tokenFromCookie;
    if (!token) throw new UnauthorizedException("Sign in to play");

    const secret = this.config.get<string>("JWT_SECRET");
    if (!secret) throw new UnauthorizedException("Server is missing JWT_SECRET");

    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
        algorithms: ["HS256"],
      });

      if (typeof payload.userId !== "string" || typeof payload.email !== "string") {
        throw new UnauthorizedException("Invalid session");
      }

      request.user = {
        userId: payload.userId,
        email: payload.email,
        username: String(payload.username ?? ""),
      };
      return true;
    } catch {
      throw new UnauthorizedException("Session expired. Sign in again.");
    }
  }
}
