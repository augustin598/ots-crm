<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';
	import { toast } from 'svelte-sonner';
	import { createAccessData, updateAccessData } from '$lib/remotes/client-access-data.remote';

	interface AccessEntry {
		id: string;
		category: string;
		label: string;
		url: string | null;
		username: string | null;
		password: string | null;
		notes: string | null;
		customFields: string | null;
	}

	let {
		open = $bindable(false),
		clientId,
		category,
		entry = null,
		onSaved
	}: {
		open: boolean;
		clientId: string;
		category: string;
		entry: AccessEntry | null;
		onSaved?: () => void;
	} = $props();

	let label = $state('');
	let url = $state('');
	let username = $state('');
	let password = $state('');
	let notes = $state('');
	let customFields = $state<{ key: string; value: string }[]>([]);
	let saving = $state(false);
	let showPassword = $state(false);

	const isEdit = $derived(entry !== null);

	$effect(() => {
		if (open) {
			if (entry) {
				label = entry.label || '';
				url = entry.url || '';
				username = entry.username || '';
				password = entry.password || '';
				notes = entry.notes || '';
				try {
					customFields = entry.customFields ? JSON.parse(entry.customFields) : [];
				} catch {
					customFields = [];
				}
			} else {
				label = '';
				url = '';
				username = '';
				password = '';
				notes = '';
				customFields = [];
			}
			showPassword = false;
		}
	});

	function addCustomField() {
		if (customFields.length >= 20) {
			toast.error('Maxim 20 câmpuri custom');
			return;
		}
		customFields = [...customFields, { key: '', value: '' }];
	}

	function removeCustomField(index: number) {
		customFields = customFields.filter((_, i) => i !== index);
	}

	async function handleSubmit() {
		if (!label.trim()) {
			toast.error('Label-ul este obligatoriu');
			return;
		}

		saving = true;
		try {
			const filteredFields = customFields.filter((f) => f.key.trim());
			const customFieldsJson = filteredFields.length > 0 ? JSON.stringify(filteredFields) : null;

			if (isEdit && entry) {
				await updateAccessData({
					id: entry.id,
					label: label.trim(),
					url: url.trim() || null,
					username: username.trim() || null,
					password: password || null,
					notes: notes.trim() || null,
					customFields: customFieldsJson
				});
				toast.success('Înregistrare actualizată');
			} else {
				await createAccessData({
					clientId,
					category: category as any,
					label: label.trim(),
					url: url.trim() || null,
					username: username.trim() || null,
					password: password || null,
					notes: notes.trim() || null,
					customFields: customFieldsJson
				});
				toast.success('Înregistrare creată');
			}

			open = false;
			onSaved?.();
		} catch (e: any) {
			toast.error(e?.message || 'Eroare la salvare');
		} finally {
			saving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg max-h-[90vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>{isEdit ? 'Editează' : 'Adaugă'} date de acces</Dialog.Title>
		</Dialog.Header>

		<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="space-y-4">
			<div class="space-y-2">
				<Label for="ad-label">Label *</Label>
				<Input id="ad-label" bind:value={label} placeholder="ex: Site principal, Admin panel" required />
			</div>

			<div class="space-y-2">
				<Label for="ad-url">URL</Label>
				<Input id="ad-url" bind:value={url} placeholder="https://..." />
			</div>

			<div class="space-y-2">
				<Label for="ad-username">Username</Label>
				<Input id="ad-username" bind:value={username} placeholder="admin" autocomplete="off" />
			</div>

			<div class="space-y-2">
				<Label for="ad-password">Parolă</Label>
				<div class="relative">
					<Input
						id="ad-password"
						type={showPassword ? 'text' : 'password'}
						bind:value={password}
						placeholder="••••••••"
						autocomplete="new-password"
						class="pr-10"
					/>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						class="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
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

			<div class="space-y-2">
				<Label for="ad-notes">Note</Label>
				<Textarea id="ad-notes" bind:value={notes} placeholder="Observații suplimentare..." rows={3} />
			</div>

			<div class="space-y-2">
				<div class="flex items-center justify-between">
					<Label>Câmpuri adiționale</Label>
					<Button type="button" variant="outline" size="sm" onclick={addCustomField}>
						<PlusIcon class="h-3.5 w-3.5 mr-1" />
						Adaugă
					</Button>
				</div>
				{#each customFields as field, i}
					<div class="flex items-center gap-2">
						<Input
							bind:value={field.key}
							placeholder="Cheie"
							class="flex-1"
						/>
						<Input
							bind:value={field.value}
							placeholder="Valoare"
							class="flex-1"
						/>
						<Button type="button" variant="ghost" size="icon" class="h-8 w-8 shrink-0 text-destructive" onclick={() => removeCustomField(i)}>
							<Trash2Icon class="h-3.5 w-3.5" />
						</Button>
					</div>
				{/each}
			</div>

			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>Anulează</Button>
				<Button type="submit" disabled={saving}>
					{#if saving}
						<LoaderIcon class="h-4 w-4 mr-2 animate-spin" />
					{/if}
					{isEdit ? 'Salvează' : 'Adaugă'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
