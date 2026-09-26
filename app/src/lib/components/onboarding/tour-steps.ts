export interface TourStep {
	id: string;
	path: string;
	sidebarKey: string;
	title: string;
	description: string;
	primaryOnly?: boolean;
}

const ALL_STEPS: TourStep[] = [
	{
		id: 'dashboard',
		path: 'dashboard',
		sidebarKey: 'dashboard',
		title: 'Bine ai venit!',
		description: 'Aici ai o privire de ansamblu: task-uri active, facturi recente și contracte.'
	},
	{
		id: 'services',
		path: 'services',
		sidebarKey: 'services',
		title: 'Servicii & Oferte',
		description: 'Răsfoiește serviciile și ofertele disponibile pentru contul tău.'
	},
	{
		id: 'tasks',
		path: 'tasks',
		sidebarKey: 'tasks',
		title: 'Task-urile tale',
		description: 'Vezi task-urile alocate, aprobă sau respinge lucrări și adaugă comentarii.'
	},
	{
		id: 'contracts',
		path: 'contracts',
		sidebarKey: 'contracts',
		title: 'Contracte',
		description: 'Vizualizează contractele active, semnează digital și descarcă PDF-uri.',
		primaryOnly: true
	},
	{
		id: 'invoices',
		path: 'invoices',
		sidebarKey: 'invoices',
		title: 'Facturi',
		description: 'Toate facturile: servicii, Google Ads, Meta Ads și TikTok Ads.',
		primaryOnly: true
	},
	{
		id: 'hosting',
		path: 'hosting',
		sidebarKey: 'hosting',
		title: 'Hosting',
		description: 'Conturile tale de hosting, pachetele disponibile și reînnoirile.',
		primaryOnly: true
	},
	{
		id: 'budgets',
		path: 'budgets',
		sidebarKey: 'budgets',
		title: 'Bugete Ads',
		description: 'Monitorizează bugetele lunare de publicitate per platformă și cont.',
		primaryOnly: true
	},
	{
		id: 'marketing',
		path: 'marketing',
		sidebarKey: 'marketing',
		title: 'Materiale marketing',
		description: 'Imagini, video-uri și alte resurse create de echipa de marketing.'
	},
	{
		id: 'reports',
		path: 'reports',
		sidebarKey: 'reports',
		title: 'Rapoarte campanii',
		description: 'Metrici detaliate pentru campaniile de pe Facebook, Google și TikTok Ads.'
	},
	{
		id: 'leads',
		path: 'leads',
		sidebarKey: 'leads',
		title: 'Lead-uri',
		description: 'Lead-urile generate din campaniile tale publicitare.'
	},
	{
		id: 'access-data',
		path: 'access-data',
		sidebarKey: 'access-data',
		title: 'Date de acces',
		description: 'Credențiale și date de acces pentru platformele tale.'
	},
	{
		id: 'backlinks',
		path: 'backlinks',
		sidebarKey: 'backlinks',
		title: 'Backlinks',
		description: 'Link-urile externe către site-ul tău pentru SEO.'
	},
	{
		id: 'settings',
		path: 'settings',
		sidebarKey: 'settings',
		title: 'Setări',
		description: 'Notificări, preferințe vizuale și datele companiei. Poți relua turul de aici.'
	}
];

/**
 * Cont de hosting (self-signup de pe /pachete-hosting): portalul se reduce la
 * Dashboard, Hosting, Facturi, Setări — turul și checklist-ul la fel, altfel ar
 * trimite omul spre secțiuni pe care nu le poate deschide (403).
 */
const HOSTING_SCOPE_STEP_IDS = new Set(['dashboard', 'hosting', 'invoices', 'settings']);
const HOSTING_SCOPE_DESCRIPTIONS: Record<string, string> = {
	dashboard: 'Aici ai o privire de ansamblu: conturile tale de hosting și facturile recente.',
	invoices: 'Facturile de hosting: descarcă PDF-uri și plătește online.'
};

export function getTourSteps(isPrimary: boolean, portalScope: string = 'full'): TourStep[] {
	let steps = isPrimary ? ALL_STEPS : ALL_STEPS.filter((s) => !s.primaryOnly);
	if (portalScope === 'hosting') {
		steps = steps
			.filter((s) => HOSTING_SCOPE_STEP_IDS.has(s.id))
			.map((s) => ({ ...s, description: HOSTING_SCOPE_DESCRIPTIONS[s.id] ?? s.description }));
	}
	return steps;
}

export function getChecklistItems(isPrimary: boolean, portalScope: string = 'full') {
	return getTourSteps(isPrimary, portalScope).map((s) => ({
		id: s.id,
		label: s.title,
		path: s.path
	}));
}
