import { API_ERROR_CODES, API_RESPONSE_STATUS } from '@bt/shared/types';
import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Authenticates trace-app requests using a static API key sent by the mobile client,
 * instead of a browser session. Does not attach req.user — key-to-user resolution is
 * handled separately.
 */
export const authenticateApiKey = (req: Request, res: Response, next: NextFunction) => {
  // Read at request time (not module scope) to support test environment setup.
  const apiKey = process.env.TRACE_API_KEY;

  if (!apiKey) {
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

  return next();
};
