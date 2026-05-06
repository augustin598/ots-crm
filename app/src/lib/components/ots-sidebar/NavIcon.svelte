<script lang="ts">
	import LayoutDashboardIcon from '@lucide/svelte/icons/layout-dashboard';
	import UsersIcon from '@lucide/svelte/icons/users';
	import FolderKanbanIcon from '@lucide/svelte/icons/folder-kanban';
	import CheckSquareIcon from '@lucide/svelte/icons/check-square';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import FileSignatureIcon from '@lucide/svelte/icons/file-signature';
	import BriefcaseIcon from '@lucide/svelte/icons/briefcase';
	import ReceiptIcon from '@lucide/svelte/icons/receipt';
	import CreditCardIcon from '@lucide/svelte/icons/credit-card';
	import LinkIcon from '@lucide/svelte/icons/link';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import MegaphoneIcon from '@lucide/svelte/icons/megaphone';
	import RocketIcon from '@lucide/svelte/icons/rocket';
	import BarChart3Icon from '@lucide/svelte/icons/bar-chart-3';
	import ContactIcon from '@lucide/svelte/icons/contact';
	import ScrollTextIcon from '@lucide/svelte/icons/scroll-text';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import CalendarClockIcon from '@lucide/svelte/icons/calendar-clock';
	import FileDownIcon from '@lucide/svelte/icons/file-down';
	import IconKeez from '$lib/components/marketing/icon-keez.svelte';
	import IconGoogleAds from '$lib/components/marketing/icon-google-ads.svelte';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import IconTiktok from '$lib/components/marketing/icon-tiktok.svelte';
	import IconWhatsapp from '$lib/components/marketing/icon-whatsapp.svelte';
	import type { IconKey } from '$lib/config/sidebar-nav';

	let { icon, class: className = '' }: { icon: IconKey; class?: string } = $props();
</script>

{#if icon === 'dashboard'}
	<LayoutDashboardIcon class={className} />
{:else if icon === 'tasks'}
	<CheckSquareIcon class={className} />
{:else if icon === 'my-plans'}
	<CalendarIcon class={className} />
{:else if icon === 'clients'}
	<UsersIcon class={className} />
{:else if icon === 'projects'}
	<FolderKanbanIcon class={className} />
{:else if icon === 'services'}
	<BriefcaseIcon class={className} />
{:else if icon === 'contracts'}
	<FileSignatureIcon class={className} />
{:else if icon === 'invoices'}
	<ReceiptIcon class={className} />
{:else if icon === 'invoice-keez'}
	<IconKeez class={className} />
{:else if icon === 'invoice-google' || icon === 'google'}
	<IconGoogleAds class={className} />
{:else if icon === 'invoice-meta' || icon === 'meta'}
	<IconFacebook class={className} />
{:else if icon === 'invoice-tiktok' || icon === 'tiktok'}
	<IconTiktok class={className} />
{:else if icon === 'banking'}
	<CreditCardIcon class={className} />
{:else if icon === 'supplier-invoices'}
	<FileDownIcon class={className} />
{:else if icon === 'seo-links'}
	<LinkIcon class={className} />
{:else if icon === 'wordpress'}
	<GlobeIcon class={className} />
{:else if icon === 'marketing'}
	<MegaphoneIcon class={className} />
{:else if icon === 'campaigns-ads'}
	<RocketIcon class={className} />
{:else if icon === 'leads'}
	<ContactIcon class={className} />
{:else if icon === 'reports'}
	<BarChart3Icon class={className} />
{:else if icon === 'reports-schedule'}
	<CalendarClockIcon class={className} />
{:else if icon === 'admin'}
	<ScrollTextIcon class={className} />
{:else if icon === 'admin-scheduler'}
	<ClockIcon class={className} />
{:else if icon === 'admin-pay-status'}
	<TriangleAlertIcon class={className} />
{:else if icon === 'whatsapp'}
	<IconWhatsapp class={className} />
{:else if icon === 'settings'}
	<SettingsIcon class={className} />
{/if}
