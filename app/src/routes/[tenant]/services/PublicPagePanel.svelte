<!--
	Tab-ul „Pagina publică" din /[tenant]/services.

	De aici se pornește/oprește versiunea publică a catalogului (/servicii) și se
	setează parola comună. Parola nu se poate citi înapoi — doar seta din nou.
	Orice schimbare de parolă rotește secretul cookie-ului, deci toate sesiunile
	publice deschise se închid instant.
-->
<script lang="ts">
	import { Card } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import { Switch } from '$lib/components/ui/switch';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import KeyIcon from '@lucide/svelte/icons/key-round';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';
	import { toast } from 'svelte-sonner';
	import {
		getPublicServicesAccess,
		setPublicServicesPassword,
		setPublicServicesEnabled,
		clearPublicServicesPassword
	} from '$lib/remotes/public-page.remote';

	const accessQuery = getPublicServicesAccess();
	const access = $derived(accessQuery.current);

	let newPassword = $state('');
	let showPassword = $state(false);
	let saving = $state(false);
	let toggling = $state(false);
	let clearing = $state(false);

	const MIN_LENGTH = 6;

	function errorText(e: unknown, fallback: string): string {
		return e instanceof Error && e.message ? e.message : fallback;
	}

	async function savePassword() {
		if (newPassword.trim().length < MIN_LENGTH) {
			toast.error(`Parola trebuie să aibă minimum ${MIN_LENGTH} caractere.`);
			return;
		}
		saving = true;
		try {
			await setPublicServicesPassword({ password: newPassword.trim() }).updates(accessQuery);
			newPassword = '';
			showPassword = false;
			toast.success('Parolă salvată', {
				description: 'Pagina publică e activă. Sesiunile deschise anterior au fost închise.'
			});
		} catch (e) {
			toast.error('Nu am putut salva parola', { description: errorText(e, 'Încearcă din nou.') });
		} finally {
			saving = false;
		}
	}

	async function toggleEnabled(enabled: boolean) {
		toggling = true;
		try {
			await setPublicServicesEnabled({ enabled }).updates(accessQuery);
			toast.success(enabled ? 'Pagina publică e activă' : 'Pagina publică a fost oprită');
		} catch (e) {
			toast.error('Nu am putut schimba starea', { description: errorText(e, 'Încearcă din nou.') });
			// Readucem switch-ul la starea reală din server.
			await accessQuery.refresh();
		} finally {
			toggling = false;
		}
	}

	async function clearPassword() {
		clearing = true;
		try {
			await clearPublicServicesPassword().updates(accessQuery);
			toast.success('Parola a fost ștearsă', { description: 'Pagina publică e închisă.' });
		} catch (e) {
			toast.error('Nu am putut șterge parola', { description: errorText(e, 'Încearcă din nou.') });
		} finally {
			clearing = false;
		}
	}

	async function copyUrl(url: string) {
		try {
			await navigator.clipboard.writeText(url);
			toast.success('Link copiat');
		} catch {
			toast.error('Nu am putut copia linkul');
		}
	}

	function formatDate(d: Date | string | null | undefined): string {
		if (!d) return '—';
		const date = d instanceof Date ? d : new Date(d);
		return date.toLocaleDateString('ro-RO', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<div class="max-w-3xl space-y-6">
	<div>
		<h2 class="text-xl font-semibold">Versiunea publică a catalogului</h2>
		<p class="text-sm text-muted-foreground mt-1">
			Aceeași ofertă de pachete, accesibilă de oriunde pe <code class="text-xs">/servicii</code>, dar
			doar cu parola pe care o setezi aici. Cererile primite de acolo apar în tab-ul „Cereri
			clienți".
		</p>
	</div>

	{#if accessQuery.loading && !access}
		<p class="text-muted-foreground">Se încarcă...</p>
	{:else if access}
		{#if !access.isPublicTenant}
			<Card class="p-4 border-amber-300 bg-amber-50 dark:bg-amber-950/30">
				<div class="flex gap-3">
					<TriangleAlertIcon class="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
					<div class="text-sm">
						<p class="font-medium">Pagina publică servește alt tenant</p>
						<p class="text-muted-foreground mt-1">
							Site-ul public nu are tenant în URL, deci afișează catalogul tenantului configurat
							prin <code class="text-xs">PUBLIC_SITE_TENANT_SLUG</code>. Setările de aici nu vor apărea
							pe /servicii.
						</p>
					</div>
				</div>
			</Card>
		{/if}

		<Card class="p-6">
			<div class="flex items-start justify-between gap-4 flex-wrap">
				<div class="flex gap-3 min-w-0">
					<div class="rounded-lg bg-muted/60 p-2.5 h-fit">
						<GlobeIcon class="h-5 w-5" />
					</div>
					<div class="min-w-0">
						<div class="flex items-center gap-2 flex-wrap">
							<h3 class="font-semibold">Pagina publică</h3>
							{#if access.enabled}
								<Badge class="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
									Activă
								</Badge>
							{:else}
								<Badge variant="outline">Oprită</Badge>
							{/if}
						</div>
						<p class="text-sm text-muted-foreground mt-1">
							{#if !access.hasPassword}
								Setează o parolă mai jos ca să poți activa pagina.
							{:else if access.enabled}
								Oricine are linkul și parola vede catalogul.
							{:else}
								Parola e setată, dar pagina răspunde cu 404 până o activezi.
							{/if}
						</p>
					</div>
				</div>
				<Switch
					checked={access.enabled}
					disabled={toggling || !access.hasPassword}
					onCheckedChange={(v) => toggleEnabled(v)}
					aria-label="Activează pagina publică"
				/>
			</div>

			<div class="mt-5 flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
				<code class="text-sm truncate flex-1">{access.publicUrl}</code>
				<Button variant="ghost" size="sm" onclick={() => copyUrl(access.publicUrl)}>
					<CopyIcon class="h-4 w-4" />
				</Button>
				<Button variant="ghost" size="sm" href={access.publicUrl} target="_blank" rel="noopener">
					<ExternalLinkIcon class="h-4 w-4" />
				</Button>
			</div>
		</Card>

		<Card class="p-6">
			<div class="flex gap-3 mb-4">
				<div class="rounded-lg bg-muted/60 p-2.5 h-fit">
					<KeyIcon class="h-5 w-5" />
				</div>
				<div>
					<h3 class="font-semibold">Parola de acces</h3>
					<p class="text-sm text-muted-foreground mt-1">
						{#if access.hasPassword}
							Parolă setată {formatDate(access.passwordUpdatedAt)}{#if access.updatedBy}
								&nbsp;de {access.updatedBy}{/if}. Nu poate fi citită înapoi — poți doar seta una nouă.
						{:else}
							Nicio parolă setată încă.
						{/if}
					</p>
				</div>
			</div>

			<div class="grid gap-2 max-w-sm">
				<Label for="public-password">
					{access.hasPassword ? 'Parolă nouă' : 'Parolă'}
				</Label>
				<div class="flex gap-2">
					<Input
						id="public-password"
						type={showPassword ? 'text' : 'password'}
						bind:value={newPassword}
						minlength={MIN_LENGTH}
						maxlength={128}
						autocomplete="new-password"
						placeholder="minimum {MIN_LENGTH} caractere"
					/>
					<Button
						variant="outline"
						size="icon"
						type="button"
						aria-label={showPassword ? 'Ascunde parola' : 'Arată parola'}
						onclick={() => (showPassword = !showPassword)}
					>
						{#if showPassword}
							<EyeOffIcon class="h-4 w-4" />
						{:else}
							<EyeIcon class="h-4 w-4" />
						{/if}
					</Button>
				</div>
			</div>

			<p class="text-xs text-muted-foreground mt-3">
				Salvarea unei parole noi activează pagina și deconectează pe toată lumea care o avea
				deschisă (inclusiv prospecții cu link vechi).
			</p>

			<div class="flex flex-wrap gap-2 mt-4">
				<Button onclick={savePassword} disabled={saving || newPassword.trim().length < MIN_LENGTH}>
					{saving ? 'Se salvează...' : access.hasPassword ? 'Schimbă parola' : 'Setează parola'}
				</Button>
				{#if access.hasPassword}
					<Button variant="outline" onclick={clearPassword} disabled={clearing}>
						{clearing ? 'Se șterge...' : 'Șterge parola și închide pagina'}
					</Button>
				{/if}
			</div>
		</Card>
	{/if}
</div>
