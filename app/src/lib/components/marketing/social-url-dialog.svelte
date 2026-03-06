<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Separator } from '$lib/components/ui/separator';
	import { Badge } from '$lib/components/ui/badge';
	import Combobox from '$lib/components/ui/combobox/combobox.svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import ListIcon from '@lucide/svelte/icons/list';
	import SaveIcon from '@lucide/svelte/icons/save';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import { toast } from 'svelte-sonner';
	import { getTasks } from '$lib/remotes/tasks.remote';
	import { createSocialUrlSets } from '$lib/remotes/marketing-materials.remote';
	import MaterialColorTagPicker from './material-color-tag-picker.svelte';
	import { serializeColorTags, type ColorTag } from './tag-colors';

	interface UrlSet {
		title: string;
		urls: string[];
		bulkMode: boolean;
		bulkText: string;
	}

	let {
		open = $bindable(false),
		clientId,
		category,
		onSaved
	}: {
		open: boolean;
		clientId: string;
		category: 'tiktok-ads' | 'facebook-ads';
		onSaved?: () => void;
	} = $props();

	let sets = $state<UrlSet[]>([{ title: '', urls: [''], bulkMode: false, bulkText: '' }]);
	let tags = $state<ColorTag[]>([]);
	let selectedTaskId = $state<string | undefined>(undefined);
	let saving = $state(false);

	const tasksQuery = $derived(getTasks({ clientId }));
	const taskOptions = $derived(
		(tasksQuery.current || []).map((t: any) => ({
			value: t.id,
			label: t.title || `Task #${t.id.slice(0, 6)}`
		}))
	);

	const categoryLabel = $derived(category === 'tiktok-ads' ? 'TikTok Ads' : 'Facebook Ads');

	function resetDialog() {
		sets = [{ title: '', urls: [''], bulkMode: false, bulkText: '' }];
		tags = [];
		selectedTaskId = undefined;
		saving = false;
	}

	function addSet() {
		sets = [...sets, { title: '', urls: [''], bulkMode: false, bulkText: '' }];
	}

	function removeSet(index: number) {
		if (sets.length <= 1) return;
		sets = sets.filter((_, i) => i !== index);
	}

	function addUrl(setIndex: number) {
		sets[setIndex].urls = [...sets[setIndex].urls, ''];
	}

	function removeUrl(setIndex: number, urlIndex: number) {
		if (sets[setIndex].urls.length <= 1) return;
		sets[setIndex].urls = sets[setIndex].urls.filter((_, i) => i !== urlIndex);
	}

	function handleBulkPaste(setIndex: number, e: ClipboardEvent) {
		e.preventDefault();
		const pasted = e.clipboardData?.getData('text') || '';
		const cleaned = pasted.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
		const ta = e.target as HTMLTextAreaElement;
		const start = ta.selectionStart;
		const end = ta.selectionEnd;
		const current = sets[setIndex].bulkText;
		sets[setIndex].bulkText = current.slice(0, start) + cleaned + current.slice(end);
	}

	function toggleBulk(setIndex: number) {
		const set = sets[setIndex];
		if (set.bulkMode) {
			// Parse bulk text and add to URL list
			const newUrls = set.bulkText
				.split('\n')
				.map((u) => u.trim())
				.filter(Boolean);
			if (newUrls.length > 0) {
				const existingNonEmpty = set.urls.filter((u) => u.trim());
				sets[setIndex].urls = [...existingNonEmpty, ...newUrls];
			}
			sets[setIndex].bulkText = '';
		}
		sets[setIndex].bulkMode = !set.bulkMode;
	}

	function isValidHttpUrl(value: string): boolean {
		try {
			const url = new URL(value);
			return url.protocol === 'http:' || url.protocol === 'https:';
		} catch {
			return false;
		}
	}

	async function handleSave() {
		// Auto-process any open bulk textareas before validating
		for (let i = 0; i < sets.length; i++) {
			if (sets[i].bulkMode && sets[i].bulkText.trim()) {
				toggleBulk(i);
			}
		}

		// Validate sets
		for (let i = 0; i < sets.length; i++) {
			const set = sets[i];
			if (!set.title.trim()) {
				toast.error(`Setul ${i + 1}: titlul este obligatoriu`);
				return;
			}
			const validUrls = set.urls.filter((u) => u.trim());
			if (validUrls.length === 0) {
				toast.error(`Setul ${i + 1}: adăugați cel puțin un URL`);
				return;
			}
			for (const url of validUrls) {
				if (!isValidHttpUrl(url)) {
					toast.error(`Setul ${i + 1}: URL invalid — ${url}`);
					return;
				}
			}
		}

		// Serialize color tags
		const tagsStr = serializeColorTags(tags);

		saving = true;
		try {
			await createSocialUrlSets({
				clientId,
				category,
				sets: sets.map((s) => ({
					title: s.title.trim(),
					urls: s.urls.filter((u) => u.trim())
				})),
				tags: tagsStr,
				taskId: selectedTaskId || null
			});
			toast.success(`${sets.length} set(uri) salvate cu succes`);
			resetDialog();
			open = false;
			onSaved?.();
		} catch (e: any) {
			toast.error(e?.message || 'Eroare la salvare');
		} finally {
			saving = false;
		}
	}
