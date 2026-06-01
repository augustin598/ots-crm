/* ===== Dashboard OTS — shared types ===== */

export type Accent = 'success' | 'primary' | 'info' | 'warn' | 'danger';

export interface KpiData {
	id: string;
	label: string;
	/** RON units when fmt === 'ron', otherwise a raw count. */
	value: number;
	fmt?: 'ron';
	delta: number; // percent vs previous period
	sub?: string;
	spark: number[];
	icon: string; // design icon name (mapped to lucide in the component)
	accent: Accent;
	href: string;
}

export interface AlertData {
	type: 'danger' | 'warn' | 'info' | 'success';
	icon: string;
	title: string;
	detail: string;
	action: string;
	href: string;
}

export interface TopClient {
	name: string;
	revenue: number; // RON
	projects: number;
	change: number; // percent
	avatar: string;
}

export interface TeamMember {
	name: string;
	role: string;
	avatar: string;
	actions: number;
	status: 'online' | 'away' | 'offline';
}

export interface ActivityItem {
	action: string;
	detail: string;
	amount?: number; // RON
	ago: string;
	user: string;
	icon: string;
	color: Accent;
	href: string;
}

export interface TaskItem {
	id: string;
	title: string;
	project: string;
	priority: 'urgent' | 'high' | 'medium' | 'low';
	due: string;
	assignee: string;
	href: string;
}

export interface RevenuePoint {
	m: string;
	revenue: number; // RON
	expenses: number; // RON
}

export interface CashflowPoint {
	day: number;
	inflow: number;
	outflow: number;
}

export interface FunnelStage {
	stage: string;
	value: number;
	colorVar: string; // e.g. 'var(--chart-1)'
}

export interface AdsPlatform {
	id: 'meta' | 'google' | 'tiktok';
	name: string;
	color: string; // brand hex (kept for brand identity)
	spend: number; // RON
	roas: number;
	conv: number;
	ctr: number;
	cpa: number; // RON
	campaigns: number;
	budget: number; // RON
}

export interface TodayEvent {
	time: string;
	title: string;
	color: Accent;
}

/** Everything the dashboard page renders. Assembled in +page.server.ts. */
export interface DashboardData {
	greeting: string;
	userName: string;
	alertSummary: string;
	kpis: KpiData[];
	alerts: AlertData[];
	topClients: TopClient[];
	team: TeamMember[];
	activity: ActivityItem[];
	tasks: TaskItem[];
	revenue12m: RevenuePoint[];
	cashflow: CashflowPoint[];
	funnel: FunnelStage[];
	adsPlatforms: AdsPlatform[];
	todayEvents: TodayEvent[];
	/** True for widgets whose data is illustrative (not tracked in the CRM yet). */
	demoFlags: { ads: boolean; revenueChart: boolean; cashflow: boolean; funnel: boolean; today: boolean };
}
