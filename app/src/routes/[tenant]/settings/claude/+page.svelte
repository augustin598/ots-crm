<!-- src/routes/[tenant]/settings/claude/+page.svelte -->
<script lang="ts">
	import {
		getClaudeIntegration,
		saveClaudeIntegration,
		testClaudeConnection,
		deleteClaudeIntegration
	} from '$lib/remotes/claude-integration.remote';
	import { CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL } from '$lib/claude-models';
	import { toast } from 'svelte-sonner';
	import KeyIcon from '@lucide/svelte/icons/key';
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import RefreshIcon from '@lucide/svelte/icons/refresh-cw';
	import TrashIcon from '@lucide/svelte/icons/trash-2';

	const integrationQuery = getClaudeIntegration();
	const current = $derived(integrationQuery.current ?? null);
	const loading = $derived(integrationQuery.loading);

	let apiKey = $state('');
	let defaultModel = $state<string>(DEFAULT_CLAUDE_MODEL);
	let modelInitialized = $state(false);
	let saving = $state(false);
	let testing = $state(false);
	let deleting = $state(false);

	// Pre-umple dropdown-ul cu modelul salvat, o singură dată.
	$effect(() => {
		if (current && !modelInitialized) {
			defaultModel = current.defaultModel ?? DEFAULT_CLAUDE_MODEL;
			modelInitialized = true;
		}
	});

	async function save() {
		saving = true;
		try {
			await saveClaudeIntegration({ apiKey: apiKey.trim(), defaultModel }).updates(
				integrationQuery
			);
			toast.success('Cheia Claude a fost salvată.');
			apiKey = '';
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la salvare');
		} finally {
			saving = false;
		}
	}

	async function runTest() {
		testing = true;
		try {
			const r = await testClaudeConnection().updates(integrationQuery);
			toast.success(
				r.via === 'models'
					? `OK — cheie validă (${r.models.length} modele disponibile).`
					: 'OK — cheie validă.'
			);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Test eșuat');
		} finally {
			testing = false;
		}
	}

	async function remove() {
		if (!confirm('Sigur ștergi cheia Claude a acestui tenant?')) return;
		deleting = true;
		try {
			await deleteClaudeIntegration().updates(integrationQuery);
			toast.success('Cheia Claude a fost ștearsă.');
			apiKey = '';
			defaultModel = DEFAULT_CLAUDE_MODEL;
			modelInitialized = false;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		} finally {
			deleting = false;
		}
	}
</script>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold">Claude</h1>
		<p class="text-slate-500">
			Conectează cheia ta Claude (Anthropic). Suportă atât API key (sk-ant-api…) cât și Claude Code
			OAuth token (sk-ant-oat…). Cheia e criptată și nu părăsește serverul.
		</p>
	</div>

	{#if current?.connected}
		<div class="rounded-xl border bg-white p-6 dark:bg-slate-800">
			<div class="flex items-center gap-2">
				<CheckCircleIcon class="h-5 w-5 text-green-600" />
				<span class="font-medium">Conectat</span>
				<span class="text-sm text-slate-500">
					cheie {current.keyType === 'oat' ? 'OAuth' : 'API'} …{current.keyHint}
				</span>
			</div>
			{#if current.lastError}
				<div
					class="mt-3 flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200"
				>
					<AlertCircleIcon class="mt-0.5 h-4 w-4 shrink-0" />
					<span>{current.lastError}</span>
				</div>
			{/if}
			{#if current.lastTestedAt}
				<p class="mt-2 text-xs text-slate-500">
					Ultimul test: {new Date(current.lastTestedAt).toLocaleString('ro-RO')}
				</p>
			{/if}
		</div>
	{/if}

	<div class="rounded-xl border bg-white p-6 dark:bg-slate-800">
		<div class="space-y-4">
			<div class="space-y-1.5">
				<label for="claude-key" class="text-sm font-medium">Cheie Claude</label>
				<input
					id="claude-key"
					type="password"
					bind:value={apiKey}
					placeholder={current?.connected ? 'Lasă gol ca să păstrezi cheia actuală' : 'sk-ant-…'}
					autocomplete="off"
					disabled={loading}
					class="w-full rounded-md border px-3 py-2 text-sm dark:bg-slate-900"
				/>
			</div>
			<div class="space-y-1.5">
				<label for="claude-model" class="text-sm font-medium">Model implicit</label>
				<select
					id="claude-model"
					bind:value={defaultModel}
					disabled={loading}
					class="w-full rounded-md border px-3 py-2 text-sm dark:bg-slate-900"
				>
					{#each CLAUDE_MODELS as m (m.id)}
						<option value={m.id}>{m.label}</option>
					{/each}
				</select>
			</div>
			<div class="flex flex-wrap gap-2">
				<button
					onclick={save}
					disabled={saving}
					class="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
				>
					<KeyIcon class="h-4 w-4" />
					{saving ? 'Se salvează…' : 'Salvează'}
				</button>
				{#if current?.connected}
					<button
						onclick={runTest}
						disabled={testing}
						class="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
					>
						<RefreshIcon class="h-4 w-4 {testing ? 'animate-spin' : ''}" />
						{testing ? 'Se testează…' : 'Test conexiune'}
					</button>
					<button
						onclick={remove}
						disabled={deleting}
						class="inline-flex items-center gap-2 rounded-md border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/40"
					>
						<TrashIcon class="h-4 w-4" />
						{deleting ? 'Se șterge…' : 'Șterge'}
					</button>
				{/if}
			</div>
		</div>
	</div>
</div>
