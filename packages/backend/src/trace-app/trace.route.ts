import { Router } from 'express';

import { authenticateSession } from '../middlewares/better-auth';
import { validateEndpoint } from '../middlewares/validations';
import { authenticateApiKey } from './middlewares/authenticate-api-key';
import { migrateSMSTransactionsController } from './trace.controller';

const router = Router({});

router.get('/', authenticateSession);
router.post(
  '/migrate-sms-transactions',
  authenticateApiKey,
  validateEndpoint(migrateSMSTransactionsController.schema),
  migrateSMSTransactionsController.handler,
);

export default router;
