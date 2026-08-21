<script lang="ts">
	/**
	 * Cererea numărului de WhatsApp către utilizatorul de portal.
	 *
	 * Starea („modal", „banner" sau nimic) e decisă pe server, în layoutul
	 * portalului, ca să se randeze din prima. Modalul apare o dată pe sesiune;
	 * după trei amânări rămâne doar bannerul.
	 */
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
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
	<Dialog.Content class="sm:max-w-md">
		<div class="flex items-start gap-3.5">
			<div class="wa-badge">
				<IconWhatsapp class="size-6" />
			</div>
			<div class="min-w-0">
				<Dialog.Title class="text-[17px] leading-snug font-extrabold text-balance">
					Care e numărul tău de WhatsApp?
				</Dialog.Title>
				<Dialog.Description class="mt-1 text-[13.5px] leading-relaxed">
					Când apare ceva urgent la proiectul tău, cel mai rapid te găsim pe WhatsApp. Lasă-ne
					numărul tău de mobil și echipa <span class="font-semibold text-foreground">{tenantName}</span>
					îți scrie direct acolo, în loc să trimită un e-mail pe care-l vezi a doua zi.
				</Dialog.Description>
			</div>
		</div>

		<div class="flex flex-col gap-1.5">
			<Label for="wa-phone">Numărul tău de mobil</Label>
			<Input
				id="wa-phone"
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
				<p id="wa-phone-error" class="text-xs font-medium text-destructive">{error}</p>
			{:else}
				<p id="wa-phone-hint" class="text-xs text-muted-foreground">
					Îl folosim doar ca să vorbim cu tine despre proiectele tale. Îl poți schimba sau șterge
					oricând din Setări.
				</p>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="ghost" onclick={dismiss} disabled={saving}>Nu acum</Button>
			<Button onclick={save} disabled={saving || !phone.trim()}>
				{saving ? 'Se verifică…' : 'Salvează numărul'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<style>
	.wa-badge {
		width: 44px;
		height: 44px;
		border-radius: 12px;
		flex-shrink: 0;
		display: grid;
		place-items: center;
		background: color-mix(in oklch, #25d366 14%, transparent);
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
