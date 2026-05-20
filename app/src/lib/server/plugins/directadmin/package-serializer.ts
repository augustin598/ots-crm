/**
 * DirectAdmin package serializer.
 *
 * Centralises the finicky CMD_API_MANAGE_USER_PACKAGES wire format so the rules
 * aren't repeated inline (and so quirks like "Unlimited" vs numeric vs blank
 * have exactly one definition in the codebase).
 *
 * DA wire conventions (legacy form-urlencoded):
 *   - Resource limits (bandwidth, quota, ...): integer string OR the literal
 *     string "unlimited". Empty/null means "not set" — we always send
 *     "unlimited" instead so the DA value is deterministic.
 *   - Boolean access flags: "ON" or "OFF" — case matters in some DA versions.
 *   - String fields (skin, language, packagename): plain values.
 *   - Action: action=create / action=modify / add=Submit for the original
 *     screen; add=save also accepted by newer DA releases.
 *
 * The reverse direction (`parseDAPackage`) consumes the response of
 * `GET /CMD_API_PACKAGES_USER?package=...`, which uses the same field names but
 * may emit "unlimited" or "" for missing values.
 */

export type PackageInput = {
	// Resource limits (null = unlimited)
	bandwidth: number | null;
	quota: number | null;
	maxInodes: number | null;
	maxDomains: number | null;
	maxSubdomains: number | null;
	maxDomainPointers: number | null;
	maxEmailAccounts: number | null;
	maxEmailForwarders: number | null;
	maxMailingLists: number | null;
	maxAutoresponders: number | null;
	maxDatabases: number | null;
	maxFtpAccounts: number | null;
	emailDailyLimit: number | null;

	// Boolean access flags
	anonymousFtp: boolean;
	cgi: boolean;
	php: boolean;
	ssl: boolean;
	ssh: boolean;
	dnsControl: boolean;
	cron: boolean;
	spam: boolean;
	clamav: boolean;
	wordpress: boolean;
	git: boolean;
	redis: boolean;
	suspendAtLimit: boolean;
	oversold: boolean;
	jailed: boolean;
	securityTxt: boolean;

	// systemd resource caps (null = unlimited)
	cpuQuota: number | null;
	ioReadBandwidthMax: number | null;
	iopsReadMax: number | null;
	ioWriteBandwidthMax: number | null;
	iopsWriteMax: number | null;
	memoryHigh: number | null;
	memoryMax: number | null;
	tasksMax: number | null;

	// Strings
	skin: string | null;
	language: string | null;

	// Feature sets + plugins policies
	featureSetsPolicy: 'allow_all_commands' | 'allow_selected_features';
	featureSetsSelected: string[];
	pluginsPolicy: 'allow_all' | 'deny_selected' | 'allow_selected';
	pluginsSelected: string[];
};

/** Numeric → DA wire string. `null` = "unlimited". */
function num(value: number | null | undefined): string {
	if (value === null || value === undefined) return 'unlimited';
	return String(Math.trunc(value));
}

/** Boolean → "ON"/"OFF" exactly as DA expects. */
function bool(value: boolean | null | undefined): string {
	return value ? 'ON' : 'OFF';
}

/**
 * Build the form-urlencoded body for `POST /CMD_API_MANAGE_USER_PACKAGES`.
 *
 * @param action `create` or `modify` — DA accepts both with the same field set.
 *               For `delete`, use a separate `serializeDeletePackageBody` helper
 *               since DA expects the bulk-delete shape (`select0=<name>`).
 */
