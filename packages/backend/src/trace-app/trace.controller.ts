import { z } from 'zod';

import { createController } from '../controllers/helpers/controller-factory';
import { migrateSmsTransactions } from './services/migrate-sms.service';

const rawSmsMessageSchema = z.object({
  id: z.string().nullable(),
  address: z.string(),
  body: z.string(),
  timestamp: z.number(),
});

export const migrateSMSTransactionsController = createController(
  z.object({
    body: z.object({
      mtnMomo: z.array(rawSmsMessageSchema),
      bk: z.array(rawSmsMessageSchema),
    }),
  }),
  async ({ body, user }) => {
    if (!user) {
      throw new Error('migrateSMSTransactionsController requires an authenticated user');
    }
    const result = await migrateSmsTransactions({ userId: user.id, ...body });
    return {
      data: result,
    };
  },
);
