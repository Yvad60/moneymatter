import { Router } from 'express';

import { authenticateSession } from '../middlewares/better-auth';
import { authenticateApiKey } from './middlewares/authenticate-api-key';
import { migrateSMSTransactionsController } from './trace.controller';

const router = Router({});

router.get('/', authenticateSession);
router.post('/migrate-sms-transactions', authenticateApiKey, migrateSMSTransactionsController);

export default router;
