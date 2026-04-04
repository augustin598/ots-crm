<script lang="ts">
	import {
		getEmailLogs,
		getEmailLogStats,
		deleteEmailLog,
		deleteAllEmailLogs,
		retryEmailLog
	} from '$lib/remotes/email-logs.remote';
	import {
		getDebugLogs,
		getDebugLogStats,
		deleteDebugLog,
		deleteDebugLogsByLevel,
		deleteAllDebugLogs,
		resolveDebugLog,
		bulkResolveDebugLogs
	} from '$lib/remotes/debug-logs.remote';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import {
		Select,
		SelectContent,
		SelectItem,
		SelectTrigger
	} from '$lib/components/ui/select';
	import { Tabs, TabsList, TabsTrigger, TabsContent } from '$lib/components/ui/tabs';
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
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import MailIcon from '@lucide/svelte/icons/mail';
	import BugIcon from '@lucide/svelte/icons/bug';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle';
	import XCircleIcon from '@lucide/svelte/icons/x-circle';
	import TimerIcon from '@lucide/svelte/icons/timer';
	import SearchIcon from '@lucide/svelte/icons/search';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import XIcon from '@lucide/svelte/icons/x';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import CheckIcon from '@lucide/svelte/icons/check';
	import UndoIcon from '@lucide/svelte/icons/undo';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import { page } from '$app/state';
	import { getErrorByCode } from '$lib/error-codes';

	// ---- Email Logs ----
	const emailLogsQuery = getEmailLogs();
	const allEmailLogs = $derived(emailLogsQuery.current || []);
	const emailStatsQuery = getEmailLogStats();
	const emailStats = $derived(
		emailStatsQuery.current || { pending: 0, active: 0, completed: 0, failed: 0, delayed: 0 }
	);

	let emailStatusFilter = $state<string>('');
	let emailTypeFilter = $state<string>('');
	let emailSearchText = $state('');
	let emailDateRange = $state<DateRange>({ start: undefined, end: undefined });
	let emailDateOpen = $state(false);

	const emailDateRangeLabel = $derived.by(() => {
		const { start, end } = emailDateRange;
		if (!start) return 'Selecteaza perioada';
		const fmt = (d: DateValue) => new Date(d.year, d.month - 1, d.day).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
		if (!end) return fmt(start);
		return `${fmt(start)} - ${fmt(end)}`;
	});

	const filteredEmailLogs = $derived(
		allEmailLogs.filter((log: any) => {
			if (emailStatusFilter && log.status !== emailStatusFilter) return false;
			if (emailTypeFilter && log.emailType !== emailTypeFilter) return false;
			if (emailSearchText) {
				const s = emailSearchText.toLowerCase();
				if (
					!log.toEmail?.toLowerCase().includes(s) &&
					!log.subject?.toLowerCase().includes(s) &&
					!log.emailType?.toLowerCase().includes(s) &&
					!String(log.id).includes(s)
				)
					return false;
			}
			if (emailDateRange.start) {
				const logDate = new Date(log.createdAt);
				const startDate = new Date(emailDateRange.start.year, emailDateRange.start.month - 1, emailDateRange.start.day);
				if (logDate < startDate) return false;
				if (emailDateRange.end) {
					const endDate = new Date(emailDateRange.end.year, emailDateRange.end.month - 1, emailDateRange.end.day + 1);
					if (logDate >= endDate) return false;
				}
			}
			return true;
		})
	);

	let emailPage = $state(1);
	let emailPageSize = $state(20);
	const emailTotalPages = $derived(Math.ceil(filteredEmailLogs.length / emailPageSize));
	const paginatedEmailLogs = $derived(
		filteredEmailLogs.slice((emailPage - 1) * emailPageSize, emailPage * emailPageSize)
	);

	$effect(() => {
		emailStatusFilter;
		emailTypeFilter;
		emailSearchText;
		emailDateRange;
		emailPage = 1;
	});

	// ---- Debug Logs ----
	const debugLogsQuery = getDebugLogs();
	const allDebugLogs = $derived(debugLogsQuery.current || []);
	const debugStatsQuery = getDebugLogStats();
	const debugStats = $derived(
		debugStatsQuery.current || { total: 0, errors: 0, warnings: 0, infos: 0, errors24h: 0 }
	);

	let debugLevelFilter = $state<string>('');
	let debugSourceFilter = $state<string>('');
	let debugSearchText = $state('');
	let debugDateRange = $state<DateRange>({ start: undefined, end: undefined });
	let debugDateOpen = $state(false);

	const debugDateRangeLabel = $derived.by(() => {
		const { start, end } = debugDateRange;
		if (!start) return 'Selecteaza perioada';
		const fmt = (d: DateValue) => new Date(d.year, d.month - 1, d.day).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
		if (!end) return fmt(start);
		return `${fmt(start)} - ${fmt(end)}`;
	});

	const filteredDebugLogs = $derived(
		allDebugLogs.filter((log: any) => {
			if (debugLevelFilter && log.level !== debugLevelFilter) return false;
			if (debugSourceFilter && log.source !== debugSourceFilter) return false;
			if (debugSearchText) {
				const s = debugSearchText.toLowerCase();
				if (
					!log.message?.toLowerCase().includes(s) &&
					!log.url?.toLowerCase().includes(s) &&
					!log.source?.toLowerCase().includes(s)
				)
					return false;
			}
			if (debugDateRange.start) {
				const logDate = new Date(log.createdAt);
				const startDate = new Date(debugDateRange.start.year, debugDateRange.start.month - 1, debugDateRange.start.day);
				if (logDate < startDate) return false;
				if (debugDateRange.end) {
					const endDate = new Date(debugDateRange.end.year, debugDateRange.end.month - 1, debugDateRange.end.day + 1);
					if (logDate >= endDate) return false;
				}
			}
			return true;
		})
	);

	let debugPage = $state(1);
	let debugPageSize = $state(20);
	let debugResolvedFilter = $state<string>(''); // '', 'resolved', 'unresolved'
	let selectedDebugLogIds = $state<Set<string>>(new Set());
	let expandedDebugLogId = $state<string | null>(null);

	const filteredDebugLogsWithResolved = $derived(
		filteredDebugLogs.filter((log: any) => {
			if (debugResolvedFilter === 'resolved' && !log.resolved) return false;
			if (debugResolvedFilter === 'unresolved' && log.resolved) return false;
			return true;
		})
	);

	const debugTotalPagesResolved = $derived(Math.ceil(filteredDebugLogsWithResolved.length / debugPageSize));
	const paginatedDebugLogsResolved = $derived(
		filteredDebugLogsWithResolved.slice((debugPage - 1) * debugPageSize, debugPage * debugPageSize)
	);

	function toggleDebugLogSelection(id: string) {
		const next = new Set(selectedDebugLogIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedDebugLogIds = next;
	}

	function toggleAllDebugLogs() {
		if (selectedDebugLogIds.size === paginatedDebugLogsResolved.length) {
			selectedDebugLogIds = new Set();
		} else {
			selectedDebugLogIds = new Set(paginatedDebugLogsResolved.map((l: any) => l.id));
		}
	}

	$effect(() => {
		debugLevelFilter;
		debugSourceFilter;
		debugSearchText;
		debugDateRange;
		debugResolvedFilter;
		debugPage = 1;
		selectedDebugLogIds = new Set();
	});

	// ---- Helpers ----
	function formatDate(date: Date | string | null): string {
		if (!date) return '-';
		const d = new Date(date);
		return d.toLocaleDateString('ro-RO', {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		}) + ', ' + d.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
	}

	function emailStatusLabel(status: string): string {
		switch (status) {
			case 'pending': return 'In asteptare';
			case 'active': return 'Active';
			case 'completed': return 'Finalizate';
			case 'failed': return 'Esuate';
			case 'delayed': return 'Amanate';
			default: return status;
		}
	}

	function emailStatusColor(status: string): string {
		switch (status) {
			case 'pending': return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400';
			case 'active': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
			case 'completed': return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
			case 'failed': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
			case 'delayed': return 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400';
			default: return 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400';
		}
	}

	function emailStatusNumberColor(status: string): string {
		switch (status) {
			case 'pending': return 'text-orange-600';
			case 'active': return 'text-blue-600';
			case 'completed': return 'text-green-600';
			case 'failed': return 'text-red-600';
			case 'delayed': return 'text-gray-600';
			default: return '';
		}
	}

	function debugLevelLabel(level: string): string {
		switch (level) {
			case 'info': return 'Informatie';
			case 'warning': return 'Avertisment';
			case 'error': return 'Eroare';
			default: return level;
		}
	}

	function emailTypeLabel(type: string): string {
		switch (type) {
			case 'invitation': return 'Invitatie';
			case 'invoice': return 'Factura';
			case 'magic-link': return 'Magic Link';
			case 'admin-magic-link': return 'Admin Magic Link';
			case 'password-reset': return 'Reset Parola';
			case 'task-assignment': return 'Asignare Task';
			case 'task-update': return 'Update Task';
			case 'task-reminder': return 'Reminder Task';
			case 'daily-reminder': return 'Reminder Zilnic';
			case 'contract-signing': return 'Semnare Contract';
			case 'invoice-paid': return 'Factura Platita';
			default: return type;
		}
	}

	function formatMetadata(raw: string | null): string {
		if (!raw) return '';
		try {
			return JSON.stringify(JSON.parse(raw), null, 2);
		} catch {
			return raw;
		}
	}

	// ---- Actions ----
	let refreshingEmail = $state(false);
	let refreshingDebug = $state(false);

	async function refreshEmailLogs() {
		refreshingEmail = true;
		emailLogsQuery.refresh();
		emailStatsQuery.refresh();
		setTimeout(() => (refreshingEmail = false), 800);
	}

	async function refreshDebugLogs() {
		refreshingDebug = true;
		debugLogsQuery.refresh();
		debugStatsQuery.refresh();
		setTimeout(() => (refreshingDebug = false), 800);
	}

	async function handleDeleteEmailLog(id: string) {
		if (!confirm('Sigur doriti sa stergeti acest log?')) return;
		try {
			await deleteEmailLog(id).updates(emailLogsQuery, emailStatsQuery);
			toast.success('Log sters');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la stergere');
		}
	}

	let retryingLogId = $state<string | null>(null);

	async function handleRetryEmailLog(logId: string) {
		retryingLogId = logId;
		try {
			await retryEmailLog(logId).updates(emailLogsQuery, emailStatsQuery);
			toast.success('Email retrimis cu succes');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la retrimitere');
		} finally {
			retryingLogId = null;
		}
	}

	function handlePreviewEmail(logId: string) {
		const tenant = page.params.tenant;
		window.open(`/${tenant}/admin/logs/email-preview/${logId}`, '_blank');
	}

	async function handleDeleteAllEmailLogs() {
		if (!confirm('Sigur doriti sa stergeti toate log-urile de email?')) return;
		try {
			await deleteAllEmailLogs().updates(emailLogsQuery, emailStatsQuery);
			toast.success('Toate log-urile de email au fost sterse');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la stergere');
		}
	}

	async function handleDeleteDebugLog(id: string) {
		if (!confirm('Sigur doriti sa stergeti acest log?')) return;
		try {
			await deleteDebugLog(id).updates(debugLogsQuery, debugStatsQuery);
			toast.success('Log sters');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la stergere');
		}
	}

	async function handleDeleteDebugByLevel(level: 'info' | 'warning' | 'error') {
		const label = debugLevelLabel(level);
		if (!confirm(`Sigur doriti sa stergeti toate log-urile de tip "${label}"?`)) return;
		try {
			await deleteDebugLogsByLevel(level).updates(debugLogsQuery, debugStatsQuery);
			toast.success(`Log-urile "${label}" au fost sterse`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la stergere');
		}
	}

	async function handleDeleteAllDebugLogs() {
		if (!confirm('Sigur doriti sa stergeti toate log-urile de debug?')) return;
		try {
			await deleteAllDebugLogs().updates(debugLogsQuery, debugStatsQuery);
			toast.success('Toate log-urile de debug au fost sterse');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la stergere');
		}
	}

	async function handleResolveDebugLog(logId: string, resolved: boolean) {
		try {
			await resolveDebugLog({ logId, resolved }).updates(debugLogsQuery, debugStatsQuery);
			toast.success(resolved ? 'Log marcat ca rezolvat' : 'Log marcat ca nerezolvat');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la actualizare');
		}
	}

	async function handleBulkResolve(resolved: boolean) {
		if (selectedDebugLogIds.size === 0) return;
		try {
			await bulkResolveDebugLogs({
				logIds: [...selectedDebugLogIds],
				resolved
			}).updates(debugLogsQuery, debugStatsQuery);
			toast.success(`${selectedDebugLogIds.size} log-uri ${resolved ? 'rezolvate' : 'deschise'}`);
			selectedDebugLogIds = new Set();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la actualizare');
		}
	}
</script>

<div class="space-y-6">
	<Tabs value="email" class="w-full">
		<div class="flex items-center justify-between mb-6">
			<div>
				<h1 class="text-2xl font-bold">Logs si Debug</h1>
				<p class="text-muted-foreground">Monitorizati toate erorile si log-urile platformei</p>
			</div>
			<TabsList>
				<TabsTrigger value="email">
					<MailIcon class="h-4 w-4 mr-2" />
					Email Logs
				</TabsTrigger>
				<TabsTrigger value="debug">
					<BugIcon class="h-4 w-4 mr-2" />
					Debug
				</TabsTrigger>
			</TabsList>
		</div>

		<!-- ==================== EMAIL LOGS TAB ==================== -->
		<TabsContent value="email">
			<div class="space-y-6">
				<!-- Header -->
				<div class="flex items-center justify-between">
					<div>
						<h2 class="text-xl font-semibold">Coada Email</h2>
						<p class="text-sm text-muted-foreground">Monitorizati si gestionati job-urile din coada de email-uri</p>
					</div>
					<Button variant="outline" onclick={refreshEmailLogs} disabled={refreshingEmail}>
						<RefreshCwIcon class="h-4 w-4 mr-2 {refreshingEmail ? 'animate-spin' : ''}" />
						Actualizeaza
					</Button>
				</div>

				<!-- Stat Cards -->
				<div class="grid grid-cols-2 md:grid-cols-5 gap-4">
					<Card class="cursor-pointer hover:border-primary transition-colors {emailStatusFilter === 'pending' ? 'border-primary' : ''}" onclick={() => emailStatusFilter = emailStatusFilter === 'pending' ? '' : 'pending'}>
						<CardContent class="pt-4 pb-4">
							<div class="flex items-center justify-between">
								<p class="text-sm text-muted-foreground">In asteptare</p>
								<ClockIcon class="h-4 w-4 text-orange-500" />
							</div>
							<p class="text-2xl font-bold text-orange-600">{emailStats.pending}</p>
						</CardContent>
					</Card>
					<Card class="cursor-pointer hover:border-primary transition-colors {emailStatusFilter === 'active' ? 'border-primary' : ''}" onclick={() => emailStatusFilter = emailStatusFilter === 'active' ? '' : 'active'}>
						<CardContent class="pt-4 pb-4">
							<div class="flex items-center justify-between">
								<p class="text-sm text-muted-foreground">Active</p>
								<RefreshCwIcon class="h-4 w-4 text-blue-500" />
							</div>
							<p class="text-2xl font-bold text-blue-600">{emailStats.active}</p>
						</CardContent>
					</Card>
					<Card class="cursor-pointer hover:border-primary transition-colors {emailStatusFilter === 'completed' ? 'border-primary' : ''}" onclick={() => emailStatusFilter = emailStatusFilter === 'completed' ? '' : 'completed'}>
						<CardContent class="pt-4 pb-4">
							<div class="flex items-center justify-between">
								<p class="text-sm text-muted-foreground">Finalizate</p>
								<CheckCircleIcon class="h-4 w-4 text-green-500" />
							</div>
							<p class="text-2xl font-bold text-green-600">{emailStats.completed}</p>
						</CardContent>
					</Card>
					<Card class="cursor-pointer hover:border-primary transition-colors {emailStatusFilter === 'failed' ? 'border-primary' : ''}" onclick={() => emailStatusFilter = emailStatusFilter === 'failed' ? '' : 'failed'}>
						<CardContent class="pt-4 pb-4">
							<div class="flex items-center justify-between">
								<p class="text-sm text-muted-foreground">Esuate</p>
								<XCircleIcon class="h-4 w-4 text-red-500" />
							</div>
							<p class="text-2xl font-bold text-red-600">{emailStats.failed}</p>
						</CardContent>
					</Card>
					<Card class="cursor-pointer hover:border-primary transition-colors {emailStatusFilter === 'delayed' ? 'border-primary' : ''}" onclick={() => emailStatusFilter = emailStatusFilter === 'delayed' ? '' : 'delayed'}>
						<CardContent class="pt-4 pb-4">
							<div class="flex items-center justify-between">
								<p class="text-sm text-muted-foreground">Amanate</p>
								<TimerIcon class="h-4 w-4 text-gray-500" />
							</div>
							<p class="text-2xl font-bold text-gray-500">{emailStats.delayed}</p>
						</CardContent>
					</Card>
				</div>

				<!-- Sub-tabs for status filtering -->
				<div class="flex items-center gap-4 border-b">
					<button
						class="px-1 py-2 text-sm font-medium transition-colors border-b-2 -mb-px {emailStatusFilter === '' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}"
						onclick={() => emailStatusFilter = ''}
					>
						Toate ({allEmailLogs.length})
					</button>
					<button
						class="px-1 py-2 text-sm font-medium transition-colors border-b-2 -mb-px {emailStatusFilter === 'pending' ? 'border-orange-500 text-orange-600' : 'border-transparent text-muted-foreground hover:text-foreground'}"
						onclick={() => emailStatusFilter = emailStatusFilter === 'pending' ? '' : 'pending'}
					>
						In asteptare ({emailStats.pending})
					</button>
					<button
						class="px-1 py-2 text-sm font-medium transition-colors border-b-2 -mb-px {emailStatusFilter === 'active' ? 'border-blue-500 text-blue-600' : 'border-transparent text-muted-foreground hover:text-foreground'}"
						onclick={() => emailStatusFilter = emailStatusFilter === 'active' ? '' : 'active'}
					>
						Active ({emailStats.active})
					</button>
					<button
						class="px-1 py-2 text-sm font-medium transition-colors border-b-2 -mb-px {emailStatusFilter === 'completed' ? 'border-green-500 text-green-600' : 'border-transparent text-muted-foreground hover:text-foreground'}"
						onclick={() => emailStatusFilter = emailStatusFilter === 'completed' ? '' : 'completed'}
					>
						Finalizate ({emailStats.completed})
					</button>
					<button
						class="px-1 py-2 text-sm font-medium transition-colors border-b-2 -mb-px {emailStatusFilter === 'failed' ? 'border-red-500 text-red-600' : 'border-transparent text-muted-foreground hover:text-foreground'}"
						onclick={() => emailStatusFilter = emailStatusFilter === 'failed' ? '' : 'failed'}
					>
						Esuate ({emailStats.failed})
					</button>
					<button
						class="px-1 py-2 text-sm font-medium transition-colors border-b-2 -mb-px {emailStatusFilter === 'delayed' ? 'border-gray-500 text-gray-600' : 'border-transparent text-muted-foreground hover:text-foreground'}"
						onclick={() => emailStatusFilter = emailStatusFilter === 'delayed' ? '' : 'delayed'}
					>
						Amanate ({emailStats.delayed})
					</button>
				</div>

				<!-- Filter Bar -->
				<div class="flex flex-wrap gap-4 items-center">
					<div class="relative flex-1 min-w-[200px]">
						<SearchIcon class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
						<Input
							placeholder="Cauta in mesaje, stack trace, detalii..."
							bind:value={emailSearchText}
							class="pl-9"
						/>
					</div>
					<Popover.Root bind:open={emailDateOpen}>
						<Popover.Trigger>
							{#snippet child({ props })}
								<Button {...props} variant="outline" class="h-9 justify-start text-start font-normal text-sm {emailDateRange.start ? '' : 'text-muted-foreground'}">
									<CalendarIcon class="mr-2 h-3.5 w-3.5 shrink-0 opacity-50" />
									{emailDateRangeLabel}
								</Button>
							{/snippet}
						</Popover.Trigger>
						<Popover.Content class="w-auto p-0" align="start">
							<div class="flex flex-col">
								<RangeCalendar
									bind:value={emailDateRange}
									locale="ro-RO"
									weekStartsOn={1}
									onValueChange={() => {
										if (emailDateRange.start && emailDateRange.end) emailDateOpen = false;
									}}
								/>
								<Button
									variant="ghost"
									class="rounded-t-none border-t text-muted-foreground text-sm"
									onclick={() => { emailDateRange = { start: undefined, end: undefined }; emailDateOpen = false; }}
								>
									Sterge filtru
								</Button>
							</div>
						</Popover.Content>
					</Popover.Root>
					{#if emailDateRange.start}
						<Button variant="ghost" size="sm" class="h-9 px-2" onclick={() => { emailDateRange = { start: undefined, end: undefined }; }}>
							<XIcon class="h-3.5 w-3.5" />
						</Button>
					{/if}
					<Select type="single" value={emailTypeFilter} onValueChange={(v) => (emailTypeFilter = v ?? '')}>
						<SelectTrigger class="w-[180px]">
							{emailTypeFilter ? emailTypeLabel(emailTypeFilter) : 'Toate tipurile'}
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="">Toate tipurile</SelectItem>
							<SelectItem value="invitation">Invitatie</SelectItem>
							<SelectItem value="invoice">Factura</SelectItem>
							<SelectItem value="magic-link">Magic Link</SelectItem>
							<SelectItem value="admin-magic-link">Admin Magic Link</SelectItem>
							<SelectItem value="password-reset">Reset Parola</SelectItem>
							<SelectItem value="task-assignment">Asignare Task</SelectItem>
							<SelectItem value="task-update">Update Task</SelectItem>
							<SelectItem value="task-reminder">Reminder Task</SelectItem>
							<SelectItem value="daily-reminder">Reminder Zilnic</SelectItem>
							<SelectItem value="contract-signing">Semnare Contract</SelectItem>
							<SelectItem value="invoice-paid">Factura Platita</SelectItem>
						</SelectContent>
					</Select>
					<div class="flex items-center gap-2 ml-auto">
						<span class="text-sm text-muted-foreground">
							{filteredEmailLogs.length} log-uri{emailStatusFilter ? ` (${emailStatusLabel(emailStatusFilter).toLowerCase()})` : ''}
						</span>
						<Button variant="outline" size="sm" onclick={handleDeleteAllEmailLogs} disabled={allEmailLogs.length === 0}>
							<Trash2Icon class="h-4 w-4" />
						</Button>
					</div>
				</div>

				<!-- Email Log Entries -->
				{#if allEmailLogs.length === 0}
					<Card>
						<CardContent class="py-12 text-center">
							<MailIcon class="h-12 w-12 mx-auto text-muted-foreground mb-4" />
							<p class="text-lg font-medium">Niciun log de email</p>
							<p class="text-muted-foreground">Log-urile vor aparea dupa ce se trimit email-uri din aplicatie.</p>
						</CardContent>
					</Card>
				{:else if filteredEmailLogs.length === 0}
					<Card>
						<CardContent class="py-12 text-center">
							<SearchIcon class="h-12 w-12 mx-auto text-muted-foreground mb-4" />
							<p class="text-lg font-medium">Niciun rezultat</p>
							<p class="text-muted-foreground">Incercati sa modificati filtrele.</p>
						</CardContent>
					</Card>
				{:else}
					<div class="space-y-3">
						{#each paginatedEmailLogs as log (log.id)}
							<Collapsible>
								<Card>
									<CardContent class="pt-4 pb-4">
										<div class="flex items-start justify-between gap-4">
											<div class="flex-1 min-w-0">
												<div class="flex items-center gap-2 mb-2">
													<MailIcon class="h-4 w-4 text-muted-foreground shrink-0" />
													<Badge class={emailStatusColor(log.status)}>
														{emailStatusLabel(log.status)}
													</Badge>
													<span class="text-xs text-muted-foreground font-mono">ID: {log.id.slice(0, 8)}...</span>
												</div>
												<p class="font-medium">
													Catre: <span class="text-foreground">{log.toEmail}</span>
												</p>
												<p class="text-sm text-muted-foreground flex items-center gap-1">
													<MailIcon class="h-3 w-3" />
													Subiect: {log.subject}
												</p>
												<div class="flex flex-wrap gap-4 mt-2 text-xs text-muted-foreground">
													<span>Creat: {formatDate(log.createdAt)}</span>
													{#if log.processedAt}
														<span>Procesat: {formatDate(log.processedAt)}</span>
													{/if}
													{#if log.completedAt}
														<span>Finalizat: {formatDate(log.completedAt)}</span>
													{/if}
													<span>Incercari: {log.attempts} / {log.maxAttempts}</span>
												</div>
												{#if log.errorMessage}
													<p class="text-sm text-red-600 mt-1">{log.errorMessage}</p>
												{/if}
											</div>
											<div class="flex items-center gap-2 shrink-0">
												{#if log.hasHtmlBody}
													<Button
														variant="ghost"
														size="sm"
														title="Previzualizare email"
														onclick={() => handlePreviewEmail(log.id)}
													>
														<EyeIcon class="h-4 w-4 text-purple-500" />
													</Button>
												{/if}
												<CollapsibleTrigger>
													{#snippet child({ props })}
														<Button {...props} variant="ghost" size="sm">
															<ChevronDownIcon class="h-4 w-4" />
														</Button>
													{/snippet}
												</CollapsibleTrigger>
												{#if log.status === 'failed'}
													<Button
														variant="ghost"
														size="sm"
														title="Retrimite email"
														disabled={retryingLogId === log.id}
														onclick={() => handleRetryEmailLog(log.id)}
													>
														<RotateCcwIcon class="h-4 w-4 text-blue-500 {retryingLogId === log.id ? 'animate-spin' : ''}" />
													</Button>
												{/if}
												<Button variant="ghost" size="sm" onclick={() => handleDeleteEmailLog(log.id)}>
													<Trash2Icon class="h-4 w-4 text-red-500" />
												</Button>
											</div>
										</div>
										<CollapsibleContent>
											<div class="mt-4 pt-4 border-t space-y-2">
												<div class="flex items-center gap-2 mb-2">
													<MailIcon class="h-4 w-4 text-green-600" />
													<span class="font-medium text-sm">Status Email Trimis</span>
												</div>
												<div class="text-sm space-y-1 text-muted-foreground">
													<p>Tip: <Badge variant="outline">{emailTypeLabel(log.emailType)}</Badge></p>
													{#if log.smtpMessageId}
														<p>ID Mesaj SMTP: <span class="font-mono text-xs">{log.smtpMessageId}</span></p>
													{/if}
													{#if log.smtpResponse}
														<p>Raspuns SMTP: <span class="font-mono text-xs">{log.smtpResponse}</span></p>
													{/if}
													{#if log.completedAt}
														<p>Trimis la: {formatDate(log.completedAt)}</p>
													{/if}
													{#if log.metadata}
														<div>
															<p class="font-medium text-foreground mb-1">Metadata:</p>
															<pre class="bg-muted p-3 rounded-md text-xs overflow-x-auto whitespace-pre-wrap">{formatMetadata(log.metadata)}</pre>
														</div>
													{/if}
												</div>
											</div>
										</CollapsibleContent>
									</CardContent>
								</Card>
							</Collapsible>
						{/each}
					</div>

					<!-- Pagination -->
					{#if emailTotalPages > 1}
						<div class="flex items-center justify-between mt-4">
							<p class="text-sm text-muted-foreground">
								Afisare {(emailPage - 1) * emailPageSize + 1}-{Math.min(emailPage * emailPageSize, filteredEmailLogs.length)} din {filteredEmailLogs.length}
							</p>
							<div class="flex items-center gap-2">
								<Button variant="outline" size="sm" disabled={emailPage <= 1} onclick={() => emailPage--}>
									<ChevronLeftIcon class="h-4 w-4" />
									Anterior
								</Button>
								<span class="text-sm text-muted-foreground">Pagina {emailPage} / {emailTotalPages}</span>
								<Button variant="outline" size="sm" disabled={emailPage >= emailTotalPages} onclick={() => emailPage++}>
									Urmator
									<ChevronRightIcon class="h-4 w-4" />
								</Button>
							</div>
						</div>
					{/if}
				{/if}
			</div>
		</TabsContent>

		<!-- ==================== DEBUG LOGS TAB ==================== -->
		<TabsContent value="debug">
			<div class="space-y-6">
				<!-- Header -->
				<div class="flex items-center justify-between">
					<div>
						<h2 class="text-xl font-semibold">Logs si Debug</h2>
						<p class="text-sm text-muted-foreground">Monitorizati toate erorile si log-urile platformei</p>
					</div>
					<Button variant="outline" onclick={refreshDebugLogs} disabled={refreshingDebug}>
						<RefreshCwIcon class="h-4 w-4 mr-2 {refreshingDebug ? 'animate-spin' : ''}" />
						Actualizeaza
					</Button>
				</div>

				<!-- Stat Cards -->
				<div class="grid grid-cols-2 md:grid-cols-5 gap-4">
					<Card>
						<CardContent class="pt-4 pb-4">
							<div class="flex items-center justify-between">
								<p class="text-sm text-muted-foreground">Total log-uri</p>
								<Button variant="ghost" size="sm" class="h-6 w-6 p-0" onclick={handleDeleteAllDebugLogs} disabled={debugStats.total === 0}>
									<Trash2Icon class="h-3 w-3 text-muted-foreground" />
								</Button>
							</div>
							<p class="text-2xl font-bold">{debugStats.total}</p>
						</CardContent>
					</Card>
					<Card>
						<CardContent class="pt-4 pb-4">
							<div class="flex items-center justify-between">
								<p class="text-sm text-muted-foreground">Erori</p>
								<Button variant="ghost" size="sm" class="h-6 w-6 p-0" onclick={() => handleDeleteDebugByLevel('error')} disabled={debugStats.errors === 0}>
									<Trash2Icon class="h-3 w-3 text-muted-foreground" />
								</Button>
							</div>
							<p class="text-2xl font-bold text-red-600">{debugStats.errors}</p>
						</CardContent>
					</Card>
					<Card>
						<CardContent class="pt-4 pb-4">
							<div class="flex items-center justify-between">
								<p class="text-sm text-muted-foreground">Avertismente</p>
								<Button variant="ghost" size="sm" class="h-6 w-6 p-0" onclick={() => handleDeleteDebugByLevel('warning')} disabled={debugStats.warnings === 0}>
									<Trash2Icon class="h-3 w-3 text-muted-foreground" />
								</Button>
							</div>
							<p class="text-2xl font-bold text-yellow-600">{debugStats.warnings}</p>
						</CardContent>
					</Card>
					<Card>
						<CardContent class="pt-4 pb-4">
							<div class="flex items-center justify-between">
								<p class="text-sm text-muted-foreground">Informatii</p>
								<Button variant="ghost" size="sm" class="h-6 w-6 p-0" onclick={() => handleDeleteDebugByLevel('info')} disabled={debugStats.infos === 0}>
									<Trash2Icon class="h-3 w-3 text-muted-foreground" />
								</Button>
							</div>
							<p class="text-2xl font-bold text-blue-600">{debugStats.infos}</p>
						</CardContent>
					</Card>
					<Card>
						<CardContent class="pt-4 pb-4">
							<div class="flex items-center justify-between">
								<p class="text-sm text-muted-foreground">Erori (24h)</p>
								<XCircleIcon class="h-4 w-4 text-muted-foreground" />
							</div>
							<p class="text-2xl font-bold {debugStats.errors24h > 0 ? 'text-red-600' : ''}">{debugStats.errors24h}</p>
						</CardContent>
					</Card>
				</div>

				<!-- Filter Bar -->
				<div class="flex flex-wrap gap-4 items-center">
					<div class="relative flex-1 min-w-[200px]">
						<SearchIcon class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
						<Input
							placeholder="Cauta in mesaje, stack trace, detalii..."
							bind:value={debugSearchText}
							class="pl-9"
						/>
					</div>
					<Popover.Root bind:open={debugDateOpen}>
						<Popover.Trigger>
							{#snippet child({ props })}
								<Button {...props} variant="outline" class="h-9 justify-start text-start font-normal text-sm {debugDateRange.start ? '' : 'text-muted-foreground'}">
									<CalendarIcon class="mr-2 h-3.5 w-3.5 shrink-0 opacity-50" />
									{debugDateRangeLabel}
								</Button>
							{/snippet}
						</Popover.Trigger>
						<Popover.Content class="w-auto p-0" align="start">
							<div class="flex flex-col">
								<RangeCalendar
									bind:value={debugDateRange}
									locale="ro-RO"
									weekStartsOn={1}
									onValueChange={() => {
										if (debugDateRange.start && debugDateRange.end) debugDateOpen = false;
									}}
								/>
								<Button
									variant="ghost"
									class="rounded-t-none border-t text-muted-foreground text-sm"
									onclick={() => { debugDateRange = { start: undefined, end: undefined }; debugDateOpen = false; }}
								>
									Sterge filtru
								</Button>
							</div>
						</Popover.Content>
					</Popover.Root>
					{#if debugDateRange.start}
						<Button variant="ghost" size="sm" class="h-9 px-2" onclick={() => { debugDateRange = { start: undefined, end: undefined }; }}>
							<XIcon class="h-3.5 w-3.5" />
						</Button>
					{/if}
					<Select type="single" value={debugLevelFilter} onValueChange={(v) => (debugLevelFilter = v ?? '')}>
						<SelectTrigger class="w-[160px]">
							{debugLevelFilter ? debugLevelLabel(debugLevelFilter) : 'Toate'}
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="">Toate</SelectItem>
							<SelectItem value="info">Informatie</SelectItem>
							<SelectItem value="warning">Avertisment</SelectItem>
							<SelectItem value="error">Eroare</SelectItem>
						</SelectContent>
					</Select>
					<Select type="single" value={debugSourceFilter} onValueChange={(v) => (debugSourceFilter = v ?? '')}>
						<SelectTrigger class="w-[160px]">
							{debugSourceFilter || 'Toate sursele'}
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="">Toate sursele</SelectItem>
							<SelectItem value="server">Server</SelectItem>
							<SelectItem value="client">Client</SelectItem>
							<SelectItem value="scheduler">Scheduler</SelectItem>
							<SelectItem value="plugin">Plugin</SelectItem>
							<SelectItem value="email">Email</SelectItem>
							<SelectItem value="gmail">Gmail</SelectItem>
							<SelectItem value="keez">Keez</SelectItem>
							<SelectItem value="smartbill">SmartBill</SelectItem>
							<SelectItem value="bnr">BNR</SelectItem>
							<SelectItem value="anaf-spv">ANAF SPV</SelectItem>
							<SelectItem value="banking">Banking</SelectItem>
							<SelectItem value="storage">Storage</SelectItem>
							<SelectItem value="google-ads">Google Ads</SelectItem>
							<SelectItem value="meta-ads">Meta Ads</SelectItem>
							<SelectItem value="tiktok-ads">TikTok Ads</SelectItem>
						</SelectContent>
					</Select>
					<Select type="single" value={debugResolvedFilter} onValueChange={(v) => (debugResolvedFilter = v ?? '')}>
						<SelectTrigger class="w-[160px]">
							{debugResolvedFilter === 'resolved' ? 'Rezolvate' : debugResolvedFilter === 'unresolved' ? 'Nerezolvate' : 'Toate statusurile'}
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="">Toate statusurile</SelectItem>
							<SelectItem value="unresolved">Nerezolvate</SelectItem>
							<SelectItem value="resolved">Rezolvate</SelectItem>
						</SelectContent>
					</Select>
				</div>

				<!-- Bulk Actions -->
				{#if selectedDebugLogIds.size > 0}
					<div class="flex items-center gap-3 p-3 bg-muted rounded-lg">
						<span class="text-sm font-medium">{selectedDebugLogIds.size} selectate</span>
						<Button variant="outline" size="sm" onclick={() => handleBulkResolve(true)}>
							<CheckIcon class="h-4 w-4 mr-1" />
							Rezolva
						</Button>
						<Button variant="outline" size="sm" onclick={() => handleBulkResolve(false)}>
							<UndoIcon class="h-4 w-4 mr-1" />
							Redeschide
						</Button>
					</div>
				{/if}

				<!-- Debug Log Entries -->
				{#if allDebugLogs.length === 0}
					<Card>
						<CardContent class="py-12 text-center">
							<BugIcon class="h-12 w-12 mx-auto text-muted-foreground mb-4" />
							<p class="text-lg font-medium">Niciun log de debug</p>
							<p class="text-muted-foreground">Log-urile vor aparea pe masura ce aplicatia inregistreaza evenimente.</p>
						</CardContent>
					</Card>
				{:else if filteredDebugLogsWithResolved.length === 0}
					<Card>
						<CardContent class="py-12 text-center">
							<SearchIcon class="h-12 w-12 mx-auto text-muted-foreground mb-4" />
							<p class="text-lg font-medium">Niciun rezultat</p>
							<p class="text-muted-foreground">Incercati sa modificati filtrele.</p>
						</CardContent>
					</Card>
				{:else}
					<div class="space-y-3">
						<!-- Select all checkbox -->
						<div class="flex items-center gap-2 px-1">
							<input
								type="checkbox"
								class="rounded border-muted-foreground/50"
								checked={selectedDebugLogIds.size === paginatedDebugLogsResolved.length && paginatedDebugLogsResolved.length > 0}
								onchange={toggleAllDebugLogs}
							/>
							<span class="text-xs text-muted-foreground">Selecteaza toate ({filteredDebugLogsWithResolved.length})</span>
						</div>

						{#each paginatedDebugLogsResolved as log (log.id)}
							<Collapsible>
								<Card class={log.resolved ? 'opacity-60' : ''}>
									<CardContent class="pt-4 pb-4">
										<div class="flex items-start justify-between gap-4">
											<div class="flex items-start gap-3 flex-1 min-w-0">
												<input
													type="checkbox"
													class="rounded border-muted-foreground/50 mt-1 shrink-0"
													checked={selectedDebugLogIds.has(log.id)}
													onchange={() => toggleDebugLogSelection(log.id)}
												/>
												<div class="flex-1 min-w-0">
													<div class="flex items-center gap-2 mb-2 flex-wrap">
														{#if log.level === 'error'}
															<Badge variant="destructive">Eroare</Badge>
														{:else if log.level === 'warning'}
															<Badge class="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">Avertisment</Badge>
														{:else}
															<Badge variant="secondary" class="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">Informatie</Badge>
														{/if}
														<Badge variant="outline" class="bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400">{log.source}</Badge>
														{#if log.errorCode}
															<Badge variant="outline" class="font-mono text-xs">{log.errorCode}</Badge>
														{/if}
														{#if log.resolved}
															<Badge class="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
																<ShieldCheckIcon class="h-3 w-3 mr-1" />
																Rezolvat
															</Badge>
														{/if}
														{#if log.duration}
															<Badge variant="outline" class="text-xs {log.duration >= 3000 ? 'text-orange-600' : ''}">
																{log.duration}ms
															</Badge>
														{/if}
														<span class="text-xs text-muted-foreground">{formatDate(log.createdAt)}</span>
													</div>
													<p class="text-sm font-medium">{log.message}</p>
													<div class="flex items-center gap-3 mt-1 flex-wrap">
														{#if log.action}
															<span class="text-xs text-muted-foreground">Actiune: <span class="font-mono">{log.action}</span></span>
														{/if}
														{#if log.url}
															<span class="text-xs text-muted-foreground">URL: {log.url}</span>
														{/if}
													</div>
												</div>
											</div>
											<div class="flex items-center gap-1 shrink-0">
												{#if !log.resolved}
													<Button variant="ghost" size="sm" title="Marcheaza rezolvat" onclick={() => handleResolveDebugLog(log.id, true)}>
														<CheckIcon class="h-4 w-4 text-green-500" />
													</Button>
												{:else}
													<Button variant="ghost" size="sm" title="Redeschide" onclick={() => handleResolveDebugLog(log.id, false)}>
														<UndoIcon class="h-4 w-4 text-orange-500" />
													</Button>
												{/if}
												<CollapsibleTrigger>
													{#snippet child({ props })}
														<Button {...props} variant="ghost" size="sm">
															<ChevronDownIcon class="h-4 w-4" />
														</Button>
													{/snippet}
												</CollapsibleTrigger>
												<Button variant="ghost" size="sm" onclick={() => handleDeleteDebugLog(log.id)}>
													<Trash2Icon class="h-4 w-4 text-red-500" />
												</Button>
											</div>
										</div>
										<CollapsibleContent>
											<div class="mt-4 pt-4 border-t space-y-3 text-sm text-muted-foreground">
												{#if log.errorCode}
													{@const errorDef = getErrorByCode(log.errorCode)}
													{#if errorDef}
														<div class="bg-muted/50 p-3 rounded-md space-y-1">
															<p class="text-xs"><span class="font-medium text-foreground">Mesaj utilizator:</span> {errorDef.userMessage}</p>
															{#if errorDef.suggestedFix}
																<p class="text-xs"><span class="font-medium text-foreground">Suggested fix:</span> {errorDef.suggestedFix}</p>
															{/if}
															<p class="text-xs"><span class="font-medium text-foreground">Retryable:</span> {errorDef.retryable ? 'Da' : 'Nu'}</p>
														</div>
													{/if}
												{/if}
												{#if log.stackTrace}
													<div>
														<p class="font-medium text-foreground mb-1">Stack Trace:</p>
														<pre class="bg-muted p-3 rounded-md text-xs overflow-x-auto whitespace-pre-wrap">{log.stackTrace}</pre>
													</div>
												{/if}
												{#if log.metadata}
													<div>
														<p class="font-medium text-foreground mb-1">Metadata:</p>
														<pre class="bg-muted p-3 rounded-md text-xs overflow-x-auto whitespace-pre-wrap">{formatMetadata(log.metadata)}</pre>
													</div>
												{/if}
												<div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
													{#if log.userName}
														<div><span class="font-medium text-foreground">Utilizator:</span> {log.userName}</div>
													{/if}
													{#if log.requestId}
														<div><span class="font-medium text-foreground">Request ID:</span> <span class="font-mono">{log.requestId.slice(0, 8)}...</span></div>
													{/if}
													{#if log.ipAddress}
														<div><span class="font-medium text-foreground">IP:</span> {log.ipAddress}</div>
													{/if}
													{#if log.userAgent}
														<div class="col-span-2"><span class="font-medium text-foreground">User Agent:</span> {log.userAgent}</div>
													{/if}
												</div>
												{#if log.resolved && log.resolvedAt}
													<div class="bg-emerald-50 dark:bg-emerald-950/20 p-3 rounded-md space-y-1">
														<p class="text-xs font-medium text-emerald-700 dark:text-emerald-400">Rezolvat la: {formatDate(log.resolvedAt)}</p>
														{#if log.resolutionNote}
															<p class="text-xs">Nota: {log.resolutionNote}</p>
														{/if}
													</div>
												{/if}
											</div>
										</CollapsibleContent>
									</CardContent>
								</Card>
							</Collapsible>
						{/each}
					</div>

					<!-- Pagination -->
					{#if debugTotalPagesResolved > 1}
						<div class="flex items-center justify-between mt-4">
							<p class="text-sm text-muted-foreground">
								Afisare {(debugPage - 1) * debugPageSize + 1}-{Math.min(debugPage * debugPageSize, filteredDebugLogsWithResolved.length)} din {filteredDebugLogsWithResolved.length}
							</p>
							<div class="flex items-center gap-2">
								<Button variant="outline" size="sm" disabled={debugPage <= 1} onclick={() => debugPage--}>
									<ChevronLeftIcon class="h-4 w-4" />
									Anterior
								</Button>
								<span class="text-sm text-muted-foreground">Pagina {debugPage} / {debugTotalPagesResolved}</span>
								<Button variant="outline" size="sm" disabled={debugPage >= debugTotalPagesResolved} onclick={() => debugPage++}>
									Urmator
									<ChevronRightIcon class="h-4 w-4" />
								</Button>
							</div>
						</div>
					{/if}
				{/if}
			</div>
		</TabsContent>
	</Tabs>
</div>
