<script lang="ts">
	import {
		getSchedulerJobs,
		getSchedulerHistory,
		getSchedulerStats,
		getJobStats,
		updateJobSchedule,
		removeSchedulerJob,
		triggerJobNow,
		deleteSchedulerLogsByLevel
	} from '$lib/remotes/scheduler.remote';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import {
		Select,
		SelectContent,
		SelectItem,
		SelectTrigger
	} from '$lib/components/ui/select';
	import {
		Collapsible,
		CollapsibleContent,
		CollapsibleTrigger
	} from '$lib/components/ui/collapsible';
	import * as Popover from '$lib/components/ui/popover';
	import { RangeCalendar } from '$lib/components/ui/range-calendar';
	import { type DateValue } from '@internationalized/date';
	import type { DateRange } from 'bits-ui';
	import { toast } from 'svelte-sonner';
	import { clientLogger } from '$lib/client-logger';
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
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import SearchIcon from '@lucide/svelte/icons/search';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import ReceiptTextIcon from '@lucide/svelte/icons/receipt-text';
	import LandmarkIcon from '@lucide/svelte/icons/landmark';
	import MailIcon from '@lucide/svelte/icons/mail';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import type { Component } from 'svelte';

	// ---- Data Queries ----
	const jobsQuery = getSchedulerJobs();
	const jobsData = $derived(jobsQuery.current || { jobs: [], allJobLabels: {} });
	const jobs = $derived(jobsData.jobs);
	const allJobLabels = $derived(jobsData.allJobLabels as Record<string, string>);

	const historyQuery = getSchedulerHistory();
	const history = $derived(historyQuery.current || []);

	const statsQuery = getSchedulerStats();
	const stats = $derived(statsQuery.current || { total: 0, info: 0, warning: 0, error: 0 });

	// Per-job stats from server (not limited by history cap)
	const jobStatsQuery = getJobStats();
	const jobStats = $derived(jobStatsQuery.current || {} as Record<string, { successCount: number; failCount: number; lastRun: string | null; lastStatus: 'success' | 'error' | null }>);

	// ---- UI State ----
	let refreshing = $state(false);
	let editingJobKey = $state<string | null>(null);
	let editPattern = $state('');

	// Loading states for actions
	let triggeringJob = $state<string | null>(null);
	let savingJob = $state<string | null>(null);
	let removingJob = $state<string | null>(null);

	// ---- Job Categories ----
	const JOB_CATEGORIES: Record<string, { label: string; icon: Component; jobs: string[] }> = {
		facturare: {
			label: 'Facturare',
			icon: ReceiptTextIcon,
			jobs: ['recurring_invoices', 'invoice_overdue_reminders']
		},
		financiar: {
			label: 'Integrari Financiare',
			icon: LandmarkIcon,
			jobs: ['spv_invoice_sync', 'keez_invoice_sync', 'revolut_transaction_sync', 'bnr_rate_sync']
		},
		google: {
			label: 'Google Ads',
			icon: SearchIcon,
			jobs: ['google_ads_invoice_sync', 'token_refresh_frequent']
		},
		meta: {
			label: 'Meta Ads',
			icon: PlayIcon,
			jobs: ['meta_ads_invoice_sync', 'meta_ads_leads_sync']
		},
		tiktok: {
			label: 'TikTok Ads',
			icon: PlayIcon,
			jobs: ['tiktok_ads_spending_sync']
		},
		email: {
			label: 'Email & Rapoarte',
			icon: MailIcon,
			jobs: ['gmail_invoice_sync', 'gmail_invoice_sync_evening', 'pdf_report_send']
		},
		sistem: {
			label: 'Sistem',
			icon: SettingsIcon,
			jobs: ['task_reminders', 'daily_work_reminders', 'contract_lifecycle', 'token_refresh_daily', 'db_write_health_check', 'debug_log_cleanup']
		}
	};

	const groupedJobs = $derived.by(() => {
		const groups: Array<{ key: string; label: string; icon: Component; jobs: typeof jobs }> = [];
		const assigned = new Set<string>();

		for (const [key, cat] of Object.entries(JOB_CATEGORIES)) {
			const catJobs = jobs.filter((j) => cat.jobs.includes(j.typeKey));
			if (catJobs.length > 0) {
				groups.push({ key, label: cat.label, icon: cat.icon, jobs: catJobs });
				catJobs.forEach((j) => assigned.add(j.key));
			}
		}

		// Uncategorized jobs (safety net)
		const uncategorized = jobs.filter((j) => !assigned.has(j.key));
		if (uncategorized.length > 0) {
			groups.push({ key: 'other', label: 'Altele', icon: SettingsIcon, jobs: uncategorized });
		}

		return groups;
	});

	// ---- History Filters ----
	let historyFilter = $state<string>('all');
	let historyLevelFilter = $state<string>('');
	let historySearchText = $state('');
	let historyDateRange = $state<DateRange>({ start: undefined, end: undefined });
	let historyDateOpen = $state(false);

	const historyDateRangeLabel = $derived.by(() => {
		const { start, end } = historyDateRange;
		if (!start) return 'Selecteaza perioada';
		const fmt = (d: DateValue) =>
			new Date(d.year, d.month - 1, d.day).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
		if (!end) return fmt(start);
		return `${fmt(start)} - ${fmt(end)}`;
	});

	// Derive unique handler types for dropdown (deduplicated by handlerType)
	const jobTypeOptions = $derived.by(() => {
		const seen = new Map<string, string>();
		for (const job of jobs) {
			if (!seen.has(job.handlerType)) {
				seen.set(job.handlerType, job.label);
			}
		}
		// Add any labels not represented by current jobs (e.g. removed jobs still in logs)
		for (const [key, label] of Object.entries(allJobLabels)) {
			const ht = key.replace(/_(?:frequent|daily|evening)$/, '');
			if (!seen.has(ht) && !seen.has(key)) {
				seen.set(key, label);
			}
		}
		return Array.from(seen, ([key, label]) => ({ key, label }));
	});

	// Extract handler type from "Job completed: TYPE" or "Job failed: TYPE - error"
	function extractLogHandlerType(message: string): string | null {
		const m = message.match(/^Job (?:completed|failed): (\S+)/);
		return m ? m[1] : null;
	}

	const filteredHistory = $derived(
		history.filter((l) => {
			// Job type filter — exact match on handler type extracted from message
			if (historyFilter !== 'all') {
				const logHt = extractLogHandlerType(l.message);
				const matchesJobType = logHt === historyFilter;
				const matchesInMessage = l.message.includes(historyFilter) && !logHt;
				if (!matchesJobType && !matchesInMessage) return false;
			}
			// Level filter
			if (historyLevelFilter && l.level !== historyLevelFilter) return false;
			// Text search
			if (historySearchText) {
				const s = historySearchText.toLowerCase();
				const meta = typeof l.metadata === 'string' ? l.metadata : JSON.stringify(l.metadata || '');
				if (
					!l.message?.toLowerCase().includes(s) &&
					!meta.toLowerCase().includes(s) &&
					!(l.stackTrace || '').toLowerCase().includes(s)
				) return false;
			}
			// Date range filter
			if (historyDateRange.start) {
				const logDate = new Date(l.createdAt);
				const startDate = new Date(historyDateRange.start.year, historyDateRange.start.month - 1, historyDateRange.start.day);
				if (logDate < startDate) return false;
				if (historyDateRange.end) {
					const endDate = new Date(historyDateRange.end.year, historyDateRange.end.month - 1, historyDateRange.end.day + 1);
					if (logDate >= endDate) return false;
				}
			}
			return true;
		})
	);

	const hasActiveFilters = $derived(
		historyFilter !== 'all' || historyLevelFilter !== '' || historySearchText !== '' || !!historyDateRange.start
	);

	function resetHistoryFilters() {
		historyFilter = 'all';
		historyLevelFilter = '';
		historySearchText = '';
		historyDateRange = { start: undefined, end: undefined };
		historyPage = 1;
	}

	// ---- Pagination (1-based) ----
	let historyPage = $state(1);
	const historyPerPage = 20;
	// Clamp page to valid range when filters reduce result count
	const safeHistoryPage = $derived(Math.max(1, Math.min(historyPage, Math.ceil(filteredHistory.length / historyPerPage) || 1)));
	const paginatedHistory = $derived(filteredHistory.slice((safeHistoryPage - 1) * historyPerPage, safeHistoryPage * historyPerPage));
	const totalHistoryPages = $derived(Math.ceil(filteredHistory.length / historyPerPage));

	// ---- Actions ----
	async function refresh() {
		refreshing = true;
		try {
			await Promise.all([jobsQuery.refresh(), historyQuery.refresh(), statsQuery.refresh(), jobStatsQuery.refresh()]);
		} finally {
			refreshing = false;
		}
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
		savingJob = job.key;
		try {
			await updateJobSchedule({ jobId: job.key, name: job.name, pattern: editPattern });
			toast.success(`Schedule actualizat: ${job.label}`);
			editingJobKey = null;
			jobsQuery.refresh();
		} catch (e: any) {
			clientLogger.apiError('scheduler_save_schedule', e);
			toast.error(e?.message || 'Eroare la salvarea schedule-ului');
		} finally {
			savingJob = null;
		}
	}

	async function handleRemoveJob(job: (typeof jobs)[0]) {
		if (!confirm(`Sigur doriti sa stergeti job-ul "${job.label}"?`)) return;
		removingJob = job.key;
		try {
			await removeSchedulerJob(job.key);
			toast.success(`Job sters: ${job.label}`);
			jobsQuery.refresh();
		} catch (e: any) {
			clientLogger.apiError('scheduler_remove_job', e);
			toast.error(e?.message || 'Eroare la stergerea job-ului');
		} finally {
			removingJob = null;
		}
	}

	async function handleTriggerNow(job: (typeof jobs)[0]) {
		triggeringJob = job.key;
		try {
			await triggerJobNow({ name: job.name, typeKey: job.typeKey, params: job.params });
			toast.success(`Job lansat manual: ${job.label}`);
			setTimeout(() => historyQuery.refresh(), 2000);
		} catch (e: any) {
			clientLogger.apiError('scheduler_trigger_now', e);
			toast.error(e?.message || 'Eroare la lansarea job-ului');
		} finally {
			triggeringJob = null;
		}
	}

	// ---- Helpers ----
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

	function formatDateShort(date: Date | string | null) {
		if (!date) return '-';
		const d = typeof date === 'string' ? new Date(date) : date;
		return d.toLocaleString('ro-RO', {
			day: '2-digit',
			month: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function cronToHuman(pattern: string): string {
		const parts = pattern.split(' ');
		if (parts.length !== 5) return pattern;
		const [min, hour, dom, mon, dow] = parts;

		// Every N minutes: */N * * * *
		if (min.startsWith('*/') && hour === '*' && dom === '*') {
			return `La fiecare ${min.slice(2)} minute`;
		}
		// Every hour at :00
		if (min === '0' && hour === '*' && dom === '*') return 'La fiecare ora';
		// Every N hours at :00
		if (min === '0' && hour.startsWith('*/') && dom === '*') {
			return `La fiecare ${hour.slice(2)} ore`;
		}
		// Every N hours at :MM offset
		if (min !== '*' && !min.startsWith('*/') && hour.startsWith('*/') && dom === '*') {
			return `La fiecare ${hour.slice(2)} ore, la :${min.padStart(2, '0')}`;
		}
		// Monthly on specific day: 0 H D * *
		if (dom !== '*' && mon === '*' && dow === '*') {
			return `Lunar pe ${dom} la ${hour}:${min.padStart(2, '0')}`;
		}
		// Weekdays
		if (dow === '1-5') return `L-V la ${hour}:${min.padStart(2, '0')}`;
		// Daily
		if (dom === '*' && mon === '*' && dow === '*') return `Zilnic la ${hour}:${min.padStart(2, '0')}`;
		return pattern;
	}

	function toggleStatFilter(level: string) {
		if (historyLevelFilter === level) {
			historyLevelFilter = '';
		} else {
			historyLevelFilter = level;
		}
		historyPage = 1;
	}

	let deletingLevel = $state<string | null>(null);

	async function handleDeleteByLevel(level: 'info' | 'warning' | 'error', label: string) {
		if (!confirm(`Sigur doriti sa stergeti toate logurile de tip "${label}"?`)) return;
		deletingLevel = level;
		try {
			await deleteSchedulerLogsByLevel(level);
			toast.success(`Loguri "${label}" sterse`);
			await Promise.all([historyQuery.refresh(), statsQuery.refresh(), jobStatsQuery.refresh()]);
		} catch (e: any) {
			clientLogger.apiError('scheduler_delete_logs', e);
			toast.error(e?.message || 'Eroare la stergerea logurilor');
		} finally {
			deletingLevel = null;
		}
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold">Scheduler</h1>
			<p class="text-muted-foreground">Gestionati job-urile programate si vizualizati istoricul executiilor</p>
		</div>
		<Button variant="outline" size="sm" onclick={refresh} disabled={refreshing}>
			<RefreshCwIcon class="size-4 {refreshing ? 'animate-spin' : ''}" />
			Refresh
		</Button>
	</div>

	<!-- Stats Cards (clickable, toggle level filter) -->
	<div class="grid grid-cols-4 gap-4">
		<Card>
			<CardContent class="pt-6">
				<div class="text-2xl font-bold">{jobs.length}</div>
				<p class="text-xs text-muted-foreground">Job-uri Active</p>
			</CardContent>
		</Card>
		<Card
			class="cursor-pointer transition-colors hover:border-green-500/50 {historyLevelFilter === 'info' ? 'border-green-500' : ''}"
			onclick={() => toggleStatFilter('info')}
		>
			<CardContent class="pt-4 pb-4">
				<div class="flex items-center justify-between">
					<p class="text-sm text-muted-foreground">Completate</p>
					<Button
						variant="ghost"
						size="icon"
						class="h-6 w-6 p-0"
						disabled={deletingLevel === 'info'}
						onclick={(e: MouseEvent) => { e.stopPropagation(); handleDeleteByLevel('info', 'Completate'); }}
					>
						{#if deletingLevel === 'info'}
							<RefreshCwIcon class="h-3 w-3 animate-spin text-muted-foreground" />
						{:else}
							<Trash2Icon class="h-3 w-3 text-muted-foreground" />
						{/if}
					</Button>
				</div>
				<p class="text-2xl font-bold text-green-600">{stats.info}</p>
				<p class="text-xs text-muted-foreground">total loguri</p>
			</CardContent>
		</Card>
		<Card
			class="cursor-pointer transition-colors hover:border-amber-500/50 {historyLevelFilter === 'warning' ? 'border-amber-500' : ''}"
			onclick={() => toggleStatFilter('warning')}
		>
			<CardContent class="pt-4 pb-4">
				<div class="flex items-center justify-between">
					<p class="text-sm text-muted-foreground">Avertismente</p>
					<Button
						variant="ghost"
						size="icon"
						class="h-6 w-6 p-0"
						disabled={deletingLevel === 'warning'}
						onclick={(e: MouseEvent) => { e.stopPropagation(); handleDeleteByLevel('warning', 'Avertismente'); }}
					>
						{#if deletingLevel === 'warning'}
							<RefreshCwIcon class="h-3 w-3 animate-spin text-muted-foreground" />
						{:else}
							<Trash2Icon class="h-3 w-3 text-muted-foreground" />
						{/if}
					</Button>
				</div>
				<p class="text-2xl font-bold text-amber-600">{stats.warning}</p>
				<p class="text-xs text-muted-foreground">total loguri</p>
			</CardContent>
		</Card>
		<Card
			class="cursor-pointer transition-colors hover:border-red-500/50 {historyLevelFilter === 'error' ? 'border-red-500' : ''}"
			onclick={() => toggleStatFilter('error')}
		>
			<CardContent class="pt-4 pb-4">
				<div class="flex items-center justify-between">
					<p class="text-sm text-muted-foreground">Esuate</p>
					<Button
						variant="ghost"
						size="icon"
						class="h-6 w-6 p-0"
						disabled={deletingLevel === 'error'}
						onclick={(e: MouseEvent) => { e.stopPropagation(); handleDeleteByLevel('error', 'Esuate'); }}
					>
						{#if deletingLevel === 'error'}
							<RefreshCwIcon class="h-3 w-3 animate-spin text-muted-foreground" />
						{:else}
							<Trash2Icon class="h-3 w-3 text-muted-foreground" />
						{/if}
					</Button>
				</div>
				<p class="text-2xl font-bold text-red-600">{stats.error}</p>
				<p class="text-xs text-muted-foreground">total loguri</p>
			</CardContent>
		</Card>
	</div>

	<!-- Scheduled Jobs (grouped by category) -->
	{#if jobs.length === 0}
		<Card>
			<CardContent class="pt-6">
				<p class="text-muted-foreground text-sm">Nu exista job-uri programate.</p>
			</CardContent>
		</Card>
	{:else}
		{#each groupedJobs as group, gi (group.key)}
			<Card>
				<CardContent class="pt-4">
					<div class="flex items-center gap-2 mb-3">
						<group.icon class="size-4 text-muted-foreground" />
						<h3 class="font-semibold text-sm">{group.label}</h3>
						<span class="text-xs text-muted-foreground">({group.jobs.length})</span>
					</div>
					<div class="divide-y">
						{#each group.jobs as job, i (job.key)}
							{@const stat = jobStats[job.handlerType]}
							{@const isTriggering = triggeringJob === job.key}
							{@const isSaving = savingJob === job.key}
							{@const isRemoving = removingJob === job.key}
							<div class="py-3 flex items-center gap-4">
								<span class="text-xs text-muted-foreground font-mono w-5 text-right shrink-0">{i + 1}</span>
								<div class="flex-1 min-w-0">
									<div class="font-medium">{job.label}</div>
									<div class="text-xs text-muted-foreground mt-0.5">
										{job.name} &middot; {job.tz}
									</div>
								</div>
								<!-- Per-job stats -->
								<div class="text-xs min-w-[100px] text-center">
									{#if stat}
										<div class="flex items-center justify-center gap-1.5">
											<span class="text-green-600 font-medium">{stat.successCount}</span>
											<span class="text-muted-foreground">/</span>
											<span class="text-red-600 font-medium">{stat.failCount}</span>
										</div>
										{#if stat.lastRun}
											<div class="text-muted-foreground mt-0.5 flex items-center justify-center gap-1">
												{#if stat.lastStatus === 'error'}
													<XCircleIcon class="size-3 text-red-500" />
												{:else}
													<CheckCircleIcon class="size-3 text-green-500" />
												{/if}
												{formatDateShort(stat.lastRun)}
											</div>
										{:else}
											<div class="text-muted-foreground mt-0.5">Nicio executie</div>
										{/if}
									{/if}
								</div>
								<div class="text-sm text-center min-w-[140px]">
									{#if editingJobKey === job.key}
										<div class="flex items-center gap-1">
											<Input
												bind:value={editPattern}
												class="h-7 text-xs w-[130px] font-mono"
												placeholder="0 2 * * *"
											/>
											<Button variant="ghost" size="icon" class="h-7 w-7" onclick={() => saveSchedule(job)} disabled={isSaving}>
												{#if isSaving}
													<RefreshCwIcon class="size-3.5 animate-spin" />
												{:else}
													<CheckIcon class="size-3.5 text-green-600" />
												{/if}
											</Button>
											<Button variant="ghost" size="icon" class="h-7 w-7" onclick={cancelEdit} disabled={isSaving}>
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
									<Button variant="ghost" size="icon" class="h-7 w-7" title="Ruleaza acum" onclick={() => handleTriggerNow(job)} disabled={isTriggering}>
										{#if isTriggering}
											<RefreshCwIcon class="size-3.5 animate-spin" />
										{:else}
											<PlayIcon class="size-3.5" />
										{/if}
									</Button>
									<Button variant="ghost" size="icon" class="h-7 w-7" title="Editeaza schedule" onclick={() => startEdit(job)}>
										<PencilIcon class="size-3.5" />
									</Button>
									<Button variant="ghost" size="icon" class="h-7 w-7" title="Sterge job" onclick={() => handleRemoveJob(job)} disabled={isRemoving}>
										{#if isRemoving}
											<RefreshCwIcon class="size-3.5 animate-spin text-red-500" />
										{:else}
											<Trash2Icon class="size-3.5 text-red-500" />
										{/if}
									</Button>
								</div>
							</div>
						{/each}
					</div>
				</CardContent>
			</Card>
		{/each}
	{/if}

	<!-- History -->
	<Card>
		<CardHeader>
			<CardTitle>Istoric Executii</CardTitle>
		</CardHeader>
		<CardContent class="space-y-4">
			<!-- Filter Bar -->
			<div class="flex flex-wrap gap-3 items-center">
				<div class="relative flex-1 min-w-[200px]">
					<SearchIcon class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
					<Input
						placeholder="Cauta in mesaje, metadata, stack trace..."
						bind:value={historySearchText}
						oninput={() => { historyPage = 1; }}
						class="pl-9"
					/>
				</div>
				<Popover.Root bind:open={historyDateOpen}>
					<Popover.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant="outline" class="h-9 justify-start text-start font-normal text-sm {historyDateRange.start ? '' : 'text-muted-foreground'}">
								<CalendarIcon class="mr-2 h-3.5 w-3.5 shrink-0 opacity-50" />
								{historyDateRangeLabel}
							</Button>
						{/snippet}
					</Popover.Trigger>
					<Popover.Content class="w-auto p-0" align="start">
						<div class="flex flex-col">
							<RangeCalendar
								bind:value={historyDateRange}
								locale="ro-RO"
								weekStartsOn={1}
								onValueChange={() => {
									if (historyDateRange.start && historyDateRange.end) {
										historyDateOpen = false;
										historyPage = 1;
									}
								}}
							/>
							<Button
								variant="ghost"
								class="rounded-t-none border-t text-muted-foreground text-sm"
								onclick={() => { historyDateRange = { start: undefined, end: undefined }; historyDateOpen = false; historyPage = 1; }}
							>
								Sterge filtru
							</Button>
						</div>
					</Popover.Content>
				</Popover.Root>
				{#if historyDateRange.start}
					<Button variant="ghost" size="sm" class="h-9 px-2" onclick={() => { historyDateRange = { start: undefined, end: undefined }; historyPage = 1; }}>
						<XIcon class="h-3.5 w-3.5" />
					</Button>
				{/if}
				<Select type="single" value={historyFilter} onValueChange={(v) => { historyFilter = v ?? 'all'; historyPage = 1; }}>
					<SelectTrigger class="w-[200px]">
						{historyFilter === 'all' ? 'Toate job-urile' : (allJobLabels[historyFilter] || historyFilter)}
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">Toate job-urile ({history.length})</SelectItem>
						{#each jobTypeOptions as opt (opt.key)}
							<SelectItem value={opt.key}>{opt.label}</SelectItem>
						{/each}
					</SelectContent>
				</Select>
				<Select type="single" value={historyLevelFilter} onValueChange={(v) => { historyLevelFilter = v ?? ''; historyPage = 1; }}>
					<SelectTrigger class="w-[160px]">
						{historyLevelFilter === 'info' ? 'Informatie' : historyLevelFilter === 'warning' ? 'Avertisment' : historyLevelFilter === 'error' ? 'Eroare' : 'Toate nivelurile'}
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="">Toate nivelurile</SelectItem>
						<SelectItem value="info">Informatie</SelectItem>
						<SelectItem value="warning">Avertisment</SelectItem>
						<SelectItem value="error">Eroare</SelectItem>
					</SelectContent>
				</Select>
				{#if hasActiveFilters}
					<Button variant="ghost" size="sm" class="h-9" onclick={resetHistoryFilters}>
						<RotateCcwIcon class="size-3.5 mr-1" />
						Reset
					</Button>
				{/if}
				<span class="text-sm text-muted-foreground ml-auto">
					{filteredHistory.length} din {history.length} inregistrari
					{#if history.length >= 1000}<span class="text-xs opacity-60">(limita 1000)</span>{/if}
				</span>
			</div>

			<!-- History List -->
			{#if filteredHistory.length === 0}
				<p class="text-muted-foreground text-sm">Nu exista inregistrari{hasActiveFilters ? ' care corespund filtrelor' : ''}.</p>
			{:else}
				<div class="space-y-2">
					{#each paginatedHistory as log (log.id)}
						{@const hasDetails = !!(log.metadata || log.stackTrace)}
						{#if hasDetails}
							<Collapsible>
								<CollapsibleTrigger class="w-full">
									<div class="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 text-left w-full">
										{#if log.level === 'error'}
											<XCircleIcon class="size-4 text-red-500 shrink-0" />
										{:else if log.level === 'warning'}
											<TriangleAlertIcon class="size-4 text-amber-500 shrink-0" />
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
									<div class="ml-7 p-3 bg-muted/30 rounded-md text-xs space-y-2 overflow-hidden">
										{#if log.metadata}
											<div class="overflow-x-auto">
												<span class="font-semibold">Metadata:</span>
												<pre class="mt-1 whitespace-pre-wrap break-all text-muted-foreground">{typeof log.metadata === 'string' ? log.metadata : JSON.stringify(log.metadata, null, 2)}</pre>
											</div>
										{/if}
										{#if log.stackTrace}
											<div class="overflow-x-auto">
												<span class="font-semibold text-red-500">Stack Trace:</span>
												<pre class="mt-1 whitespace-pre-wrap break-all text-red-400/80">{log.stackTrace}</pre>
											</div>
										{/if}
									</div>
								</CollapsibleContent>
							</Collapsible>
						{:else}
							<div class="flex items-center gap-3 p-2 rounded-md text-left w-full">
								{#if log.level === 'error'}
									<XCircleIcon class="size-4 text-red-500 shrink-0" />
								{:else if log.level === 'warning'}
									<TriangleAlertIcon class="size-4 text-amber-500 shrink-0" />
								{:else}
									<CheckCircleIcon class="size-4 text-green-500 shrink-0" />
								{/if}
								<div class="flex-1 min-w-0 truncate text-sm">
									{log.message}
								</div>
								<div class="text-xs text-muted-foreground shrink-0">
									{formatDate(log.createdAt)}
								</div>
							</div>
						{/if}
					{/each}
				</div>

				<!-- Pagination -->
				{#if totalHistoryPages > 1}
					<div class="flex items-center justify-between mt-4 pt-4 border-t">
						<span class="text-sm text-muted-foreground">
							Pagina {safeHistoryPage} din {totalHistoryPages}
						</span>
						<div class="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								disabled={historyPage <= 1}
								onclick={() => historyPage--}
							>
								Anterior
							</Button>
							<Button
								variant="outline"
								size="sm"
								disabled={historyPage >= totalHistoryPages}
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
