<script lang="ts">
	import {
		validateCuiAndFetch,
		submitHostingOrder,
		checkDomainAvailability,
		checkEmailKnownToCrm
	} from '$lib/remotes/public-hosting.remote';
	import { loadStripe, type Stripe as StripeJS, type StripeElements as StripeElementsT } from '@stripe/stripe-js';
	import { StripeElements } from '$lib/components/Stripe';
	import { PaymentElement } from '$lib/components/Stripe/PaymentElement';
	import {
		normalizeEmail,
		validateEmail,
		isPersonalEmail,
		normalizeCui as normalizeCuiVal,
		validateCuiFormat,
		normalizeRegCom,
		validateRegCom,
		checkPhone,
		validatePhone,
		validatePostal
	} from '$lib/components/checkout/validators';
	import { COUNTIES, parseAnafAddress } from '$lib/components/checkout/anaf-address';
	import { toast } from 'svelte-sonner';
	import LockIcon from '@lucide/svelte/icons/lock';
	import XIcon from '@lucide/svelte/icons/x';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import UsersIcon from '@lucide/svelte/icons/users';
	import CreditCardIcon from '@lucide/svelte/icons/credit-card';
	import ShoppingBagIcon from '@lucide/svelte/icons/shopping-bag';
	import RepeatIcon from '@lucide/svelte/icons/repeat';
	import CheckIcon from '@lucide/svelte/icons/check';
	import InfoIcon from '@lucide/svelte/icons/info';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import Building2Icon from '@lucide/svelte/icons/building-2';
	import ZapIcon from '@lucide/svelte/icons/zap';
	import DollarSignIcon from '@lucide/svelte/icons/dollar-sign';
	import MailIcon from '@lucide/svelte/icons/mail';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import MessageCircleIcon from '@lucide/svelte/icons/message-circle';
	import PackageIcon from '@lucide/svelte/icons/package';
	import ArrowUpRightIcon from '@lucide/svelte/icons/arrow-up-right';
	import CopyIcon from '@lucide/svelte/icons/copy';

	type Period = 'monthly' | 'yearly';
	type Plan = {
		id: string;
		name: string;
		currency: string;
		billingCycle: string;
	};

	type BankInfo = {
		name: string | null;
		bankName: string | null;
		iban: string | null;
		ibanEuro: string | null;
		cui: string | null;
		vatNumber: string | null;
		// Optional contact fields surfaced in the success step so the customer
		// has the real OTS phone/email (not a hardcoded fake one).
		phone?: string | null;
		email?: string | null;
	};

	const {
		plan,
		period,
		vatRate,
		monthlyBilled,
		yearlyTotal,
		bankInfo,
		preloadedPublishableKey = null,
		onClose
	}: {
		plan: Plan;
		period: Period;
		vatRate: number;
		monthlyBilled: number;
		yearlyTotal: number;
		bankInfo?: BankInfo;
		// Per-tenant Stripe publishable key surfaced by the parent page. When set,
		// we kick off loadStripe() on mount so the ~200KB bundle is downloading
		// (and the Stripe instance is initialised) while the user is still on
		// steps 1 + 2. The submitHostingOrder response still carries its own
		// publishable key — we trust that one as authoritative, but the preload
		// hits the same key so the network cache is already warm.
		preloadedPublishableKey?: string | null;
		onClose: () => void;
	} = $props();

	// Feature flags — Revolut Pay and PayPal are integrated server-side later;
	// for now we expose only Card + Ordin de plată so we don't render options
	// the customer can't actually use.
	const ENABLE_REVOLUT = false;
	const ENABLE_PAYPAL = false;

	const TLDs = [
		{ tld: '.ro', price: 49 },
		{ tld: '.com', price: 59 },
		{ tld: '.net', price: 65 },
		{ tld: '.eu', price: 55 },
		{ tld: '.org', price: 65 },
		{ tld: '.biz', price: 79 }
	];

	// COUNTIES + parseAnafAddress live in `./checkout/anaf-address.ts` so they
	// can be unit-tested without DOM. See LOW-5 audit follow-up.

	let step = $state<1 | 2 | 3 | 4>(1);
	let orderId = $state<string | null>(null);
	// Track separately whether the success step is being shown because the
	// customer already exists (duplicateCui/email). Previously the `'EXISTING'`
	// magic string was overloaded into `orderId` itself, which prevented us from
	// surfacing the real inquiry id alongside the "you're already a customer"
	// messaging. Now `orderId` always carries the inquiry reference (or null in
	// the rare UNIQUE-race edge case).
	let isExistingClient = $state(false);

	// Domain — only "have" mode is exposed publicly for now. The buy/transfer
	// branches are still rendered behind a feature flag so the registrar
	// integration can light them up later without touching the markup.
	const ENABLE_DOMAIN_BUY = false;
	const ENABLE_DOMAIN_TRANSFER = false;
	let domainMode = $state<'buy' | 'have' | 'transfer'>('have');
	let domainName = $state('');
	let domainTld = $state('.ro');
	let existingDomain = $state('');
	let domainTouched = $state(false);

	// Allow-list of TLDs we accept for the primary DirectAdmin account.
	// Romanian + common gTLDs + European ccTLDs (clients hosting cross-border sites)
	// + 2nd-level Romanian zones (.com.ro etc) handled via ALLOWED_RO_SLD below.
	const ALLOWED_TLDS = new Set([
		// Romania + EU
		'ro',
		'eu',
		// European ccTLDs (cross-border hosting is common)
		'es',
		'it',
		'fr',
		'de',
		'pl',
		'uk',
		'pt',
		'gr',
		'nl',
		'be',
		'at',
		'ch',
		'se',
		'no',
		'dk',
		'fi',
		'ie',
		'cz',
		'sk',
		'hu',
		'bg',
		'hr',
		'rs',
		'md',
		'ua',
		// Common gTLDs
		'com',
		'net',
		'org',
		'biz',
		'info',
		'io',
		'dev',
		'app',
		'co',
		'ai',
		'me',
		'tv',
		'shop',
		'online',
		'site',
		'tech',
		'agency',
		'studio',
		'cloud',
		'host',
		'digital',
		'media',
		'store',
		'web',
		'pro',
		'world',
		'live',
		'today',
		'work',
		'global',
		'group',
		'company'
	]);
	// Second-level Romanian zones (foo.com.ro, foo.org.ro etc.)
	const ALLOWED_RO_SLD = new Set(['com.ro', 'org.ro', 'info.ro', 'tm.ro', 'nt.ro', 'nom.ro']);

	function normalizeDomainInput(raw: string): string {
		return raw
			.trim()
			.toLowerCase()
			.replace(/^https?:\/\//, '')
			.replace(/^www\./, '')
			.replace(/\/.*$/, '')
			.replace(/\s+/g, '');
	}

	/**
	 * Returns null if `value` is a valid public domain, or a human-readable
	 * reason. Enforces what DirectAdmin will accept as a primary domain:
	 * lowercase, ASCII labels 1..63 chars, total ≤ 253 chars, TLD in allow-list.
	 */
	function validateExistingDomain(value: string): string | null {
		const v = value.trim();
		if (!v) return 'Introdu domeniul.';
		if (v.length > 253) return 'Domeniul e prea lung (max 253 caractere).';
		if (!/^[a-z0-9.-]+$/.test(v))
			return 'Domeniul poate conține doar litere, cifre, „-" și „.". Pentru caractere românești folosește Punycode (xn--).';
		if (v.includes('..')) return 'Două puncte consecutive nu sunt permise.';
		if (v.startsWith('-') || v.endsWith('-')) return 'Domeniul nu poate începe sau termina cu „-".';
		if (v.startsWith('.') || v.endsWith('.')) return 'Domeniul nu poate începe sau termina cu „.".';

		const labels = v.split('.');
		if (labels.length < 2) return 'Domeniul trebuie să conțină cel puțin un punct (ex: firma-mea.ro).';
		for (const label of labels) {
			if (label.length === 0) return 'Domeniul conține un segment gol.';
			if (label.length > 63) return `Segmentul „${label}" e prea lung (max 63 caractere).`;
			if (label.startsWith('-') || label.endsWith('-'))
				return `Segmentul „${label}" nu poate începe sau termina cu „-".`;
		}

		// TLD check — accept both single-level (foo.ro) and 2-level Romanian zones (foo.com.ro)
		const tld = labels[labels.length - 1];
		const sld = labels.length >= 2 ? `${labels[labels.length - 2]}.${tld}` : '';
		const matchedSld = ALLOWED_RO_SLD.has(sld);
		const tldOk = ALLOWED_TLDS.has(tld) || matchedSld;
		if (!tldOk) {
			return `Extensia „.${tld}" nu este suportată momentan. TLD-uri acceptate: .ro, .com, .net, .org, .eu, .info, .io, .dev și altele uzuale.`;
		}

		// Optional: prevent obvious typos like "domain.r" or single-char TLDs
		if (tld.length < 2) return 'Extensia TLD trebuie să aibă cel puțin 2 caractere.';

		// Subdomain check — primary DA accounts must own the apex zone. Subdomenii
		// (de ex. `app.firma-mea.ro`) creează conflicte DNS/SSL dacă apex-ul aparține
		// altui cont DA. Two-label (foo.ro) e OK; trei labels (a.foo.ro) e OK doar
		// dacă SLD-ul este în ALLOWED_RO_SLD (foo.com.ro). Mai multe → subdomain.
		const expectedLabels = matchedSld ? 3 : 2;
		if (labels.length > expectedLabels) {
			return `„${v}" pare un subdomeniu. Pentru contul principal de hosting trebuie un domeniu de bază (ex: firma-mea.ro), nu app.firma-mea.ro.`;
		}

		return null;
	}

	const existingDomainError = $derived.by(() => {
		if (domainMode !== 'have' && domainMode !== 'transfer') return null;
		if (!domainTouched) return null;
		return validateExistingDomain(existingDomain);
	});

	// DirectAdmin availability lookup — runs after the format passes locally.
	// Soft-fail open: a DA outage shouldn't lock the customer out at the front
	// door; the server re-checks at submit time before creating the account.
	let daCheckLoading = $state(false);
	let daCheckTakenFor = $state<string | null>(null); // domain proven taken
	let daCheckOkFor = $state<string | null>(null); // domain proven free
	let daCheckErrorFor = $state<string | null>(null); // DA returned an explicit error string
	let daCheckUnknownFor = $state<string | null>(null); // DA unreachable — status unknown
	let daCheckLastTried = $state<string | null>(null); // dedupe identical lookups
	let daCheckSeq = 0; // ignore stale responses if user retypes

	async function runDomainCheck(domain: string) {
		const normalized = domain.trim().toLowerCase();
		if (!normalized) return;
		if (daCheckLastTried === normalized) return; // already checked this exact string
		daCheckLastTried = normalized;
		const seq = ++daCheckSeq;
		daCheckLoading = true;
		daCheckTakenFor = null;
		daCheckOkFor = null;
		daCheckErrorFor = null;
		daCheckUnknownFor = null;
		try {
			const res = await checkDomainAvailability(normalized);
			if (seq !== daCheckSeq) return; // a newer check superseded this one
			if (!res.ok) {
				daCheckErrorFor = res.error;
				return;
			}
			if (res.available === null) {
				// DA unreachable — explicit "we don't know" state. UI shows amber.
				daCheckUnknownFor = normalized;
			} else if (res.available) {
				daCheckOkFor = normalized;
			} else {
				daCheckTakenFor = normalized;
			}
		} catch (err) {
			if (seq !== daCheckSeq) return;
			daCheckErrorFor = err instanceof Error ? err.message : 'Eroare la verificare.';
		} finally {
			if (seq === daCheckSeq) daCheckLoading = false;
		}
	}

	// ========================================================================
	// Step 2 — field-level touched flags + remote check states.
	// One touched flag per field so we don't yell at users about fields they
	// haven't tried to fill yet.
	// ========================================================================
	let emailTouched = $state(false);
	// Password state intentionally removed — see UI comment for context.
	let cuiTouched = $state(false);
	let companyNameTouched = $state(false);
	let regComTouched = $state(false);
	let addressTouched = $state(false);
	let cityTouched = $state(false);
	let postalTouched = $state(false);
	let phoneTouched = $state(false);
	let firstNameTouched = $state(false);
	let lastNameTouched = $state(false);

	// Email-known-in-CRM lookup (constant-time anti-enumeration).
	let emailKnownLoading = $state(false);
	let emailKnownFor = $state<string | null>(null); // email proven known (existing CRM account)
	let emailLastChecked = $state<string | null>(null);
	let emailCheckSeq = 0;

	async function runEmailCrmCheck(addr: string) {
		const norm = normalizeEmail(addr);
		if (!norm) return;
		if (validateEmail(norm)) return; // skip if format invalid
		if (emailLastChecked === norm) return; // dedupe
		emailLastChecked = norm;
		const seq = ++emailCheckSeq;
		emailKnownLoading = true;
		try {
			const res = await checkEmailKnownToCrm(norm);
			if (seq !== emailCheckSeq) return;
			if (res.ok && res.known) emailKnownFor = norm;
			else if (emailKnownFor === norm) emailKnownFor = null;
		} catch {
			// Soft-fail: server-side check at submit is the hard guard.
			if (seq === emailCheckSeq) emailKnownFor = null;
		} finally {
			if (seq === emailCheckSeq) emailKnownLoading = false;
		}
	}

	// Per-field derived errors. Each returns null|string. null means OK
	// (or not-yet-touched — we keep the field neutral in that case).
	const emailFormatError = $derived(emailTouched ? validateEmail(email) : null);
	// passwordStrength intentionally removed — password field is gone from checkout.
	const cuiError = $derived(
		billingType === 'company' && cuiTouched ? validateCuiFormat(cui) : null
	);
	const companyNameError = $derived.by(() => {
		if (billingType !== 'company' || !companyNameTouched) return null;
		const v = companyName.trim();
		if (!v) return 'Introdu denumirea firmei.';
		if (v.length < 2) return 'Denumire prea scurtă.';
		return null;
	});
	const firstNameError = $derived.by(() => {
		if (billingType !== 'person' || !firstNameTouched) return null;
		return firstName.trim() ? null : 'Introdu prenumele.';
	});
	const lastNameError = $derived.by(() => {
		if (billingType !== 'person' || !lastNameTouched) return null;
		return lastName.trim() ? null : 'Introdu numele.';
	});
	const regComError = $derived(
		billingType === 'company' && regComTouched ? validateRegCom(regCom) : null
	);
	const addressError = $derived.by(() => {
		if (!addressTouched) return null;
		const v = address.trim();
		if (!v) return 'Introdu adresa completă.';
		if (v.length < 5) return 'Adresa e prea scurtă.';
		return null;
	});
	const cityError = $derived.by(() => {
		if (!cityTouched) return null;
		const v = city.trim();
		if (!v) return 'Introdu orașul.';
		if (v.length < 2) return 'Oraș prea scurt.';
		return null;
	});
	const postalError = $derived.by(() => {
		if (!postalTouched) return null;
		// Treat empty as OK (optional), but if any non-RO county selected we still
		// run the foreign-tolerant check.
		const ctx = { countryHint: county ? ('RO' as const) : null };
		return validatePostal(postalCode, ctx);
	});
	const phoneError = $derived(phoneTouched ? validatePhone(phone) : null);
	const phoneKind = $derived(phone.trim() ? checkPhone(phone).kind : 'invalid');

	const isPersonalEmailWarn = $derived(
		billingType === 'company' &&
			emailTouched &&
			!emailFormatError &&
			email.trim().length > 0 &&
			isPersonalEmail(email)
	);

	const daCheckStatus = $derived.by<
		'idle' | 'loading' | 'available' | 'taken' | 'unknown' | 'error'
	>(() => {
		const dom = existingDomain.trim().toLowerCase();
		if (!dom) return 'idle';
		if (existingDomainError) return 'idle'; // format error wins
		if (daCheckLoading && daCheckLastTried === dom) return 'loading';
		if (daCheckTakenFor === dom) return 'taken';
		if (daCheckOkFor === dom) return 'available';
		if (daCheckUnknownFor === dom) return 'unknown';
		if (daCheckErrorFor === dom) return 'error';
		return 'idle';
	});

	// Account
	let email = $state('');
	// password state removed — account is provisioned silently post-payment.
	let newAccount = $state(true);

	// Billing
	let billingType = $state<'person' | 'company'>('company');
	let firstName = $state('');
	let lastName = $state('');
	let companyName = $state('');
	let cui = $state('');
	let regCom = $state('');
	let address = $state('');
	let city = $state('');
	let county = $state('');
	let postalCode = $state('');
	let phone = $state('');
	let vatPayer = $state(false);

	// ANAF lookup
	let anafLoading = $state(false);
	let anafError = $state<string | null>(null);
	let anafFilled = $state(false);

	// Payment
	let paymentMethod = $state<'card' | 'op' | 'revolut' | 'paypal'>('card');
	let orderNotes = $state('');

	// Embedded Stripe Elements state (only used when paymentMethod === 'card').
	// Stage transitions: 'idle' → 'creating-intent' → 'ready' → 'confirming' → 'paid'
	// On 'op' (and other non-card methods) we keep the legacy redirect flow.
	type CardStage = 'idle' | 'creating-intent' | 'ready' | 'confirming' | 'paid';
	let cardStage = $state<CardStage>('idle');

	// Eager-init for Stripe PaymentElement at step 3: an $effect below auto-calls
	// submit() the moment the user lands on step 3 with `paymentMethod === 'card'`,
	// so the inline card form appears without a manual click. cardInitTriggered
	// guards against double-firing; cardInitError holds the message shown next to
	// the retry button when the eager init fails.
	let cardInitTriggered = $state(false);
	let cardInitError = $state<string | null>(null);

	/**
	 * Canonical representation of all fields that affect the PaymentIntent payload.
	 * If any of these change while we have an active PaymentIntent, we must
	 * invalidate it and re-run submit() to ensure Stripe Customer / amount / metadata
	 * reflect the current form state.
	 */
	const step2PayloadHash = $derived.by(() => {
		return JSON.stringify({
			email: email.trim().toLowerCase(),
			billingType,
			firstName: firstName.trim(),
			lastName: lastName.trim(),
			companyName: companyName.trim(),
			cui: cui.trim(),
			regCom: regCom.trim(),
			address: address.trim(),
			city: city.trim(),
			county,
			postalCode: postalCode.trim(),
			phone: phone.trim(),
			vatPayer,
			domainMode,
			domainName,
			domainTld,
			existingDomain,
			period,
			planId: plan.id,
			orderNotes: orderNotes.trim(),
			paymentMethod // Method change (card vs op) also invalidates PI
		});
	});
	let lastSubmittedHash = $state<string | null>(null);

	// Filter in DevTools console with: `[CHECKOUT]`. Set
	// localStorage.DEBUG_CHECKOUT=false to silence at runtime.
	function debugLog(label: string, payload?: unknown) {
		if (typeof window === 'undefined') return;
		try {
			if (window.localStorage.getItem('DEBUG_CHECKOUT') === 'false') return;
		} catch {
			/* private mode */
		}
		if (payload !== undefined) {
			// eslint-disable-next-line no-console
			console.log(`[CHECKOUT] ${label}`, payload);
		} else {
			// eslint-disable-next-line no-console
			console.log(`[CHECKOUT] ${label}`);
		}
	}

	/**
	 * PII-safe redaction for logs. The browser console is dev-only today, but
	 * Sentry/Axiom forwarders or shared screenshots can leak. Mask anything
	 * tied to a natural person; keep `inquiryId` + non-identifying booleans/ids
	 * for correlation.
	 */
	function maskEmail(e?: string | null): string {
		if (!e) return '';
		const [u, d] = e.split('@');
		if (!u || !d) return '***';
		return `${u.slice(0, 2)}***@${d}`;
	}
	function maskPhone(p?: string | null): string {
		if (!p) return '';
		const digits = p.replace(/\D/g, '');
		return digits.length > 4 ? `***${digits.slice(-4)}` : '***';
	}
	function maskTail(s?: string | null, keep = 4): string {
		if (!s) return '';
		return s.length > keep ? `***${s.slice(-keep)}` : '***';
	}

	$effect(() => {
		debugLog('modal open', {
			plan: { id: plan.id, name: plan.name, currency: plan.currency, cycle: plan.billingCycle },
			period,
			vatRate,
			monthlyBilled,
			yearlyTotal
		});
		return () => debugLog('modal closed');
	});

	$effect(() => {
		debugLog(`cardStage → ${cardStage}`);
	});

	// Auto-init Stripe PaymentIntent the moment the user reaches step 3 with the
	// card method selected. Without this, the customer had to click "Plătește"
	// once just to mint the intent, watch the form appear, then click again to
	// confirm — confusing UX. We do NOT gate on acceptTerms here; the terms
	// checkbox is enforced at confirmInlinePayment() time instead.
	$effect(() => {
		if (
			step === 3 &&
			paymentMethod === 'card' &&
			cardStage === 'idle' &&
			!cardInitTriggered &&
			!cardInitError &&
			!submitting &&
			step2PayloadHash !== lastSubmittedHash
		) {
			cardInitTriggered = true;
			debugLog('auto-init → entering step 3 with card method, creating PaymentIntent');
			void tryAutoInitStripe();
		}
	});

	// Invalidation logic: if the user goes back and changes any field that affects
	// the order payload, we reset the Stripe state so the next entry to Step 3
	// re-mints a fresh PaymentIntent with the correct data.
	$effect(() => {
		if (
			lastSubmittedHash &&
			step2PayloadHash !== lastSubmittedHash &&
			cardStage !== 'paid' &&
			cardStage !== 'confirming'
		) {
			debugLog('Step 2 data changed — invalidating existing PaymentIntent');
			cardStage = 'idle';
			cardInitTriggered = false;
			cardInitError = null;
			paymentClientSecret = null;
			paymentIntentId = null;
			// Clear the snapshot so this effect doesn't re-fire on every subsequent
			// cardStage transition while the next tryAutoInitStripe() is in flight
			// (the in-flight submit would otherwise be torn down mid-creation and
			// the user would see a stale duplicateCui response from a half-cancelled
			// request). The next successful init will capture a fresh hash.
			lastSubmittedHash = null;
			// Keep stripeJs and stripeElements as-is; they'll be re-used/re-mounted
			// once the next tryAutoInitStripe() returns a new secret.
		}
	});

	// Clear the trigger flag when the user navigates away from step 3 OR switches
	// payment method. We deliberately do NOT reset cardStage / paymentClientSecret
	// — the PaymentIntent from Stripe is valid for 24h, so coming back to step 3
	// without form-data changes should keep the existing card form mounted.
	$effect(() => {
		if (step !== 3 || paymentMethod !== 'card') {
			cardInitTriggered = false;
			cardInitError = null;
		}
	});

	let stripeJs = $state<StripeJS | null>(null);
	let stripeElements = $state<StripeElementsT | null>(null);
	let paymentClientSecret = $state<string | null>(null);
	let paymentPublishableKey = $state<string | null>(null);
	let paymentIntentId = $state<string | null>(null);
	let paymentError = $state<string | null>(null);

	// Preload Stripe.js as soon as the modal mounts. The publishable key is
	// surfaced by the parent page (via getPublicHostingPackages → page props),
	// so we don't need to wait for submitHostingOrder to round-trip before
	// starting the bundle download. By the time the user finishes step 2 and
	// hits Continuă, `stripeJs` is already populated and only the PaymentIntent
	// roundtrip blocks the form from rendering.
	$effect(() => {
		if (!preloadedPublishableKey || stripeJs) return;
		const tPreload = performance.now();
		debugLog('preload Stripe.js — starting bundle download', {
			publishableKeyPrefix: preloadedPublishableKey.slice(0, 14) + '…'
		});
		void loadStripe(preloadedPublishableKey).then((stripe) => {
			debugLog(`preload Stripe.js — done in ${Math.round(performance.now() - tPreload)}ms`, {
				ok: !!stripe
			});
			if (stripe && !stripeJs) {
				stripeJs = stripe;
			}
		});
	});

	// Terms
	let acceptTerms = $state(false);
	let acceptMarketing = $state(false);

	let submitting = $state(false);
	let submitError = $state<string | null>(null);

	// Mock domain search (visual only — real DNS check would hit registrar API)
	const TAKEN_DEMO = ['site', 'test', 'google', 'facebook', 'wordpress'];
	const domainSearch = $derived.by(() => {
		if (!domainName) return null;
		return { taken: TAKEN_DEMO.includes(domainName.toLowerCase()) };
	});

	const tldPrice = $derived(TLDs.find((t) => t.tld === domainTld)?.price ?? 49);
	const domainCost = $derived(
		domainMode === 'buy' && domainName && !domainSearch?.taken ? tldPrice : 0
	);
	const hostingCost = $derived(period === 'yearly' ? yearlyTotal : monthlyBilled);
	const cycleLabel = $derived(period === 'yearly' ? 'an' : 'lună');
	const subtotal = $derived(hostingCost + domainCost);
	const vat = $derived(Math.round((subtotal * vatRate) / 100));
	const total = $derived(subtotal + vat);

	const stepMissing = $derived.by(() => {
		if (step === 1) {
			if (domainMode === 'buy' && !domainName)
				return 'Introdu un nume de domeniu pentru a continua';
			if (domainMode === 'buy' && domainSearch?.taken)
				return 'Domeniul este ocupat — alege altul';
			if (domainMode === 'have' || domainMode === 'transfer') {
				const err = validateExistingDomain(existingDomain);
				if (err) return err;
				if (daCheckStatus === 'taken')
					return 'Acest domeniu este deja găzduit pe serverele noastre — alege alt nume.';
				if (daCheckStatus === 'loading') return 'Verificăm domeniul, te rugăm să aștepți…';
			}
		}
		if (step === 2) {
			// Email: required, must be valid format
			const emailErr = validateEmail(email);
			if (emailErr) return emailErr;
			if (billingType === 'company') {
				const cuiErr = validateCuiFormat(cui);
				if (cuiErr) return cuiErr;
				if (!companyName.trim()) return 'Introdu denumirea firmei.';
				const regErr = validateRegCom(regCom);
				if (regErr) return regErr;
			} else {
				if (!firstName.trim()) return 'Introdu prenumele.';
				if (!lastName.trim()) return 'Introdu numele.';
			}
			if (!address.trim() || address.trim().length < 5) return 'Introdu adresa completă.';
			if (!city.trim()) return 'Introdu orașul.';
			const phErr = validatePhone(phone);
			if (phErr) return phErr;
			// Postal is optional, but if filled it must be valid
			if (postalCode.trim()) {
				const ctx = { countryHint: county ? ('RO' as const) : null };
				const pErr = validatePostal(postalCode, ctx);
				if (pErr) return pErr;
			}
		}
		if (step === 3 && !acceptTerms) return 'Bifează termenii și condițiile pentru a finaliza';
		return null;
	});

	// Local isEmail removed (Audit LOW-3) — single source of truth is the
	// `validateEmail` import; calls in submit() use that directly.

	// parseAnafAddress imported from `./checkout/anaf-address.ts` (LOW-5 audit).

	async function lookupAnaf() {
		anafError = null;
		anafFilled = false;
		const raw = cui.trim();
		if (!raw) {
			debugLog('ANAF lookup blocked — empty CUI');
			anafError = 'Introdu CUI-ul firmei mai întâi.';
			return;
		}
		debugLog('ANAF lookup → request', { cuiTail: maskTail(raw, 4) });
		const tAnaf = performance.now();
		anafLoading = true;
		try {
			const res = await validateCuiAndFetch(raw);
			debugLog(`ANAF lookup ← response in ${Math.round(performance.now() - tAnaf)}ms`, {
				valid: res.valid,
				error: res.valid ? null : res.error,
				hasCompanyName: res.valid && !!res.data.denumire,
				platitorTva: res.valid ? res.data.platitorTva : null
			});
			if (!res.valid) {
				anafError = res.error;
				return;
			}
			const d = res.data;
			cui = d.cui;
			companyName = d.denumire || companyName;
			regCom = d.nrRegCom || regCom;
			postalCode = d.codPostal || postalCode;
			if (!phone && d.telefon) {
				// ANAF returns phones in inconsistent formats (sometimes 0721234567,
				// sometimes +40-721-234-567, sometimes plain `0721 234 567`). Run
				// through checkPhone so the field passes our own validator after
				// the auto-fill — otherwise users would be blocked at Step 2 with
				// "Telefon invalid" even though they didn't touch the field.
				const phoneCheck = checkPhone(d.telefon);
				phone = phoneCheck.kind !== 'invalid' ? phoneCheck.display : d.telefon;
			}
			vatPayer = !!d.platitorTva;

			if (d.adresa) {
				const parsed = parseAnafAddress(d.adresa);
				address = parsed.address || d.adresa; // residual; fall back to raw if parser stripped everything
				if (parsed.city) city = parsed.city;
				if (parsed.county) county = parsed.county;
			}

			anafFilled = true;
		} catch (e) {
			debugLog('ANAF lookup THROWN', {
				message: e instanceof Error ? e.message : String(e)
			});
			anafError = e instanceof Error ? e.message : 'Eroare la verificare ANAF.';
		} finally {
			anafLoading = false;
		}
	}

	function formatCard(v: string): string {
		return v
			.replace(/\s/g, '')
			.replace(/(.{4})/g, '$1 ')
			.trim();
	}

	// Track which value was most recently copied so we can flip the icon to a
	// brief checkmark — short-lived per-key feedback without overlaying a toast.
	let copiedKey = $state<string | null>(null);
	let copyResetTimer: ReturnType<typeof setTimeout> | null = null;

	async function copyToClipboard(value: string, label: string, key: string) {
		// Optimistic visual feedback first — the icon swap is just an affordance
		// that the click registered. The actual copy can fail in iframes/sandboxes
		// where clipboard permission is restricted; the user still sees the
		// success cue and we surface an explicit error toast only on hard failure.
		copiedKey = key;
		if (copyResetTimer) clearTimeout(copyResetTimer);
		copyResetTimer = setTimeout(() => {
			if (copiedKey === key) copiedKey = null;
		}, 1500);

		let ok = false;
		try {
			await navigator.clipboard.writeText(value);
			ok = true;
		} catch {
			try {
				const tmp = document.createElement('textarea');
				tmp.value = value;
				tmp.style.position = 'fixed';
				tmp.style.opacity = '0';
				document.body.appendChild(tmp);
				tmp.select();
				ok = document.execCommand('copy');
				document.body.removeChild(tmp);
			} catch {
				ok = false;
			}
		}
		if (ok) {
			toast.success(`${label} copiat în clipboard`);
		} else {
			toast.error('Nu am putut copia. Selectează manual cu Cmd/Ctrl+C.');
		}
	}

	function paymentMethodLabel(m: typeof paymentMethod): string {
		switch (m) {
			case 'card':
				return 'Card bancar (Visa/Mastercard)';
			case 'op':
				return 'Ordin de plată';
			case 'revolut':
				return 'Revolut Pay';
			case 'paypal':
				return 'PayPal';
		}
	}

	async function next() {
		// Hard guard: stepMissing is the user-visible reason "Continuă" should be
		// disabled; never advance past it even if the button is somehow clickable.
		if (stepMissing) {
			toast.error(stepMissing);
			return;
		}
		if (step === 3) {
			// Card flow: PaymentIntent is created eagerly by the auto-init $effect
			// when the user lands on step 3, so the inline form is already mounted.
			// The "Plătește" button here is single-purpose: confirm the payment.
			if (paymentMethod === 'card') {
				if (cardStage === 'ready') {
					await confirmInlinePayment();
				}
				// idle/creating-intent/confirming: button is either disabled or the
				// auto-init is still in flight — no-op.
				return;
			}
			// Non-card (Ordin de plată, future Revolut/PayPal): submit the order
			// which redirects to a hosted checkout page (or completes the OP flow).
			await submit();
		} else if (step === 1) {
			step = 2;
		} else if (step === 2) {
			// Kick off the Stripe init in parallel with the step transition. The
			// server roundtrip + PaymentIntent creation is the slow part (~1-3s);
			// firing it here overlaps that latency with the step-change animation
			// and gives the user a much shorter wait at step 3. The $effect below
			// still acts as a safety net if cardStage somehow stays idle on step 3
			// (HMR, future routing, etc.).
			if (
				paymentMethod === 'card' &&
				cardStage === 'idle' &&
				!cardInitTriggered &&
				!cardInitError
			) {
				cardInitTriggered = true;
				debugLog('eager-init at step 2 → step 3 transition (parallelize with step animation)');
				void tryAutoInitStripe();
			}
			step = 3;
		}
	}

	// Wrapper used by the auto-init $effect. submit() handles its own errors and
	// sets submitError on failure; we lift the same message into cardInitError so
	// the card-form area can render an inline retry button instead of stranding
	// the user on the bottom-of-modal error banner.
	async function tryAutoInitStripe() {
		// Capture the form fingerprint BEFORE submitting so we have a stable
		// "this is what the PaymentIntent was created with" reference, even if
		// the user starts editing while the server roundtrip is in flight.
		const hashAtInit = step2PayloadHash;
		await submit({ requireTerms: false });
		if (cardStage === 'ready') {
			// Success — snapshot the fingerprint so the invalidation $effect can
			// detect future edits to email / billing identity / amount / etc. and
			// tear down the stale PaymentIntent.
			lastSubmittedHash = hashAtInit;
			debugLog('lastSubmittedHash captured after successful PaymentIntent creation');
		}
		if (cardStage === 'idle' && submitError) {
			cardInitError = submitError;
			submitError = null;
		}
	}

	function retryCardInit() {
		debugLog('retryCardInit() — user-triggered retry after init error');
		cardInitTriggered = false;
		cardInitError = null;
		submitError = null;
		// $effect picks this up on the next microtask and re-runs tryAutoInitStripe().
	}

	async function submit(opts: { requireTerms?: boolean } = {}) {
		const requireTerms = opts.requireTerms ?? true;
		debugLog('submit() start', {
			step,
			paymentMethod,
			billingType,
			requireTerms,
			email: maskEmail(email.trim()),
			cuiTail: maskTail(cui.trim(), 4),
			hasCompanyName: companyName.trim().length > 0,
			domainMode,
			hasNewDomain: !!domainName,
			hasExistingDomain: !!existingDomain,
			period,
			total
		});
		submitError = null;
		paymentError = null;
		if (requireTerms && !acceptTerms) {
			debugLog('submit() blocked — terms not accepted');
			toast.error('Bifează termenii și condițiile.');
			return;
		}
		if (!email.trim() || validateEmail(email.trim()) !== null) {
			toast.error('Email invalid. Întoarce-te la pasul 2.');
			step = 2;
			return;
		}
		if (billingType === 'company' && (!companyName.trim() || !cui.trim())) {
			toast.error('Pentru factură pe firmă, completează denumirea și CUI-ul.');
			step = 2;
			return;
		}
		if (billingType === 'person' && (!firstName.trim() || !lastName.trim())) {
			toast.error('Pentru persoană fizică, completează prenumele și numele.');
			step = 2;
			return;
		}
		submitting = true;
		if (paymentMethod === 'card') cardStage = 'creating-intent';
		try {
			const notesParts: string[] = [];
			// Resolve which domain the client picked into a single canonical value
			// the CRM can store + pre-fill in the provisioning form.
			let chosenDomain = '';
			if (domainMode === 'buy' && domainName) {
				chosenDomain = `${domainName}${domainTld}`.toLowerCase();
				notesParts.push(`Domeniu nou: ${chosenDomain} (${tldPrice} RON/an)`);
			} else if (domainMode === 'have' && existingDomain) {
				chosenDomain = existingDomain.trim().toLowerCase();
				notesParts.push(`Domeniu existent (DNS update): ${chosenDomain}`);
			} else if (domainMode === 'transfer' && existingDomain) {
				chosenDomain = existingDomain.trim().toLowerCase();
				notesParts.push(`Transfer domeniu: ${chosenDomain}`);
			}
			notesParts.push(`Metodă plată preferată: ${paymentMethodLabel(paymentMethod)}`);
			notesParts.push(`Facturare: ${period === 'yearly' ? 'anuală' : 'lunară'}`);
			if (orderNotes.trim()) notesParts.push(`Note client: ${orderNotes.trim()}`);

			debugLog('submitHostingOrder → request', {
				hostingProductId: plan.id,
				paymentMode: paymentMethod === 'card' ? 'payment_intent' : 'checkout_redirect',
				paymentMethod,
				billingType,
				email: maskEmail(email.trim()),
				cuiTail: maskTail(cui.trim(), 4),
				hasRequestedDomain: !!chosenDomain
			});
			const result = await submitHostingOrder({
				hostingProductId: plan.id,
				billingType,
				email: email.trim(),
				phone: phone.trim() || undefined,
				// Company-only fields (server ignores when billingType=person)
				cui: billingType === 'company' ? cui.trim() : undefined,
				companyName: billingType === 'company' ? companyName.trim() : undefined,
				registrationNumber: billingType === 'company' ? regCom.trim() || undefined : undefined,
				vatPayer: billingType === 'company' ? vatPayer : false,
				// Person-only fields
				firstName: billingType === 'person' ? firstName.trim() : undefined,
				lastName: billingType === 'person' ? lastName.trim() : undefined,
				// Shared address
				address: address.trim() || undefined,
				postalCode: postalCode.trim() || undefined,
				city: city.trim() || undefined,
				county: county.trim() || undefined,
				consentTerms: true,
				notes: notesParts.join(' · '),
				paymentMode: paymentMethod === 'card' ? 'payment_intent' : 'checkout_redirect',
				paymentMethod,
				requestedDomain: chosenDomain || undefined,
				domainName: (domainName + domainTld).toLowerCase(),
				domainMode,
				domainCostCents: domainMode === 'buy' ? Math.round(tldPrice * 100) : 0
			});

			// Don't dump the whole result object — server might add new fields, and
			// `paymentIntent.clientSecret` is sensitive (Stripe expects only the
			// confirming origin to ever see the full secret). Log structural shape.
			debugLog('submitHostingOrder ← response shape', {
				duplicateCui: result.duplicateCui ?? false,
				hasPaymentIntent: 'paymentIntent' in result && !!result.paymentIntent,
				hasCheckoutUrl: 'checkoutUrl' in result && !!(result as { checkoutUrl?: string }).checkoutUrl,
				inquiryId: 'inquiryId' in result ? (result as { inquiryId?: string }).inquiryId : null
			});

			if (result.duplicateCui) {
				debugLog('result branch: duplicateCui → success step (existing client)', {
					hasMessage: !!result.message,
					inquiryId: result.inquiryId
				});
				toast.success(result.message);
				orderId = result.inquiryId ?? null;
				isExistingClient = true;
				step = 4;
				return;
			}

			// Card flow → embedded Stripe Elements
			if ('paymentIntent' in result && result.paymentIntent) {
				debugLog('result branch: paymentIntent → mount Stripe Elements', {
					inquiryId: result.inquiryId,
					paymentIntentId: result.paymentIntent.paymentIntentId,
					subscriptionId: result.paymentIntent.subscriptionId,
					mode: result.paymentIntent.mode,
					// Only log a 6-char tail of the clientSecret (NOT a prefix — the
					// prefix is the PI id which we already log). Stripe's docs treat
					// the full secret as bearer-like for its origin/intent pair.
					clientSecretTail: maskTail(result.paymentIntent.clientSecret, 6),
					publishableKeyPrefix: result.paymentIntent.publishableKey?.slice(0, 14) + '…'
				});
				orderId = result.inquiryId ?? null;
				paymentClientSecret = result.paymentIntent.clientSecret;
				paymentPublishableKey = result.paymentIntent.publishableKey;
				paymentIntentId = result.paymentIntent.paymentIntentId;
				debugLog('loadStripe() — loading Stripe.js bundle');
				const tLoad = performance.now();
				const stripe = await loadStripe(result.paymentIntent.publishableKey);
				debugLog(`loadStripe() done in ${Math.round(performance.now() - tLoad)}ms`, {
					ok: !!stripe
				});
				if (!stripe) {
					throw new Error('Stripe.js nu s-a putut încărca. Verifică conexiunea.');
				}
				stripeJs = stripe;
				cardStage = 'ready';
				return;
			}

			// Legacy redirect flow (ordin de plată, future PayPal/Revolut)
			if ('checkoutUrl' in result && result.checkoutUrl) {
				debugLog('result branch: checkoutUrl → redirect', {
					checkoutUrl: result.checkoutUrl,
					inquiryId: result.inquiryId
				});
				orderId = result.inquiryId ?? null;
				window.location.href = result.checkoutUrl;
				return;
			}
			debugLog('result branch: ??? unrecognized shape', result);
			toast.error('Stripe nu a returnat un mod de plată valid.');
			cardStage = 'idle';
		} catch (e) {
			debugLog('submit() ERROR', {
				name: e instanceof Error ? e.name : typeof e,
				message: e instanceof Error ? e.message : String(e),
				body: (e as { body?: unknown })?.body
			});
			cardStage = 'idle';
			// SvelteKit HttpError thrown server-side via error(status, msg) lands here
			// with .body.message. Plain Error has .message directly. Generic fallback
			// for unexpected throws.
			const httpBody = (e as { body?: { message?: string } })?.body;
			const msg =
				httpBody?.message ||
				(e instanceof Error ? e.message : '') ||
				'Eroare la procesare. Te rugăm să încerci din nou.';
			submitError = msg;
			toast.error(msg);
		} finally {
			submitting = false;
		}
	}

	async function confirmInlinePayment() {
		debugLog('confirmInlinePayment() start', {
			stripeReady: !!stripeJs,
			elementsReady: !!stripeElements,
			clientSecretPresent: !!paymentClientSecret,
			paymentIntentId,
			acceptTerms
		});
		// Terms check moved here — submit() no longer requires acceptTerms because
		// the auto-init path creates the PaymentIntent before the user has had a
		// chance to tick the box. The actual contract is formed at confirm time.
		if (!acceptTerms) {
			debugLog('confirmInlinePayment() blocked — terms not accepted');
			toast.error('Bifează termenii și condițiile.');
			return;
		}
		if (!stripeJs || !stripeElements || !paymentClientSecret) {
			debugLog('confirmInlinePayment() blocked — form not ready');
			paymentError = 'Formularul de plată nu este pregătit. Reîncarcă pagina.';
			return;
		}
		paymentError = null;
		cardStage = 'confirming';
		submitting = true;
		try {
			const returnUrl = `${window.location.origin}/pachete-hosting/comanda/success`;
			debugLog('stripe.confirmPayment() → request', { returnUrl, redirect: 'if_required' });
			const tConfirm = performance.now();
			const { error: confirmErr, paymentIntent: confirmedPI } = await stripeJs.confirmPayment({
				elements: stripeElements,
				confirmParams: { return_url: returnUrl },
				redirect: 'if_required'
			});
			debugLog(`stripe.confirmPayment() done in ${Math.round(performance.now() - tConfirm)}ms`, {
				error: confirmErr
					? { type: confirmErr.type, code: confirmErr.code, message: confirmErr.message }
					: null,
				paymentIntent: confirmedPI
					? {
							id: confirmedPI.id,
							status: confirmedPI.status,
							amount: confirmedPI.amount,
							currency: confirmedPI.currency,
							nextAction: confirmedPI.next_action?.type ?? null
						}
					: null
			});

			if (confirmErr) {
				paymentError =
					confirmErr.message ||
					'Plata nu a putut fi confirmată. Verifică datele cardului și încearcă din nou.';
				cardStage = 'ready';
				toast.error(paymentError);
				return;
			}

			// `redirect: 'if_required'` means we get here without redirect on success
			// or when a 3DS challenge isn't needed.
			if (confirmedPI?.status === 'succeeded' || confirmedPI?.status === 'processing') {
				debugLog(`payment ${confirmedPI.status} → step 4`);
				cardStage = 'paid';
				step = 4;
				return;
			}
			if (confirmedPI?.status === 'requires_action') {
				debugLog('payment requires_action — Stripe will redirect via return_url');
				// Stripe will redirect via return_url for off-session 3DS.
				return;
			}
			debugLog('payment unexpected status', { status: confirmedPI?.status });
			paymentError = `Stare neașteptată: ${confirmedPI?.status ?? 'unknown'}`;
			cardStage = 'ready';
		} catch (e) {
			debugLog('confirmInlinePayment() THROWN ERROR', {
				name: e instanceof Error ? e.name : typeof e,
				message: e instanceof Error ? e.message : String(e)
			});
			const msg = e instanceof Error ? e.message : 'Eroare la confirmarea plății.';
			paymentError = msg;
			toast.error(msg);
			cardStage = 'ready';
		} finally {
			submitting = false;
		}
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && step < 4) onClose();
	}

	$effect(() => {
		document.addEventListener('keydown', handleKey);
		const prev = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.removeEventListener('keydown', handleKey);
			document.body.style.overflow = prev;
		};
	});
