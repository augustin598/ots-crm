<script lang="ts">
	import type { PageData } from './$types';
	import { Tabs, TabsList, TabsTrigger, TabsContent } from '$lib/components/ui/tabs';
	import { page } from '$app/state';
	import { Settings, Receipt, Plug, CheckSquare, Mail, Calendar, UserCircle, FileBarChart } from '@lucide/svelte';
	import { goto } from '$app/navigation';

	let { data, children }: { data: PageData; children: any } = $props();

	const tenantSlug = $derived(page.params.tenant);
	const currentPath = $derived(page.url.pathname);

	import { CreditCard } from '@lucide/svelte';

	const tabs = $derived([
		{ id: 'general', label: 'General', href: `/${tenantSlug}/settings`, icon: Settings },
		{ id: 'account', label: 'Cont', href: `/${tenantSlug}/settings/account`, icon: UserCircle },
		{ id: 'invoices', label: 'Invoices', href: `/${tenantSlug}/settings/invoices`, icon: Receipt },
		{ id: 'tasks', label: 'Tasks', href: `/${tenantSlug}/settings/tasks`, icon: CheckSquare },
		{ id: 'my-plans', label: 'My Plans', href: `/${tenantSlug}/settings/my-plans`, icon: Calendar },
		{ id: 'banking', label: 'Banking', href: `/${tenantSlug}/settings/banking`, icon: CreditCard },
		{ id: 'email', label: 'Email', href: `/${tenantSlug}/settings/email`, icon: Mail },
		{ id: 'reports', label: 'Rapoarte', href: `/${tenantSlug}/settings/reports`, icon: FileBarChart },
		{ id: 'plugins', label: 'Plugins', href: `/${tenantSlug}/settings/plugins`, icon: Plug }
	]);

	const activeTab = $derived(() => {
		if (currentPath === `/${tenantSlug}/settings` || currentPath === `/${tenantSlug}/settings/`) return 'general';
		if (currentPath.startsWith(`/${tenantSlug}/settings/account`)) return 'account';
		if (currentPath.startsWith(`/${tenantSlug}/settings/invoices`)) return 'invoices';
		if (currentPath.startsWith(`/${tenantSlug}/settings/tasks`)) return 'tasks';
		if (currentPath.startsWith(`/${tenantSlug}/settings/my-plans`)) return 'my-plans';
		if (currentPath.startsWith(`/${tenantSlug}/settings/banking`)) return 'banking';
		if (currentPath.startsWith(`/${tenantSlug}/settings/email`)) return 'email';
		if (currentPath.startsWith(`/${tenantSlug}/settings/reports`)) return 'reports';
		if (currentPath.startsWith(`/${tenantSlug}/settings/plugins`)) return 'plugins';
		if (currentPath.startsWith(`/${tenantSlug}/settings/smartbill`)) return 'plugins'; // SmartBill is under plugins
		if (currentPath.startsWith(`/${tenantSlug}/settings/keez`)) return 'plugins'; // Keez is under plugins
		return 'general';
	});

	function handleTabChange(tabId: string) {
		const tab = tabs.find((t) => t.id === tabId);
		if (tab) {
			goto(tab.href);
		}
	}
</script>

<div class="space-y-6">
	<div class="flex items-center gap-2">
		<Settings class="h-8 w-8" />
		<h1 class="text-3xl font-bold">Settings</h1>
	</div>

	<Tabs value={activeTab()} class="w-full">
		<TabsList class="grid w-full grid-cols-2 sm:grid-cols-4 lg:grid-cols-9">
			{#each tabs as tab}
				<TabsTrigger value={tab.id} onclick={() => goto(tab.href)}>
					{@const TabIcon = tab.icon}
					<TabIcon class="h-4 w-4 mr-2" />
					{tab.label}
				</TabsTrigger>
			{/each}
		</TabsList>
		<TabsContent value={activeTab()} class="mt-6">
			{@render children()}
		</TabsContent>
	</Tabs>
</div>
