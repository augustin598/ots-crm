<script lang="ts">
	/**
	 * Cererea numărului de WhatsApp către utilizatorul de portal.
	 *
	 * Starea („modal", „banner" sau nimic) e decisă pe server, în layoutul
	 * portalului, ca să se randeze din prima. Modalul apare o dată pe sesiune;
	 * după trei amânări rămâne doar bannerul.
	 *
	 * Vizual, modalul urmează foaia albă a checkout-ului din /pachete-hosting
	 * (bară de sus, corp, subsol gri) — stilurile `co-*` nu sunt încărcate în
	 * portal, deci le reproducem local, cu aceleași valori.
	 */
	import * as Dialog from '$lib/components/ui/dialog';
	import IconWhatsapp from '$lib/components/marketing/icon-whatsapp.svelte';
	import XIcon from '@lucide/svelte/icons/x';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { clientLogger } from '$lib/client-logger';
	import {
		setMyWhatsappPhone,
		dismissWhatsappPrompt
	} from '$lib/remotes/client-whatsapp-phone.remote';
	import type { WhatsappPromptState } from '$lib/server/whatsapp/phone-prompt';

	let { promptState, tenantName }: { promptState: WhatsappPromptState; tenantName: string } = $props();

	// O dată pe sesiune: dacă a amânat sau a salvat, nu-l mai deranjăm până la
	// următoarea încărcare a portalului.
	let resolved = $state(false);
	let bannerClosed = $state(false);
	let bannerOpenedModal = $state(false);

	// `bind:open`, ca restul dialogurilor din proiect: cu `open` unidirecțional
	// bits-ui își ține propria stare și o închide singur la montare.
	// Inițializat o singură dată, la crearea componentei, deci modalul apare o
	// dată per încărcare a portalului; după aceea starea îi aparține omului.
	// untrack: citim starea o singură dată, intenționat, nu ne abonăm la ea.
	let open = $state(untrack(() => promptState === 'modal'));

	const showBanner = $derived(promptState === 'banner' && !resolved && !bannerClosed && !open);

	let phone = $state('');
	let saving = $state(false);
	let error = $state<string | null>(null);

	const ERRORS: Record<string, string> = {
		format: 'Scrie numărul cu prefixul țării, de exemplu +40 7xx xxx xxx.',
		not_on_whatsapp: 'Numărul nu pare să aibă WhatsApp. Verifică-l și încearcă din nou.',
		already_linked:
			'Numărul e deja legat de altcineva în CRM. Dacă e al tău, scrie-ne și îl mutăm noi.',
		rate_limited:
			'Ai încercat de trei ori în ultimele 24 de ore. Mai încearcă mâine sau scrie-ne pe e-mail.'
	};

	async function save() {
		if (!phone.trim() || saving) return;
		saving = true;
		error = null;
		try {
			const res = await setMyWhatsappPhone({ phone });
			if (!res.ok) {
				error = ERRORS[res.reason] ?? 'Nu am putut salva numărul.';
				return;
			}
			resolved = true;
			bannerOpenedModal = false;
			open = false;
			toast.success('Gata, te găsim pe WhatsApp', {
				description: `${res.phoneE164} · poți schimba numărul din Setări`
			});
		} catch (err) {
			clientLogger.apiError('setMyWhatsappPhone', err);
			error = 'Nu am putut salva numărul. Încearcă din nou.';
		} finally {
			saving = false;
		}
	}

	/**
	 * „Nu acum", apăsat explicit. Numai asta consumă una din cele trei șanse.
	 *
	 * Închiderea prin X, Escape sau clic în afară doar ascunde modalul până la
	 * următoarea încărcare a portalului: altfel o închidere din greșeală (sau
	 * orice pierdere de focus) ar cheltui o amânare pe care omul n-a vrut-o.
	 * Când modalul a fost deschis din banner nu numărăm nimic, omul e deja acolo.
	 */
	async function dismiss() {
		open = false;
		if (bannerOpenedModal) {
			bannerOpenedModal = false;
			return;
		}
		if (resolved) return;
		resolved = true;
		try {
			await dismissWhatsappPrompt();
		} catch (err) {
			clientLogger.apiError('dismissWhatsappPrompt', err);
		}
	}

	/** Închidere fără decizie: ascundem pentru sesiunea asta, fără să numărăm. */
	function closeWithoutCounting() {
		open = false;
		bannerOpenedModal = false;
	}
</script>

