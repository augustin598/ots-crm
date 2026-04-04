import type { CampaignAggregate } from './report-helpers';

export interface CampaignAnomaly {
	campaignId: string;
	type: 'cost_spike' | 'ctr_drop' | 'performance_drop' | 'budget_waste';
	severity: 'warning' | 'critical';
	message: string;
}

/**
 * Detect anomalies across campaigns by comparing each to the aggregate average.
 * Only flags campaigns with meaningful data (spend > 0, impressions > 0).
 */
export function detectAnomalies(campaigns: CampaignAggregate[]): Map<string, CampaignAnomaly[]> {
	const anomalies = new Map<string, CampaignAnomaly[]>();
	const active = campaigns.filter(c => c.spend > 0 && c.impressions > 0);
	if (active.length < 2) return anomalies;

	// Calculate averages
	const avgCpc = active.reduce((s, c) => s + c.cpc, 0) / active.length;
	const avgCtr = active.reduce((s, c) => s + c.ctr, 0) / active.length;
	const avgCostPerConv = active.filter(c => c.conversions > 0).reduce((s, c) => s + c.costPerConversion, 0) /
		(active.filter(c => c.conversions > 0).length || 1);

	for (const c of active) {
		const issues: CampaignAnomaly[] = [];

		// CPC spike (> 80% above average)
		if (avgCpc > 0 && c.cpc > avgCpc * 1.8) {
			issues.push({
				campaignId: c.campaignId,
				type: 'cost_spike',
				severity: c.cpc > avgCpc * 2.5 ? 'critical' : 'warning',
				message: `CPC ${((c.cpc / avgCpc - 1) * 100).toFixed(0)}% peste medie`
			});
		}

		// CTR drop (< 50% of average)
		if (avgCtr > 0 && c.ctr < avgCtr * 0.5 && c.impressions > 1000) {
			issues.push({
				campaignId: c.campaignId,
				type: 'ctr_drop',
				severity: c.ctr < avgCtr * 0.25 ? 'critical' : 'warning',
				message: `CTR ${((1 - c.ctr / avgCtr) * 100).toFixed(0)}% sub medie`
			});
		}

		// Cost per conversion spike (> 100% above average)
		if (avgCostPerConv > 0 && c.conversions > 0 && c.costPerConversion > avgCostPerConv * 2) {
			issues.push({
				campaignId: c.campaignId,
				type: 'performance_drop',
				severity: c.costPerConversion > avgCostPerConv * 3 ? 'critical' : 'warning',
				message: `Cost/conversie ${((c.costPerConversion / avgCostPerConv - 1) * 100).toFixed(0)}% peste medie`
			});
		}

		// Budget waste: high spend but zero conversions (while others convert)
		if (c.spend > 0 && c.conversions === 0 && active.some(a => a.conversions > 0)) {
			const avgSpend = active.reduce((s, a) => s + a.spend, 0) / active.length;
			if (c.spend > avgSpend * 0.5) {
				issues.push({
					campaignId: c.campaignId,
					type: 'budget_waste',
					severity: c.spend > avgSpend ? 'critical' : 'warning',
					message: 'Cheltuieli fără conversii'
				});
			}
		}

		if (issues.length > 0) {
			anomalies.set(c.campaignId, issues);
		}
	}

	return anomalies;
}

/** Get a summary of all anomalies for an alert banner */
export function getAnomalySummary(anomalies: Map<string, CampaignAnomaly[]>): { criticalCount: number; warningCount: number; total: number } {
	let criticalCount = 0;
	let warningCount = 0;
	for (const [, issues] of anomalies) {
		for (const issue of issues) {
			if (issue.severity === 'critical') criticalCount++;
			else warningCount++;
		}
	}
	return { criticalCount, warningCount, total: criticalCount + warningCount };
}
