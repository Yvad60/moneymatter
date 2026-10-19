import { logger } from '@js/utils/logger';
import { appName, buildEmailShell, escapeHtml, fromEmail } from '@services/email';
import { sendEmail } from '@services/email/send-email';

const buildPasswordResetHtml = ({ url }: { url: string }): string => {
  const safeUrl = escapeHtml(url);
  return buildEmailShell({
    innerHtml: `
          <tr><td style="padding: 28px 40px 0 40px;"><h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #1a1a1a; line-height: 1.3;">Reset your password</h1></td></tr>
          <tr><td style="padding: 16px 40px 36px 40px; font-size: 15px; color: #1a1a1a; line-height: 1.5;">
            <p style="margin: 0 0 12px 0;">We received a request to reset the password for your ${escapeHtml(appName)} account. Click the button below to choose a new one:</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 20px 0 0 0;"><tr><td style="background-color: #fff7ed; border: 1px solid #fdba74; border-radius: 8px; padding: 14px 16px; font-size: 14px; color: #7c2d12; line-height: 1.5;">
              <strong>Didn't request this?</strong> Don't click the link below. Ignore this email and your password stays the same. Nobody can change it without this link.
            </td></tr></table>
            <p style="margin: 24px 0;"><a href="${safeUrl}" style="background-color: #7c3aed; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600;">Reset password</a></p>
            <p style="margin: 0 0 12px 0; color: #666; font-size: 14px;">Or copy and paste this link:<br><a href="${safeUrl}" style="color: #7c3aed; word-break: break-all;">${safeUrl}</a></p>
            <p style="margin: 0; color: #666; font-size: 14px;">This link expires in 1 hour. Resetting your password signs you out of all devices.</p>
          </td></tr>`,
  });
};

export const sendPasswordResetEmail = async ({
  email,
  url,
  userId,
}: {
  email: string;
  url: string;
  userId: string;
}): Promise<void> => {
  try {
    const result = await sendEmail({
      from: `${appName} <${fromEmail}>`,
      to: email,
      subject: `Reset your ${appName} password`,
      html: buildPasswordResetHtml({ url }),
    });
    if (result?.error) {
      logger.error(`[PasswordResetEmail] Failed to send: ${result.error.name}: ${result.error.message}`, { userId });
      return;
    }
    if (result) logger.info(`[PasswordResetEmail] Sent to user ${userId}, resendId: ${result.data?.id}`);
  } catch (error) {
    logger.error({ message: '[PasswordResetEmail] Failed to send', error: error as Error }, { userId });
  }
};
