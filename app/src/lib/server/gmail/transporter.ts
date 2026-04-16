import nodemailer from 'nodemailer';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { getAuthenticatedClient, hasGmailSendScope } from './auth';
import { logInfo, logWarning, logError, serializeError } from '$lib/server/logger';

/**
 * Create a nodemailer transporter using Gmail OAuth2.
 * Returns null if: no active integration, missing send scope, token invalid.
 * Refreshes token via getAuthenticatedClient() BEFORE creating transport.
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

  // 4. Read fresh tokens (decrypted)
  const credentials = oauth2Client.credentials;
  if (!credentials.access_token || !credentials.refresh_token) {
    logWarning('gmail', 'Gmail credentials incomplete after refresh', { tenantId });
    return null;
  }

  // 5. Create nodemailer transport
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: integration.email,
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        refreshToken: credentials.refresh_token as string,
        accessToken: credentials.access_token as string
      }
    });

    logInfo('gmail', 'Created Gmail transporter', {
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
    msg.includes('oauth')
  );
}

/**
 * Detect Gmail rate limit errors (should NOT fallback, should retry with backoff).
 */
export function isGmailRateLimitError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes('429') || msg.includes('Rate Limit') || msg.includes('quota');
}
