<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Select from '$lib/components/ui/select';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import { toast } from 'svelte-sonner';
	import { updateMarketingMaterial } from '$lib/remotes/marketing-materials.remote';

	interface Material {
		id: string;
		type: string;
		title: string;
		description: string | null;
		textContent: string | null;
		externalUrl: string | null;
		seoLinkId: string | null;
		status: string;
		tags: string | null;
		category: string;
	}

	interface SeoLinkOption {
		id: string;
		keyword: string | null;
		articleUrl: string | null;
	}

	let {
		open = $bindable(false),
		material = null,
		seoLinks = [],
		onUpdated
	}: {
		open: boolean;
		material: Material | null;
		seoLinks?: SeoLinkOption[];
		onUpdated?: () => void;
	} = $props();

	let title = $state('');
	let description = $state('');
	let textContent = $state('');
	let externalUrl = $state('');
	let seoLinkId = $state('');
	let status = $state('active');
	let tags = $state('');
	let saving = $state(false);

	$effect(() => {
		if (material && open) {
			title = material.title || '';
			description = material.description || '';
			textContent = material.textContent || '';
			externalUrl = material.externalUrl || '';
			seoLinkId = material.seoLinkId || '';
			status = material.status || 'active';
			tags = material.tags || '';
		}
	});

	async function handleSave() {
		if (!material) return;
		if (!title.trim()) {
			toast.error('Titlul este obligatoriu');
			return;
		}

		saving = true;
		try {
			await updateMarketingMaterial({
				id: material.id,
				title: title.trim(),
				description: description.trim() || null,
				textContent: textContent.trim() || null,
				externalUrl: externalUrl.trim() || null,
				seoLinkId: seoLinkId || null,
				status: status as 'draft' | 'active' | 'archived',
				tags: tags.trim() || null
			});
			toast.success('Material actualizat');
			open = false;
			onUpdated?.();
		} catch (e: any) {
			toast.error(e?.message || 'Eroare la actualizare');
		} finally {
			saving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Editează Material</Dialog.Title>
		</Dialog.Header>

		{#if material}
			<div class="space-y-4 pt-2">
				<div class="space-y-1.5">
					<Label for="edit-title">Titlu</Label>
					<Input id="edit-title" bind:value={title} />
				</div>

				<div class="space-y-1.5">
					<Label for="edit-desc">Descriere</Label>
					<Textarea id="edit-desc" bind:value={description} rows={2} />
				</div>

				{#if material.textContent !== null || material.type === 'text'}
					<div class="space-y-1.5">
						<Label for="edit-text">Conținut Text</Label>
						<Textarea id="edit-text" bind:value={textContent} rows={4} />
					</div>
				{/if}

				{#if material.externalUrl !== null || material.type === 'url'}
					<div class="space-y-1.5">
						<Label for="edit-url">URL Extern</Label>
						<Input id="edit-url" type="url" bind:value={externalUrl} />
					</div>
				{/if}

				<!-- SEO Link selector -->
				{#if material.category === 'seo-article' && seoLinks.length > 0}
					<div class="space-y-1.5">
						<Label>Link SEO asociat</Label>
						<Select.Root type="single" bind:value={seoLinkId}>
							<Select.Trigger>
								{seoLinks.find((l) => l.id === seoLinkId)?.keyword || 'Selectează...'}
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="">Niciunul</Select.Item>
								{#each seoLinks as link}
									<Select.Item value={link.id}>
										{link.keyword || 'N/A'} — {link.articleUrl || 'fără URL'}
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
				{/if}

				<div class="space-y-1.5">
					<Label>Status</Label>
					<Select.Root type="single" bind:value={status}>
						<Select.Trigger>{status === 'active' ? 'Activ' : status === 'draft' ? 'Draft' : 'Arhivat'}</Select.Trigger>
						<Select.Content>
							<Select.Item value="active">Activ</Select.Item>
							<Select.Item value="draft">Draft</Select.Item>
							<Select.Item value="archived">Arhivat</Select.Item>
						</Select.Content>
					</Select.Root>
				</div>

				<div class="space-y-1.5">
					<Label for="edit-tags">Taguri</Label>
					<Input id="edit-tags" bind:value={tags} placeholder="separate prin virgulă" />
				</div>
			</div>
		{/if}

		<Dialog.Footer class="pt-4">
			<Button variant="outline" onclick={() => (open = false)}>Anulează</Button>
			<Button onclick={handleSave} disabled={saving}>
				{#if saving}
					<LoaderIcon class="h-4 w-4 mr-2 animate-spin" />
					Se salvează...
				{:else}
					Salvează
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
