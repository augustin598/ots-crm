<script lang="ts">
	import { Card } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import SendIcon from '@lucide/svelte/icons/send';
	import LinkIcon from '@lucide/svelte/icons/link';
	import UnlinkIcon from '@lucide/svelte/icons/link-2-off';
	import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
	import { toast } from 'svelte-sonner';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let link = $state({ ...data.link });
	let generating = $state(false);
	let testing = $state(false);
	let deepLink = $state<string | null>(null);

	async function generateLink() {
		generating = true;
		try {
			const res = await fetch(`/${data.tenantSlug}/api/settings/telegram/link`, {
				method: 'POST'
			});
			const body = (await res.json()) as { deepLink?: string; expiresAt?: string };
			if (!res.ok || !body.deepLink) throw new Error('Generare cod eșuată');
			deepLink = body.deepLink;
			link = {
				...link,
				hasPendingCode: true,
				pendingExpiresAt: body.expiresAt ? new Date(body.expiresAt) : null
			};
			toast.success('Cod generat. Apasă pe link pentru a deschide Telegram.');
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			generating = false;
		}
	}

	async function disconnectTelegram() {
		if (!confirm('Sigur deconectezi Telegram?')) return;
		try {
			const res = await fetch(`/${data.tenantSlug}/api/settings/telegram/link`, {
				method: 'DELETE'
			});
			if (!res.ok) throw new Error('Deconectare eșuată');
			link = { linked: false, telegramUsername: null, linkedAt: null, hasPendingCode: false, pendingExpiresAt: null };
			deepLink = null;
			toast.success('Telegram deconectat.');
		} catch (e) {
			toast.error((e as Error).message);
		}
	}

	async function sendTest() {
		testing = true;
		try {
			const res = await fetch(`/${data.tenantSlug}/api/settings/telegram/link`, {
				method: 'PUT'
			});
			const body = (await res.json()) as { ok: boolean; reason?: string; detail?: string };
			if (!body.ok) {
				if (body.reason === 'no_token') throw new Error('TELEGRAM_BOT_TOKEN nu e configurat pe server.');
				if (body.reason === 'not_linked') throw new Error('Niciun chat conectat.');
				throw new Error(body.detail ?? body.reason ?? 'Eroare');
			}
			toast.success('Mesaj test trimis. Verifică Telegram.');
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			testing = false;
		}
	}
</script>

<svelte:head>
	<title>Setări Telegram</title>
</svelte:head>

<div class="container mx-auto p-6 max-w-3xl space-y-6">
	<div>
		<h1 class="text-3xl font-bold flex items-center gap-3">
			<SendIcon class="h-7 w-7" />
			Telegram
		</h1>
		<p class="text-muted-foreground">
			Primește alerte de monitoring Meta Ads direct pe Telegram.
		</p>
	</div>

	<Card class="p-6">
		<div class="flex items-start justify-between gap-4">
			<div>
				<h2 class="text-xl font-semibold mb-2">Status conectare</h2>
				{#if link.linked}
					<div class="flex items-center gap-2">
						<CheckCircle2Icon class="h-5 w-5 text-green-600" />
						<span>
							Conectat
							{#if link.telegramUsername}
								ca <span class="font-mono">@{link.telegramUsername}</span>
							{/if}
						</span>
					</div>
					{#if link.linkedAt}
						<p class="text-sm text-muted-foreground mt-1">
							Activ din {new Date(link.linkedAt).toLocaleDateString('ro-RO', {
								day: '2-digit',
								month: 'long',
								year: 'numeric'
							})}.
						</p>
					{/if}
				{:else if link.hasPendingCode}
					<Badge variant="secondary">Cod activ — așteaptă /start în Telegram</Badge>
					{#if link.pendingExpiresAt}
						<p class="text-sm text-muted-foreground mt-1">
							Expiră la {new Date(link.pendingExpiresAt).toLocaleTimeString('ro-RO')}.
						</p>
					{/if}
				{:else}
					<Badge variant="outline">Neconectat</Badge>
				{/if}
			</div>
			<div class="flex flex-col gap-2 min-w-[180px]">
				{#if link.linked}
					<Button variant="default" size="sm" onclick={sendTest} disabled={testing}>
						<SendIcon class="h-4 w-4 mr-2" />
						{testing ? 'Trimit…' : 'Trimite test'}
					</Button>
					<Button variant="outline" size="sm" onclick={disconnectTelegram}>
						<UnlinkIcon class="h-4 w-4 mr-2" />
						Deconectează
					</Button>
				{:else}
					<Button onclick={generateLink} disabled={generating}>
						<LinkIcon class="h-4 w-4 mr-2" />
						{generating ? 'Generez…' : 'Conectează Telegram'}
					</Button>
				{/if}
			</div>
		</div>

		{#if deepLink && !link.linked}
			<div class="mt-6 p-4 rounded-md border border-primary/40 bg-primary/5">
				<p class="text-sm font-medium mb-2">Deschide Telegram cu acest link:</p>
				<a
					href={deepLink}
					target="_blank"
					rel="noopener"
					class="text-primary underline break-all font-mono text-xs"
				>
					{deepLink}
				</a>
				<p class="text-xs text-muted-foreground mt-3">
					După ce dai /start, această pagină se va actualiza automat. Reîncarcă-o dacă nu vezi
					schimbarea în 30 secunde.
				</p>
			</div>
		{/if}
	</Card>

	<Card class="p-6 bg-muted/20">
		<h3 class="font-semibold mb-2">Cum funcționează</h3>
		<ol class="text-sm space-y-2 list-decimal list-inside text-muted-foreground">
			<li>Apasă „Conectează Telegram”.</li>
			<li>
				Vei primi un link de tipul <code class="text-xs"
					>https://t.me/{data.botUsername}?start=...</code
				>.
			</li>
			<li>Apasă pe link, Telegram se deschide și pornește bot-ul cu un cod unic.</li>
			<li>Bot-ul confirmă conectarea. Reîncarcă pagina pentru a vedea statusul actualizat.</li>
			<li>De acum, deviațiile high/urgent îți ajung pe Telegram.</li>
		</ol>
	</Card>
</div>
