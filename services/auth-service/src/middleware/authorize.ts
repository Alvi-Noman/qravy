import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { computeCapabilities, satisfies, type SessionType } from '@qravy/shared/utils/policy';

type MutableUser = {
  id: string;
  email: string;
  tenantId?: string;
  role?: 'owner' | 'admin' | 'editor' | 'viewer';
  locationId?: string;
  sessionType?: SessionType;
  viewAs?: SessionType;
  capabilities?: string[];
};

export function authorize(required: string | string[], options?: { any?: boolean }): RequestHandler {
  const mode = options?.any ? 'any' : 'all';
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user as MutableUser | undefined;
    if (!user || !user.id) {
      return (res as any).fail ? (res as any).fail(401, 'Unauthorized') : res.status(401).json({ message: 'Unauthorized' });
    }

    if (!user.capabilities) {
      const sessionType: SessionType = user.sessionType ?? (user.role ? 'member' : 'branch');
      user.capabilities = computeCapabilities({
        role: user.role,
        sessionType,
        viewAs: user.viewAs,
      });
    }

    if (!satisfies(user.capabilities, required, mode)) {
      return (res as any).fail ? (res as any).fail(403, 'Forbidden') : res.status(403).json({ message: 'Forbidden' });
    }

    next();
  };
}

export default authorize;