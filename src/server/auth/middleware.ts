import type { NextFunction, Request, Response } from "express";
import { isOrganiser, parseDevToken, verifyMacToken, type MacUser } from "./jwt.ts";
import { isDevAuth } from "../env.ts";

// Attach the verified user to the request. Express doesn't know about our type,
// so we widen it locally rather than polluting a global namespace.
export interface AuthedRequest extends Request {
  user?: MacUser;
}

function extractBearer(req: Request): string | null {
  const header = req.header("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

/**
 * Require a valid mac-auth token. On success, `req.user` is populated. The JWT
 * signature is verified against JWKS on every request — we never trust claims
 * from the client without verification.
 */
export async function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = extractBearer(req);
  if (!token) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }

  // Local-dev bypass (never reachable in production — see isDevAuth).
  if (isDevAuth && token.startsWith("dev:")) {
    try {
      req.user = parseDevToken(token);
      next();
    } catch {
      res.status(401).json({ error: "Invalid dev token" });
    }
    return;
  }

  try {
    req.user = await verifyMacToken(token);
    next();
  } catch (err) {
    // Signature/expiry/issuer failure. Do not leak the reason to the client.
    console.warn("[auth] token verification failed:", (err as Error).message);
    res.status(401).json({ error: "Invalid token" });
  }
}

/**
 * Require organiser access. Role-gated SERVER-SIDE — a hidden UI button is not
 * access control. Stage 1 gates on the mac-auth `team` claim; the event-scoped
 * `organisers` table is a later, additive path and slots in here.
 *
 * Must be used after requireAuth.
 */
export function requireOrganiser(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (!isOrganiser(req.user)) {
    res.status(403).json({ error: "Organiser access required" });
    return;
  }
  next();
}