</script>

<Dialog.Root bind:open onOpenChange={(o) => { if (!o) resetDialog(); }}>
	<Dialog.Content class="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>{categoryLabel} — Seturi URL-uri</Dialog.Title>
			<Dialog.Description>Adaugă seturi de URL-uri grupate pe conturi.</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4 pt-2">
			<!-- Sets -->
			{#each sets as set, setIdx}
				<div class="border rounded-lg p-4 space-y-3">
					<!-- Set header -->
					<div class="flex items-center gap-2">
						<Input
							bind:value={set.title}
							placeholder="Nume set (ex: Cont Heylux)"
							class="flex-1 font-medium"
						/>
						<Badge variant="outline" class="shrink-0">{setIdx + 1}/{sets.length}</Badge>
						{#if sets.length > 1}
							<Button variant="ghost" size="icon" class="h-8 w-8 shrink-0 text-destructive" onclick={() => removeSet(setIdx)}>
								<Trash2Icon class="h-4 w-4" />
							</Button>
						{/if}
					</div>

					<!-- URL list -->
					{#each set.urls as url, urlIdx}
						<div class="flex items-center gap-2">
							<Input
								type="url"
								value={url}
								oninput={(e) => { sets[setIdx].urls[urlIdx] = (e.target as HTMLInputElement).value; }}
								placeholder="https://tiktok.com/..."
								class="flex-1 text-sm"
							/>
							{#if set.urls.length > 1}
								<Button variant="ghost" size="icon" class="h-8 w-8 shrink-0" onclick={() => removeUrl(setIdx, urlIdx)}>
									<XIcon class="h-4 w-4" />
								</Button>
							{/if}
						</div>
					{/each}

					<!-- Action buttons -->
					<div class="flex gap-2">
						<Button variant="outline" size="sm" onclick={() => addUrl(setIdx)}>
							<PlusIcon class="h-3.5 w-3.5 mr-1" /> Adaugă URL
						</Button>
						<Button variant="outline" size="sm" onclick={() => toggleBulk(setIdx)}>
							<ListIcon class="h-3.5 w-3.5 mr-1" />
							{set.bulkMode ? 'Adaugă URL-urile' : 'Bulk'}
						</Button>
					</div>

					<!-- Bulk textarea -->
					{#if set.bulkMode}
						<div class="space-y-2">
							<Textarea
								bind:value={set.bulkText}
								rows={4}
								placeholder="Lipește URL-uri, câte unul pe linie..."
								class="text-sm"
								onpaste={(e) => handleBulkPaste(setIdx, e)}
							/>
							<p class="text-xs text-muted-foreground">
								{set.bulkText.split('\n').filter((l) => l.trim()).length} URL-uri detectate
							</p>
						</div>
					{/if}
				</div>
			{/each}

			<!-- Add new set -->
			<Button variant="outline" class="w-full" onclick={addSet}>
				<PlusIcon class="h-4 w-4 mr-2" /> Adaugă Set Nou
			</Button>

			<Separator />

			<!-- Global fields -->
			<div class="space-y-3">
				<div class="space-y-1.5">
					<Label>Taguri</Label>
					<MaterialColorTagPicker value={tags} onChange={(v) => { tags = v; }} />
				</div>
				<div class="space-y-1.5">
					<Label>Task asociat (opțional)</Label>
					<Combobox
						options={taskOptions}
						bind:value={selectedTaskId}
						placeholder="Selectează un task..."
						searchPlaceholder="Caută task..."
					/>
				</div>
			</div>
		</div>

		<Dialog.Footer class="pt-4">
			<Button variant="outline" onclick={() => { resetDialog(); open = false; }}>Anulează</Button>
			<Button onclick={handleSave} disabled={saving}>
				{#if saving}
					<LoaderIcon class="h-4 w-4 mr-2 animate-spin" />
					Se salvează...
				{:else}
					<SaveIcon class="h-4 w-4 mr-2" />
					Salvează Seturile
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
