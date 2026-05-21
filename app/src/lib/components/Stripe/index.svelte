<script lang="ts">
	import type { Stripe, StripeElements } from '@stripe/stripe-js';
	import { setContext, untrack, type Snippet } from 'svelte';
	import { browser } from '$app/environment';

	// Inline equivalent of svelte-stripe's `register` helper — svelte-stripe@2 no
	// longer exposes a subpath export for `/util`, so we replicate the tiny
	// `registerAppInfo` attribution call here.
	function registerStripeAppInfo(stripe: Stripe): void {
		if (typeof window === 'undefined') return;
		try {
			stripe.registerAppInfo({ name: 'ots-crm', url: 'https://clients.onetopsolution.ro' });
		} catch {
			// Stripe SDK throws if registerAppInfo isn't available — non-fatal.
		}
	}

	interface Props {
		stripe: Stripe | null;
		mode?: 'payment' | 'subscription' | 'setup';
		theme?: 'stripe' | 'night' | 'flat';
		variables?: Record<string, string>;
		rules?: Record<string, Record<string, string>>;
		labels?: 'above' | 'below' | 'inline';
		loader?: 'auto' | 'always' | 'never';
		fonts?: unknown[];
		locale?: string;
		clientSecret: string | null;
		elements: StripeElements | null;
		currency?: string | undefined;
		amount?: number | undefined;
		children?: Snippet;
	}

	let {
		stripe,
		clientSecret,
		children,
		elements = $bindable(null)
	}: Props = $props();

	const ctx = {
		get stripe() {
			return stripe;
		},
		set stripe(value: Stripe | null) {
			stripe = value;
		},
		get elements() {
			return elements;
		},
		set elements(value: StripeElements | null) {
			elements = value;
		}
	};

	setContext('stripe', ctx);

	let registered = $state(false);
	let lastClientSecret = $state<string | null>(null);
	let lastStripe = $state<Stripe | null>(null);

	$effect(() => {
		if (!browser) return;

		const currentClientSecret = clientSecret;
		const currentStripe = stripe;

		untrack(() => {
			if (!currentStripe) {
				if (elements) {
					elements = null;
					lastClientSecret = null;
					lastStripe = null;
					ctx.elements = null;
				}
				return;
			}

			if (!registered || lastStripe !== currentStripe) {
				registerStripeAppInfo(currentStripe);
				ctx.stripe = currentStripe;
				registered = true;
				lastStripe = currentStripe;
				if (elements) {
					elements = null;
					lastClientSecret = null;
					ctx.elements = null;
				}
			}

			const currentElements = elements;
			const stripeChanged = lastStripe !== currentStripe;
			const needsRecreate =
				!currentElements ||
				stripeChanged ||
				(currentClientSecret !== null && currentClientSecret !== lastClientSecret);

			if (currentClientSecret && needsRecreate) {
				const newElements = currentStripe.elements({
					clientSecret: currentClientSecret
				});
				elements = newElements;
				lastClientSecret = currentClientSecret;
				lastStripe = currentStripe;
				ctx.elements = elements;
			} else if (!currentClientSecret && currentElements) {
				elements = null;
				lastClientSecret = null;
				lastStripe = null;
				ctx.elements = null;
			}
		});
	});
</script>

{#if browser && elements && clientSecret}
	{@render children?.()}
{:else if browser && stripe && clientSecret}
	<div class="stripe-loading">
		<div class="stripe-loading-text">Se inițializează plata…</div>
	</div>
{/if}

<style>
	.stripe-loading {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem 0;
	}
	.stripe-loading-text {
		font-size: 0.875rem;
		color: #64748b;
	}
</style>