</script>

<div
	class="co-overlay"
	role="dialog"
	aria-modal="true"
	tabindex="-1"
	onclick={(e) => {
		if (e.target === e.currentTarget && step < 4) onClose();
	}}
	onkeydown={(e) => {
		if (e.key === 'Escape' && e.target === e.currentTarget && step < 4) onClose();
	}}
>
	<div class="co-sheet">
		<!-- Top bar -->
		<div class="co-topbar">
			<div class="co-logo">
				<img src="/onetop-logo.png" alt="One Top Solution" />
			</div>
			<div class="co-secure">
				<LockIcon size={13} />
				<span>Plată securizată · SSL 256-bit</span>
			</div>
			{#if step < 4}
				<button type="button" class="co-close" onclick={onClose}>
					<XIcon size={14} /> Închide
				</button>
			{/if}
		</div>

		{#if step < 4}
			<div class="co-stepper">
				{#each [{ n: 1, label: 'Domeniu' }, { n: 2, label: 'Date & cont' }, { n: 3, label: 'Plată' }] as s, i (s.n)}
					<div
						class="co-step {step === s.n ? 'active' : ''} {step > s.n ? 'done' : ''}"
					>
						<div class="co-step-circle">
							{#if step > s.n}
								<CheckIcon size={14} />
							{:else if s.n === 1}
								<GlobeIcon size={14} />
							{:else if s.n === 2}
								<UsersIcon size={14} />
							{:else}
								<CreditCardIcon size={14} />
							{/if}
						</div>
						<div class="co-step-label">
							<div class="co-step-num">PAS {s.n}</div>
							<div>{s.label}</div>
						</div>
					</div>
					{#if i < 2}
						<div class="co-step-line {step > s.n ? 'done' : ''}"></div>
					{/if}
				{/each}
			</div>
		{/if}

		<!-- Body -->
		<div class="co-body" class:co-body-single={step === 4}>
			<div class="co-content">
				{#if step === 1}
					<h2 class="co-h2">Conectează domeniul</h2>
					<p class="co-sub">
						{#if ENABLE_DOMAIN_BUY || ENABLE_DOMAIN_TRANSFER}
							Site-ul tău are nevoie de o adresă pe web. Cumpără un domeniu nou de la noi sau
							conectează unul pe care îl ai deja.
						{:else}
							Introdu domeniul pe care îl deții deja — îți trimitem după plată instrucțiunile cu
							serverele noastre DNS și migrăm site-ul fără timp de nefuncționare.
						{/if}
					</p>

					{#if ENABLE_DOMAIN_BUY || ENABLE_DOMAIN_TRANSFER}
						<div class="co-tabs">
							{#if ENABLE_DOMAIN_BUY}
								<button
									type="button"
									class={domainMode === 'buy' ? 'active' : ''}
									onclick={() => (domainMode = 'buy')}
								>
									<ShoppingBagIcon size={14} /> Vreau să cumpăr un domeniu nou
								</button>
							{/if}
							<button
								type="button"
								class={domainMode === 'have' ? 'active' : ''}
								onclick={() => (domainMode = 'have')}
							>
								<GlobeIcon size={14} /> Am deja un domeniu
							</button>
							{#if ENABLE_DOMAIN_TRANSFER}
								<button
									type="button"
									class={domainMode === 'transfer' ? 'active' : ''}
									onclick={() => (domainMode = 'transfer')}
								>
									<RepeatIcon size={14} /> Vreau să transfer un domeniu
								</button>
							{/if}
						</div>
					{/if}

					{#if domainMode === 'buy' && ENABLE_DOMAIN_BUY}
						<div class="co-domain-row">
							<input
								class="co-input co-input-lg"
								placeholder="exemplu-site"
								value={domainName}
								oninput={(e) => {
									const raw = (e.currentTarget as HTMLInputElement).value;
									domainName = raw.toLowerCase().replace(/[^a-z0-9-]/g, '');
								}}
							/>
							<select
								class="co-tld-select"
								value={domainTld}
								onchange={(e) => (domainTld = (e.currentTarget as HTMLSelectElement).value)}
							>
								{#each TLDs as t (t.tld)}
									<option value={t.tld}>{t.tld}</option>
								{/each}
							</select>
						</div>

						{#if domainName && domainSearch}
							<div class="co-domain-result {domainSearch.taken ? 'taken' : 'available'}">
								{#if domainSearch.taken}
									<XIcon size={16} />
									<div>
										<strong>{domainName}{domainTld} este ocupat</strong>
										<div>Încearcă altă combinație sau alt TLD</div>
									</div>
								{:else}
									<CheckIcon size={16} />
									<div>
										<strong>{domainName}{domainTld} este disponibil!</strong>
										<div>Înregistrare 1 an · {tldPrice} RON</div>
									</div>
									<div class="co-domain-badge">Disponibil</div>
								{/if}
							</div>
						{/if}

						{#if domainName && !domainSearch?.taken}
							<div class="co-suggestions">
								<div class="co-sugg-label">Sugestii similare</div>
								<div class="co-sugg-grid">
									{#each TLDs.filter((t) => t.tld !== domainTld).slice(0, 4) as t (t.tld)}
										<button
											type="button"
											class="co-sugg"
											onclick={() => (domainTld = t.tld)}
										>
											<span>{domainName}<strong>{t.tld}</strong></span>
											<span class="co-sugg-price">{t.price} RON</span>
										</button>
									{/each}
								</div>
							</div>
						{/if}
					{:else}
						{@const inputIsEmpty = existingDomain.trim().length === 0}
						{@const showInlineError = !!existingDomainError && inputIsEmpty}
						{@const showBelowError = !!existingDomainError && !inputIsEmpty}
						{@const daTaken = daCheckStatus === 'taken'}
						{@const isValid =
							!inputIsEmpty &&
							domainTouched &&
							!existingDomainError &&
							daCheckStatus === 'available'}
						{@const inputHasError = !!existingDomainError || daTaken}
						<label class="co-label" for="existing-domain">Numele domeniului *</label>
						<input
							id="existing-domain"
							class="co-input co-input-lg"
							class:co-input-error={inputHasError}
							class:co-input-error-placeholder={showInlineError}
							class:co-input-success={isValid}
							placeholder={showInlineError ? existingDomainError : 'ex: firma-mea.ro'}
							autocomplete="off"
							spellcheck="false"
							value={existingDomain}
							oninput={(e) => {
								existingDomain = normalizeDomainInput((e.currentTarget as HTMLInputElement).value);
							}}
							onblur={() => {
								domainTouched = true;
								existingDomain = normalizeDomainInput(existingDomain);
								if (!validateExistingDomain(existingDomain)) {
									runDomainCheck(existingDomain);
								}
							}}
						/>
						{#if showBelowError}
							<div class="co-hint co-hint-err">{existingDomainError}</div>
						{:else if daCheckStatus === 'loading'}
							<div class="co-hint co-hint-loading">
								<span class="co-spin" aria-hidden="true"></span>
								Verificăm dacă domeniul e disponibil pe serverele OTS…
							</div>
						{:else if daCheckStatus === 'taken'}
							<div class="co-hint co-hint-err">
								Acest domeniu este deja găzduit pe serverele noastre. Dacă e al tău,
								<button type="button" class="co-hint-link" onclick={onClose}>contactează un consultant</button>
								pentru migrare; altfel alege alt nume.
							</div>
						{:else if daCheckStatus === 'unknown'}
							<div class="co-hint co-hint-warn">
								Verificarea automată a domeniului nu e disponibilă acum. Confirmăm definitiv
								la finalizarea comenzii — dacă domeniul e deja la noi, te contactăm înainte de
								a încasa plata.
							</div>
						{:else if daCheckStatus === 'error'}
							<div class="co-hint co-hint-warn">
								Nu am putut verifica disponibilitatea acum. Treci mai departe — verificăm din
								nou la finalizare.
							</div>
						{:else if daCheckStatus === 'available'}
							<div class="co-hint co-hint-ok">
								<CheckIcon size={12} />
								Domeniu valid și disponibil
							</div>
						{:else if existingDomain && domainTouched && !existingDomainError}
							<div class="co-hint co-hint-ok">
								<CheckIcon size={12} />
								Domeniu valid
							</div>
						{:else if !showInlineError}
							<div class="co-hint">
								Litere mici, cifre, „-" și „.". Domeniul devine contul principal de hosting
								(ex: firma-mea.ro).
							</div>
						{/if}
						<div class="co-info-box">
							<InfoIcon size={16} />
							{#if domainMode === 'have'}
								<div>
									<strong>Modifică DNS-urile la registratorul tău</strong>
									<div>
										După plată îți trimitem instrucțiunile cu serverele noastre DNS
										(ns1/ns2.onetopsolution.ro). Propagarea durează 2-24h.
									</div>
								</div>
							{:else}
								<div>
									<strong>Transfer gratuit între registratori</strong>
									<div>
										Cere codul EPP de la providerul actual și ți-l introducem în formular după
										plată. Transferul durează 5-7 zile și include 1 an gratuit la noi.
									</div>
								</div>
							{/if}
						</div>
					{/if}
				{:else if step === 2}
					<h2 class="co-h2">Date de contact &amp; cont</h2>
					<p class="co-sub">
						Avem nevoie de un email pentru a-ți trimite acces la panoul tău + factura.
					</p>

					<section class="co-form-section">
						<div class="co-form-section-head">
							<h3>Contul tău</h3>
							<div class="co-segmented">
								<button
									type="button"
									class={newAccount ? 'active' : ''}
									onclick={() => (newAccount = true)}>Cont nou</button
								>
								<button
									type="button"
									class={!newAccount ? 'active' : ''}
									onclick={() => (newAccount = false)}>Am deja cont</button
								>
							</div>
						</div>
						<div class="co-grid-2">
							<div class="co-field">
								<label class="co-label" for="acct-email">Email *</label>
								<input
									id="acct-email"
									class="co-input"
									class:co-input-error={!!emailFormatError}
									class:co-input-success={emailTouched && !emailFormatError && email.trim().length > 0}
									type="email"
									placeholder="contact@firma.ro"
									autocomplete="email"
									value={email}
									oninput={(e) => (email = (e.currentTarget as HTMLInputElement).value)}
									onblur={() => {
										emailTouched = true;
										email = normalizeEmail(email);
										if (!validateEmail(email)) runEmailCrmCheck(email);
									}}
								/>
								{#if emailFormatError}
									<div class="co-hint co-hint-err">{emailFormatError}</div>
								{:else if isPersonalEmailWarn}
									<div class="co-hint co-hint-warn">
										Email personal (gmail/yahoo etc.) pentru factură pe firmă. Recomandăm un email
										corporativ (ex: contact@firma.ro).
									</div>
								{:else if emailTouched && !emailFormatError && email.trim()}
									<!-- Conditional, non-confirming hint: tells the user a login route
									     exists but never reveals whether this specific email is registered.
									     Shown for every valid email so an attacker can't distinguish
									     "known" from "unknown" via the UI. -->
									<div class="co-hint co-hint-ok">
										<CheckIcon size={12} /> Email valid.
										<span class="co-hint-muted">
											Dacă ai deja cont OTS,
											<a
												class="co-hint-link"
												href="/login?email={encodeURIComponent(normalizeEmail(email))}"
												target="_blank"
												rel="noopener">autentifică-te</a
											>
											ca să comanzi din contul existent.
										</span>
									</div>
								{:else}
									<div class="co-hint">Aici trimitem factura + accesul la panoul de administrare.</div>
								{/if}
							</div>
							<!-- Password field intentionally removed: contul se creează silent post-plată,
								 fără parolă în checkout. Acces ulterior prin magic-link (TODO Sprint 8.1).
								 Reintroducerea câmpului doar dacă wire-uim payload-ul prin OrderSchema. -->
						</div>
					</section>

					<section class="co-form-section">
						<div class="co-form-section-head">
							<h3>Date facturare</h3>
							<div class="co-segmented">
								<button
									type="button"
									class={billingType === 'person' ? 'active' : ''}
									onclick={() => (billingType = 'person')}>Persoană fizică</button
								>
								<button
									type="button"
									class={billingType === 'company' ? 'active' : ''}
									onclick={() => (billingType = 'company')}>Persoană juridică</button
								>
							</div>
						</div>

						{#if billingType === 'person'}
							<div class="co-grid-2">
								<div class="co-field">
									<label class="co-label" for="b-first">Prenume *</label>
									<input
										id="b-first"
										class="co-input"
										class:co-input-error={!!firstNameError}
										class:co-input-success={firstNameTouched && !firstNameError && firstName.trim()}
										value={firstName}
										oninput={(e) => (firstName = (e.currentTarget as HTMLInputElement).value)}
										onblur={() => (firstNameTouched = true)}
									/>
									{#if firstNameError}
										<div class="co-hint co-hint-err">{firstNameError}</div>
									{/if}
								</div>
								<div class="co-field">
									<label class="co-label" for="b-last">Nume *</label>
									<input
										id="b-last"
										class="co-input"
										class:co-input-error={!!lastNameError}
										class:co-input-success={lastNameTouched && !lastNameError && lastName.trim()}
										value={lastName}
										oninput={(e) => (lastName = (e.currentTarget as HTMLInputElement).value)}
										onblur={() => (lastNameTouched = true)}
									/>
									{#if lastNameError}
										<div class="co-hint co-hint-err">{lastNameError}</div>
									{/if}
								</div>
							</div>
							<div class="co-info-box" style="margin-top: 14px;">
								<InfoIcon size={16} />
								<div>
									<strong>Plată online ca persoană fizică</strong>
									<div>
										Factura se emite pe numele complet introdus mai sus. Plata securizată prin
										Stripe (card, Apple Pay, Google Pay). Fără CUI necesar.
									</div>
								</div>
							</div>
						{:else}
							<div class="co-grid-2">
								<div class="co-field co-span-2">
									<label class="co-label" for="b-cui">CUI *</label>
									<div class="co-cui-row">
										<input
											id="b-cui"
											class="co-input"
											class:co-input-error={!!cuiError}
											class:co-input-success={cuiTouched && !cuiError && anafFilled}
											placeholder="RO12345678 sau 12345678"
											value={cui}
											oninput={(e) => (cui = (e.currentTarget as HTMLInputElement).value)}
											onblur={() => {
												cuiTouched = true;
												cui = normalizeCuiVal(cui);
												if (cui && !validateCuiFormat(cui) && !anafFilled && !anafLoading) lookupAnaf();
											}}
										/>
										<button
											type="button"
											class="co-btn-ghost"
											disabled={anafLoading || !cui.trim()}
											onclick={lookupAnaf}
										>
											{anafLoading ? 'Verifică…' : 'Verifică ANAF'}
										</button>
									</div>
									{#if cuiError}
										<div class="co-hint co-hint-err">{cuiError}</div>
									{:else if anafError}
										<div class="co-hint co-hint-err">{anafError}</div>
									{:else if anafLoading}
										<div class="co-hint co-hint-loading">
											<span class="co-spin" aria-hidden="true"></span>
											Verificăm la ANAF…
										</div>
									{:else if anafFilled}
										<div class="co-hint co-hint-ok">
											<CheckIcon size={12} /> Date completate automat din ANAF — verifică și
											corectează la nevoie.
										</div>
									{:else}
										<div class="co-hint">Doar cifre. Prefixul RO se elimină automat.</div>
									{/if}
								</div>
								<div class="co-field co-span-2">
									<label class="co-label" for="b-company">Denumire firmă *</label>
									<input
										id="b-company"
										class="co-input"
										class:co-input-error={!!companyNameError}
										class:co-input-success={companyNameTouched && !companyNameError && companyName.trim()}
										placeholder="Firma SRL"
										value={companyName}
										oninput={(e) => (companyName = (e.currentTarget as HTMLInputElement).value)}
										onblur={() => (companyNameTouched = true)}
									/>
									{#if companyNameError}
										<div class="co-hint co-hint-err">{companyNameError}</div>
									{/if}
								</div>
								<div class="co-field">
									<label class="co-label" for="b-regcom">Reg. Comerțului *</label>
									<input
										id="b-regcom"
										class="co-input"
										class:co-input-error={!!regComError}
										class:co-input-success={regComTouched && !regComError && regCom.trim()}
										placeholder="J33/1520/2018"
										value={regCom}
										oninput={(e) => (regCom = (e.currentTarget as HTMLInputElement).value)}
										onblur={() => {
											regComTouched = true;
											regCom = normalizeRegCom(regCom);
										}}
									/>
									{#if regComError}
										<div class="co-hint co-hint-err">{regComError}</div>
									{/if}
								</div>
								<div class="co-field">
									<label class="co-label" for="b-vatp">TVA</label>
									<select
										id="b-vatp"
										class="co-input"
										value={vatPayer ? 'yes' : 'no'}
										onchange={(e) => {
											vatPayer = (e.currentTarget as HTMLSelectElement).value === 'yes';
										}}
									>
										<option value="no">Neplătitor TVA</option>
										<option value="yes">Plătitor TVA</option>
									</select>
								</div>
							</div>
						{/if}

						<div class="co-grid-2" style="margin-top: 14px;">
							<div class="co-field co-span-2">
								<label class="co-label" for="b-address">Adresă *</label>
								<input
									id="b-address"
									class="co-input"
									class:co-input-error={!!addressError}
									class:co-input-success={addressTouched && !addressError && address.trim().length >= 5}
									placeholder="Strada, număr, bloc, scară, apartament"
									value={address}
									oninput={(e) => (address = (e.currentTarget as HTMLInputElement).value)}
									onblur={() => (addressTouched = true)}
								/>
								{#if addressError}
									<div class="co-hint co-hint-err">{addressError}</div>
								{/if}
							</div>
							<div class="co-field">
								<label class="co-label" for="b-city">Oraș *</label>
								<input
									id="b-city"
									class="co-input"
									class:co-input-error={!!cityError}
									class:co-input-success={cityTouched && !cityError && city.trim().length >= 2}
									value={city}
									oninput={(e) => (city = (e.currentTarget as HTMLInputElement).value)}
									onblur={() => (cityTouched = true)}
								/>
								{#if cityError}
									<div class="co-hint co-hint-err">{cityError}</div>
								{/if}
							</div>
							<div class="co-field">
								<label class="co-label" for="b-county">Județ</label>
								<select id="b-county" class="co-input" bind:value={county}>
									<option value="">— Selectează —</option>
									{#each COUNTIES as c (c)}
										<option value={c}>{c}</option>
									{/each}
								</select>
							</div>
							<div class="co-field">
								<label class="co-label" for="b-postal">Cod poștal</label>
								<input
									id="b-postal"
									class="co-input"
									class:co-input-error={!!postalError}
									class:co-input-success={postalTouched && !postalError && postalCode.trim()}
									placeholder={county ? '720117' : 'ex: 720117 sau SW1A 1AA'}
									value={postalCode}
									oninput={(e) => (postalCode = (e.currentTarget as HTMLInputElement).value)}
									onblur={() => (postalTouched = true)}
								/>
								{#if postalError}
									<div class="co-hint co-hint-err">{postalError}</div>
								{/if}
							</div>
							<div class="co-field">
								<label class="co-label" for="b-phone">Telefon *</label>
								<input
									id="b-phone"
									class="co-input"
									class:co-input-error={!!phoneError}
									class:co-input-success={phoneTouched && !phoneError && phone.trim()}
									placeholder="07XX XXX XXX, 021 XXX XXXX sau +40 / +XX..."
									value={phone}
									oninput={(e) => (phone = (e.currentTarget as HTMLInputElement).value)}
									onblur={() => {
										phoneTouched = true;
										const ck = checkPhone(phone);
										if (ck.kind !== 'invalid') phone = ck.display;
									}}
								/>
								{#if phoneError}
									<div class="co-hint co-hint-err">{phoneError}</div>
								{:else if phoneTouched && phone.trim() && phoneKind === 'international'}
									<div class="co-hint co-hint-warn">
										Telefon non-RO acceptat. Asigură-te că include prefixul de țară (ex: +34, +49).
									</div>
								{:else if phoneTouched && phone.trim()}
									<div class="co-hint co-hint-ok">
										<CheckIcon size={12} /> Telefon valid
										({phoneKind === 'ro-mobile' ? 'mobil' : 'fix'} RO)
									</div>
								{/if}
							</div>
						</div>
					</section>
				{:else if step === 3}
					<h2 class="co-h2">Plata</h2>
					<p class="co-sub">
						Alege metoda de plată. Toate plățile sunt procesate securizat de Stripe — datele
						cardului nu trec niciodată prin serverele noastre.
					</p>

					<div class="co-pay-methods">
						<button
							type="button"
							class="co-pay-tile {paymentMethod === 'card' ? 'selected' : ''}"
							onclick={() => (paymentMethod = 'card')}
						>
							<CreditCardIcon size={18} />
							<div>
								<strong>Card bancar</strong>
								<span>Visa · Mastercard · Maestro</span>
							</div>
							<div class="co-pay-badges">
								<div class="co-card-mark visa active">VISA</div>
								<div class="co-card-mark mc active">●●</div>
							</div>
						</button>
						<button
							type="button"
							class="co-pay-tile {paymentMethod === 'op' ? 'selected' : ''}"
							onclick={() => (paymentMethod = 'op')}
						>
							<Building2Icon size={18} />
							<div>
								<strong>Ordin de plată</strong>
								<span>Pentru firme · primești proforma pe email</span>
							</div>
						</button>
						{#if ENABLE_REVOLUT}
							<button
								type="button"
								class="co-pay-tile {paymentMethod === 'revolut' ? 'selected' : ''}"
								onclick={() => (paymentMethod = 'revolut')}
							>
								<ZapIcon size={18} />
								<div>
									<strong>Revolut Pay</strong>
									<span>Plată instant cu un click</span>
								</div>
							</button>
						{/if}
						{#if ENABLE_PAYPAL}
							<button
								type="button"
								class="co-pay-tile {paymentMethod === 'paypal' ? 'selected' : ''}"
								onclick={() => (paymentMethod = 'paypal')}
							>
								<DollarSignIcon size={18} />
								<div>
									<strong>PayPal</strong>
									<span>Plătește cu contul tău PayPal</span>
								</div>
							</button>
						{/if}
					</div>

					{#if paymentMethod === 'op'}
						{@const cuiDisplay = bankInfo?.vatNumber || bankInfo?.cui}
						<div class="co-bank-card">
							<div class="co-bank-card-head">
								<Building2Icon size={14} />
								Detalii pentru transfer bancar
							</div>
							{#if bankInfo?.name}
								<div class="co-bank-row">
									<span>Beneficiar</span>
									<strong>{bankInfo.name.replace(/\.+$/, '')}</strong>
								</div>
							{/if}
							{#if cuiDisplay}
								<div class="co-bank-row co-bank-row-copy">
									<span>CUI</span>
									<div class="co-bank-val">
										<strong>{cuiDisplay}</strong>
										<button
											type="button"
											class="co-copy-btn"
											aria-label="Copiază CUI"
											title="Copiază CUI"
											onclick={() => copyToClipboard(cuiDisplay, 'CUI', 'cui')}
										>
											{#if copiedKey === 'cui'}
												<CheckIcon size={13} />
											{:else}
												<CopyIcon size={13} />
											{/if}
										</button>
									</div>
								</div>
							{/if}
							{#if bankInfo?.bankName}
								<div class="co-bank-row">
									<span>Bancă</span>
									<strong>{bankInfo.bankName}</strong>
								</div>
							{/if}
							{#if bankInfo?.iban}
								<div class="co-bank-row co-bank-row-iban co-bank-row-copy">
									<span>IBAN RON</span>
									<div class="co-bank-val">
										<code>{bankInfo.iban}</code>
										<button
											type="button"
											class="co-copy-btn"
											aria-label="Copiază IBAN RON"
											title="Copiază IBAN RON"
											onclick={() => copyToClipboard(bankInfo.iban!, 'IBAN RON', 'iban-ron')}
										>
											{#if copiedKey === 'iban-ron'}
												<CheckIcon size={13} />
											{:else}
												<CopyIcon size={13} />
											{/if}
										</button>
									</div>
								</div>
							{/if}
							{#if bankInfo?.ibanEuro}
								<div class="co-bank-row co-bank-row-iban co-bank-row-copy">
									<span>IBAN EUR</span>
									<div class="co-bank-val">
										<code>{bankInfo.ibanEuro}</code>
										<button
											type="button"
											class="co-copy-btn"
											aria-label="Copiază IBAN EUR"
											title="Copiază IBAN EUR"
											onclick={() => copyToClipboard(bankInfo.ibanEuro!, 'IBAN EUR', 'iban-eur')}
										>
											{#if copiedKey === 'iban-eur'}
												<CheckIcon size={13} />
											{:else}
												<CopyIcon size={13} />
											{/if}
										</button>
									</div>
								</div>
							{/if}
							<div class="co-bank-foot">
								Reprezentarea exactă a IBAN-urilor și CUI-ul apar și pe proforma trimisă pe email
								după plasarea comenzii. Activăm contul după confirmarea încasării (1-2 zile lucrătoare).
							</div>
						</div>
					{:else if cardStage === 'ready' || cardStage === 'confirming'}
						<div class="co-card-form">
							<div class="co-card-form-head">
								<CreditCardIcon size={16} />
								<span>Detalii card</span>
							</div>
							{#if stripeJs && paymentClientSecret}
								<StripeElements
									bind:elements={stripeElements}
									stripe={stripeJs}
									clientSecret={paymentClientSecret}
								>
									<PaymentElement
										options={{ layout: 'tabs' }}
										onready={() => debugLog('PaymentElement READY (mounted, accepting input)')}
										onloaderror={(e) =>
											debugLog('PaymentElement LOADERROR', {
												error:
													e && typeof e === 'object' && 'error' in e
														? (e as { error: unknown }).error
														: e
											})}
										onchange={(e) =>
											debugLog('PaymentElement change', {
												complete:
													e && typeof e === 'object' && 'complete' in e
														? (e as { complete: boolean }).complete
														: undefined,
												empty:
													e && typeof e === 'object' && 'empty' in e
														? (e as { empty: boolean }).empty
														: undefined
											})}
									/>
								</StripeElements>
							{/if}
							{#if paymentError}
								<div class="co-submit-err" role="alert">
									<strong>Plata a eșuat:</strong>
									<span>{paymentError}</span>
								</div>
							{/if}
							<div class="co-info-box co-info-box-compact">
								<InfoIcon size={14} />
								<div>
									Completează datele cardului, bifează termenii, apoi apasă „Confirm plata"
									mai jos. Stripe va cere autentificare 3D Secure dacă banca solicită.
								</div>
							</div>
						</div>
					{:else if cardStage === 'creating-intent'}
						<div class="co-card-form">
							<div class="co-card-form-loading">
								Se inițializează plata securizată…
							</div>
						</div>
					{:else if paymentMethod === 'card' && cardInitError}
						<div class="co-card-form">
							<div class="co-submit-err" role="alert">
								<strong>Nu am putut inițializa plata cu cardul:</strong>
								<span>{cardInitError}</span>
							</div>
							<button
								type="button"
								class="co-btn-ghost co-card-retry"
								onclick={retryCardInit}
							>
								Încearcă din nou
							</button>
						</div>
					{:else if paymentMethod === 'card'}
						<div class="co-card-form">
							<div class="co-card-form-loading">
								Se pregătește plata securizată…
							</div>
						</div>
					{:else}
						<div class="co-info-box">
							<InfoIcon size={16} />
							<div>
								<strong>Plata se face direct aici, securizat prin Stripe</strong>
								<div>
									Selectează o metodă de plată mai sus pentru a continua.
								</div>
							</div>
						</div>
					{/if}

					<div class="co-field" style="margin-top: 20px;">
						<label class="co-label" for="order-notes">Note pentru comandă (opțional)</label>
						<textarea
							id="order-notes"
							class="co-input"
							rows="2"
							placeholder="Vreau migrare cât mai rapidă, am voucher de la consultant, etc..."
							bind:value={orderNotes}
						></textarea>
					</div>

					<div class="co-terms">
						<label class="co-check">
							<input type="checkbox" bind:checked={acceptTerms} />
							<span>
								Am citit și sunt de acord cu <a href="/termeni" target="_blank" rel="noopener"
									>Termenii și condițiile</a
								>
								și <a href="/gdpr" target="_blank" rel="noopener">Politica de confidențialitate</a> *
							</span>
						</label>
						<label class="co-check">
							<input type="checkbox" bind:checked={acceptMarketing} />
							<span>Vreau să primesc oferte și sfaturi tehnice pe email (cancel oricând)</span>
						</label>
					</div>

					<div class="co-secure-line">
						<LockIcon size={13} />
						<span>
							Datele cardului sunt criptate și procesate de Stripe · suntem PCI-DSS Level 1
						</span>
					</div>

					{#if submitError}
						<div class="co-submit-err">
							<strong>Nu am putut procesa comanda:</strong>
							<span>{submitError}</span>
						</div>
					{/if}
				{:else if step === 4}
					<div class="co-success">
						<div class="co-success-icon">
							<CheckIcon size={28} />
						</div>
						<h2 class="co-h2" style="text-align: center;">
							{#if isExistingClient && billingType === 'company'}
								Acest CUI există deja în sistemul nostru.
							{:else if isExistingClient}
								Acest email există deja în sistemul nostru.
							{:else}
								Mulțumim! Comanda este în curs de procesare.
							{/if}
						</h2>
						<p class="co-sub" style="text-align: center; max-width: 520px; margin: 0 auto 28px;">
							{#if isExistingClient}
								Cererea ta este vizibilă la noi pentru contul existent asociat cu
								<strong>{email}</strong>. Autentifică-te pe <a href="/login?email={encodeURIComponent(email)}" target="_blank" rel="noopener">/login</a>
								sau așteaptă să te contacteze echipa OTS pentru continuare.
							{:else}
								Comanda a fost înregistrată cu emailul <strong>{email}</strong>. Stripe îți va trimite chitanța plății, iar echipa OTS te contactează cu accesul la cont după confirmarea încasării.
							{/if}
						</p>

						<div class="co-success-card">
							<div class="co-success-card-head">
								<PackageIcon size={16} />
								<span>Detalii comandă</span>
							</div>
							{#if orderId}
								<div class="co-success-detail">
									<span>ID comandă</span>
									<strong class="co-order-id" title="Referință unică pentru această cerere — folosește-o la suport.">
										#{orderId}
									</strong>
								</div>
							{/if}
							<div class="co-success-detail">
								<span>Pachet</span>
								<strong>Hosting {plan.name}</strong>
							</div>
							{#if domainMode === 'buy' && domainName}
								<div class="co-success-detail">
									<span>Domeniu nou</span>
									<strong style="font-family: ui-monospace, monospace;"
										>{domainName}{domainTld}</strong
									>
								</div>
							{:else if existingDomain}
								<div class="co-success-detail">
									<span>Domeniu</span>
									<strong style="font-family: ui-monospace, monospace;">{existingDomain}</strong>
								</div>
							{/if}
							<div class="co-success-detail">
								<span>Plată</span>
								<strong
									>{paymentMethodLabel(paymentMethod)} · {cycleLabel === 'an'
										? 'anual'
										: 'lunar'}</strong
								>
							</div>
						</div>

						<div class="co-success-next">
							<h3>Următorii pași</h3>
							<ol>
								<li>
									<MailIcon size={14} />
									<div>
										<strong>Chitanța plății pe email</strong>
										<span>
											Stripe îți trimite confirmarea plății la <strong>{email}</strong>
											imediat ce încasarea e confirmată.
										</span>
									</div>
								</li>
								<li>
									<GlobeIcon size={14} />
									<div>
										<strong>
											{domainMode === 'buy'
												? 'Domeniul tău se înregistrează automat'
												: 'Modifică DNS-urile la registrator'}
										</strong>
										<span>
											{domainMode === 'buy'
												? 'Va fi activ în max 4 ore'
												: 'Echipa OTS te contactează cu serverele DNS de configurat'}
										</span>
									</div>
								</li>
								<li>
									<UploadIcon size={14} />
									<div>
										<strong>Activăm contul de hosting</strong>
										<span>
											După confirmarea plății te contactăm cu accesul la panou
											(maxim 24h lucrătoare). Migrare gratuită din alt panou la cerere.
										</span>
									</div>
								</li>
								<li>
									<MessageCircleIcon size={14} />
									<div>
										<strong>Ai o întrebare?</strong>
										<span>
											{#if bankInfo?.phone}Telefon: <strong>{bankInfo.phone}</strong> ·{/if}
											Email:
											<strong>{bankInfo?.email ?? 'office@onetopsolution.ro'}</strong>
										</span>
									</div>
								</li>
							</ol>
						</div>

						<div style="display: flex; gap: 10px; justify-content: center; margin-top: 28px;">
							<button type="button" class="co-btn-ghost" onclick={onClose}>
								Înapoi la pachete
							</button>
							<a class="co-btn-primary" href="/login" style="text-decoration: none;">
								Intră în contul tău <ArrowUpRightIcon size={13} />
							</a>
						</div>
					</div>
				{/if}
			</div>

			{#if step < 4}
				<aside class="co-summary">
					<div class="co-summary-head">Sumar comandă</div>

					<div class="co-cart-item">
						<div class="co-cart-name">
							<strong>Hosting {plan.name}</strong>
							<span>{period === 'yearly' ? 'facturat anual' : 'facturat lunar'}</span>
						</div>
						<div class="co-cart-price">{hostingCost.toLocaleString('ro-RO')} {plan.currency}</div>
					</div>

					{#if domainMode === 'buy' && domainName && !domainSearch?.taken}
						<div class="co-cart-item">
							<div class="co-cart-name">
								<strong>{domainName}{domainTld}</strong>
								<span>Înregistrare 1 an</span>
							</div>
							<div class="co-cart-price">{domainCost} RON</div>
						</div>
					{:else if (domainMode === 'have' || domainMode === 'transfer') && existingDomain}
						<div class="co-cart-item">
							<div class="co-cart-name">
								<strong>{existingDomain}</strong>
								<span
									>{domainMode === 'transfer' ? 'Transfer (gratuit)' : 'Conectare la cont'}</span
								>
							</div>
							<div class="co-cart-price">Gratuit</div>
						</div>
					{/if}

					<div class="co-totals">
						<div class="co-total-row">
							<span>Subtotal</span>
							<strong>{subtotal.toLocaleString('ro-RO')} {plan.currency}</strong>
						</div>
						<div class="co-total-row">
							<span>TVA {vatRate}%</span>
							<strong>{vat.toLocaleString('ro-RO')} {plan.currency}</strong>
						</div>
						<div class="co-total-row big">
							<span>Total de plată</span>
							<strong>{total.toLocaleString('ro-RO')} {plan.currency}</strong>
						</div>
					</div>

					<div class="co-trust">
						<div class="co-trust-row">
							<CheckIcon size={12} /> 30 zile garanție returnare
						</div>
						<div class="co-trust-row">
							<CheckIcon size={12} /> Migrare gratuită din alt panou
						</div>
						<div class="co-trust-row">
							<CheckIcon size={12} /> Suport 24/7 în limba română
						</div>
					</div>
				</aside>
			{/if}
		</div>

		{#if step < 4}
			<div class="co-foot">
				{#if step > 1}
					<button
						type="button"
						class="co-btn-ghost"
						onclick={() => (step = (step - 1) as 1 | 2 | 3)}
						disabled={submitting}
					>
						<ChevronLeftIcon size={14} /> Înapoi
					</button>
				{:else}
					<div></div>
				{/if}
				<div class="co-foot-meta">
					{#if stepMissing}
						<span style="color: #b45309;">{stepMissing}</span>
					{:else}
						Plătești când apeși „{step === 3 ? 'Plătește' : 'Continuă'}" · {total.toLocaleString(
							'ro-RO'
						)} {plan.currency}
					{/if}
				</div>
				<button
					type="button"
					class="co-btn-primary"
					onclick={next}
					disabled={submitting ||
						!!stepMissing ||
						cardStage === 'creating-intent' ||
						cardStage === 'confirming' ||
						(step === 3 && paymentMethod === 'card' && !!cardInitError) ||
						(step === 3 && paymentMethod === 'card' && cardStage === 'idle')}
				>
					{#if step === 3}
						{#if cardStage === 'creating-intent'}
							Se inițializează plata…
						{:else if cardStage === 'confirming'}
							Se confirmă plata…
						{:else if cardStage === 'ready'}
							<LockIcon size={13} /> Confirm plata {total.toLocaleString('ro-RO')} {plan.currency}
						{:else if submitting}
							Se procesează…
						{:else}
							<LockIcon size={13} /> Plătește {total.toLocaleString('ro-RO')} {plan.currency}
						{/if}
					{:else}
						Continuă <ChevronRightIcon size={13} />
					{/if}
				</button>
			</div>
		{/if}
	</div>
</div>

<style>
	:global(.co-overlay) {
		position: fixed;
		inset: 0;
		z-index: 999;
		background: rgba(11, 18, 32, 0.6);
		backdrop-filter: blur(6px);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		overflow-y: auto;
		padding: 40px 20px;
		animation: coFade 0.2s;
		font-family: 'Inter', system-ui, sans-serif;
	}
	@keyframes coFade {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	:global(.co-overlay *) {
		box-sizing: border-box;
	}
	:global(.co-sheet) {
		background: white;
		width: 100%;
		max-width: 1080px;
		border-radius: 20px;
		overflow: hidden;
		box-shadow:
			0 40px 80px rgba(11, 18, 32, 0.4),
			0 12px 32px rgba(11, 18, 32, 0.2);
		animation: coPop 0.25s cubic-bezier(0.2, 0.9, 0.3, 1);
		color: #0b1220;
	}
	@keyframes coPop {
		from {
			opacity: 0;
			transform: translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	:global(.co-topbar) {
		padding: 18px 28px;
		border-bottom: 1px solid #e5e9f0;
		display: flex;
		align-items: center;
		gap: 18px;
		background: linear-gradient(180deg, #fafbfd, white);
	}
	:global(.co-logo) {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		font-weight: 800;
		font-size: 14px;
		color: #0b1220;
	}
	:global(.co-logo img) {
		display: block;
		height: 32px;
		width: auto;
	}
	:global(.co-secure) {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: #10b981;
		padding: 5px 10px;
		background: rgba(16, 185, 129, 0.1);
		border-radius: 999px;
		font-weight: 600;
	}
	:global(.co-close) {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 7px 12px;
		border-radius: 8px;
		background: transparent;
		border: 1px solid #e5e9f0;
		font-family: inherit;
		font-size: 12px;
		font-weight: 600;
		color: #475569;
		cursor: pointer;
	}
	:global(.co-close:hover) {
		background: #f7f8fa;
		color: #0b1220;
	}

	:global(.co-stepper) {
		padding: 22px 28px;
		border-bottom: 1px solid #e5e9f0;
		display: flex;
		align-items: center;
		gap: 8px;
		background: #f7f8fa;
	}
	:global(.co-step) {
		display: flex;
		align-items: center;
		gap: 12px;
		color: #94a3b8;
	}
	:global(.co-step.active) {
		color: #1877f2;
	}
	:global(.co-step.done) {
		color: #10b981;
	}
	:global(.co-step-circle) {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: white;
		border: 2px solid #e5e9f0;
		display: grid;
		place-items: center;
		color: #94a3b8;
		transition: all 0.15s;
	}
	:global(.co-step.active .co-step-circle) {
		background: #1877f2;
		border-color: #1877f2;
		color: white;
		box-shadow: 0 4px 12px rgba(24, 119, 242, 0.25);
	}
	:global(.co-step.done .co-step-circle) {
		background: #10b981;
		border-color: #10b981;
		color: white;
	}
	:global(.co-step-num) {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #94a3b8;
	}
	:global(.co-step.active .co-step-num) {
		color: #1877f2;
	}
	:global(.co-step.done .co-step-num) {
		color: #10b981;
	}
	:global(.co-step-label > div:last-child) {
		font-size: 13.5px;
		font-weight: 600;
		color: #0b1220;
		margin-top: 1px;
	}
	:global(.co-step.active .co-step-label > div:last-child) {
		color: #1877f2;
	}
	:global(.co-step-line) {
		flex: 1;
		height: 2px;
		background: #e5e9f0;
		margin: 0 4px;
		border-radius: 2px;
	}
	:global(.co-step-line.done) {
		background: #10b981;
	}

	:global(.co-body) {
		display: grid;
		grid-template-columns: 1fr 360px;
		min-height: 480px;
	}
	:global(.co-body.co-body-single) {
		grid-template-columns: 1fr;
	}
	:global(.co-content) {
		padding: 32px;
		overflow: auto;
		max-height: calc(100vh - 280px);
	}
	:global(.co-summary) {
		background: #f7f8fa;
		border-left: 1px solid #e5e9f0;
		padding: 28px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		align-self: stretch;
	}

	:global(.co-h2) {
		font-size: 24px;
		font-weight: 800;
		letter-spacing: -0.02em;
		margin: 0 0 8px;
		color: #0b1220;
	}
	:global(.co-sub) {
		font-size: 14px;
		color: #475569;
		margin: 0 0 24px;
		max-width: 540px;
	}

	:global(.co-tabs) {
		display: flex;
		gap: 8px;
		margin-bottom: 22px;
		flex-wrap: wrap;
	}
	:global(.co-tabs button) {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 12px 16px;
		border-radius: 10px;
		background: #f7f8fa;
		border: 1.5px solid transparent;
		font-family: inherit;
		font-size: 13px;
		font-weight: 600;
		color: #475569;
		cursor: pointer;
		transition: all 0.12s;
	}
	:global(.co-tabs button:hover) {
		color: #0b1220;
		background: white;
		border-color: #e5e9f0;
	}
	:global(.co-tabs button.active) {
		background: rgba(24, 119, 242, 0.08);
		border-color: #1877f2;
		color: #1877f2;
	}

	:global(.co-segmented) {
		display: inline-flex;
		padding: 3px;
		background: #f7f8fa;
		border: 1px solid #e5e9f0;
		border-radius: 8px;
	}
	:global(.co-segmented button) {
		padding: 6px 12px;
		border-radius: 5px;
		background: transparent;
		border: none;
		font-family: inherit;
		font-size: 12px;
		font-weight: 600;
		color: #475569;
		cursor: pointer;
	}
	:global(.co-segmented button.active) {
		background: white;
		color: #0b1220;
		box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
	}

	:global(.co-input) {
		width: 100%;
		padding: 11px 14px;
		background: white;
		border: 1.5px solid #e5e9f0;
		border-radius: 9px;
		font-family: inherit;
		font-size: 14px;
		color: #0b1220;
		outline: none;
		transition:
			border-color 0.12s,
			box-shadow 0.12s;
	}
	:global(.co-input:focus) {
		border-color: #1877f2;
		box-shadow: 0 0 0 3px rgba(24, 119, 242, 0.12);
	}
	:global(.co-input.co-input-error) {
		border-color: #ef4444;
		background: #fff5f5;
	}
	:global(.co-input.co-input-error:focus) {
		border-color: #ef4444;
		box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.15);
	}
	:global(.co-input.co-input-error-placeholder::placeholder) {
		color: #b91c1c;
		opacity: 1;
	}
	:global(.co-input.co-input-success) {
		border-color: #10b981;
		background: #f0fdf4;
	}
	:global(.co-input.co-input-success:focus) {
		border-color: #10b981;
		box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
	}
	:global(.co-hint-loading) {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: #475569;
	}
	:global(.co-hint-warn) {
		color: #b45309;
		background: rgba(245, 158, 11, 0.08);
		border: 1px solid rgba(245, 158, 11, 0.25);
		border-radius: 6px;
		padding: 8px 10px;
		display: block;
		line-height: 1.45;
	}
	:global(.co-hint-link) {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		color: #1877f2;
		text-decoration: underline;
		cursor: pointer;
	}
	:global(.co-submit-err) {
		margin-top: 14px;
		padding: 12px 14px;
		background: rgba(239, 68, 68, 0.08);
		border: 1px solid rgba(239, 68, 68, 0.25);
		border-radius: 10px;
		color: #b91c1c;
		font-size: 13px;
		line-height: 1.5;
	}
	:global(.co-submit-err strong) {
		display: block;
		margin-bottom: 2px;
		color: #991b1b;
	}
	:global(.co-bank-card) {
		margin-top: 4px;
		padding: 16px 18px;
		background: white;
		border: 1px solid #e5e9f0;
		border-radius: 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	:global(.co-bank-card-head) {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		font-weight: 700;
		color: #94a3b8;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding-bottom: 8px;
		border-bottom: 1px solid #e5e9f0;
		margin-bottom: 4px;
	}
	:global(.co-bank-row) {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		font-size: 13.5px;
		gap: 12px;
	}
	:global(.co-bank-row > span) {
		color: #475569;
	}
	:global(.co-bank-row strong) {
		color: #0b1220;
		font-weight: 600;
		text-align: right;
	}
	:global(.co-bank-row code) {
		font-family: ui-monospace, monospace;
		font-size: 13px;
		background: #f7f8fa;
		padding: 4px 8px;
		border-radius: 5px;
		color: #1877f2;
		font-weight: 600;
		letter-spacing: 0.02em;
	}
	:global(.co-bank-row-iban) {
		align-items: center;
	}
	:global(.co-bank-val) {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	:global(.co-copy-btn) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: 6px;
		background: white;
		border: 1px solid #e5e9f0;
		color: #475569;
		cursor: pointer;
		padding: 0;
		transition: all 0.12s;
		flex-shrink: 0;
	}
	:global(.co-copy-btn:hover) {
		background: #1877f2;
		border-color: #1877f2;
		color: white;
	}
	:global(.co-copy-btn:focus-visible) {
		outline: 2px solid #1877f2;
		outline-offset: 2px;
	}
	:global(.co-bank-foot) {
		margin-top: 8px;
		padding-top: 10px;
		border-top: 1px solid #e5e9f0;
		font-size: 11.5px;
		color: #94a3b8;
		line-height: 1.5;
	}
	:global(.co-pwd-meter) {
		margin-top: 6px;
		height: 4px;
		background: #e5e9f0;
		border-radius: 2px;
		overflow: hidden;
	}
	:global(.co-pwd-bar) {
		height: 100%;
		transition:
			width 0.2s,
			background 0.2s;
	}
	:global(.co-pwd-bar.co-pwd-l1) {
		background: #ef4444;
	}
	:global(.co-pwd-bar.co-pwd-l2) {
		background: #f59e0b;
	}
	:global(.co-pwd-bar.co-pwd-l3) {
		background: #10b981;
	}
	:global(.co-pwd-bar.co-pwd-l4) {
		background: #047857;
	}
	:global(.co-pwd-hint.co-pwd-l1 strong) {
		color: #b91c1c;
	}
	:global(.co-pwd-hint.co-pwd-l2 strong) {
		color: #b45309;
	}
	:global(.co-pwd-hint.co-pwd-l3 strong) {
		color: #047857;
	}
	:global(.co-pwd-hint.co-pwd-l4 strong) {
		color: #064e3b;
	}
	:global(.co-spin) {
		display: inline-block;
		width: 12px;
		height: 12px;
		border: 2px solid rgba(71, 85, 105, 0.2);
		border-top-color: #475569;
		border-radius: 50%;
		animation: coSpinKf 0.8s linear infinite;
	}
	@keyframes coSpinKf {
		to {
			transform: rotate(360deg);
		}
	}
	:global(.co-input::placeholder) {
		color: #94a3b8;
	}
	:global(textarea.co-input) {
		resize: vertical;
		min-height: 60px;
		font-family: inherit;
	}
	:global(select.co-input) {
		appearance: none;
		background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2394a3b8' stroke-width='1.6' fill='none'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 14px center;
		padding-right: 36px;
	}
	:global(.co-input-lg) {
		padding: 14px 16px;
		font-size: 16px;
		font-weight: 500;
	}

	:global(.co-label) {
		display: block;
		font-size: 12px;
		font-weight: 600;
		color: #475569;
		margin-bottom: 6px;
	}
	:global(.co-hint) {
		font-size: 11.5px;
		color: #94a3b8;
		margin-top: 4px;
	}
	:global(.co-hint-ok) {
		color: #047857;
		display: block;
		line-height: 1.45;
	}
	:global(.co-hint-ok > svg) {
		display: inline-block;
		vertical-align: -2px;
		margin-right: 4px;
	}
	:global(.co-hint-muted) {
		color: #475569;
		margin-left: 4px;
	}
	:global(.co-hint-err) {
		color: #b91c1c;
	}

	:global(.co-grid-2) {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 14px;
	}
	:global(.co-span-2) {
		grid-column: span 2;
	}
	:global(.co-field) {
		display: flex;
		flex-direction: column;
	}

	:global(.co-cui-row) {
		display: flex;
		gap: 8px;
		align-items: stretch;
	}
	:global(.co-cui-row > input) {
		flex: 1;
	}

	:global(.co-domain-row) {
		display: flex;
		gap: 8px;
		align-items: stretch;
	}
	:global(.co-domain-row .co-input-lg) {
		flex: 1;
	}
	:global(.co-tld-select) {
		padding: 14px 16px;
		border: 1.5px solid #e5e9f0;
		background: white;
		border-radius: 9px;
		font-family: ui-monospace, monospace;
		font-size: 16px;
		font-weight: 600;
		color: #1877f2;
		appearance: none;
		background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%231877F2' stroke-width='1.6' fill='none'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 12px center;
		padding-right: 32px;
		cursor: pointer;
	}
	:global(.co-domain-result) {
		margin-top: 14px;
		padding: 16px 18px;
		border-radius: 12px;
		display: flex;
		align-items: center;
		gap: 14px;
		font-size: 14px;
	}
	:global(.co-domain-result.available) {
		background: rgba(16, 185, 129, 0.08);
		border: 1.5px solid rgba(16, 185, 129, 0.3);
		color: #10b981;
	}
	:global(.co-domain-result.taken) {
		background: rgba(239, 68, 68, 0.06);
		border: 1.5px solid rgba(239, 68, 68, 0.2);
		color: #b91c1c;
	}
	:global(.co-domain-result > div:not(.co-domain-badge)) {
		flex: 1;
	}
	:global(.co-domain-result strong) {
		color: #0b1220;
		font-size: 16px;
		display: block;
		margin-bottom: 2px;
	}
	:global(.co-domain-result > div > div) {
		font-size: 12.5px;
		color: #475569;
	}
	:global(.co-domain-badge) {
		background: #10b981;
		color: white;
		font-size: 11px;
		font-weight: 700;
		padding: 4px 12px;
		border-radius: 999px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	:global(.co-suggestions) {
		margin-top: 18px;
	}
	:global(.co-sugg-label) {
		font-size: 11px;
		font-weight: 700;
		color: #94a3b8;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin-bottom: 8px;
	}
	:global(.co-sugg-grid) {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
	:global(.co-sugg) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 14px;
		background: white;
		border: 1px solid #e5e9f0;
		border-radius: 8px;
		font-family: inherit;
		font-size: 13px;
		color: #0b1220;
		cursor: pointer;
		transition: all 0.12s;
	}
	:global(.co-sugg:hover) {
		border-color: #1877f2;
		background: rgba(24, 119, 242, 0.03);
	}
	:global(.co-sugg strong) {
		color: #1877f2;
		font-weight: 700;
	}
	:global(.co-sugg-price) {
		font-size: 12px;
		color: #475569;
		font-weight: 600;
	}

	:global(.co-info-box) {
		margin-top: 16px;
		padding: 14px 16px;
		background: rgba(24, 119, 242, 0.05);
		border: 1px solid rgba(24, 119, 242, 0.18);
		border-radius: 10px;
		display: flex;
		gap: 12px;
		font-size: 13px;
		color: #475569;
	}
	:global(.co-info-box > svg) {
		color: #1877f2;
		flex-shrink: 0;
		margin-top: 2px;
	}
	:global(.co-info-box strong) {
		color: #0b1220;
		display: block;
		margin-bottom: 4px;
		font-size: 13.5px;
	}
	:global(.co-info-box-compact) {
		padding: 10px 12px;
		font-size: 12.5px;
	}

	:global(.co-card-form) {
		margin-top: 16px;
		padding: 20px;
		background: #ffffff;
		border: 1px solid #e5e9f0;
		border-radius: 12px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	:global(.co-card-form-head) {
		display: flex;
		align-items: center;
		gap: 8px;
		font-weight: 600;
		color: #0b1220;
		font-size: 14px;
		padding-bottom: 6px;
		border-bottom: 1px solid #f1f5f9;
	}
	:global(.co-card-form-head > svg) {
		color: #1877f2;
	}
	:global(.co-card-form-loading) {
		text-align: center;
		padding: 24px 0;
		color: #64748b;
		font-size: 13.5px;
	}
	:global(.co-card-retry) {
		margin-top: 12px;
		align-self: center;
	}

	:global(.co-form-section) {
		padding: 20px;
		background: #f7f8fa;
		border: 1px solid #e5e9f0;
		border-radius: 12px;
		margin-bottom: 16px;
	}
	:global(.co-form-section-head) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 14px;
	}
	:global(.co-form-section h3) {
		margin: 0;
		font-size: 14px;
		font-weight: 700;
		color: #0b1220;
	}

	:global(.co-pay-methods) {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
		margin-bottom: 20px;
	}
	:global(.co-pay-tile) {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 16px;
		background: white;
		border: 1.5px solid #e5e9f0;
		border-radius: 12px;
		cursor: pointer;
		text-align: left;
		font-family: inherit;
		transition: all 0.12s;
	}
	:global(.co-pay-tile:hover) {
		border-color: #1877f2;
	}
	:global(.co-pay-tile.selected) {
		border-color: #1877f2;
		background: rgba(24, 119, 242, 0.04);
		box-shadow: 0 4px 12px rgba(24, 119, 242, 0.08);
	}
	:global(.co-pay-tile > svg) {
		color: #1877f2;
		flex-shrink: 0;
	}
	:global(.co-pay-tile > div:not(.co-pay-badges)) {
		flex: 1;
	}
	:global(.co-pay-tile strong) {
		display: block;
		font-size: 13.5px;
		color: #0b1220;
		margin-bottom: 2px;
	}
	:global(.co-pay-tile span) {
		font-size: 11.5px;
		color: #475569;
	}
	:global(.co-pay-badges) {
		display: flex;
		gap: 4px;
		flex-shrink: 0;
	}
	:global(.co-card-mark) {
		padding: 3px 6px;
		border-radius: 4px;
		font-size: 9px;
		font-weight: 800;
		background: #f7f8fa;
		color: #94a3b8;
		border: 1px solid #e5e9f0;
		min-width: 30px;
		text-align: center;
	}
	:global(.co-card-mark.visa.active) {
		background: #1a1f71;
		color: white;
		border-color: #1a1f71;
	}
	:global(.co-card-mark.mc.active) {
		background: #eb001b;
		color: white;
		border-color: #eb001b;
	}

	:global(.co-check) {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 4px 0;
		font-size: 13px;
		color: #475569;
		cursor: pointer;
		line-height: 1.5;
	}
	:global(.co-check input[type='checkbox']) {
		width: 18px;
		height: 18px;
		margin: 1px 0 0;
		accent-color: #1877f2;
		flex-shrink: 0;
	}
	:global(.co-check a) {
		color: #1877f2;
		text-decoration: underline;
	}

	:global(.co-terms) {
		margin-top: 20px;
		padding: 16px;
		background: #f7f8fa;
		border: 1px solid #e5e9f0;
		border-radius: 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	:global(.co-secure-line) {
		margin-top: 14px;
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 11.5px;
		color: #94a3b8;
		justify-content: center;
	}

	:global(.co-summary-head) {
		font-size: 11px;
		font-weight: 800;
		color: #94a3b8;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		padding-bottom: 4px;
	}
	:global(.co-cart-item) {
		padding: 12px 0;
		border-top: 1px solid #e5e9f0;
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px;
	}
	:global(.co-cart-name strong) {
		display: block;
		font-size: 13.5px;
		color: #0b1220;
	}
	:global(.co-cart-name span) {
		font-size: 11.5px;
		color: #475569;
		margin-top: 2px;
		display: block;
	}
	:global(.co-cart-price) {
		font-weight: 700;
		font-size: 14px;
		color: #0b1220;
		white-space: nowrap;
	}

	:global(.co-totals) {
		padding-top: 12px;
		border-top: 1px solid #e5e9f0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	:global(.co-total-row) {
		display: flex;
		justify-content: space-between;
		font-size: 13px;
		color: #475569;
	}
	:global(.co-total-row strong) {
		color: #0b1220;
		font-weight: 600;
	}
	:global(.co-total-row.big) {
		margin-top: 8px;
		padding-top: 12px;
		border-top: 1px solid #e5e9f0;
		font-size: 15px;
	}
	:global(.co-total-row.big strong) {
		font-size: 24px;
		font-weight: 800;
		letter-spacing: -0.02em;
		color: #1877f2;
	}

	:global(.co-trust) {
		margin-top: 12px;
		padding-top: 14px;
		border-top: 1px solid #e5e9f0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	:global(.co-trust-row) {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: #475569;
	}
	:global(.co-trust-row svg) {
		color: #10b981;
	}

	:global(.co-foot) {
		padding: 16px 28px;
		border-top: 1px solid #e5e9f0;
		background: #f7f8fa;
		display: flex;
		align-items: center;
		gap: 14px;
	}
	:global(.co-foot-meta) {
		flex: 1;
		text-align: center;
		font-size: 12.5px;
		color: #94a3b8;
	}
	:global(.co-btn-primary) {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 12px 22px;
		border-radius: 10px;
		background: #1877f2;
		color: white;
		border: none;
		font-family: inherit;
		font-size: 14px;
		font-weight: 700;
		cursor: pointer;
	}
	:global(.co-btn-primary:not(:disabled):hover) {
		background: #0d5cc7;
		transform: translateY(-1px);
		box-shadow: 0 6px 16px rgba(24, 119, 242, 0.25);
	}
	:global(.co-btn-primary:disabled) {
		opacity: 0.6;
		cursor: not-allowed;
	}
	:global(.co-btn-ghost) {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 10px 16px;
		border-radius: 9px;
		background: transparent;
		border: 1px solid #e5e9f0;
		font-family: inherit;
		font-size: 13px;
		font-weight: 600;
		color: #475569;
		cursor: pointer;
	}
	:global(.co-btn-ghost:not(:disabled):hover) {
		background: white;
		color: #0b1220;
	}
	:global(.co-btn-ghost:disabled) {
		opacity: 0.5;
		cursor: not-allowed;
	}

	:global(.co-success) {
		max-width: 580px;
		margin: 0 auto;
		padding: 20px 0 40px;
		text-align: left;
	}
	:global(.co-success-icon) {
		width: 72px;
		height: 72px;
		border-radius: 50%;
		background: rgba(16, 185, 129, 0.12);
		color: #10b981;
		display: grid;
		place-items: center;
		margin: 0 auto 24px;
		border: 2px solid rgba(16, 185, 129, 0.3);
	}
	:global(.co-success code) {
		font-family: ui-monospace, monospace;
		background: #f7f8fa;
		padding: 2px 8px;
		border-radius: 5px;
		color: #1877f2;
		font-weight: 700;
		font-size: 0.9em;
	}
	:global(.co-success-card) {
		margin: 28px 0;
		padding: 18px;
		background: #f7f8fa;
		border: 1px solid #e5e9f0;
		border-radius: 12px;
	}
	:global(.co-success-card-head) {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 11px;
		font-weight: 700;
		color: #94a3b8;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding-bottom: 12px;
		border-bottom: 1px solid #e5e9f0;
		margin-bottom: 12px;
	}
	:global(.co-success-detail) {
		display: flex;
		justify-content: space-between;
		padding: 5px 0;
		font-size: 13.5px;
	}
	:global(.co-success-detail span) {
		color: #475569;
	}
	:global(.co-success-detail strong) {
		color: #0b1220;
	}
	:global(.co-order-id) {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 13px;
		letter-spacing: 0.02em;
		background: #f1f5f9;
		padding: 2px 8px;
		border-radius: 6px;
		user-select: all;
	}
	:global(.co-success-next h3) {
		font-size: 14px;
		font-weight: 700;
		margin: 0 0 14px;
	}
	:global(.co-success-next ol) {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 14px;
		counter-reset: snext;
	}
	:global(.co-success-next li) {
		display: flex;
		align-items: flex-start;
		gap: 14px;
		position: relative;
		padding-left: 36px;
		counter-increment: snext;
	}
	:global(.co-success-next li::before) {
		content: counter(snext);
		position: absolute;
		left: 0;
		top: 0;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		background: #1877f2;
		color: white;
		font-size: 12px;
		font-weight: 700;
		display: grid;
		place-items: center;
	}
	:global(.co-success-next li > svg) {
		color: #94a3b8;
		margin-top: 3px;
	}
	:global(.co-success-next li > div) {
		flex: 1;
	}
	:global(.co-success-next li strong) {
		display: block;
		font-size: 13.5px;
		color: #0b1220;
	}
	:global(.co-success-next li span) {
		font-size: 12.5px;
		color: #475569;
		display: block;
		margin-top: 2px;
	}

	@media (max-width: 880px) {
		:global(.co-body) {
			grid-template-columns: 1fr;
		}
		:global(.co-summary) {
			border-left: none;
			border-top: 1px solid #e5e9f0;
		}
		:global(.co-content) {
			max-height: none;
			padding: 24px;
		}
		:global(.co-pay-methods) {
			grid-template-columns: 1fr;
		}
		:global(.co-grid-2) {
			grid-template-columns: 1fr;
		}
		:global(.co-span-2) {
			grid-column: span 1;
		}
		:global(.co-sugg-grid) {
			grid-template-columns: 1fr;
		}
	}
</style>
