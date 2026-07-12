import { Router } from "express";
import { isOrganiserTeam } from "../auth/jwt.ts";
import { requireAuth, type AuthedRequest } from "../auth/middleware.ts";

export const meRouter = Router();

// Who am I? The SPA calls this after sign-in to decide what to render. We only
// return claims we're happy to expose to the user about themselves.
meRouter.get("/me", requireAuth, (req: AuthedRequest, res) => {
  const user = req.user!;
  res.json({
    macUserId: user.macUserId,
    email: user.email,
    name: user.name,
    isMonash: user.isMonash,
    isOrganiser: isOrganiserTeam(user),
  });
});
