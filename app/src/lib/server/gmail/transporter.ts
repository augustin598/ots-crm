import nodemailer from 'nodemailer';
import { google } from 'googleapis';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { getAuthenticatedClient, hasGmailSendScope } from './auth';
import { logInfo, logWarning, logError, serializeError } from '$lib/server/logger';

/**
 * Create a nodemailer-compatible transporter that sends via Gmail API.
 * Uses gmail.users.messages.send instead of SMTP — works reliably with
 * Google Workspace accounts where SMTP OAuth2 may be restricted.
 */
export async function createGmailTransporter(
  tenantId: string
): Promise<{ transporter: nodemailer.Transporter; gmailEmail: string } | null> {
  // 1. Load integration
  const [integration] = await db
    .select()
    .from(table.gmailIntegration)
    .where(and(
      eq(table.gmailIntegration.tenantId, tenantId),
      eq(table.gmailIntegration.isActive, true)
    ))
    .limit(1);

  if (!integration) {
    logInfo('gmail', 'No active Gmail integration for sending', { tenantId });
    return null;
  }

  // 2. Check send scope
  if (!hasGmailSendScope(integration.grantedScopes)) {
    logWarning('gmail', 'Gmail integration lacks gmail.send scope — user must re-authorize', { tenantId });
    return null;
  }

  // 3. Refresh token via getAuthenticatedClient (handles expiry, deactivation)
  const oauth2Client = await getAuthenticatedClient(tenantId);
  if (!oauth2Client) {
    logWarning('gmail', 'Gmail OAuth client unavailable (token revoked?)', { tenantId });
    return null;
  }

  // 4. Create Gmail API-backed transporter
  // Nodemailer compiles the email to RFC 5322 raw format, then we send via Gmail API.
  // This bypasses SMTP entirely — no 535 auth issues with Google Workspace.
  try {
    const gmailApi = google.gmail({ version: 'v1', auth: oauth2Client });

    const transporter = nodemailer.createTransport({
      streamTransport: true,
      newline: 'unix',
      buffer: true
    });

    // Wrap sendMail to route through Gmail API
    const originalSendMail = transporter.sendMail.bind(transporter);
    (transporter as any).sendMail = async (mailOptions: nodemailer.SendMailOptions) => {
      // 1. Compile email to raw RFC 5322 using nodemailer
      const info = await originalSendMail(mailOptions);
      const rawMessage = info.message as Buffer;

      // 2. Encode to base64url (RFC 4648 §5) as required by Gmail API
      const encodedMessage = rawMessage.toString('base64url');

      const response = await gmailApi.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage
        }
      });

      // Gmail API sometimes places sent messages in INBOX — remove INBOX label to keep only in SENT
      const messageId = response.data.id;
      if (messageId) {
        try {
          await gmailApi.users.messages.modify({
            userId: 'me',
            id: messageId,
            requestBody: {
              removeLabelIds: ['INBOX', 'UNREAD']
            }
          });
        } catch (labelError) {
          // Non-critical — log but don't fail the send
          logWarning('gmail', 'Failed to remove INBOX label from sent message', {
            tenantId,
            metadata: { messageId, error: labelError instanceof Error ? labelError.message : String(labelError) }
          });
        }
      }

      logInfo('gmail', 'Email sent via Gmail API', {
        tenantId,
        metadata: { messageId }
      });

      return {
        messageId: response.data.id || '',
        response: `Gmail API: ${response.status}`,
        envelope: info.envelope,
        accepted: [mailOptions.to as string],
        rejected: [],
        pending: []
      };
    };

    logInfo('gmail', 'Created Gmail API transporter', {
      tenantId,
      metadata: { email: integration.email }
    });

    return { transporter, gmailEmail: integration.email };
  } catch (error) {
    logError('gmail', 'Failed to create Gmail transporter', {
      tenantId,
      stackTrace: serializeError(error).stack
    });
    return null;
  }
}

/**
 * Detect Gmail-specific OAuth errors that should trigger SMTP fallback.
 */
export function isGmailOAuthError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes('invalid_grant') ||
    msg.includes('Token has been expired or revoked') ||
    msg.includes('Insufficient Permission') ||
    msg.includes('Invalid Credentials') ||
    msg.includes('OAUTH') ||
    msg.includes('oauth') ||
    msg.includes('401') ||
    msg.includes('403')
  );
}

/**
 * Detect Gmail rate limit errors (should NOT fallback, should retry with backoff).
 */
export function isGmailRateLimitError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes('429') || msg.includes('Rate Limit') || msg.includes('quota');
}
