import { API_ERROR_CODES, API_RESPONSE_STATUS } from '@bt/shared/types';
import { setSentryUser } from '@js/utils/sentry';
import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';

import { findAppUser } from '../../middlewares/better-auth';

/**
 * Authenticates trace-app requests using a static API key sent by the mobile client,
 * instead of a browser session, and resolves it to the single app user the key
 * acts as (TRACE_USER_ID) so downstream handlers see req.user like any
 * session-authenticated route.
 */
export const authenticateApiKey = async (req: Request, res: Response, next: NextFunction) => {
  // Read at request time (not module scope) to support test environment setup.
  const apiKey = process.env.TRACE_API_KEY;
  const userId = process.env.TRACE_USER_ID;

  if (!apiKey || !userId) {
    return res.status(401).json({
      status: API_RESPONSE_STATUS.error,
      response: {
        message: 'API key authentication is not configured.',
        code: API_ERROR_CODES.unauthorized,
      },
    });
  }

  const providedKey = req.headers['x-api-key'];

  if (!providedKey || typeof providedKey !== 'string') {
    return res.status(401).json({
      status: API_RESPONSE_STATUS.error,
      response: {
        message: 'Unauthorized',
        code: API_ERROR_CODES.unauthorized,
      },
    });
  }

  const providedBuffer = Buffer.from(providedKey);
  const expectedBuffer = Buffer.from(apiKey);

  // Buffers must have the same length for timingSafeEqual.
  const isValid =
    providedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(providedBuffer, expectedBuffer);

  if (!isValid) {
    return res.status(401).json({
      status: API_RESPONSE_STATUS.error,
      response: {
        message: 'Unauthorized',
        code: API_ERROR_CODES.unauthorized,
      },
    });
  }

  const user = await findAppUser({ where: { id: Number(userId) } });

  if (!user) {
    return res.status(401).json({
      status: API_RESPONSE_STATUS.error,
      response: {
        message: 'User not found',
        code: API_ERROR_CODES.unauthorized,
      },
    });
  }

  req.user = user;
  setSentryUser({ userId: user.id, username: user.username });

  return next();
};