{#if showBanner}
	<div class="wa-banner">
		<IconWhatsapp class="size-4 shrink-0" />
		<span>
			Încă nu avem un număr de WhatsApp pentru tine.
			<button type="button" class="wa-banner-link" onclick={() => {
					bannerOpenedModal = true;
					open = true;
				}}>
				Adaugă-l acum
			</button>. Durează zece secunde.
		</span>
		<button
			type="button"
			class="wa-banner-close"
			aria-label="Închide"
			onclick={() => (bannerClosed = true)}
		>
			<XIcon class="size-3.5" />
		</button>
	</div>
{/if}

<Dialog.Root
	bind:open
	onOpenChange={(next) => {
		if (!next) closeWithoutCounting();
	}}
>
	<Dialog.Content
		class="wa-sheet"
		showCloseButton={false}
		onOpenAutoFocus={(e) => {
			// Focusul pe câmpul de telefon, nu pe „Închide" (primul element tabbabil).
			e.preventDefault();
			document.getElementById('wa-phone')?.focus();
		}}
	>
		<div class="wa-top">
			<div class="wa-badge">
				<IconWhatsapp class="size-5" />
			</div>
			<Dialog.Title class="wa-title">Care e numărul tău de WhatsApp?</Dialog.Title>
			<button type="button" class="wa-close" onclick={closeWithoutCounting} disabled={saving}>
				<XIcon class="size-3.5" /> Închide
			</button>
		</div>

		<div class="wa-body">
			<Dialog.Description class="wa-sub">
				Când apare ceva urgent la proiectul tău, cel mai rapid te găsim pe WhatsApp. Lasă-ne
				numărul de mobil și echipa <strong>{tenantName}</strong> îți scrie direct acolo, în loc să
				trimită un e-mail pe care-l vezi a doua zi.
			</Dialog.Description>

			<div class="wa-field">
				<label class="wa-label" for="wa-phone">Numărul tău de mobil</label>
				<input
					id="wa-phone"
					class="wa-input"
					class:wa-input-error={!!error}
					type="tel"
					inputmode="tel"
					autocomplete="tel"
					placeholder="+40 7xx xxx xxx"
					bind:value={phone}
					disabled={saving}
					aria-invalid={error ? 'true' : undefined}
					aria-describedby={error ? 'wa-phone-error' : 'wa-phone-hint'}
					onkeydown={(e) => {
						if (e.key === 'Enter') void save();
					}}
				/>
				{#if error}
					<p id="wa-phone-error" class="wa-hint wa-hint-err">{error}</p>
				{:else}
					<p id="wa-phone-hint" class="wa-hint">
						Îl folosim doar ca să vorbim cu tine despre proiectele tale. Îl poți schimba sau șterge
						oricând din Setări.
					</p>
				{/if}
			</div>
		</div>

		<div class="wa-foot">
			<button type="button" class="wa-btn-ghost" onclick={dismiss} disabled={saving}>Nu acum</button>
			<div class="wa-foot-meta">Durează zece secunde</div>
			<button type="button" class="wa-btn-primary" onclick={save} disabled={saving || !phone.trim()}>
				{saving ? 'Se verifică…' : 'Salvează numărul'}
			</button>
		</div>
	</Dialog.Content>
</Dialog.Root>

<style>
	/* Aceleași valori ca foaia checkout-ului (/pachete-hosting); în dark mode
	   cad pe tokenii portalului. */
	:global(.wa-sheet) {
		--wa-bg: #ffffff;
		--wa-soft: #f7f8fa;
		--wa-top: linear-gradient(180deg, #fafbfd, #ffffff);
		--wa-ink: #0b1220;
		--wa-ink2: #475569;
		--wa-muted: #94a3b8;
		--wa-border: #e5e9f0;
		--wa-accent: #1877f2;
		--wa-accent-dark: #0d5cc7;
		max-width: 520px;
		padding: 0;
		gap: 0;
		overflow: hidden;
		border: 0;
		border-radius: 20px;
		background: var(--wa-bg);
		color: var(--wa-ink);
		box-shadow:
			0 40px 80px rgba(11, 18, 32, 0.4),
			0 12px 32px rgba(11, 18, 32, 0.2);
	}
	:global(.dark .wa-sheet) {
		--wa-bg: var(--card);
		--wa-soft: var(--muted);
		--wa-top: var(--card);
		--wa-ink: var(--foreground);
		--wa-ink2: var(--muted-foreground);
		--wa-muted: var(--muted-foreground);
		--wa-border: var(--border);
	}

	.wa-top {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 16px 20px 16px 24px;
		border-bottom: 1px solid var(--wa-border);
		background: var(--wa-top);
	}
	.wa-badge {
		width: 40px;
		height: 40px;
		border-radius: 12px;
		flex-shrink: 0;
		display: grid;
		place-items: center;
		color: #16a34a;
		background: rgba(37, 211, 102, 0.14);
	}
	:global(.wa-title) {
		flex: 1;
		min-width: 0;
		margin: 0;
		font-size: 17px;
		font-weight: 800;
		letter-spacing: -0.01em;
		line-height: 1.25;
		color: var(--wa-ink);
	}
	.wa-close {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 7px 12px;
		border-radius: 8px;
		background: transparent;
		border: 1px solid var(--wa-border);
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		color: var(--wa-ink2);
		cursor: pointer;
		flex-shrink: 0;
	}
	.wa-close:hover {
		background: var(--wa-soft);
		color: var(--wa-ink);
	}

	.wa-body {
		padding: 22px 24px 24px;
	}
	:global(.wa-sub) {
		margin: 0 0 18px;
		font-size: 14px;
		line-height: 1.55;
		color: var(--wa-ink2);
	}
	:global(.wa-sub strong) {
		color: var(--wa-ink);
		font-weight: 700;
	}
	.wa-field {
		display: flex;
		flex-direction: column;
	}
	.wa-label {
		display: block;
		margin-bottom: 6px;
		font-size: 12px;
		font-weight: 600;
		color: var(--wa-ink2);
	}
	.wa-input {
		width: 100%;
		padding: 11px 14px;
		background: var(--wa-bg);
		border: 1.5px solid var(--wa-border);
		border-radius: 9px;
		font: inherit;
		font-size: 14px;
		color: var(--wa-ink);
		outline: none;
		transition:
			border-color 0.12s,
			box-shadow 0.12s;
	}
	.wa-input::placeholder {
		color: var(--wa-muted);
	}
	.wa-input:focus {
		border-color: var(--wa-accent);
		box-shadow: 0 0 0 3px rgba(24, 119, 242, 0.12);
	}
	.wa-input:disabled {
		opacity: 0.6;
	}
	.wa-input-error,
	.wa-input-error:focus {
		border-color: #ef4444;
		box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.15);
	}
	.wa-hint {
		margin: 6px 0 0;
		font-size: 11.5px;
		line-height: 1.45;
		color: var(--wa-muted);
	}
	.wa-hint-err {
		color: #b91c1c;
		font-weight: 500;
	}

	.wa-foot {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 14px 24px;
		border-top: 1px solid var(--wa-border);
		background: var(--wa-soft);
	}
	.wa-foot-meta {
		flex: 1;
		text-align: center;
		font-size: 12px;
		color: var(--wa-muted);
	}
	.wa-btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 11px 20px;
		border-radius: 10px;
		border: 0;
		background: var(--wa-accent);
		color: #fff;
		font: inherit;
		font-size: 14px;
		font-weight: 700;
		cursor: pointer;
		transition:
			background 0.12s,
			transform 0.12s,
			box-shadow 0.12s;
	}
	.wa-btn-primary:not(:disabled):hover {
		background: var(--wa-accent-dark);
		transform: translateY(-1px);
		box-shadow: 0 6px 16px rgba(24, 119, 242, 0.25);
	}
	.wa-btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.wa-btn-ghost {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 10px 16px;
		border-radius: 9px;
		background: transparent;
		border: 1px solid var(--wa-border);
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		color: var(--wa-ink2);
		cursor: pointer;
	}
	.wa-btn-ghost:not(:disabled):hover {
		background: var(--wa-bg);
		color: var(--wa-ink);
	}
	.wa-btn-ghost:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	@media (max-width: 520px) {
		.wa-top {
			padding: 14px 16px;
		}
		.wa-body {
			padding: 18px 16px 20px;
		}
		.wa-foot {
			padding: 12px 16px;
			flex-wrap: wrap;
		}
		.wa-foot-meta {
			display: none;
		}
		.wa-btn-primary {
			margin-left: auto;
		}
	}

	.wa-banner {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 9px 14px;
		font-size: 13px;
		background: color-mix(in oklch, #25d366 9%, var(--card));
		border-bottom: 1px solid color-mix(in oklch, #25d366 30%, var(--border));
	}
	.wa-banner-link {
		font: inherit;
		font-weight: 600;
		color: var(--primary);
		background: none;
		border: 0;
		padding: 0;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.wa-banner-close {
		margin-left: auto;
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		border: 0;
		border-radius: 6px;
		background: none;
		color: var(--muted-foreground);
		cursor: pointer;
		flex-shrink: 0;
	}
	.wa-banner-close:hover {
		background: var(--muted);
		color: var(--foreground);
	}
</style>
