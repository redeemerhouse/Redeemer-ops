import { Router, type IRouter } from "express";
import { GetSessionResponse } from "@workspace/api-zod";
import { authenticate, getPrincipal } from "../middlewares/auth";

const router: IRouter = Router();

/**
 * Returns only the non-sensitive identity needed to render the shell. The
 * session credential remains an HttpOnly cookie; it is never returned to JS.
 */
router.get("/auth/session", authenticate, (_req, res) => {
  res.setHeader("Cache-Control", "no-store, private");
  const principal = getPrincipal(res);
  const session = GetSessionResponse.parse({
    authenticated: true,
    user: {
      id: principal.sub,
      role: principal.role,
      organizationId: principal.organizationId,
      houseNames: principal.houseNames,
      residentId: principal.residentId,
    },
    expiresAt: new Date((principal.sessionExpiresAt ?? principal.exp) * 1000).toISOString(),
  });
  res.json(session);
});

export default router;