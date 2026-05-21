<script lang="ts">
	import { getContext } from 'svelte';

	import type {
		StripePaymentElementOptions,
		StripeElementBase,
		StripeElements
	} from '@stripe/stripe-js';

	interface Props {
		options?: StripePaymentElementOptions | null;
		onchange?: (event: unknown) => void;
		onready?: (event: unknown) => void;
		onfocus?: (event: unknown) => void;
		onblur?: (event: unknown) => void;
		onescape?: (event: unknown) => void;
		onloaderror?: (event: unknown) => void;
		onloaderstart?: (event: unknown) => void;
		wrapper?: HTMLElement | null;
	}

	let {
		options = null,
		onchange,
		onready,
		onfocus,
		onblur,
		onescape,
		onloaderror,
		onloaderstart,
		wrapper = $bindable(null)
	}: Props = $props();

	let element = $state<StripeElementBase | null>(null);

	const { elements } = getContext<{ elements: StripeElements }>('stripe');

	function mount(
		node: HTMLElement,
		type: 'payment',
		els: StripeElements,
		opts: StripePaymentElementOptions | null = null
	) {
		const el = els.create(type, opts ?? undefined);
		el.mount(node);
		el.on('change', (e) => onchange?.(e));
		el.on('ready', (e) => onready?.(e));
		el.on('focus', (e) => onfocus?.(e));
		el.on('blur', (e) => onblur?.(e));
		el.on('escape', (e) => onescape?.(e));
		el.on('loaderror', (e) => onloaderror?.(e));
		el.on('loaderstart', (e) => onloaderstart?.(e));
		return el;
	}

	$effect(() => {
		if (wrapper && elements) {
			element = mount(wrapper, 'payment', elements, options);
			return () => {
				element?.destroy();
				element = null;
			};
		}
	});

	export function blur() {
		element?.blur?.();
	}
	export function clear() {
		element?.clear?.();
	}
	export function destroy() {
		element?.destroy?.();
	}
	export function focus() {
		element?.focus?.();
	}
</script>

<svelte:boundary>
	<div bind:this={wrapper}></div>
	{#snippet failed(error)}
		<div class="stripe-pe-err" role="alert">
			<strong>Eroare la formularul de plată</strong>
			<div>
				{error instanceof Error ? error.message : 'A apărut o eroare necunoscută.'}
			</div>
		</div>
	{/snippet}
</svelte:boundary>

<style>
	.stripe-pe-err {
		background: #fef2f2;
		border: 1px solid #fecaca;
		color: #991b1b;
		padding: 0.75rem 1rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
	}
</style>
