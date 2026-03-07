<script lang="ts">
	import {
		getSchedulerJobs,
		getSchedulerHistory,
		updateJobSchedule,
		removeSchedulerJob,
		triggerJobNow
	} from '$lib/remotes/scheduler.remote';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import {
		Collapsible,
		CollapsibleContent,
		CollapsibleTrigger
	} from '$lib/components/ui/collapsible';
	import { toast } from 'svelte-sonner';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import PlayIcon from '@lucide/svelte/icons/play';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import CheckIcon from '@lucide/svelte/icons/check';
	import XIcon from '@lucide/svelte/icons/x';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle';
	import XCircleIcon from '@lucide/svelte/icons/x-circle';
	import ClockIcon from '@lucide/svelte/icons/clock';

	const jobsQuery = getSchedulerJobs();
	const jobs = $derived(jobsQuery.current || []);

	const historyQuery = getSchedulerHistory();
	const history = $derived(historyQuery.current || []);

	let refreshing = $state(false);
	let editingJobKey = $state<string | null>(null);
	let editPattern = $state('');

	const completedLogs = $derived(history.filter((l) => l.level === 'info' && l.message.includes('completed')));
	const failedLogs = $derived(history.filter((l) => l.level === 'error' && l.message.includes('failed')));

	async function refresh() {
		refreshing = true;
		jobsQuery.updates();
		historyQuery.updates();
		setTimeout(() => (refreshing = false), 500);
	}

	function startEdit(job: (typeof jobs)[0]) {
		editingJobKey = job.key;
		editPattern = job.pattern || '';
	}

	function cancelEdit() {
		editingJobKey = null;
		editPattern = '';
	}

	async function saveSchedule(job: (typeof jobs)[0]) {
		try {
			await updateJobSchedule({ jobId: job.key, name: job.name, pattern: editPattern });
			toast.success(`Schedule actualizat: ${job.label}`);
			editingJobKey = null;
			jobsQuery.updates();
		} catch (e: any) {
			toast.error(`Eroare: ${e.message}`);
		}
	}

	async function handleRemoveJob(job: (typeof jobs)[0]) {
		if (!confirm(`Sigur doriti sa stergeti job-ul "${job.label}"?`)) return;
		try {
			await removeSchedulerJob(job.key);
			toast.success(`Job sters: ${job.label}`);
			jobsQuery.updates();
		} catch (e: any) {
			toast.error(`Eroare: ${e.message}`);
		}
	}

	async function handleTriggerNow(job: (typeof jobs)[0]) {
		try {
			await triggerJobNow({ name: job.name, typeKey: job.typeKey });
			toast.success(`Job lansat manual: ${job.label}`);
			setTimeout(() => historyQuery.updates(), 2000);
		} catch (e: any) {
			toast.error(`Eroare: ${e.message}`);
		}
	}

	function formatDate(date: Date | string | null) {
		if (!date) return '-';
		const d = typeof date === 'string' ? new Date(date) : date;
		return d.toLocaleString('ro-RO', {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	}

	function cronToHuman(pattern: string): string {
		const parts = pattern.split(' ');
		if (parts.length !== 5) return pattern;
		const [min, hour, dom, mon, dow] = parts;
		if (min === '0' && hour === '*') return 'La fiecare ora';
		if (dow === '1-5') return `L-V la ${hour}:${min.padStart(2, '0')}`;
		if (dom === '*' && mon === '*' && dow === '*') return `Zilnic la ${hour}:${min.padStart(2, '0')}`;
		return pattern;
	}

	// Pagination for history
	let historyPage = $state(0);
	const historyPerPage = 20;
	const paginatedHistory = $derived(history.slice(historyPage * historyPerPage, (historyPage + 1) * historyPerPage));
	const totalHistoryPages = $derived(Math.ceil(history.length / historyPerPage));
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold">Scheduler</h1>
			<p class="text-muted-foreground">Gestionati job-urile programate si vizualizati istoricul executiilor</p>
		</div>
		<Button variant="outline" size="sm" onclick={refresh}>
			<RefreshCwIcon class="size-4 {refreshing ? 'animate-spin' : ''}" />
			Refresh
		</Button>
	</div>

	<!-- Stats -->
	<div class="grid grid-cols-3 gap-4">
		<Card>
			<CardContent class="pt-6">
				<div class="text-2xl font-bold">{jobs.length}</div>
				<p class="text-xs text-muted-foreground">Job-uri Active</p>
			</CardContent>
		</Card>
		<Card>
			<CardContent class="pt-6">
				<div class="text-2xl font-bold text-green-600">{completedLogs.length}</div>
				<p class="text-xs text-muted-foreground">Completate (recent)</p>
			</CardContent>
		</Card>
		<Card>
			<CardContent class="pt-6">
				<div class="text-2xl font-bold text-red-600">{failedLogs.length}</div>
				<p class="text-xs text-muted-foreground">Esuate (recent)</p>
			</CardContent>
		</Card>
	</div>

	<!-- Scheduled Jobs -->
	<Card>
		<CardHeader>
			<CardTitle>Job-uri Programate</CardTitle>
		</CardHeader>
		<CardContent>
			{#if jobs.length === 0}
				<p class="text-muted-foreground text-sm">Nu exista job-uri programate.</p>
			{:else}
				<div class="divide-y">
					{#each jobs as job (job.key)}
						<div class="py-3 flex items-center gap-4">
							<div class="flex-1 min-w-0">
								<div class="font-medium">{job.label}</div>
								<div class="text-xs text-muted-foreground mt-0.5">
									{job.name} &middot; {job.tz}
								</div>
							</div>
							<div class="text-sm text-center min-w-[140px]">
								{#if editingJobKey === job.key}
									<div class="flex items-center gap-1">
										<Input
											bind:value={editPattern}
											class="h-7 text-xs w-[130px] font-mono"
											placeholder="0 2 * * *"
										/>
										<Button variant="ghost" size="icon" class="h-7 w-7" onclick={() => saveSchedule(job)}>
											<CheckIcon class="size-3.5 text-green-600" />
										</Button>
										<Button variant="ghost" size="icon" class="h-7 w-7" onclick={cancelEdit}>
											<XIcon class="size-3.5 text-red-600" />
										</Button>
									</div>
								{:else}
									<Badge variant="secondary" class="font-mono text-xs">{job.pattern}</Badge>
									<div class="text-xs text-muted-foreground mt-0.5">{cronToHuman(job.pattern || '')}</div>
								{/if}
							</div>
							<div class="text-xs text-muted-foreground min-w-[130px] text-right">
								{#if job.next}
									<ClockIcon class="size-3 inline mr-1" />
									{formatDate(job.next)}
								{/if}
							</div>
							<div class="flex items-center gap-1">
								<Button variant="ghost" size="icon" class="h-7 w-7" title="Ruleaza acum" onclick={() => handleTriggerNow(job)}>
									<PlayIcon class="size-3.5" />
								</Button>
								<Button variant="ghost" size="icon" class="h-7 w-7" title="Editeaza schedule" onclick={() => startEdit(job)}>
									<PencilIcon class="size-3.5" />
								</Button>
								<Button variant="ghost" size="icon" class="h-7 w-7" title="Sterge job" onclick={() => handleRemoveJob(job)}>
									<Trash2Icon class="size-3.5 text-red-500" />
								</Button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</CardContent>
	</Card>

	<!-- History -->
	<Card>
		<CardHeader>
			<div class="flex items-center justify-between">
				<CardTitle>Istoric Executii</CardTitle>
				<span class="text-sm text-muted-foreground">{history.length} inregistrari</span>
			</div>
		</CardHeader>
		<CardContent>
			{#if history.length === 0}
				<p class="text-muted-foreground text-sm">Nu exista inregistrari.</p>
			{:else}
				<div class="space-y-2">
					{#each paginatedHistory as log (log.id)}
						<Collapsible>
							<CollapsibleTrigger class="w-full">
								<div class="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 text-left w-full">
									{#if log.level === 'error'}
										<XCircleIcon class="size-4 text-red-500 shrink-0" />
									{:else}
										<CheckCircleIcon class="size-4 text-green-500 shrink-0" />
									{/if}
									<div class="flex-1 min-w-0 truncate text-sm">
										{log.message}
									</div>
									<div class="text-xs text-muted-foreground shrink-0">
										{formatDate(log.createdAt)}
									</div>
									<ChevronDownIcon class="size-4 text-muted-foreground shrink-0" />
								</div>
							</CollapsibleTrigger>
							<CollapsibleContent>
								<div class="ml-7 p-3 bg-muted/30 rounded-md text-xs space-y-2">
									{#if log.metadata}
										<div>
											<span class="font-semibold">Metadata:</span>
											<pre class="mt-1 whitespace-pre-wrap text-muted-foreground">{typeof log.metadata === 'string' ? log.metadata : JSON.stringify(log.metadata, null, 2)}</pre>
										</div>
									{/if}
									{#if log.stackTrace}
										<div>
											<span class="font-semibold text-red-500">Stack Trace:</span>
											<pre class="mt-1 whitespace-pre-wrap text-red-400/80">{log.stackTrace}</pre>
										</div>
									{/if}
								</div>
							</CollapsibleContent>
						</Collapsible>
					{/each}
				</div>

				<!-- Pagination -->
				{#if totalHistoryPages > 1}
					<div class="flex items-center justify-between mt-4 pt-4 border-t">
						<span class="text-sm text-muted-foreground">
							Pagina {historyPage + 1} din {totalHistoryPages}
						</span>
						<div class="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								disabled={historyPage === 0}
								onclick={() => historyPage--}
							>
								Anterior
							</Button>
							<Button
								variant="outline"
								size="sm"
								disabled={historyPage >= totalHistoryPages - 1}
								onclick={() => historyPage++}
							>
								Urmator
							</Button>
						</div>
					</div>
				{/if}
			{/if}
		</CardContent>
	</Card>
</div>
