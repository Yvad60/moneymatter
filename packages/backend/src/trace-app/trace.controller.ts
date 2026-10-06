import { z } from "zod";
import { createController } from "../controllers/helpers/controller-factory";

export const getLatestSync = createController(z.object({}), async ({}) => {});

export const migrateSMSTransactions = createController(
  z.object({
    body: z.object({
      smsTransactions: z.array(
        z.object({
          id: z.string().nullable(),
          address: z.string(),
          body: z.string(),
          timestamp: z.number(),
          subscriptionId: z.number().nullable(),
        }),
      ),
    }),
  }),
  async ({ body }) => {
    const {} = body;
  },
);
