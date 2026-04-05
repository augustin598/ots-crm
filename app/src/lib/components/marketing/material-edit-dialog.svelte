<script lang="ts">
	import { untrack } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Select from '$lib/components/ui/select';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import ImageIcon from '@lucide/svelte/icons/image';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
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
	let initMaterialId = '';

	// Social URL sets editing
	let urlSets = $state<{ title: string; urls: string[] }[]>([]);

	const isSocialUrl = $derived(
		material ? (material.category === 'tiktok-ads' || material.category === 'facebook-ads') && material.type === 'url' : false
	);

	function parseSocialSets(textContent: string | null): { title: string; urls: string[] }[] {
		if (!textContent) return [];
		try {
			const parsed = JSON.parse(textContent);
			if (!Array.isArray(parsed)) return [];
			if (parsed.length > 0 && typeof parsed[0] === 'object' && 'title' in parsed[0]) {
				return parsed.filter((s: any) => s.title && Array.isArray(s.urls)).map((s: any) => ({ title: s.title, urls: [...s.urls] }));
			}
			const urls = parsed.filter((u: any) => typeof u === 'string' && u.trim());
			if (urls.length > 0) return [{ title: '', urls: [...urls] }];
		} catch { /* not JSON */ }
		return [];
	}

	function addUrlToSet(setIdx: number) {
		urlSets[setIdx].urls = [...urlSets[setIdx].urls, ''];
		urlSets = [...urlSets];
	}

	function removeUrlFromSet(setIdx: number, urlIdx: number) {
		urlSets[setIdx].urls = urlSets[setIdx].urls.filter((_, i) => i !== urlIdx);
		urlSets = [...urlSets];
	}

	function addSet() {
		urlSets = [...urlSets, { title: '', urls: [''] }];
	}

	function removeSet(setIdx: number) {
		urlSets = urlSets.filter((_, i) => i !== setIdx);
	}

	// Init fields only when dialog opens (open transitions false→true), not on background refreshes
	$effect(() => {
		const isOpen = open;
		const mat = material;
		if (isOpen && mat) {
			const prevId = untrack(() => initMaterialId);
			if (prevId !== mat.id) {
				initMaterialId = mat.id;
				title = mat.title || '';
				description = mat.description || '';
				textContent = mat.textContent || '';
				externalUrl = mat.externalUrl || '';
				seoLinkId = mat.seoLinkId || '';
				status = mat.status || 'active';
				tags = parseColorTags(mat.tags);
				urlSets = parseSocialSets(mat.textContent);
			}
		}
		if (!isOpen) {
			initMaterialId = '';
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
			const isGoogleAds = material ? material.category === 'google-ads' : false;
			// Social URL sets — serialize back to JSON
			let updatedTextContent: string | null | undefined = undefined;
			if (isSocialUrl) {
				const cleanSets = urlSets
					.map((s) => ({ title: s.title.trim(), urls: s.urls.filter((u) => u.trim()) }))
					.filter((s) => s.urls.length > 0);
				updatedTextContent = cleanSets.length > 0 ? JSON.stringify(cleanSets) : null;
			} else if (!isGoogleAds) {
				updatedTextContent = textContent.trim() || null;
			}

			await updateMarketingMaterial({
				id: material.id,
				title: title.trim(),
				description: description.trim() || null,
				...(updatedTextContent !== undefined ? { textContent: updatedTextContent } : {}),
				externalUrl: isSocialUrl && urlSets.length > 0 && urlSets[0].urls.length > 0
					? urlSets[0].urls[0].trim() || null
					: externalUrl.trim() || null,
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

				{#if isSocialUrl}
					<!-- Social URL sets editor -->
					<div class="space-y-3">
						<div class="flex items-center justify-between">
							<Label>Seturi de URL-uri</Label>
							<Button variant="ghost" size="sm" class="h-7 text-xs gap-1" onclick={addSet}>
								<PlusIcon class="h-3 w-3" /> Set nou
							</Button>
						</div>
						{#each urlSets as set, si (si)}
							<div class="border rounded-lg p-3 space-y-2">
								<div class="flex items-center gap-2">
									<Input
										bind:value={set.title}
										placeholder="Nume set (ex: Campania Aprilie)"
										class="h-7 text-xs flex-1"
									/>
									{#if urlSets.length > 1}
										<Button variant="ghost" size="sm" class="h-7 w-7 p-0 text-destructive" onclick={() => removeSet(si)}>
											<XIcon class="h-3.5 w-3.5" />
										</Button>
									{/if}
								</div>
								{#each set.urls as url, ui (ui)}
									<div class="flex items-center gap-1.5 pl-2">
										<ExternalLinkIcon class="h-3 w-3 text-muted-foreground shrink-0" />
										<Input
											bind:value={set.urls[ui]}
											placeholder="https://..."
											class="h-7 text-xs flex-1"
										/>
										{#if set.urls.length > 1}
											<Button variant="ghost" size="sm" class="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" onclick={() => removeUrlFromSet(si, ui)}>
												<XIcon class="h-3 w-3" />
											</Button>
										{/if}
									</div>
								{/each}
								<Button variant="ghost" size="sm" class="h-6 text-xs text-muted-foreground w-full" onclick={() => addUrlToSet(si)}>
									<PlusIcon class="h-3 w-3 mr-1" /> Adaugă URL
								</Button>
							</div>
						{/each}
					</div>
				{:else if material.textContent !== null || material.type === 'text'}
					{@const isGoogleAds = material.category === 'google-ads'}
					<div class="space-y-1.5">
						<Label for="edit-text">Conținut Text</Label>
						{#if isGoogleAds}
							<p class="text-xs text-muted-foreground italic">Conținut structurat — editează prin dialogul Google Ads.</p>
						{:else}
							<Textarea id="edit-text" bind:value={textContent} rows={4} maxlength={50000} />
						{/if}
					</div>
				{/if}

				{#if !isSocialUrl && (material.externalUrl !== null || material.type === 'url')}
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
