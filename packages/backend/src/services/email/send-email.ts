import { isTestEmail } from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import { DEMO_EMAIL_DOMAIN } from '@services/demo/demo-config';
import { resend } from '@services/email';

type SendEmailPayload = {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
};

type SendEmailResult = Awaited<ReturnType<NonNullable<typeof resend>['emails']['send']>> | null;

export async function sendEmail(payload: SendEmailPayload): Promise<SendEmailResult> {
  if (!resend) {
    logger.warn(`[Email] Skipped (RESEND_API_KEY not configured): "${payload.subject}" -> ${payload.to}`);
    return null;
  }
  if (isTestEmail(payload.to) || payload.to.endsWith(`@${DEMO_EMAIL_DOMAIN}`)) {
    logger.info(`[Email] Skipped (test recipient): "${payload.subject}" -> ${payload.to}`);
    return null;
  }
  return resend.emails.send(payload);
}
