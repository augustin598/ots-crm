<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Select from '$lib/components/ui/select';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import ImageIcon from '@lucide/svelte/icons/image';
	import { toast } from 'svelte-sonner';
	import MaterialColorTagPicker from './material-color-tag-picker.svelte';
	import { parseColorTags, serializeColorTags, type ColorTag } from './tag-colors';
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
		attachedImages: string | null;
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
		isClientUser = false,
		onUpdated
	}: {
		open: boolean;
		material: Material | null;
		seoLinks?: SeoLinkOption[];
		isClientUser?: boolean;
		onUpdated?: () => void;
	} = $props();

	let title = $state('');
	let description = $state('');
	let textContent = $state('');
	let externalUrl = $state('');
	let seoLinkId = $state('');
	let status = $state('active');
	let tags = $state<ColorTag[]>([]);
	let saving = $state(false);

	$effect(() => {
		if (material && open) {
			title = material.title || '';
			description = material.description || '';
			textContent = material.textContent || '';
			externalUrl = material.externalUrl || '';
			seoLinkId = material.seoLinkId || '';
			status = material.status || 'active';
			tags = parseColorTags(material.tags);
		}
	});

	function isValidHttpUrl(value: string): boolean {
		try {
			const url = new URL(value);
			return url.protocol === 'http:' || url.protocol === 'https:';
		} catch {
			return false;
		}
	}

	async function handleSave() {
		if (!material) return;
		if (!title.trim()) {
			toast.error('Titlul este obligatoriu');
			return;
		}
		if (title.trim().length > 200) {
			toast.error('Titlul nu poate depăși 200 de caractere');
			return;
		}
		if (externalUrl.trim() && !isValidHttpUrl(externalUrl.trim())) {
			toast.error('URL extern invalid. Trebuie să înceapă cu https:// sau http://');
			return;
		}
		saving = true;
		try {
			const isStructured = material ? ['google-ads', 'tiktok-ads', 'facebook-ads'].includes(material.category) : false;
			await updateMarketingMaterial({
				id: material.id,
				title: title.trim(),
				description: description.trim() || null,
				...(isStructured ? {} : { textContent: textContent.trim() || null }),
				externalUrl: externalUrl.trim() || null,
				seoLinkId: seoLinkId || null,
				status: status as 'draft' | 'active' | 'archived',
				tags: serializeColorTags(tags)
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

<Dialog.Root bind:open onOpenChange={(o) => { if (!o) { title = ''; description = ''; textContent = ''; externalUrl = ''; seoLinkId = ''; status = 'active'; tags = []; } }}>
	<Dialog.Content class="sm:max-w-lg max-h-[85vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>Editează Material</Dialog.Title>
		</Dialog.Header>

		{#if material}
			<div class="space-y-4 pt-2">
				<div class="space-y-1.5">
					<Label for="edit-title">Titlu</Label>
					<Input id="edit-title" bind:value={title} maxlength={200} />
				</div>

				<div class="space-y-1.5">
					<Label for="edit-desc">Descriere</Label>
					<Textarea id="edit-desc" bind:value={description} rows={2} maxlength={1000} />
					<p class="text-xs text-muted-foreground text-right">{description.length}/1000</p>
				</div>

				{#if material.textContent !== null || material.type === 'text'}
					{@const isStructured = ['google-ads', 'tiktok-ads', 'facebook-ads'].includes(material.category)}
					<div class="space-y-1.5">
						<Label for="edit-text">Conținut Text</Label>
						{#if isStructured}
							<p class="text-xs text-muted-foreground italic">Conținut structurat — editează prin dialogul dedicat categoriei.</p>
						{:else}
							<Textarea id="edit-text" bind:value={textContent} rows={4} maxlength={50000} />
						{/if}
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

				{#if material.attachedImages}
					{@const imgCount = (() => { try { const p = JSON.parse(material.attachedImages); return Array.isArray(p) ? p.length : 0; } catch { return 0; } })()}
					{#if imgCount > 0}
						<div class="flex items-center gap-2 text-sm text-muted-foreground bg-muted rounded-lg px-3 py-2">
							<ImageIcon class="h-4 w-4 shrink-0" />
							<span>{imgCount} {imgCount === 1 ? 'imagine atașată' : 'imagini atașate'}</span>
						</div>
					{/if}
				{/if}

				{#if !isClientUser}
					<div class="space-y-1.5">
						<Label>Status</Label>
						<Select.Root type="single" bind:value={status}>
							<Select.Trigger>{status === 'active' ? 'Activ' : status === 'draft' ? 'Ciornă' : 'Arhivat'}</Select.Trigger>
							<Select.Content>
								<Select.Item value="active">Activ</Select.Item>
								<Select.Item value="draft">Ciornă</Select.Item>
								<Select.Item value="archived">Arhivat</Select.Item>
							</Select.Content>
						</Select.Root>
					</div>
				{/if}

				<div class="space-y-1.5">
					<Label>Taguri</Label>
					<MaterialColorTagPicker value={tags} onChange={(v) => { tags = v; }} />
				</div>
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
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