export function serializeDAPackage(
	packageName: string,
	action: 'create' | 'modify',
	p: PackageInput
): Record<string, string> {
	const body: Record<string, string> = {
		// `add=Submit` is the canonical "save" button name in DA's HTML form;
		// `action=create|modify` tells the controller which path to take.
		action,
		add: 'Submit',
		packagename: packageName,

		// Resource limits
		bandwidth: num(p.bandwidth),
		quota: num(p.quota),
		inode: num(p.maxInodes),
		vdomains: num(p.maxDomains),
		nsubdomains: num(p.maxSubdomains),
		domainptr: num(p.maxDomainPointers),
		nemails: num(p.maxEmailAccounts),
		nemailf: num(p.maxEmailForwarders),
		nemailml: num(p.maxMailingLists),
		nemailr: num(p.maxAutoresponders),
		mysql: num(p.maxDatabases),
		ftp: num(p.maxFtpAccounts),
		email_daily_limit: num(p.emailDailyLimit),

		// Boolean flags
		aftp: bool(p.anonymousFtp),
		cgi: bool(p.cgi),
		php: bool(p.php),
		ssl: bool(p.ssl),
		ssh: bool(p.ssh),
		dnscontrol: bool(p.dnsControl),
		cron: bool(p.cron),
		spam: bool(p.spam),
		clamav: bool(p.clamav),
		wordpress: bool(p.wordpress),
		git: bool(p.git),
		redis: bool(p.redis),
		suspend_at_limit: bool(p.suspendAtLimit),
		oversold: bool(p.oversold),
		jailed: bool(p.jailed),
		security_txt: bool(p.securityTxt),

		// systemd resource caps
		cpu_quota: num(p.cpuQuota),
		io_read_bandwidth_max: num(p.ioReadBandwidthMax),
		iops_read_max: num(p.iopsReadMax),
		io_write_bandwidth_max: num(p.ioWriteBandwidthMax),
		iops_write_max: num(p.iopsWriteMax),
		memory_high: num(p.memoryHigh),
		memory_max: num(p.memoryMax),
		tasks_max: num(p.tasksMax),

		// Strings (omit if empty — some DA versions reject empty skin/language)
		...(p.skin ? { skin: p.skin } : {}),
		...(p.language ? { language: p.language } : {}),

		// Policies
		feature_sets_policy: p.featureSetsPolicy,
		plugins_policy: p.pluginsPolicy
	};

	// Selected feature sets / plugins are sent as `feature_sets[]=A&feature_sets[]=B`
	// only when the policy actually restricts.
	if (p.featureSetsPolicy === 'allow_selected_features') {
		for (let i = 0; i < p.featureSetsSelected.length; i++) {
			body[`feature_sets[${i}]`] = p.featureSetsSelected[i];
		}
	}
	if (p.pluginsPolicy !== 'allow_all') {
		for (let i = 0; i < p.pluginsSelected.length; i++) {
			body[`plugins[${i}]`] = p.pluginsSelected[i];
		}
	}

	return body;
}

/**
 * Body for `POST /CMD_API_MANAGE_USER_PACKAGES` with `action=delete`.
 *
 * DA's bulk-delete shape uses `select0=<name>` (just like CMD_API_SELECT_USERS).
 */
export function serializeDeletePackageBody(packageName: string): Record<string, string> {
	return {
		action: 'delete',
		delete: 'Submit',
		select0: packageName,
		confirmed: 'Confirm'
	};
}

/**
 * Parse a DA `GET /CMD_API_PACKAGES_USER?package=...` response.
 *
 * DA returns key=value pairs where:
 *   - Boolean: "ON"/"OFF" (case-insensitive in practice).
 *   - Numeric: integer string OR "unlimited" OR empty.
 *   - Anything we don't recognise lands in the caller's `rawData` (handled by
 *     the sync layer, not here).
 */
