import { Router } from 'express';

import { authenticateSession } from '../middlewares/better-auth';
import { authenticateApiKey } from './middlewares/authenticate-api-key';
import { getLatestSyncTimeController, migrateSMSTransactionsController } from './trace.controller';

const router = Router({});

router.get('/', authenticateSession);
router.get('/latest-sync-time', authenticateApiKey, getLatestSyncTimeController);
router.post('/migrate-sms-transactions', authenticateApiKey, migrateSMSTransactionsController);

export default router;
