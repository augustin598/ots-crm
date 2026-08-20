<script lang="ts">
	/**
	 * Coaja vizuală a modalelor de plată — aceeași cu checkout-ul de hosting
	 * (`hosting-checkout-modal.svelte`), ca fluxurile de plată să arate identic
	 * indiferent de unde pornesc. O folosește și modalul de ofertă de pe
	 * /servicii (cu alt badge și aria-label).
	 *
	 * Stilurile sunt copiate din acel fișier, nu importate: acolo trăiesc ca
	 * `:global(.co-*)` în componenta lui de 3500 de linii, deci nu sunt
	 * disponibile în altă pagină. Când modalul de hosting va fi refactorizat,
	 * ar trebui să folosească această coajă și să-și șteargă copia.
	 *
	 * Accesibilitate: `focusTrap` mută focusul înăuntru, ciclează Tab, restaurează
	 * focusul la închidere (WCAG 2.1 AA). Închiderea se poate bloca — nu vrem ca
	 * userul să închidă în timp ce Stripe procesează plata.
	 */
	import type { Snippet } from 'svelte';
	import { focusTrap } from '$lib/actions/focus-trap';
	import LockIcon from '@lucide/svelte/icons/lock';
	import XIcon from '@lucide/svelte/icons/x';

	let {
		onClose,
		canClose = true,
		maxWidth = '560px',
		badgeText = 'Plată securizată · SSL 256-bit',
		ariaLabel = 'Plată cu cardul',
		flush = false,
		children,
		footer
	}: {
		onClose: () => void;
		canClose?: boolean;
		maxWidth?: string;
		/** Textul pastilei verzi din antet — modalul de ofertă /servicii nu e o plată. */
		badgeText?: string;
		ariaLabel?: string;
		/**
		 * Fără padding pe corp: modalul de ofertă își desenează singur coloana de
		 * sumar până la margine, ca în checkout-ul de hosting.
		 */
		flush?: boolean;
		children: Snippet;
		/**
		 * Bară de acțiuni lipită de baza modalului. Conținutul lung (formularul
		 * Stripe trece de 700px) derulează între antet și ea, deci butonul de
		 * confirmare rămâne mereu vizibil — altfel ajungea sub marginea ecranului
		 * exact ca varianta inline pe care o înlocuim.
		 */
		footer?: Snippet;
	} = $props();

	function requestClose() {
		if (canClose) onClose();
	}
</script>

<div
	class="co-overlay"
	role="dialog"
	aria-modal="true"
	aria-label={ariaLabel}
	tabindex="-1"
	use:focusTrap={{ onEscape: requestClose }}
	onclick={(e) => {
		if (e.target === e.currentTarget) requestClose();
	}}
	onkeydown={(e) => {
		if (e.key === 'Escape' && e.target === e.currentTarget) requestClose();
	}}
>
	<div class="co-sheet" style="max-width: {maxWidth}">
		<div class="co-topbar">
			<div class="co-logo">
				<img src="/onetop-logo.png" alt="One Top Solution" />
			</div>
			<div class="co-secure">
				<LockIcon size={13} />
				<span>{badgeText}</span>
			</div>
			{#if canClose}
				<button type="button" class="co-close" onclick={onClose}>
					<XIcon size={14} /> Închide
				</button>
			{/if}
		</div>

		<div class={["co-body", flush && "co-body-flush"]}>
			{@render children()}
		</div>

		{#if footer}
			<div class="co-footer">
				{@render footer()}
			</div>
		{/if}
	</div>
</div>

<style>
	.co-overlay {
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
	.co-overlay :global(*) {
		box-sizing: border-box;
	}
	.co-sheet {
		background: white;
		width: 100%;
		border-radius: 20px;
		overflow: hidden;
		box-shadow:
			0 40px 80px rgba(11, 18, 32, 0.4),
			0 12px 32px rgba(11, 18, 32, 0.2);
		animation: coPop 0.25s cubic-bezier(0.2, 0.9, 0.3, 1);
		color: #0b1220;
		/* Antet + acțiuni fixe, corp derulabil între ele. Fără asta, un formular
		   Stripe de 700px împinge butonul de confirmare sub marginea ecranului. */
		display: flex;
		flex-direction: column;
		max-height: calc(100vh - 80px);
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
	/* Fără animații pentru cine a cerut mișcare redusă. */
	@media (prefers-reduced-motion: reduce) {
		.co-overlay,
		.co-sheet {
			animation: none;
		}
	}

	.co-topbar {
		padding: 18px 28px;
		border-bottom: 1px solid #e5e9f0;
		display: flex;
		align-items: center;
		gap: 18px;
		background: linear-gradient(180deg, #fafbfd, white);
		flex-shrink: 0;
	}
	.co-logo {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		font-weight: 800;
		font-size: 14px;
		color: #0b1220;
	}
	.co-logo img {
		display: block;
		height: 32px;
		width: auto;
	}
	.co-secure {
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
	.co-close {
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
	.co-close:hover {
		background: #f7f8fa;
		color: #0b1220;
	}
	.co-close:focus-visible {
		outline: 2px solid #2563eb;
		outline-offset: 2px;
	}

	.co-body {
		padding: 26px 28px 28px;
		overflow-y: auto;
		flex: 1 1 auto;
		min-height: 0;
	}
	.co-body.co-body-flush {
		padding: 0;
	}
	.co-footer {
		padding: 16px 28px 20px;
		border-top: 1px solid #e5e9f0;
		background: white;
		flex-shrink: 0;
	}

	/* Pe telefon badge-ul „securizat" ar înghesui bara; logo + Închide ajung. */
	@media (max-width: 480px) {
		.co-overlay {
			padding: 16px 12px;
		}
		.co-topbar {
			padding: 14px 18px;
			gap: 12px;
		}
		.co-secure {
			display: none;
		}
		.co-body {
			padding: 20px 18px 22px;
		}
		.co-body.co-body-flush {
			padding: 0;
		}
		.co-footer {
			padding: 12px 18px 16px;
		}
		.co-sheet {
			max-height: calc(100vh - 32px);
		}
	}
</style>