export function parseDAPackage(form: Record<string, string>): Partial<PackageInput> {
	const parseNum = (v: string | undefined): number | null => {
		if (v === undefined || v === '' || v.toLowerCase() === 'unlimited') return null;
		const n = parseInt(v, 10);
		return Number.isFinite(n) ? n : null;
	};
	const parseBool = (v: string | undefined): boolean => {
		if (v === undefined) return false;
		return v.toUpperCase() === 'ON';
	};

	return {
		bandwidth: parseNum(form.bandwidth),
		quota: parseNum(form.quota),
		maxInodes: parseNum(form.inode),
		maxDomains: parseNum(form.vdomains),
		maxSubdomains: parseNum(form.nsubdomains),
		maxDomainPointers: parseNum(form.domainptr),
		maxEmailAccounts: parseNum(form.nemails),
		maxEmailForwarders: parseNum(form.nemailf),
		maxMailingLists: parseNum(form.nemailml),
		maxAutoresponders: parseNum(form.nemailr),
		maxDatabases: parseNum(form.mysql),
		maxFtpAccounts: parseNum(form.ftp),
		emailDailyLimit: parseNum(form.email_daily_limit),
		anonymousFtp: parseBool(form.aftp),
		cgi: parseBool(form.cgi),
		php: parseBool(form.php),
		ssl: parseBool(form.ssl),
		ssh: parseBool(form.ssh),
		dnsControl: parseBool(form.dnscontrol),
		cron: parseBool(form.cron),
		spam: parseBool(form.spam),
		clamav: parseBool(form.clamav),
		wordpress: parseBool(form.wordpress),
		git: parseBool(form.git),
		redis: parseBool(form.redis),
		suspendAtLimit: parseBool(form.suspend_at_limit),
		oversold: parseBool(form.oversold),
		jailed: parseBool(form.jailed),
		securityTxt: parseBool(form.security_txt),
		cpuQuota: parseNum(form.cpu_quota),
		ioReadBandwidthMax: parseNum(form.io_read_bandwidth_max),
		iopsReadMax: parseNum(form.iops_read_max),
		ioWriteBandwidthMax: parseNum(form.io_write_bandwidth_max),
		iopsWriteMax: parseNum(form.iops_write_max),
		memoryHigh: parseNum(form.memory_high),
		memoryMax: parseNum(form.memory_max),
		tasksMax: parseNum(form.tasks_max),
		skin: form.skin || null,
		language: form.language || null,
		featureSetsPolicy:
			form.feature_sets_policy === 'allow_selected_features'
				? 'allow_selected_features'
				: 'allow_all_commands',
		pluginsPolicy:
			form.plugins_policy === 'deny_selected'
				? 'deny_selected'
				: form.plugins_policy === 'allow_selected'
					? 'allow_selected'
					: 'allow_all'
	};
}

/**
 * Sensible defaults for a freshly-created package. All resource limits start
 * "unlimited" — the admin tightens them via the form. Booleans default to the
 * common safe-ish shared-hosting profile.
 */
export function defaultPackageInput(): PackageInput {
	return {
		bandwidth: null,
		quota: null,
		maxInodes: null,
		maxDomains: null,
		maxSubdomains: null,
		maxDomainPointers: null,
		maxEmailAccounts: null,
		maxEmailForwarders: null,
		maxMailingLists: null,
		maxAutoresponders: null,
		maxDatabases: null,
		maxFtpAccounts: null,
		emailDailyLimit: null,
		anonymousFtp: false,
		cgi: false,
		php: true,
		ssl: true,
		ssh: false,
		dnsControl: true,
		cron: true,
		spam: true,
		clamav: false,
		wordpress: true,
		git: false,
		redis: false,
		suspendAtLimit: true,
		oversold: false,
		jailed: true,
		securityTxt: false,
		cpuQuota: null,
		ioReadBandwidthMax: null,
		iopsReadMax: null,
		ioWriteBandwidthMax: null,
		iopsWriteMax: null,
		memoryHigh: null,
		memoryMax: null,
		tasksMax: null,
		skin: 'evolution',
		language: 'en',
		featureSetsPolicy: 'allow_all_commands',
		featureSetsSelected: [],
		pluginsPolicy: 'allow_all',
		pluginsSelected: []
	};
}
