<script lang="ts" module>
	export type PaymentMethodValue = 'card' | 'op' | 'cash';
</script>

<script lang="ts">
	import CreditCardIcon from '@lucide/svelte/icons/credit-card';
	import Building2Icon from '@lucide/svelte/icons/building-2';
	import DollarSignIcon from '@lucide/svelte/icons/dollar-sign';

	interface Props {
		/** Currently selected method. Use `bind:value` for two-way sync. */
		value: PaymentMethodValue;
		/** Optional change callback (called after `value` is set). */
		onchange?: (v: PaymentMethodValue) => void;
		/** Disable all three buttons. */
		disabled?: boolean;
		/** Compact (sm) variant for drawers/dialogs, regular (md) otherwise. */
		size?: 'sm' | 'md';
	}

	let {
		value = $bindable(),
		onchange,
		disabled = false,
		size = 'md'
	}: Props = $props();

	function pick(next: PaymentMethodValue) {
		if (disabled) return;
		value = next;
		onchange?.(next);
	}
</script>

<div
	class="pm-picker-grid"
	class:pm-picker-sm={size === 'sm'}
	role="radiogroup"
	aria-label="Metodă de plată"
>
	<button
		class="pm-picker-btn"
		class:active={value === 'card'}
		onclick={() => pick('card')}
		type="button"
		role="radio"
		aria-checked={value === 'card'}
		{disabled}
	>
		<span class="pm-picker-ic"><CreditCardIcon size={12} /></span>
		<span class="pm-picker-label">Card (offline / POS)</span>
	</button>
	<button
		class="pm-picker-btn"
		class:active={value === 'op'}
		onclick={() => pick('op')}
		type="button"
		role="radio"
		aria-checked={value === 'op'}
		{disabled}
	>
		<span class="pm-picker-ic"><Building2Icon size={12} /></span>
		<span class="pm-picker-label">Transfer bancar / OP</span>
	</button>
	<button
		class="pm-picker-btn"
		class:active={value === 'cash'}
		onclick={() => pick('cash')}
		type="button"
		role="radio"
		aria-checked={value === 'cash'}
		{disabled}
	>
		<span class="pm-picker-ic"><DollarSignIcon size={12} /></span>
		<span class="pm-picker-label">Cash</span>
	</button>
</div>

<style>
	.pm-picker-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 6px;
	}
	.pm-picker-btn {
		border: 1.5px solid #e5e9f0;
		background: white;
		border-radius: 9px;
		padding: 9px 10px;
		display: flex;
		align-items: center;
		gap: 7px;
		cursor: pointer;
		font-size: 12px;
		font-weight: 600;
		color: #475569;
		text-align: left;
		font-family: inherit;
	}
	.pm-picker-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.pm-picker-btn.active {
		border-color: #1877f2;
		background: rgba(24, 119, 242, 0.06);
		color: #0f172a;
	}
	.pm-picker-ic {
		width: 22px;
		height: 22px;
		border-radius: 6px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #f1f5f9;
		color: #475569;
		flex-shrink: 0;
	}
	.pm-picker-btn.active .pm-picker-ic {
		background: rgba(24, 119, 242, 0.14);
		color: #1877f2;
	}
	.pm-picker-label {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Compact variant for drawers / edit dialogs */
	.pm-picker-sm .pm-picker-btn {
		padding: 7px 8px;
		font-size: 11.5px;
	}
	.pm-picker-sm .pm-picker-ic {
		width: 20px;
		height: 20px;
	}
</style>
