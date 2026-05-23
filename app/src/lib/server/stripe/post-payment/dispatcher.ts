import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { logInfo, logError, serializeError } from '$lib/server/logger';
import { withTursoBusyRetry } from '$lib/server/plugins/keez/db-retry';
import { sendOnboardingMagicLink } from './send-magic-link';
import { provisionDirectAdminAccount } from './provision-da';
import { emitKeezFiscalInvoice } from './emit-keez-invoice';
import { notifyPaymentSucceeded, notifyAdminPaymentReceived } from '../notifications';

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
 * Returns: the step's inner result on success (so callers can chain follow-up
 * work like firing a customer email), or `undefined` on already-done / skipped
 * / failed. The boolean "success?" signal is preserved as `result !== undefined`
 * for the (very few) callers that only care about pass/fail.
 *
 * Why the signature change: Task 13 needs the keez_invoice step's payload
 * (the freshly-emitted invoiceId) to fire `notifyPaymentSucceeded`. The
 * alternative (re-query `invoice` after the step) duplicates Stripe's
 * idempotency key resolution and adds DB chatter. Returning the result is the
 * narrower change — none of the 3 existing callers used the prior boolean.
 */
async function runStep<T>(
	ctx: PostPaymentContext,
	step: StepName,
	fn: () => Promise<T | { skipped: true; reason: string }>
): Promise<T | { skipped: true; reason: string } | undefined> {
	const existing = await getStepStatus(ctx.sessionId, step);
	if (existing?.status === 'success' || existing?.status === 'skipped') {
		logInfo('directadmin', `post-payment step "${step}" deja ${existing.status}, skip`, {
			tenantId: ctx.tenantId,
			metadata: { sessionId: ctx.sessionId, step }
		});
		// Already-done — no fresh result to return. Follow-up work (like
		// payment-succeeded email) already ran on the original attempt; its own
		// dedupe row will block a re-fire here even if we tried.
		return undefined;
	}

	const stepStart = Date.now();
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
		logInfo(
			'directadmin',
			`[CHECKOUT][post-payment] step "${step}" → ${skipped ? 'skipped' : 'success'} in ${Date.now() - stepStart}ms`,
			{ tenantId: ctx.tenantId, metadata: { sessionId: ctx.sessionId, step } }
		);
		return result;
	} catch (err) {
		const { message } = serializeError(err);
		await recordStep({
			ctx,
			step,
			status: 'failed',
			payload: null,
			error: message
		});
		logError(
			'directadmin',
			`[CHECKOUT][post-payment] step "${step}" → FAILED in ${Date.now() - stepStart}ms: ${message}`,
			{ tenantId: ctx.tenantId, metadata: { sessionId: ctx.sessionId, step } }
		);
		return undefined;
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
	const pipelineStart = Date.now();
	logInfo('directadmin', `[CHECKOUT][post-payment] pipeline starting for session ${ctx.sessionId}`, {
		tenantId: ctx.tenantId,
		metadata: {
			clientId: ctx.clientId,
			inquiryId: ctx.inquiryId,
			productId: ctx.productId,
			mode: ctx.mode,
			hasSubscriptionId: !!ctx.stripeSubscriptionId,
			hasPaymentIntentId: !!ctx.stripePaymentIntentId
		}
	});

	// 1. Magic link — primul pas, ca user-ul să primească email imediat.
	await runStep(ctx, 'magic_link', () =>
		sendOnboardingMagicLink({ tenantId: ctx.tenantId, clientId: ctx.clientId })
	);

	// 2. Keez fiscal invoice — emit a CRM invoice + push to Keez for the FIRST
	// payment regardless of mode. Subscription RENEWALS go through
	// `invoice.payment_succeeded` webhook + a separate emitter (TODO Sprint 8.2).
	// Idempotency is enforced inside emitKeezFiscalInvoice via stripePaymentIntentId
	// — a webhook retry won't double-invoice.
	const keezResult = await runStep(ctx, 'keez_invoice', () =>
		emitKeezFiscalInvoice({
			tenantId: ctx.tenantId,
			clientId: ctx.clientId,
			sessionId: ctx.sessionId,
			inquiryId: ctx.inquiryId,
			stripePaymentIntentId: ctx.stripePaymentIntentId,
			stripeSubscriptionId: ctx.stripeSubscriptionId,
			productId: ctx.productId
		})
	);

	// 2b. Customer payment-succeeded email — best-effort, never blocks the
	// pipeline. Fired only when the keez step actually wrote/found an invoice
	// (skipped pre-conditions like `product_missing` leave nothing to email
	// about). `notifyPaymentSucceeded` has its own lifetime dedupe per invoice,
	// so a Stripe webhook retry that re-fires the dispatcher will no-op safely
	// here even though the keez step itself returned the cached invoiceId on
	// the second pass. Errors are caught + logged so a notify failure cannot
	// mark the webhook event as `failed` and trigger a Stripe retry storm.
	if (
		keezResult &&
		typeof keezResult === 'object' &&
		'invoiceId' in keezResult &&
		!('skipped' in keezResult)
	) {
		const invoiceId = keezResult.invoiceId;
		notifyPaymentSucceeded(ctx.tenantId, invoiceId).catch((err) => {
			logError('hosting-email', 'payment-succeeded notify failed', {
				tenantId: ctx.tenantId,
				metadata: {
					sessionId: ctx.sessionId,
					invoiceId,
					error: err instanceof Error ? err.message : String(err)
				}
			});
		});
	}

	// 3. DA provisioning — ultima, poate dura mai mult (apel DA + DB writes).
	await runStep(ctx, 'da_provision', async () => {
		const result = await provisionDirectAdminAccount({
			tenantId: ctx.tenantId,
			clientId: ctx.clientId,
			productId: ctx.productId,
			sessionId: ctx.sessionId,
			stripeSubscriptionId: ctx.stripeSubscriptionId,
			inquiryId: ctx.inquiryId
		});
		// Link the hosting_account back onto the inquiry so the Comenzi hosting
		// admin page can show DA status without re-joining post_payment_step.
		// Idempotent: the call below only writes when hostingAccountId is empty,
		// matching how the row gets touched both on first run and on retry.
		// Wrapped in withTursoBusyRetry — a transient BUSY here would leave the
		// freshly-created DA account unlinked + admin would manually retry.
		await withTursoBusyRetry(
			() =>
				db
					.update(table.hostingInquiry)
					.set({ hostingAccountId: result.hostingAccountId, updatedAt: new Date() })
					.where(
						and(
							eq(table.hostingInquiry.id, ctx.inquiryId),
							eq(table.hostingInquiry.tenantId, ctx.tenantId)
						)
					),
			{ tenantId: ctx.tenantId, label: 'dispatcher/linkAfterProvision' }
		);
		return result;
	});

	// 4. Admin alert with step statuses — best-effort, doesn't block the pipeline.
	//    Reads from post_payment_step table (status was persisted by each runStep
	//    call above) to capture the actual final statuses including any skipped/
	//    failed steps. Fire-and-forget pattern matches notifyPaymentSucceeded
	//    above — a notify failure must not mark the webhook event as `failed`
	//    and trigger a Stripe retry storm.
	//
	//    invoiceId resolution: prefer the keez step's payload (where
	//    emitKeezFiscalInvoice persisted invoiceId on success). When the keez
	//    step was skipped (e.g. pre-condition failed like product_missing) or
	//    failed, fall back to looking up the invoice by stripePaymentIntentId.
	//    On a totally absent invoice (no Keez emission + no fallback hit), we
	//    skip the admin notify with an info log — there's nothing to link to.
	const stepStatusRows = await db
		.select({ step: table.postPaymentStep.step, status: table.postPaymentStep.status })
		.from(table.postPaymentStep)
		.where(eq(table.postPaymentStep.stripeSessionId, ctx.sessionId));
	const stepStatuses: Record<string, string> = {};
	for (const row of stepStatusRows) {
		stepStatuses[row.step] = row.status;
	}

	let invoiceIdForAdmin: string | null = null;
	if (
		keezResult &&
		typeof keezResult === 'object' &&
		'invoiceId' in keezResult &&
		!('skipped' in keezResult)
	) {
		invoiceIdForAdmin = keezResult.invoiceId;
	}
	// Fallback: lookup by stripePaymentIntentId when the keez step skipped or
	// failed but a prior pipeline run already emitted the invoice.
	if (!invoiceIdForAdmin && ctx.stripePaymentIntentId) {
		const [inv] = await db
			.select({ id: table.invoice.id })
			.from(table.invoice)
			.where(
				and(
					eq(table.invoice.tenantId, ctx.tenantId),
					eq(table.invoice.stripePaymentIntentId, ctx.stripePaymentIntentId)
				)
			)
			.limit(1);
		invoiceIdForAdmin = inv?.id ?? null;
	}

	if (invoiceIdForAdmin) {
		notifyAdminPaymentReceived(ctx.tenantId, invoiceIdForAdmin, stepStatuses).catch((err) => {
			logError('hosting-email', 'admin-payment-received notify failed', {
				tenantId: ctx.tenantId,
				metadata: {
					sessionId: ctx.sessionId,
					invoiceId: invoiceIdForAdmin,
					error: err instanceof Error ? err.message : String(err)
				}
			});
		});
	} else {
		logInfo('hosting-email', 'skip admin-payment-received: no invoice found for session', {
			tenantId: ctx.tenantId,
			metadata: { sessionId: ctx.sessionId }
		});
	}

	logInfo(
		'directadmin',
		`[CHECKOUT][post-payment] pipeline finished for session ${ctx.sessionId} in ${Date.now() - pipelineStart}ms`,
		{ tenantId: ctx.tenantId, metadata: { sessionId: ctx.sessionId } }
	);
}
