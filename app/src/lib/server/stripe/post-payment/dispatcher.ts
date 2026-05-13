import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { logInfo, logError, serializeError } from '$lib/server/logger';
import { sendOnboardingMagicLink } from './send-magic-link';
import { provisionDirectAdminAccount } from './provision-da';
import { emitKeezFiscalInvoice } from './emit-keez-invoice';

type StepName = 'magic_link' | 'keez_invoice' | 'da_provision';
type StepStatus = 'pending' | 'success' | 'failed' | 'skipped';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

export interface PostPaymentContext {
	tenantId: string;
	clientId: string;
	inquiryId: string;
	productId: string;
	sessionId: string;
	mode: 'payment' | 'subscription';
	stripeCustomerId: string | null;
	stripeSubscriptionId: string | null;
	stripePaymentIntentId: string | null;
}

/**
 * Verifică dacă un pas e deja completat (idempotent: skip pe retry Stripe).
 * Returns: starea actuală sau null dacă nu există încă row-ul.
 */
async function getStepStatus(
	sessionId: string,
	step: StepName
): Promise<{ id: string; status: StepStatus; attempts: number } | null> {
	const [row] = await db
		.select({
			id: table.postPaymentStep.id,
			status: table.postPaymentStep.status,
			attempts: table.postPaymentStep.attempts
		})
		.from(table.postPaymentStep)
		.where(
			and(
				eq(table.postPaymentStep.stripeSessionId, sessionId),
				eq(table.postPaymentStep.step, step)
			)
		)
		.limit(1);
	return row ? { id: row.id, status: row.status as StepStatus, attempts: row.attempts } : null;
}

/**
 * Marchează un pas în starea finală. Folosește UPSERT logic: dacă row-ul există
 * (după failure precedent), UPDATE; altfel INSERT.
 */
async function recordStep(params: {
	ctx: PostPaymentContext;
	step: StepName;
	status: StepStatus;
	payload: unknown | null;
	error: string | null;
}): Promise<void> {
	const existing = await getStepStatus(params.ctx.sessionId, params.step);
	const now = new Date().toISOString();
	const isFinal = params.status === 'success' || params.status === 'skipped';
	const payloadJson = params.payload != null ? JSON.stringify(params.payload) : null;

	if (existing) {
		await db
			.update(table.postPaymentStep)
			.set({
				status: params.status,
				attempts: (existing.attempts ?? 0) + 1,
				error: params.error,
				payload: payloadJson,
				completedAt: isFinal ? now : null,
				updatedAt: now
			})
			.where(eq(table.postPaymentStep.id, existing.id));
		return;
	}

	await db.insert(table.postPaymentStep).values({
		id: generateId(),
		tenantId: params.ctx.tenantId,
		clientId: params.ctx.clientId,
		inquiryId: params.ctx.inquiryId,
		stripeSessionId: params.ctx.sessionId,
		step: params.step,
		status: params.status,
		attempts: 1,
		error: params.error,
		payload: payloadJson,
		completedAt: isFinal ? now : null
	});
}

/**
 * Rulează un pas cu try/catch — nu propagă eroarea, doar o înregistrează.
 * Returns: true dacă pasul a reușit (sau era deja success/skipped).
 */
async function runStep<T>(
	ctx: PostPaymentContext,
	step: StepName,
	fn: () => Promise<T | { skipped: true; reason: string }>
): Promise<boolean> {
	const existing = await getStepStatus(ctx.sessionId, step);
	if (existing?.status === 'success' || existing?.status === 'skipped') {
		logInfo('directadmin', `post-payment step "${step}" deja ${existing.status}, skip`, {
			tenantId: ctx.tenantId,
			metadata: { sessionId: ctx.sessionId, step }
		});
		return true;
	}

	try {
		const result = await fn();
		const skipped =
			result != null &&
			typeof result === 'object' &&
			(result as { skipped?: boolean }).skipped === true;
		await recordStep({
			ctx,
			step,
			status: skipped ? 'skipped' : 'success',
			payload: result,
			error: null
		});
		logInfo('directadmin', `post-payment step "${step}" → ${skipped ? 'skipped' : 'success'}`, {
			tenantId: ctx.tenantId,
			metadata: { sessionId: ctx.sessionId, step }
		});
		return true;
	} catch (err) {
		const { message } = serializeError(err);
		await recordStep({
			ctx,
			step,
			status: 'failed',
			payload: null,
			error: message
		});
		logError('directadmin', `post-payment step "${step}" → failed: ${message}`, {
			tenantId: ctx.tenantId,
			metadata: { sessionId: ctx.sessionId, step }
		});
		return false;
	}
}

/**
 * Rulează cei 3 pași post-payment în ordinea: magic_link → keez_invoice →
 * da_provision. Eșecul unuia NU blochează ceilalți (fiecare e independent).
 * Staff vede statusul via `/[tenant]/api/_debug-stripe-health?action=post-payment-steps`.
 *
 * Idempotent: pe retry Stripe (webhook re-deliver) pașii deja completați se sar
 * via UNIQUE (stripe_session_id, step) + verificare status în getStepStatus.
 */
export async function runPostPaymentSteps(ctx: PostPaymentContext): Promise<void> {
	logInfo('directadmin', `post-payment pipeline starting for session ${ctx.sessionId}`, {
		tenantId: ctx.tenantId,
		metadata: {
			clientId: ctx.clientId,
			inquiryId: ctx.inquiryId,
			productId: ctx.productId,
			mode: ctx.mode
		}
	});

	// 1. Magic link — primul pas, ca user-ul să primească email imediat.
	await runStep(ctx, 'magic_link', () =>
		sendOnboardingMagicLink({ tenantId: ctx.tenantId, clientId: ctx.clientId })
	);

	// 2. Keez fiscal invoice — pentru mode='payment' emitem acum; pentru subscription
	//    Stripe va emite `invoice.paid` la fiecare renewal și acolo apelăm Keez.
	if (ctx.mode === 'payment') {
		await runStep(ctx, 'keez_invoice', () =>
			emitKeezFiscalInvoice({
				tenantId: ctx.tenantId,
				clientId: ctx.clientId,
				sessionId: ctx.sessionId,
				stripePaymentIntentId: ctx.stripePaymentIntentId,
				stripeSubscriptionId: ctx.stripeSubscriptionId,
				productId: ctx.productId
			})
		);
	} else {
		// Marchează ca skipped explicit pentru claritate în debug endpoint.
		await recordStep({
			ctx,
			step: 'keez_invoice',
			status: 'skipped',
			payload: { reason: 'subscription_mode_keez_emitted_on_invoice_paid' },
			error: null
		});
	}

	// 3. DA provisioning — ultima, poate dura mai mult (apel DA + DB writes).
	await runStep(ctx, 'da_provision', () =>
		provisionDirectAdminAccount({
			tenantId: ctx.tenantId,
			clientId: ctx.clientId,
			productId: ctx.productId,
			sessionId: ctx.sessionId,
			stripeSubscriptionId: ctx.stripeSubscriptionId
		})
	);

	logInfo('directadmin', `post-payment pipeline finished for session ${ctx.sessionId}`, {
		tenantId: ctx.tenantId,
		metadata: { sessionId: ctx.sessionId }
	});
}
