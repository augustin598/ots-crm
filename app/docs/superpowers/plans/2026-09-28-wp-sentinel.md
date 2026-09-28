# WordPress Sentinel — plan de implementare

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jurnalul de securitate de pe site-urile WordPress ajunge zilnic în CRM (tabel + pagină) și produce un singur mesaj Telegram pe zi cu ce e critic/important.

**Architecture:** Sentinel devine o clasă în conectorul OTS (`ots-connector.php`, 0.9.0) cu o rută semnată `POST /sentinel` care întoarce evenimentele + o scanare a `uploads`. CRM-ul trage evenimentele (job 09:00 + buton „Citește acum”), le clasifică cu reguli pure (`rules.ts`), le stochează 7 zile în `wordpress_security_event`, ține memoria lungă (IP-uri admin, baseline uploads) în `wordpress_site.sentinel_state` și trimite rezumatul prin `sendTelegramMessage`.

**Tech Stack:** PHP 7.4+ (WordPress plugin), SvelteKit 5 + remote functions, Bun, Drizzle/libSQL, BullMQ scheduler, Redis (Bun client), Telegram.

**Spec:** `docs/superpowers/specs/2026-09-28-wp-sentinel-design.md` — citește-l înainte de orice task.

**Reguli de repo care se aplică peste tot:**
- Branch: `feat/wp-sentinel` în worktree-ul `/Users/augustin598/Projects/CRM/.claude/worktrees/wp-sentinel` (creat deja). NU lucra în checkout-ul principal (are modificările altei sesiuni). Toate căile de mai jos sunt relative la `<worktree>/app`, iar cele cu prefix `ots-wp-connector/` la `<worktree>/ots-wp-connector`.
- Commit: `git add` DOAR fișierele tale, enumerate explicit. Niciodată `git add -A`/`.`.
- Teste: `bun run test <filtru>` (NU `bun test`).
- Migrări: scrise de mână, un statement per fișier, fără `IF NOT EXISTS`, jurnal editat de mână. Baza de dev = baza de prod → migrarea se aplică imediat ce schema.ts primește coloanele (altfel `select()` pe `wordpress_site` pică pe toate paginile WordPress).
- Svelte: încarcă `svelte:svelte-core-bestpractices` înainte de a atinge un `.svelte`; `svelte-autofixer` pe fiecare componentă; la final `/build-check`.

---

## Structura fișierelor

**Conector (`ots-wp-connector/`)**
- Modify: `ots-connector.php` — versiune 0.9.0, clasa `OTS_Connector_Sentinel` (hook-uri + jurnal + citire + scanare), ruta `/sentinel`.
- Modify: `CHANGELOG.md`.

**CRM (`app/`)**
- Modify: `src/lib/server/db/schema.ts` — tabel `wordpressSecurityEvent`, 4 coloane pe `wordpressSite`.
- Create: `drizzle/0569_…` – `drizzle/0576_…` + intrări în `drizzle/meta/_journal.json`.
- Modify: `src/lib/server/wordpress/client.ts` — tipuri + `sentinel()`.
- Modify: `src/lib/server/wordpress/sync.ts` — exportă `loadSiteAndClient`.
- Create: `src/lib/server/wordpress/sentinel/types.ts` — tipurile comune (eveniment, stare, finding).
- Create: `src/lib/logic/wordpress-sentinel-labels.ts` — etichete RO (în `logic/`, nu `server/`: le folosește și pagina).
- Create: `src/lib/server/wordpress/sentinel/rules.ts` — `classify`, `detectFindings` (pure).
- Create: `src/lib/server/wordpress/sentinel/digest.ts` — textul Telegram (pur).
- Create: `src/lib/server/wordpress/sentinel/pull.ts` — `pullSite` (client + db).
- Create: `src/lib/server/wordpress/sentinel/__tests__/{rules,digest,pull}.test.ts` + `fixtures/`.
- Create: `scripts/anonymize-sentinel-log.ts`.
- Create: `src/lib/server/scheduler/tasks/wordpress-sentinel-daily.ts` + test.
- Modify: `src/lib/server/scheduler/index.ts` — înregistrare job.
- Create: `src/lib/remotes/wordpress-security.remote.ts`.
- Create: `src/routes/[tenant]/wordpress/security/+page.ts`, `+page.svelte`.
- Modify: `src/routes/[tenant]/wordpress/+page.svelte` — buton „Securitate”.

---

### Task 1: Fixture-uri din jurnalele reale (anonimizate)

**Files:**
- Create: `scripts/anonymize-sentinel-log.ts`
- Create: `src/lib/server/wordpress/sentinel/__tests__/fixtures/areni.ndjson`
- Create: `src/lib/server/wordpress/sentinel/__tests__/fixtures/nevada.ndjson`

- [ ] **Step 1: Obține jurnalele brute**

Nu există copii locale. Jurnalele stau pe site în `wp-content/ots-sentinel/sentinel.log` (areni = arenishaorma.ro, nevada = nevadasuceava.ro). Cere userului să le descarce prin FTP (sau cu `~/Wordpress/WooProducts/ots-guard/citeste_sentinel.py`, dacă are credențialele) în:
`/private/tmp/claude-501/-Users-augustin598-Projects-CRM/1f00c8ed-758e-46d9-8e58-78be24aea9bc/scratchpad/sentinel-raw/areni.log` și `.../nevada.log`.
**Dacă fișierele lipsesc: OPREȘTE-TE și întreabă.** Nu inventa fixture-uri — spec-ul cere testarea pe date reale.

- [ ] **Step 2: Scrie anonimizatorul**

```ts
#!/usr/bin/env bun
/**
 * Anonimizează un jurnal Sentinel (NDJSON) pentru fixture-uri de test:
 * IP-urile devin 10.0.<n>.<m> (același IP → același rezultat), username-urile
 * și emailurile devin user_<n>. Structura liniilor rămâne neatinsă.
 *   bun scripts/anonymize-sentinel-log.ts <in.log> <out.ndjson>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , input, output] = process.argv;
if (!input || !output) {
	console.error('Utilizare: bun scripts/anonymize-sentinel-log.ts <in.log> <out.ndjson>');
	process.exit(1);
}

const ips = new Map<string, string>();
const users = new Map<string, string>();
const OTS_IPS = new Set(['82.77.19.195', '213.157.186.85']);

function anonIp(ip: string): string {
	if (!ip || OTS_IPS.has(ip)) return ip; // IP-urile OTS rămân — regulile le exclud
	let v = ips.get(ip);
	if (!v) {
		const n = ips.size + 1;
		v = `10.0.${Math.floor(n / 256)}.${n % 256}`;
		ips.set(ip, v);
	}
	return v;
}
function anonUser(u: string): string {
	if (!u || u === '-' || u === '?') return u;
	let v = users.get(u);
	if (!v) {
		v = `user_${users.size + 1}`;
		users.set(u, v);
	}
	return v;
}
function walk(value: unknown, key = ''): unknown {
	if (typeof value === 'string') {
		if (key === 'ip') return anonIp(value);
		if (key === 'user' || key === 'login') return anonUser(value);
		if (key === 'email' || /@/.test(value)) return `${anonUser(value)}@exemplu.ro`;
		return value;
	}
	if (Array.isArray(value)) return value.map((x) => walk(x));
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, k)]));
	}
	return value;
}

const lines = readFileSync(input, 'utf8').split('\n').filter((l) => l.trim());
const out = lines.map((l) => JSON.stringify(walk(JSON.parse(l))));
writeFileSync(output, out.join('\n') + '\n');
console.log(`${out.length} linii → ${output} (${ips.size} IP-uri, ${users.size} useri)`);
```

- [ ] **Step 3: Generează fixture-urile**

```bash
mkdir -p src/lib/server/wordpress/sentinel/__tests__/fixtures
bun scripts/anonymize-sentinel-log.ts <scratchpad>/sentinel-raw/areni.log src/lib/server/wordpress/sentinel/__tests__/fixtures/areni.ndjson
bun scripts/anonymize-sentinel-log.ts <scratchpad>/sentinel-raw/nevada.log src/lib/server/wordpress/sentinel/__tests__/fixtures/nevada.ndjson
grep -c login_esuat src/lib/server/wordpress/sentinel/__tests__/fixtures/nevada.ndjson
```
Expected: numărul de linii ≥ 1; `grep` arată câte eșecuri de login are nevada (spec-ul spune 3, pe același username, 3 IP-uri — verifică cu `grep login_esuat … | jq -r '.date.login'`). Dacă datele nu confirmă „3 eșecuri / 3 IP-uri”, notează cifrele reale și ajustează aserțiunile din Task 6 la ele (nu forța fixture-ul).

- [ ] **Step 4: Verifică că n-a rămas nimic real**

```bash
grep -E '\b[0-9]{1,3}(\.[0-9]{1,3}){3}\b' src/lib/server/wordpress/sentinel/__tests__/fixtures/*.ndjson | grep -vE '10\.0\.|82\.77\.19\.195|213\.157\.186\.85' | head
```
Expected: fără output.

- [ ] **Step 5: Commit**

```bash
git add scripts/anonymize-sentinel-log.ts src/lib/server/wordpress/sentinel/__tests__/fixtures/areni.ndjson src/lib/server/wordpress/sentinel/__tests__/fixtures/nevada.ndjson
git commit -m "test(sentinel): fixture-uri anonimizate din jurnalele areni și nevada"
```

---

### Task 2: Conector 0.9.0 — clasa `OTS_Connector_Sentinel` (hook-uri + jurnal)

**Files:**
- Modify: `ots-wp-connector/ots-connector.php` (versiune la liniile 6 și 19; clasa nouă imediat după `ots_connector_verify_request`, adică după linia 91)

- [ ] **Step 1: Bump versiune**

Linia 6: `* Version:           0.9.0`. Linia 19: `define( 'OTS_CONNECTOR_VERSION', '0.9.0' );`

- [ ] **Step 2: Adaugă clasa (după linia 91, înainte de `ots_connector_route_health`)**

```php
/**
 * Sentinel — jurnal de securitate (NDJSON) în wp-content/ots-sentinel/.
 * Portat din mu-plugin-ul OTS_Sentinel 1.0. Dacă mu-plugin-ul e încă
 * instalat, nu înregistrăm hook-urile (ar dubla evenimentele), dar ruta
 * /sentinel servește jurnalul lui și raportează legacyMuPlugin = true.
 * Fiecare callback e protejat cu try/catch — o eroare aici nu oprește site-ul.
 */
class OTS_Connector_Sentinel {
	const MAX_BYTES = 8388608; // 8 MB, apoi rotire
	const MAX_EVENTS_PER_PAGE = 5000;
	const SCAN_BUDGET_SEC = 20;
	const SCAN_RETURN_MAX = 200;

	private static $posts_this_request = 0;

	public static function dir(): string {
		return WP_CONTENT_DIR . '/ots-sentinel';
	}

	/** Numele fișierului derivă din secret: .htaccess nu ajută pe Nginx, numele neghicit da. */
	public static function log_file(): string {
		$secret = (string) get_option( OTS_CONNECTOR_SECRET_OPTION, '' );
		$hash   = substr( hash_hmac( 'sha256', 'sentinel-log', $secret ), 0, 16 );
		return self::dir() . '/sentinel-' . $hash . '.log';
	}

	public static function legacy_present(): bool {
		return class_exists( 'OTS_Sentinel', false );
	}

	public static function boot(): void {
		if ( self::legacy_present() ) {
			return;
		}
		// Cronul rămas de la mu-plugin după ștergerea lui.
		if ( function_exists( 'wp_next_scheduled' ) && wp_next_scheduled( 'ots_sentinel_scan' ) ) {
			wp_clear_scheduled_hook( 'ots_sentinel_scan' );
		}
		self::ensure_dir();

		$safe = function ( $method ) {
			return function () use ( $method ) {
				try {
					call_user_func_array( [ __CLASS__, $method ], func_get_args() );
				} catch ( Throwable $e ) {
					// Sentinel nu are voie să strice site-ul.
				}
			};
		};

		add_action( 'wp_insert_post', $safe( 'on_insert_post' ), 10, 3 );
		add_action( 'user_register', $safe( 'on_user_register' ) );
		add_action( 'set_user_role', $safe( 'on_set_role' ), 10, 3 );
		add_action( 'profile_update', $safe( 'on_profile_update' ), 10, 2 );
		add_action( 'deleted_user', $safe( 'on_deleted_user' ) );
		add_action( 'wp_login', $safe( 'on_login' ), 10, 2 );
		add_action( 'wp_login_failed', $safe( 'on_login_failed' ) );
		add_action( 'activated_plugin', $safe( 'on_plugin_activated' ) );
		add_action( 'deactivated_plugin', $safe( 'on_plugin_deactivated' ) );
		add_action( 'switch_theme', $safe( 'on_switch_theme' ) );
		add_action( 'upgrader_process_complete', $safe( 'on_upgrader' ), 10, 2 );
		foreach ( [ 'siteurl', 'home', 'users_can_register', 'default_role', 'admin_email' ] as $opt ) {
			add_action( "update_option_{$opt}", function ( $old, $new ) use ( $opt ) {
				try {
					self::log( 'option_changed', [ 'option' => $opt, 'vechi' => $old, 'nou' => $new ], 'ALERT' );
				} catch ( Throwable $e ) {
				}
			}, 10, 2 );
		}
	}

	/* ---- callback-uri ---- */

	public static function on_insert_post( $post_id, $post, $update ): void {
		if ( $update || ! $post ) {
			return;
		}
		if ( wp_is_post_revision( $post_id ) || wp_is_post_autosave( $post_id ) ) {
			return;
		}
		// attachment: un upload de galerie nu e inserare în masă
		$ignored = [ 'revision', 'nav_menu_item', 'customize_changeset', 'oembed_cache', 'scheduled-action', 'attachment' ];
		if ( in_array( $post->post_type, $ignored, true ) ) {
			return;
		}
		self::$posts_this_request++;
		$sev = ( self::$posts_this_request > 5 ) ? 'ALERT' : 'INFO';
		self::log( 'post_created', [
			'id'            => $post_id,
			'tip'           => $post->post_type,
			'status'        => $post->post_status,
			'titlu'         => self::cut( $post->post_title, 80 ),
			'autor'         => (int) $post->post_author,
			'nr_in_request' => self::$posts_this_request,
			'sursa'         => self::caller(),
		], $sev );
	}

	public static function on_user_register( $user_id ): void {
		$u = get_userdata( $user_id );
		self::log( 'user_registered', [
			'id'     => $user_id,
			'login'  => $u ? $u->user_login : '?',
			'email'  => $u ? $u->user_email : '?',
			'roluri' => $u ? $u->roles : [],
		], 'WARN' );
	}

	public static function on_set_role( $user_id, $role, $old_roles ): void {
		$sev = ( 'administrator' === $role ) ? 'ALERT' : 'WARN';
		self::log( 'role_changed', [ 'id' => $user_id, 'rol_nou' => $role, 'roluri_vechi' => $old_roles ], $sev );
	}

	public static function on_profile_update( $user_id, $old ): void {
		$u = get_userdata( $user_id );
		if ( ! $u || ! $old ) {
			return;
		}
		$diff = [];
		if ( $u->user_email !== $old->user_email ) {
			$diff['email'] = [ $old->user_email, $u->user_email ];
		}
		if ( $u->user_pass !== $old->user_pass ) {
			$diff['parola'] = 'schimbata';
		}
		if ( $diff ) {
			self::log( 'profile_update', [ 'id' => $user_id, 'login' => $u->user_login, 'roluri' => $u->roles, 'modificari' => $diff ], 'WARN' );
		}
	}

	public static function on_deleted_user( $id ): void {
		self::log( 'user_deleted', [ 'id' => $id ] );
	}

	public static function on_login( $login, $user = null ): void {
		$roles = ( $user instanceof WP_User ) ? $user->roles : [];
		$sev   = in_array( 'administrator', (array) $roles, true ) ? 'WARN' : 'INFO';
		self::log( 'login_ok', [ 'login' => $login, 'roluri' => $roles ], $sev );
	}

	public static function on_login_failed( $login ): void {
		$login  = (string) $login;
		$exista = username_exists( $login ) || ( is_email( $login ) && email_exists( $login ) );
		self::log( 'login_esuat', [ 'login' => $login, 'exista' => (bool) $exista ], 'INFO' );
	}

	public static function on_plugin_activated( $p ): void {
		self::log( 'plugin_activated', [ 'plugin' => $p ], 'WARN' );
	}

	public static function on_plugin_deactivated( $p ): void {
		self::log( 'plugin_deactivated', [ 'plugin' => $p ], 'WARN' );
	}

	public static function on_switch_theme( $t ): void {
		self::log( 'theme_switched', [ 'theme' => $t ], 'WARN' );
	}

	public static function on_upgrader( $u, $h ): void {
		self::log( 'upgrader', [
			'type'   => isset( $h['type'] ) ? $h['type'] : '?',
			'action' => isset( $h['action'] ) ? $h['action'] : '?',
		], 'WARN' );
	}

	/* ---- jurnal ---- */

	public static function log( string $eveniment, array $date = [], string $sev = 'INFO' ): void {
		$f = self::log_file();
		if ( file_exists( $f ) && filesize( $f ) > self::MAX_BYTES ) {
			@rename( $f, preg_replace( '/\.log$/', '-' . gmdate( 'Ymd-His' ) . '.log', $f ) );
		}
		$u     = function_exists( 'wp_get_current_user' ) ? wp_get_current_user() : null;
		$linie = [
			'id'   => bin2hex( random_bytes( 6 ) ),
			't'    => gmdate( 'c' ),
			'sev'  => $sev,
			'ev'   => $eveniment,
			'user' => ( $u && $u->ID ) ? $u->user_login : '-',
			'uid'  => ( $u && $u->ID ) ? (int) $u->ID : 0,
			'ip'   => self::ip(),
			'uri'  => isset( $_SERVER['REQUEST_URI'] ) ? self::cut( $_SERVER['REQUEST_URI'], 200 ) : '',
			'ua'   => isset( $_SERVER['HTTP_USER_AGENT'] ) ? self::cut( $_SERVER['HTTP_USER_AGENT'], 160 ) : '',
			'date' => $date,
		];
		@file_put_contents( $f, wp_json_encode( $linie ) . "\n", FILE_APPEND | LOCK_EX );
	}

	private static function caller(): array {
		$ctx = 'web';
		if ( defined( 'REST_REQUEST' ) && REST_REQUEST ) {
			$ctx = 'rest';
		} elseif ( defined( 'XMLRPC_REQUEST' ) && XMLRPC_REQUEST ) {
			$ctx = 'xmlrpc';
		} elseif ( defined( 'DOING_CRON' ) && DOING_CRON ) {
			$ctx = 'cron';
		} elseif ( defined( 'WP_CLI' ) && WP_CLI ) {
			$ctx = 'wp-cli';
		} elseif ( is_admin() ) {
			$ctx = 'wp-admin';
		}
		$origin = '';
		foreach ( debug_backtrace( DEBUG_BACKTRACE_IGNORE_ARGS, 25 ) as $fr ) {
			if ( empty( $fr['file'] ) ) {
				continue;
			}
			$fl = wp_normalize_path( $fr['file'] );
			if ( false === strpos( $fl, '/wp-includes/' ) && false === strpos( $fl, '/wp-admin/' ) && false === strpos( $fl, 'ots-connector' ) ) {
				$origin = str_replace( wp_normalize_path( ABSPATH ), '', $fl ) . ':' . ( isset( $fr['line'] ) ? $fr['line'] : '?' );
				break;
			}
		}
		return [ 'context' => $ctx, 'fisier' => $origin ];
	}

	private static function cut( $s, int $n ): string {
		$s = (string) $s;
		return function_exists( 'mb_substr' ) ? mb_substr( $s, 0, $n ) : substr( $s, 0, $n );
	}

	private static function ip(): string {
		foreach ( [ 'HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR' ] as $k ) {
			if ( ! empty( $_SERVER[ $k ] ) ) {
				$v = explode( ',', (string) $_SERVER[ $k ] );
				return trim( $v[0] );
			}
		}
		return '';
	}

	private static function ensure_dir(): void {
		$dir = self::dir();
		if ( is_dir( $dir ) ) {
			return;
		}
		wp_mkdir_p( $dir );
		@file_put_contents( $dir . '/.htaccess', "Require all denied\n<IfModule !mod_authz_core.c>\nOrder deny,allow\nDeny from all\n</IfModule>\n" );
		@file_put_contents( $dir . '/index.php', "<?php // Silence is golden.\n" );
	}
}
add_action( 'plugins_loaded', [ 'OTS_Connector_Sentinel', 'boot' ], 5 );
```

Notă: mu-plugin-urile se încarcă înaintea plugin-urilor, deci la `plugins_loaded` (prioritate 5, după `init`-ul mu-plugin-ului la prioritatea 1) `class_exists('OTS_Sentinel')` e decisiv.

- [ ] **Step 3: Verifică sintaxa**

```bash
php -l ots-wp-connector/ots-connector.php
```
Expected: `No syntax errors detected`.

- [ ] **Step 4: Commit**

```bash
git add ots-wp-connector/ots-connector.php
git commit -m "feat(connector): Sentinel — jurnal de securitate în conector (0.9.0, partea 1: hook-uri)"
```

---

### Task 3: Conector 0.9.0 — citire jurnal, scanare uploads, ruta `POST /sentinel`

**Files:**
- Modify: `ots-wp-connector/ots-connector.php` (metode noi în clasă; înregistrarea rutei în blocul `rest_api_init`, imediat după ruta `/health`)
- Modify: `ots-wp-connector/CHANGELOG.md`

- [ ] **Step 1: Adaugă în clasă metodele de citire și scanare (înainte de `/* ---- jurnal ---- */`)**

```php
	/* ---- citire pentru CRM ---- */

	/**
	 * Evenimente cu t >= $since din TOATE fișierele sentinel*.log (jurnalul nou,
	 * cel vechi al mu-plugin-ului și rotirile lor), cele mai vechi primele.
	 * Liniile fără id (mu-plugin) primesc sha1(linie)-n, n = a câta apariție a
	 * liniei identice în fișierul ei — stabil, fișierele sunt append-only.
	 */
	public static function read_events( ?string $since, int $skip, array &$errors ): array {
		$since_ts = $since ? strtotime( $since ) : 0;
		$files    = glob( self::dir() . '/sentinel*.log' ) ?: [];
		$events   = [];
		$bytes    = 0;
		foreach ( $files as $f ) {
			$bytes += (int) @filesize( $f );
			if ( $since_ts && @filemtime( $f ) < $since_ts ) {
				continue; // fișier rotit înainte de since: nimic nou în el
			}
			$fh = @fopen( $f, 'r' );
			if ( ! $fh ) {
				$errors[] = 'Nu pot citi ' . basename( $f );
				continue;
			}
			$seen = [];
			while ( ( $line = fgets( $fh ) ) !== false ) {
				$line = rtrim( $line, "\r\n" );
				if ( '' === $line ) {
					continue;
				}
				$ev = json_decode( $line, true );
				if ( ! is_array( $ev ) || empty( $ev['t'] ) ) {
					continue;
				}
				if ( empty( $ev['id'] ) ) {
					$h          = sha1( $line );
					$seen[ $h ] = isset( $seen[ $h ] ) ? $seen[ $h ] + 1 : 1;
					$ev['id']   = $h . '-' . $seen[ $h ];
				}
				if ( $since_ts && strtotime( $ev['t'] ) < $since_ts ) {
					continue;
				}
				$events[] = $ev;
			}
			fclose( $fh );
		}
		// sortare stabilă după t (usort nu e stabil în PHP 7.4)
		$i = 0;
		foreach ( $events as &$e ) {
			$e['_i'] = $i++;
		}
		unset( $e );
		usort( $events, function ( $a, $b ) {
			$c = strcmp( $a['t'], $b['t'] );
			return $c !== 0 ? $c : $a['_i'] - $b['_i'];
		} );
		$total = count( $events );
		$page  = array_slice( $events, $skip, self::MAX_EVENTS_PER_PAGE );
		foreach ( $page as &$e ) {
			unset( $e['_i'] );
		}
		unset( $e );
		return [
			'events'   => $page,
			'hasMore'  => ( $skip + count( $page ) ) < $total,
			'logBytes' => $bytes,
		];
	}

	/**
	 * PHP executabil în uploads. Parcurge TOT (buget 20 s), întoarce cele mai
	 * noi 200 după mtime — un shell nou e mereu printre ele; o limită pe
	 * „primele 200 găsite” s-ar păcăli cu 200 de fișiere inofensive.
	 */
	public static function scan_uploads( array &$errors ): array {
		$start = microtime( true );
		$up    = wp_upload_dir();
		$out   = [ 'files' => [], 'scannedFiles' => 0, 'truncated' => false, 'durationMs' => 0 ];
		if ( empty( $up['basedir'] ) || ! is_dir( $up['basedir'] ) ) {
			$errors[] = 'uploads lipsă';
			return $out;
		}
		$base  = wp_normalize_path( $up['basedir'] );
		$found = [];
		try {
			$it = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $base, FilesystemIterator::SKIP_DOTS ), RecursiveIteratorIterator::LEAVES_ONLY, RecursiveIteratorIterator::CATCH_GET_CHILD );
			foreach ( $it as $file ) {
				$out['scannedFiles']++;
				if ( 0 === $out['scannedFiles'] % 200 && ( microtime( true ) - $start ) > self::SCAN_BUDGET_SEC ) {
					$out['truncated'] = true;
					break;
				}
				if ( ! $file->isFile() ) {
					continue;
				}
				$name = $file->getFilename();
				if ( ! preg_match( '/\.(php|phtml|php[0-9]|phar)$/i', $name ) ) {
					continue;
				}
				if ( 'index.php' === $name && $file->getSize() < 40 ) {
					continue;
				}
				$found[] = [
					'path'  => substr( wp_normalize_path( $file->getPathname() ), strlen( $base ) ),
					'size'  => $file->getSize(),
					'mtime' => $file->getMTime(),
					'full'  => $file->getPathname(),
				];
			}
		} catch ( Throwable $e ) {
			$errors[] = 'scan: ' . $e->getMessage();
		}
		usort( $found, function ( $a, $b ) {
			return $b['mtime'] <=> $a['mtime'];
		} );
		foreach ( array_slice( $found, 0, self::SCAN_RETURN_MAX ) as $f ) {
			$out['files'][] = [
				'path'  => $f['path'],
				'size'  => $f['size'],
				'mtime' => gmdate( 'c', $f['mtime'] ),
				'sha1'  => (string) @sha1_file( $f['full'] ),
			];
		}
		$out['durationMs'] = (int) round( ( microtime( true ) - $start ) * 1000 );
		return $out;
	}
```

- [ ] **Step 2: Adaugă funcția de rută (după clasă, înainte de `ots_connector_route_health`)**

```php
/**
 * POST /sentinel — body { since?: ISO 8601, skip?: int }. POST (nu GET) pentru
 * că query string-ul nu intră în semnătura HMAC, body-ul da.
 */
function ots_connector_route_sentinel( WP_REST_Request $request ) {
	$body   = $request->get_json_params();
	$since  = isset( $body['since'] ) && is_string( $body['since'] ) && '' !== $body['since'] ? $body['since'] : null;
	$skip   = isset( $body['skip'] ) ? max( 0, (int) $body['skip'] ) : 0;
	$errors = [];
	if ( $since && false === strtotime( $since ) ) {
		return new WP_Error( 'ots_bad_since', 'since must be ISO 8601', [ 'status' => 400 ] );
	}
	@set_time_limit( 120 );
	$read = OTS_Connector_Sentinel::read_events( $since, $skip, $errors );
	// Scanarea doar pe prima pagină — costă până la 20 s.
	$scan = 0 === $skip ? OTS_Connector_Sentinel::scan_uploads( $errors ) : null;
	return rest_ensure_response( [
		'sentinel' => [
			'version'        => OTS_CONNECTOR_VERSION,
			'legacyMuPlugin' => OTS_Connector_Sentinel::legacy_present(),
			'logBytes'       => $read['logBytes'],
		],
		'events'   => $read['events'],
		'hasMore'  => $read['hasMore'],
		'scan'     => $scan,
		'errors'   => $errors,
	] );
}
```

- [ ] **Step 3: Înregistrează ruta (în `rest_api_init`, după blocul `/health`)**

```php
	register_rest_route( OTS_CONNECTOR_NAMESPACE, '/sentinel', [
		'methods'             => WP_REST_Server::CREATABLE,
		'callback'            => 'ots_connector_route_sentinel',
		'permission_callback' => 'ots_connector_verify_request',
	] );
```

- [ ] **Step 4: CHANGELOG (deasupra intrării 0.8.5)**

```markdown
## 0.9.0 — 2026-09-28

- Sentinel intră în conector: jurnal de securitate NDJSON în
  `wp-content/ots-sentinel/sentinel-<hash>.log` (hash derivat din secret —
  `.htaccess` nu protejează pe Nginx). Aceleași evenimente ca mu-plugin-ul
  `ots-sentinel.php` 1.0, plus `id` unic pe linie și `exista` la `login_esuat`.
  Dacă mu-plugin-ul e încă instalat, hook-urile nu se înregistrează (fără
  dubluri) și ruta raportează `legacyMuPlugin: true`.
- Rută nouă `POST /sentinel` `{ since, skip }`: evenimentele din toate
  fișierele `sentinel*.log` (max 5000/pagină) + scanarea `uploads` după PHP
  executabil (parcurge tot în buget de 20 s, întoarce cele mai noi 200).
- Scanarea zilnică pe wp-cron dispare; CRM-ul o cere când citește.
```

- [ ] **Step 5: Verifică sintaxa și build-ul local (fără publicare)**

```bash
php -l ots-wp-connector/ots-connector.php
cd app && bun run connector:build
ls -la ../ots-wp-connector-v0.9.0.zip
```
Expected: `No syntax errors detected`; `Built: …/ots-wp-connector-v0.9.0.zip`. **NU** rula `connector:publish`/`connector:release`.

- [ ] **Step 6: Test manual pe WordPress în Docker (opțional dar recomandat)** — compose-ul folosit la backup e în scratchpad-ul sesiunii din 25 sep; dacă nu mai există, sari. Cu conectorul instalat: o logare eșuată + `POST /wp-json/ots-connector/v1/sentinel` semnat (helper-ul din `docs/superpowers/handoff/2026-09-25-wordpress-backup-updates.md`) → `events[0].ev === 'login_esuat'`, `events[0].date.exista === false`, `scan.files` gol.

- [ ] **Step 7: Commit**

```bash
git add ots-wp-connector/ots-connector.php ots-wp-connector/CHANGELOG.md
git commit -m "feat(connector): POST /sentinel — evenimente paginate + scanare uploads (0.9.0)"
```

---

### Task 4: Schema + migrări

**Files:**
- Modify: `src/lib/server/db/schema.ts` (după `wordpressSite`, linia ~5283; coloane noi în `wordpressSite` înainte de `createdAt`)
- Create: `drizzle/0569_wordpress_security_event.sql` … `drizzle/0576_wordpress_site_sentinel_state.sql`
- Modify: `drizzle/meta/_journal.json`

- [ ] **Step 1: grep numele înainte**

```bash
grep -l "wordpress_security_event\|sentinel_" drizzle/*.sql
```
Expected: fără output (nimic nu există deja).

- [ ] **Step 2: Coloane pe `wordpressSite` (în schema.ts, înainte de `createdAt`)**

```ts
	// Sentinel (jurnal de securitate prin conector ≥ 0.9.0)
	sentinelLastPullAt: timestamp('sentinel_last_pull_at', { withTimezone: true, mode: 'date' }),
	sentinelLastPullStatus: text('sentinel_last_pull_status'), // 'ok' | 'error' | 'unsupported' | 'legacy'
	sentinelFailures: integer('sentinel_failures').notNull().default(0),
	sentinelState: text('sentinel_state'), // JSON: SentinelState (sentinel/types.ts)
```

- [ ] **Step 3: Tabel nou (după `wordpressSiteRelations`)**

```ts
// Evenimente Sentinel citite de pe site-uri (7 zile). Memoria lungă (IP-uri
// admin, baseline uploads) stă în wordpress_site.sentinel_state.
export const wordpressSecurityEvent = sqliteTable(
	'wordpress_security_event',
	{
		id: text('id').primaryKey(),
		tenantId: text('tenant_id')
			.notNull()
			.references(() => tenant.id),
		siteId: text('site_id')
			.notNull()
			.references(() => wordpressSite.id),
		eventUid: text('event_uid').notNull(), // id-ul venit de pe site
		occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
		sentinelSev: text('sentinel_sev').notNull(), // INFO | WARN | ALERT
		level: text('level').notNull(), // critical | important | normal (calculat în CRM)
		event: text('event').notNull(),
		username: text('username'),
		ip: text('ip'),
		uri: text('uri'),
		userAgent: text('user_agent'),
		data: text('data'), // JSON: `date` de pe site
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
			.notNull()
			.default(sql`current_timestamp`)
	},
	(t) => ({
		tenantOccurredIdx: index('wordpress_security_event_tenant_occurred_idx').on(t.tenantId, t.occurredAt),
		siteEventOccurredIdx: index('wordpress_security_event_site_event_occurred_idx').on(t.siteId, t.event, t.occurredAt),
		siteUidUidx: uniqueIndex('wordpress_security_event_site_uid_uidx').on(t.siteId, t.eventUid)
	})
);
```

- [ ] **Step 4: Migrările (un statement per fișier, fără `IF NOT EXISTS`)**

`drizzle/0569_wordpress_security_event.sql`
```sql
CREATE TABLE `wordpress_security_event` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`site_id` text NOT NULL REFERENCES `wordpress_site`(`id`),
	`event_uid` text NOT NULL,
	`occurred_at` timestamp NOT NULL,
	`sentinel_sev` text NOT NULL,
	`level` text NOT NULL,
	`event` text NOT NULL,
	`username` text,
	`ip` text,
	`uri` text,
	`user_agent` text,
	`data` text,
	`created_at` timestamp NOT NULL DEFAULT current_timestamp
);
```
`drizzle/0570_wordpress_security_event_tenant_occurred_idx.sql`
```sql
CREATE INDEX `wordpress_security_event_tenant_occurred_idx` ON `wordpress_security_event` (`tenant_id`,`occurred_at`);
```
`drizzle/0571_wordpress_security_event_site_event_occurred_idx.sql`
```sql
CREATE INDEX `wordpress_security_event_site_event_occurred_idx` ON `wordpress_security_event` (`site_id`,`event`,`occurred_at`);
```
`drizzle/0572_wordpress_security_event_site_uid_uidx.sql`
```sql
CREATE UNIQUE INDEX `wordpress_security_event_site_uid_uidx` ON `wordpress_security_event` (`site_id`,`event_uid`);
```
`drizzle/0573_wordpress_site_sentinel_last_pull_at.sql`
```sql
ALTER TABLE `wordpress_site` ADD `sentinel_last_pull_at` timestamp;
```
`drizzle/0574_wordpress_site_sentinel_last_pull_status.sql`
```sql
ALTER TABLE `wordpress_site` ADD `sentinel_last_pull_status` text;
```
`drizzle/0575_wordpress_site_sentinel_failures.sql`
```sql
ALTER TABLE `wordpress_site` ADD `sentinel_failures` integer DEFAULT 0 NOT NULL;
```
`drizzle/0576_wordpress_site_sentinel_state.sql`
```sql
ALTER TABLE `wordpress_site` ADD `sentinel_state` text;
```

- [ ] **Step 5: Jurnalul** — în `drizzle/meta/_journal.json`, după intrarea 568, opt intrări cu `when` = `1788786476918026 + k` (k = 1..8), `version: "6"`, `breakpoints: true`, tag-urile = numele fișierelor fără `.sql`:

```json
    {
      "idx": 569,
      "version": "6",
      "when": 1788786476919026,
      "tag": "0569_wordpress_security_event",
      "breakpoints": true
    },
```
…și tot așa până la `"idx": 576, "when": 1788786476926026, "tag": "0576_wordpress_site_sentinel_state"`. (Nu rula `scripts/fix-migrations.ts` — ar adăuga `IF NOT EXISTS`.)

- [ ] **Step 6: Verifică pe bază curată, apoi aplică pe baza partajată**

```bash
ls drizzle/*.sql | wc -l; grep -c '"idx"' drizzle/meta/_journal.json
rm -f /tmp/clean.db && SQLITE_PATH=/tmp/clean.db SQLITE_URI= SQLITE_AUTH_TOKEN= bunx --bun drizzle-kit migrate 2>&1 | tail -3
sqlite3 /tmp/clean.db "PRAGMA table_info(wordpress_security_event);" | wc -l
sqlite3 /tmp/clean.db "PRAGMA table_info(wordpress_site);" | grep -c sentinel_
bun run db:migrate
```
Expected: cele două numere egale (577); 14 coloane; 4; migrarea pe Turso fără eroare. Abia acum e sigur `select()` pe `wordpress_site` cu schema nouă.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/db/schema.ts drizzle/0569_wordpress_security_event.sql drizzle/0570_wordpress_security_event_tenant_occurred_idx.sql drizzle/0571_wordpress_security_event_site_event_occurred_idx.sql drizzle/0572_wordpress_security_event_site_uid_uidx.sql drizzle/0573_wordpress_site_sentinel_last_pull_at.sql drizzle/0574_wordpress_site_sentinel_last_pull_status.sql drizzle/0575_wordpress_site_sentinel_failures.sql drizzle/0576_wordpress_site_sentinel_state.sql drizzle/meta/_journal.json
git commit -m "feat(sentinel): tabel wordpress_security_event + starea Sentinel pe wordpress_site"
```

---

### Task 5: Tipuri, etichete, `WpClient.sentinel()`

**Files:**
- Create: `src/lib/server/wordpress/sentinel/types.ts`
- Create: `src/lib/logic/wordpress-sentinel-labels.ts` (sub `logic/`, ca pagina să-l poată importa — `$lib/server/*` e refuzat în client)
- Modify: `src/lib/server/wordpress/client.ts` (tipuri lângă `WpHealth`; metoda după `health()`)
- Modify: `src/lib/server/wordpress/sync.ts:20` (`export async function loadSiteAndClient`)

- [ ] **Step 1: `types.ts`**

```ts
/** Ce trimite conectorul ≥ 0.9.0 pe `POST /sentinel` și ce ține CRM-ul minte între citiri. */

export type SentinelSev = 'INFO' | 'WARN' | 'ALERT';
export type SentinelLevel = 'critical' | 'important' | 'normal';

export interface SentinelEvent {
	id: string;
	t: string; // ISO 8601, UTC
	sev: SentinelSev;
	ev: string;
	user: string; // '-' când nu e logat
	uid: number;
	ip: string;
	/** REMOTE_ADDR brut (conector ≥ 0.9.0); lipsește pe liniile mu-plugin-ului */
	ip_remote?: string;
	uri: string;
	ua: string;
	date: Record<string, unknown>;
}

export interface SentinelScanFile {
	path: string;
	size: number;
	mtime: string;
	sha1: string;
}

export interface SentinelScan {
	files: SentinelScanFile[];
	scannedFiles: number;
	truncated: boolean;
	durationMs: number;
}

export interface WpSentinelResponse {
	sentinel: { version: string; legacyMuPlugin: boolean; logBytes: number };
	events: SentinelEvent[];
	hasMore: boolean;
	scan: SentinelScan | null; // doar pe prima pagină
	errors: string[];
}

/** Memoria lungă a unui site (wordpress_site.sentinel_state). */
export interface SentinelState {
	baselineDone: boolean;
	/** path → sha1 al fișierelor PHP din uploads cunoscute */
	uploadsBaseline: Record<string, string>;
	/** user → ip → ultima logare de admin (ISO); intrările > 90 zile se curăță */
	adminIps: Record<string, Record<string, string>>;
	lastError: string | null;
}

export function emptyState(): SentinelState {
	return { baselineDone: false, uploadsBaseline: {}, adminIps: {}, lastError: null };
}

export function parseState(raw: string | null | undefined): SentinelState {
	if (!raw) return emptyState();
	try {
		const p = JSON.parse(raw) as Partial<SentinelState>;
		return {
			baselineDone: p.baselineDone === true,
			uploadsBaseline: p.uploadsBaseline ?? {},
			adminIps: p.adminIps ?? {},
			lastError: p.lastError ?? null
		};
	} catch {
		return emptyState();
	}
}

export type FindingKind =
	| 'admin_role'
	| 'admin_registered'
	| 'option_changed'
	| 'mass_insert'
	| 'php_in_uploads'
	| 'connector_deactivated'
	| 'legacy_alert'
	| 'admin_new_ip'
	| 'plugin_change'
	| 'theme_switched'
	| 'user_registered'
	| 'admin_profile'
	| 'brute_force'
	| 'pull_failed';

export interface Finding {
	level: Exclude<SentinelLevel, 'normal'>;
	kind: FindingKind;
	/** o linie, fără prefixul site-ului — digest-ul îl pune */
	text: string;
}
```

- [ ] **Step 2: `src/lib/logic/wordpress-sentinel-labels.ts`**

```ts
import type { SentinelLevel } from '$lib/server/wordpress/sentinel/types'; // doar tip: dispare la build

export const EVENT_LABELS: Record<string, string> = {
	post_created: 'Articol creat',
	user_registered: 'Utilizator nou',
	role_changed: 'Rol schimbat',
	profile_update: 'Profil modificat',
	user_deleted: 'Utilizator șters',
	login_ok: 'Logare reușită',
	login_esuat: 'Logare eșuată',
	plugin_activated: 'Plugin activat',
	plugin_deactivated: 'Plugin dezactivat',
	theme_switched: 'Temă schimbată',
	upgrader: 'Update instalat',
	option_changed: 'Opțiune critică schimbată',
	php_in_uploads: 'PHP în uploads',
	scan_uploads_curat: 'Scanare uploads curată',
	scan_eroare: 'Eroare la scanare',
	// mu-plugin 1.1, neportate — doar etichete
	upload: 'Fișier urcat',
	upload_blocat: 'Upload blocat',
	fisiere_baseline: 'Baseline fișiere',
	fisiere_ok: 'Fișiere neschimbate',
	fisiere_modificate: 'Fișiere modificate pe disc',
	fisiere_eroare: 'Eroare verificare fișiere'
};

export function eventLabel(ev: string): string {
	return EVENT_LABELS[ev] ?? ev;
}

export const LEVEL_LABELS: Record<SentinelLevel, string> = {
	critical: 'Critic',
	important: 'Important',
	normal: 'Normal'
};

export const LEVEL_EMOJI: Record<SentinelLevel, string> = {
	critical: '🔴',
	important: '🟠',
	normal: '⚪'
};
```

- [ ] **Step 3: `client.ts` — tip + metodă**

Lângă importuri:
```ts
import type { WpSentinelResponse } from './sentinel/types';
export type { WpSentinelResponse };
```
După `health()`:
```ts
	/** `POST /sentinel` (connector ≥ 0.9.0): evenimente cu t ≥ since, paginate cu skip; scanarea uploads doar la skip = 0. */
	async sentinel(
		args: { since: string | null; skip: number },
		opts?: { timeoutMs?: number; siteId?: string }
	): Promise<WpSentinelResponse> {
		return this.request<WpSentinelResponse>({
			method: 'POST',
			path: '/sentinel',
			body: args,
			timeoutMs: opts?.timeoutMs ?? 45_000, // scanarea singură are buget 20 s
			siteId: opts?.siteId
		});
	}
```

- [ ] **Step 4: `sync.ts` — exportă `loadSiteAndClient`** (schimbă `async function loadSiteAndClient` în `export async function loadSiteAndClient`).

- [ ] **Step 5: Type-check rapid**

```bash
bunx --bun tsc --noEmit -p tsconfig.json 2>&1 | grep -E "sentinel|client.ts|sync.ts" | head
```
Expected: fără linii.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/wordpress/sentinel/types.ts src/lib/logic/wordpress-sentinel-labels.ts src/lib/server/wordpress/client.ts src/lib/server/wordpress/sync.ts
git commit -m "feat(sentinel): tipuri, etichete RO și WpClient.sentinel()"
```

---

### Task 6: `rules.ts` — clasificare și findings (TDD pe fixture-uri)

**Files:**
- Create: `src/lib/server/wordpress/sentinel/rules.ts`
- Create: `src/lib/server/wordpress/sentinel/__tests__/rules.test.ts`
- Create: `src/lib/server/wordpress/sentinel/__tests__/fixtures/load.ts`

- [ ] **Step 1: Loader-ul de fixture-uri (`fixtures/load.ts`)** — simulează ce face conectorul cu liniile fără `id`.

```ts
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { SentinelEvent } from '../../types';

export function loadFixture(name: 'areni' | 'nevada'): SentinelEvent[] {
	const raw = readFileSync(new URL(`./${name}.ndjson`, import.meta.url), 'utf8');
	const seen = new Map<string, number>();
	return raw
		.split('\n')
		.filter((l) => l.trim())
		.map((line) => {
			const ev = JSON.parse(line) as SentinelEvent;
			if (!ev.id) {
				const h = createHash('sha1').update(line).digest('hex');
				const n = (seen.get(h) ?? 0) + 1;
				seen.set(h, n);
				ev.id = `${h}-${n}`;
			}
			return ev;
		})
		.sort((a, b) => a.t.localeCompare(b.t));
}

export function ev(partial: Partial<SentinelEvent> & { ev: string; t: string }): SentinelEvent {
	return {
		id: partial.id ?? `${partial.ev}-${partial.t}-${Math.random().toString(36).slice(2, 8)}`,
		sev: 'INFO',
		user: '-',
		uid: 0,
		ip: '10.9.9.9',
		uri: '/wp-login.php',
		ua: 'test',
		date: {},
		...partial
	};
}
```

- [ ] **Step 2: Testele (`rules.test.ts`)** — scrie-le ÎNAINTE de `rules.ts`.

```ts
import { describe, test, expect } from 'bun:test';
import { detectFindings, classify, MASS_INSERT_THRESHOLD } from '../rules';
import { emptyState } from '../types';
import { loadFixture, ev } from './fixtures/load';

const NOW = new Date('2026-09-28T09:00:00Z');
const site = { id: 's1', name: 'test' };
const run = (events: ReturnType<typeof loadFixture>, state = emptyState(), scan = null) =>
	detectFindings({ site, events, scan, state, now: NOW });

describe('fixture nevada', () => {
	test('prima citire: exact un finding 🟠 brute-force, cu numărul de IP-uri', () => {
		const { findings } = run(loadFixture('nevada'));
		const bf = findings.filter((f) => f.kind === 'brute_force');
		expect(bf).toHaveLength(1);
		expect(bf[0].level).toBe('important');
		expect(bf[0].text).toMatch(/3 IP-uri/); // ajustează la cifrele reale din Task 1
		expect(findings.filter((f) => f.kind === 'admin_new_ip')).toHaveLength(0); // baseline
	});
	test('a doua citire cu aceleași evenimente: IP-urile de admin sunt cunoscute', () => {
		const events = loadFixture('nevada');
		const { nextState } = run(events);
		expect(nextState.baselineDone).toBe(true);
		const { findings } = run(events, nextState);
		expect(findings.filter((f) => f.kind === 'admin_new_ip')).toHaveLength(0);
	});
});

describe('fixture areni', () => {
	test('fără findings, evenimentele Jetpack/traduceri/comenzi sunt ⚪', () => {
		const events = loadFixture('areni');
		const { findings, levels } = run(events);
		expect(findings).toHaveLength(0);
		for (const e of events.filter((e) => e.ev === 'upgrader' || e.ev === 'post_created')) {
			expect(levels.get(e.id)).toBe('normal');
		}
	});
});

describe('reguli sintetice', () => {
	const knownState = () => ({ ...emptyState(), baselineDone: true });

	test('role_changed → administrator = critic', () => {
		const { findings } = run([ev({ ev: 'role_changed', t: '2026-09-28T08:00:00Z', date: { id: 7, rol_nou: 'administrator', roluri_vechi: ['editor'] } })], knownState());
		expect(findings).toEqual([expect.objectContaining({ level: 'critical', kind: 'admin_role' })]);
	});

	test('user_registered admin + role_changed același user = un singur finding', () => {
		const { findings } = run(
			[
				ev({ ev: 'user_registered', t: '2026-09-28T08:00:00Z', date: { id: 7, login: 'x', roluri: ['administrator'] } }),
				ev({ ev: 'role_changed', t: '2026-09-28T08:00:01Z', date: { id: 7, rol_nou: 'administrator', roluri_vechi: [] } })
			],
			knownState()
		);
		expect(findings.filter((f) => f.level === 'critical')).toHaveLength(1);
	});

	test('login admin de pe IP nou = important; IP OTS = normal; după citire IP-ul e cunoscut', () => {
		const admin = (ip: string, t: string, ip_remote?: string) => ev({ ev: 'login_ok', t, ip, ip_remote, user: 'adm', date: { login: 'adm', roluri: ['administrator'] } });
		const { findings, nextState, levels } = run(
			[
				admin('5.6.7.8', '2026-09-28T08:00:00Z', '5.6.7.8'),
				admin('5.6.7.8', '2026-09-28T08:30:00Z', '5.6.7.8'),
				admin('82.77.19.195', '2026-09-28T08:40:00Z', '82.77.19.195'), // OTS real
				admin('82.77.19.195', '2026-09-28T08:41:00Z') // linie veche, fără ip_remote
			],
			knownState()
		);
		expect(findings.filter((f) => f.kind === 'admin_new_ip')).toHaveLength(1); // un finding per (user, ip)
		expect(nextState.adminIps.adm['5.6.7.8']).toBe('2026-09-28T08:30:00Z');
		expect(nextState.adminIps.adm['82.77.19.195']).toBeUndefined();
		expect([...levels.values()].filter((l) => l === 'important')).toHaveLength(2);
	});

	test('X-Forwarded-For falsificat cu IP OTS de pe un remote străin = important, cu remote-ul în text', () => {
		const spoof = ev({ ev: 'login_ok', t: '2026-09-28T08:00:00Z', ip: '82.77.19.195', ip_remote: '203.0.113.9', user: 'adm', date: { login: 'adm', roluri: ['administrator'] } });
		const { findings } = run([spoof], knownState());
		expect(findings).toEqual([expect.objectContaining({ kind: 'admin_new_ip', text: expect.stringContaining('remote 203.0.113.9') })]);
	});

	test('IP-urile de admin mai vechi de 90 zile se uită', () => {
		const state = { ...knownState(), adminIps: { adm: { '1.1.1.1': '2026-05-01T00:00:00Z', '2.2.2.2': '2026-09-01T00:00:00Z' } } };
		const { nextState } = run([], state);
		expect(nextState.adminIps.adm).toEqual({ '2.2.2.2': '2026-09-01T00:00:00Z' });
	});

	test('brute-force: ≥3 eșecuri cu exista:true pe același user în 24h; useri inexistenți nu contează', () => {
		const fail = (login: string, ip: string, exista: boolean, t: string) => ev({ ev: 'login_esuat', t, ip, date: { login, exista } });
		const { findings } = run(
			[
				fail('adm', '1.1.1.1', true, '2026-09-27T20:00:00Z'),
				fail('adm', '2.2.2.2', true, '2026-09-27T21:00:00Z'),
				fail('adm', '2.2.2.2', true, '2026-09-27T22:00:00Z'),
				fail('ghost', '3.3.3.3', false, '2026-09-27T22:00:00Z'),
				fail('ghost', '3.3.3.3', false, '2026-09-27T22:01:00Z'),
				fail('ghost', '3.3.3.3', false, '2026-09-27T22:02:00Z'),
				fail('adm', '4.4.4.4', true, '2026-09-20T22:02:00Z') // în afara ferestrei
			],
			knownState()
		);
		expect(findings).toEqual([expect.objectContaining({ kind: 'brute_force', level: 'important', text: expect.stringMatching(/adm.*2 IP-uri/) })]);
	});

	test('scanare: prima citire = baseline fără finding; fișier nou sau sha1 schimbat = critic', () => {
		const scan = (files: Array<[string, string]>) => ({ files: files.map(([path, sha1]) => ({ path, sha1, size: 1, mtime: '2026-09-28T00:00:00Z' })), scannedFiles: 10, truncated: false, durationMs: 1 });
		const first = detectFindings({ site, events: [], scan: scan([['/sucuri/x.php', 'a']]), state: emptyState(), now: NOW });
		expect(first.findings).toHaveLength(0);
		expect(first.nextState.uploadsBaseline).toEqual({ '/sucuri/x.php': 'a' });
		const second = detectFindings({ site, events: [], scan: scan([['/sucuri/x.php', 'b'], ['/2026/09/shell.php', 'c']]), state: first.nextState, now: NOW });
		expect(second.findings.map((f) => f.kind)).toEqual(['php_in_uploads', 'php_in_uploads']);
		expect(second.findings.every((f) => f.level === 'critical')).toBe(true);
	});

	test('post_created peste prag = critic, sub prag = normal', () => {
		const post = (n: number) => ev({ ev: 'post_created', t: '2026-09-28T08:00:00Z', date: { nr_in_request: n } });
		expect(classify(post(MASS_INSERT_THRESHOLD), emptyState())).toBe('normal');
		expect(classify(post(MASS_INSERT_THRESHOLD + 1), emptyState())).toBe('critical');
	});

	test('dezactivarea conectorului = critic, alt plugin = important', () => {
		expect(classify(ev({ ev: 'plugin_deactivated', t: '2026-09-28T08:00:00Z', date: { plugin: 'ots-wp-connector/ots-connector.php' } }), emptyState())).toBe('critical');
		expect(classify(ev({ ev: 'plugin_deactivated', t: '2026-09-28T08:00:00Z', date: { plugin: 'akismet/akismet.php' } }), emptyState())).toBe('important');
	});

	test('eveniment necunoscut = normal; evenimente mu-plugin 1.1 grave = critic', () => {
		expect(classify(ev({ ev: 'ceva_nou', t: '2026-09-28T08:00:00Z' }), emptyState())).toBe('normal');
		expect(classify(ev({ ev: 'fisiere_modificate', t: '2026-09-28T08:00:00Z' }), emptyState())).toBe('critical');
	});
});
```

- [ ] **Step 3: Rulează — trebuie să pice**

```bash
bun run test sentinel/__tests__/rules
```
Expected: FAIL (`Cannot find module '../rules'`).

- [ ] **Step 4: `rules.ts`**

```ts
/**
 * Regulile Sentinel — funcții pure, fără db. Trăiesc în CRM ca să se schimbe
 * fără release de plugin. `classify` dă nivelul unui eveniment izolat;
 * `detectFindings` uită-se la un lot întreg + starea site-ului și scoate
 * findings-urile pentru digest, plus starea următoare.
 */
import type { Finding, SentinelEvent, SentinelLevel, SentinelScan, SentinelState } from './types';

/** IP-urile biroului OTS — logările de admin de aici nu sunt niciodată „IP nou”. */
export const OTS_IPS = new Set(['82.77.19.195', '213.157.186.85']);
/** Site-ul marchează ALERT de la 6; un import CSV WooCommerce sau un meniu salvat trec de 5. */
export const MASS_INSERT_THRESHOLD = 20;
export const BRUTE_FORCE_MIN = 3;
export const BRUTE_FORCE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const ADMIN_IP_MEMORY_MS = 90 * 24 * 60 * 60 * 1000;
const CONNECTOR_PLUGIN_PREFIX = 'ots-wp-connector/';
const HARMLESS_ROLES = new Set(['customer', 'subscriber']);
/** Evenimente ale mu-plugin-ului 1.1 (neportate) care merită 🔴 dacă apar. */
const LEGACY_CRITICAL = new Set(['php_in_uploads', 'fisiere_modificate', 'upload_blocat']);

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);
const roles = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const isAdminRoles = (v: unknown) => roles(v).includes('administrator');
const login = (e: SentinelEvent) => str(e.date.login) || (e.user !== '-' ? e.user : '');
const PRIVATE_IP = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd)/i;
/**
 * `ip` vine din X-Forwarded-For, pe care oricine îl poate falsifica pe un site
 * fără proxy. Excludem IP-ul OTS doar dacă și `ip_remote` (REMOTE_ADDR) e OTS,
 * privat (proxy local) sau lipsește (linie veche de mu-plugin).
 */
const isOtsIp = (e: SentinelEvent) =>
	OTS_IPS.has(e.ip) && (e.ip_remote === undefined || e.ip_remote === '' || OTS_IPS.has(e.ip_remote) || PRIVATE_IP.test(e.ip_remote));

function isAdminProfile(e: SentinelEvent, state: SentinelState): boolean {
	if (Array.isArray(e.date.roluri)) return isAdminRoles(e.date.roluri);
	return login(e) in state.adminIps; // linie veche fără roluri: știm doar cine s-a logat ca admin
}

export function classify(e: SentinelEvent, state: SentinelState): SentinelLevel {
	switch (e.ev) {
		case 'role_changed':
			return str(e.date.rol_nou) === 'administrator' ? 'critical' : 'normal';
		case 'user_registered':
			if (isAdminRoles(e.date.roluri)) return 'critical';
			return roles(e.date.roluri).every((r) => HARMLESS_ROLES.has(r)) ? 'normal' : 'important';
		case 'option_changed':
			return 'critical';
		case 'post_created':
			return num(e.date.nr_in_request) > MASS_INSERT_THRESHOLD ? 'critical' : 'normal';
		case 'plugin_deactivated':
			return str(e.date.plugin).startsWith(CONNECTOR_PLUGIN_PREFIX) ? 'critical' : 'important';
		case 'plugin_activated':
		case 'theme_switched':
			return 'important';
		case 'profile_update':
			return isAdminProfile(e, state) ? 'important' : 'normal';
		case 'login_ok': {
			if (!isAdminRoles(e.date.roluri) || isOtsIp(e)) return 'normal';
			return state.adminIps[login(e)]?.[e.ip] ? 'normal' : 'important';
		}
		default:
			return LEGACY_CRITICAL.has(e.ev) ? 'critical' : 'normal';
	}
}

export interface DetectInput {
	site: { id: string; name: string };
	events: SentinelEvent[];
	scan: SentinelScan | null;
	state: SentinelState; // de DINAINTE de citire
	now: Date;
}

export interface DetectOutput {
	findings: Finding[];
	nextState: SentinelState;
	/** nivelul fiecărui eveniment (id → level), pentru insert */
	levels: Map<string, SentinelLevel>;
}

export function detectFindings({ events, scan, state, now }: DetectInput): DetectOutput {
	const findings: Finding[] = [];
	const levels = new Map<string, SentinelLevel>();
	const nextState: SentinelState = {
		baselineDone: state.baselineDone,
		uploadsBaseline: { ...state.uploadsBaseline },
		adminIps: Object.fromEntries(Object.entries(state.adminIps).map(([u, ips]) => [u, { ...ips }])),
		lastError: null
	};
	const firstPull = !state.baselineDone;
	const seenNewIp = new Set<string>(); // `${user}|${ip}`
	const adminUsersFlagged = new Set<string>(); // id-ul userului, pentru registered+role_changed
	const failures = new Map<string, SentinelEvent[]>(); // login → eșecuri cu exista:true în 24h

	for (const e of events) {
		const level = classify(e, state);
		levels.set(e.id, level);

		if (e.ev === 'login_ok' && isAdminRoles(e.date.roluri) && !isOtsIp(e) && e.ip) {
			const u = login(e);
			const key = `${u}|${e.ip}`;
			if (level === 'important' && !firstPull && !seenNewIp.has(key)) {
				seenNewIp.add(key);
				const remote = e.ip_remote && e.ip_remote !== e.ip && !PRIVATE_IP.test(e.ip_remote) ? ` (remote ${e.ip_remote})` : '';
				findings.push({ level: 'important', kind: 'admin_new_ip', text: `logare admin ${u} de pe IP nou ${e.ip}${remote}` });
			}
			nextState.adminIps[u] = { ...(nextState.adminIps[u] ?? {}), [e.ip]: e.t };
			continue;
		}
		if (e.ev === 'login_esuat') {
			if (e.date.exista === true && now.getTime() - Date.parse(e.t) <= BRUTE_FORCE_WINDOW_MS) {
				const u = login(e);
				failures.set(u, [...(failures.get(u) ?? []), e]);
			}
			continue;
		}
		if (level === 'normal') continue;

		const uid = String(e.date.id ?? '');
		switch (e.ev) {
			case 'role_changed':
				if (uid && adminUsersFlagged.has(uid)) break;
				adminUsersFlagged.add(uid);
				findings.push({ level: 'critical', kind: 'admin_role', text: `userul #${uid} a devenit administrator` });
				break;
			case 'user_registered':
				if (level === 'critical') {
					if (uid && adminUsersFlagged.has(uid)) break;
					adminUsersFlagged.add(uid);
					findings.push({ level: 'critical', kind: 'admin_registered', text: `administrator nou ${login(e)} (${str(e.date.email)})` });
				} else {
					findings.push({ level: 'important', kind: 'user_registered', text: `utilizator nou ${login(e)} cu rol ${roles(e.date.roluri).join(', ') || '?'}` });
				}
				break;
			case 'option_changed':
				findings.push({ level: 'critical', kind: 'option_changed', text: `opțiunea ${str(e.date.option)} schimbată în „${str(e.date.nou) || String(e.date.nou)}”` });
				break;
			case 'post_created':
				findings.push({ level: 'critical', kind: 'mass_insert', text: `${num(e.date.nr_in_request)} articole într-o singură cerere (${str((e.date.sursa as Record<string, unknown> | undefined)?.context)})` });
				break;
			case 'plugin_deactivated':
				findings.push(
					level === 'critical'
						? { level, kind: 'connector_deactivated', text: 'conectorul OTS a fost dezactivat' }
						: { level, kind: 'plugin_change', text: `plugin dezactivat: ${str(e.date.plugin)} (${e.user})` }
				);
				break;
			case 'plugin_activated':
				findings.push({ level: 'important', kind: 'plugin_change', text: `plugin activat: ${str(e.date.plugin)} (${e.user})` });
				break;
			case 'theme_switched':
				findings.push({ level: 'important', kind: 'theme_switched', text: `temă schimbată: ${str(e.date.theme)} (${e.user})` });
				break;
			case 'profile_update':
				findings.push({ level: 'important', kind: 'admin_profile', text: `profil admin ${login(e)} modificat: ${Object.keys((e.date.modificari as object) ?? {}).join(', ')}` });
				break;
			default:
				if (level === 'critical') findings.push({ level: 'critical', kind: 'legacy_alert', text: `${e.ev} raportat de mu-plugin` });
		}
	}

	// un singur finding de tip mass_insert per citire e suficient
	const mass = findings.filter((f) => f.kind === 'mass_insert');
	if (mass.length > 1) {
		const keep = mass[mass.length - 1];
		for (const f of mass) if (f !== keep) findings.splice(findings.indexOf(f), 1);
	}

	for (const [u, evs] of failures) {
		if (evs.length < BRUTE_FORCE_MIN) continue;
		const ips = new Set(evs.map((e) => e.ip).filter(Boolean)).size;
		findings.push({ level: 'important', kind: 'brute_force', text: `${evs.length} logări eșuate pe ${u} (${ips} IP-uri)` });
	}

	// uită IP-urile de admin mai vechi de 90 de zile
	for (const [u, ips] of Object.entries(nextState.adminIps)) {
		for (const [ip, last] of Object.entries(ips)) {
			if (now.getTime() - Date.parse(last) > ADMIN_IP_MEMORY_MS) delete ips[ip];
		}
		if (Object.keys(ips).length === 0) delete nextState.adminIps[u];
	}

	if (scan) {
		if (!firstPull) {
			for (const f of scan.files) {
				const known = state.uploadsBaseline[f.path];
				if (known === f.sha1) continue;
				findings.push({ level: 'critical', kind: 'php_in_uploads', text: known ? `PHP modificat în uploads ${f.path}` : `PHP nou în uploads ${f.path}` });
			}
		}
		// scanare trunchiată: păstrăm ce știam, adăugăm ce am văzut
		nextState.uploadsBaseline = scan.truncated
			? { ...state.uploadsBaseline, ...Object.fromEntries(scan.files.map((f) => [f.path, f.sha1])) }
			: Object.fromEntries(scan.files.map((f) => [f.path, f.sha1]));
	}
	nextState.baselineDone = true;

	return { findings, nextState, levels };
}
```

- [ ] **Step 5: Rulează — trebuie să treacă**

```bash
bun run test sentinel/__tests__/rules
```
Expected: `pass`, 0 fail. Dacă fixture-ul nevada nu dă exact un `brute_force`, cifra reală din Task 1 Step 3 decide: ajustezi aserțiunea, NU regula (regula e cerința; datele sunt datele). Dacă areni dă findings, citește-le — pot fi reale (spec-ul presupune „fără”, verifică cu userul).

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/wordpress/sentinel/rules.ts src/lib/server/wordpress/sentinel/__tests__/rules.test.ts src/lib/server/wordpress/sentinel/__tests__/fixtures/load.ts
git commit -m "feat(sentinel): reguli de clasificare + findings, testate pe jurnalele areni/nevada"
```

---

### Task 7: `digest.ts` — mesajul Telegram (TDD)

**Files:**
- Create: `src/lib/server/wordpress/sentinel/digest.ts`
- Create: `src/lib/server/wordpress/sentinel/__tests__/digest.test.ts`

- [ ] **Step 1: Testele**

```ts
import { describe, test, expect } from 'bun:test';
import { buildDigest, TELEGRAM_MAX } from '../digest';

const base = { date: new Date('2026-09-29T06:00:00Z'), url: 'https://clients.onetopsolution.ro/ots/wordpress/security' };

describe('buildDigest', () => {
	test('zi liniștită = o singură linie cu numărul de site-uri', () => {
		const [msg, ...rest] = buildDigest({ ...base, sites: [], quietSites: 16 });
		expect(rest).toHaveLength(0);
		expect(msg).toBe('🛡 Sentinel · 29 sept. — ✅ 16 site-uri liniștite');
	});

	test('critice înainte de importante, apoi liniștite și link', () => {
		const [msg] = buildDigest({
			...base,
			quietSites: 14,
			sites: [
				{ name: 'areni', findings: [{ level: 'important', kind: 'admin_new_ip', text: 'logare admin de pe IP nou 5.6.7.8' }] },
				{ name: 'nevada', findings: [{ level: 'critical', kind: 'php_in_uploads', text: 'PHP nou în uploads /2026/09/x.php' }, { level: 'important', kind: 'brute_force', text: '3 logări eșuate pe adm (3 IP-uri)' }] }
			]
		});
		expect(msg.split('\n')).toEqual([
			'🛡 Sentinel · 29 sept.',
			'🔴 nevada: PHP nou în uploads /2026/09/x.php',
			'🟠 nevada: 3 logări eșuate pe adm (3 IP-uri)',
			'🟠 areni: logare admin de pe IP nou 5.6.7.8',
			'✅ 14 site-uri liniștite',
			'→ https://clients.onetopsolution.ro/ots/wordpress/security'
		]);
	});

	test('peste 4096: împarte pe site-uri întregi, antet repetat cu (n/m)', () => {
		const sites = Array.from({ length: 60 }, (_, i) => ({
			name: `site${i}`,
			findings: Array.from({ length: 3 }, (_, j) => ({ level: 'important' as const, kind: 'plugin_change' as const, text: `plugin activat: ${'x'.repeat(40)}-${j}` }))
		}));
		const msgs = buildDigest({ ...base, sites, quietSites: 0 });
		expect(msgs.length).toBeGreaterThan(1);
		for (const m of msgs) expect(m.length).toBeLessThanOrEqual(TELEGRAM_MAX);
		expect(msgs[0]).toMatch(/^🛡 Sentinel · 29 sept\. \(1\/\d+\)\n/);
		// liniile unui site nu se rup între mesaje
		for (const s of sites) {
			const holder = msgs.filter((m) => m.includes(`🟠 ${s.name}:`));
			expect(holder).toHaveLength(1);
		}
	});
});
```

- [ ] **Step 2: Rulează — FAIL** (`bun run test sentinel/__tests__/digest`).

- [ ] **Step 3: `digest.ts`**

```ts
/** Textul Telegram al zilei — pur, testabil. */
import type { Finding } from './types';
import { LEVEL_EMOJI } from '$lib/logic/wordpress-sentinel-labels';

export const TELEGRAM_MAX = 4096;

export interface DigestSite {
	name: string;
	findings: Finding[];
}

export interface DigestInput {
	date: Date;
	sites: DigestSite[]; // doar site-urile cu findings
	quietSites: number;
	url: string;
}

const dayLabel = new Intl.DateTimeFormat('ro-RO', { day: 'numeric', month: 'short', timeZone: 'Europe/Bucharest' });

/** Blocul unui site: 🔴 întâi, apoi 🟠. Site-urile cu critice urcă primele. */
function siteBlocks(sites: DigestSite[]): string[][] {
	const rank = (s: DigestSite) => (s.findings.some((f) => f.level === 'critical') ? 0 : 1);
	return [...sites]
		.filter((s) => s.findings.length > 0)
		.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
		.map((s) =>
			[...s.findings]
				.sort((a, b) => (a.level === b.level ? 0 : a.level === 'critical' ? -1 : 1))
				.map((f) => `${LEVEL_EMOJI[f.level]} ${s.name}: ${f.text}`)
		);
}

export function buildDigest({ date, sites, quietSites, url }: DigestInput): string[] {
	const header = `🛡 Sentinel · ${dayLabel.format(date)}`;
	const blocks = siteBlocks(sites);
	if (blocks.length === 0) return [`${header} — ✅ ${quietSites} site-uri liniștite`];

	const footer = [`✅ ${quietSites} site-uri liniștite`, `→ ${url}`];
	const single = [header, ...blocks.flat(), ...footer].join('\n');
	if (single.length <= TELEGRAM_MAX) return [single];

	// împarte pe blocuri întregi; antetul se numerotează după ce știm câte mesaje ies
	const pages: string[][] = [[]];
	const reserve = header.length + ' (99/99)'.length + 1;
	for (const block of blocks) {
		const cur = pages[pages.length - 1];
		const len = (lines: string[]) => lines.join('\n').length;
		if (cur.length > 0 && reserve + len([...cur, ...block]) > TELEGRAM_MAX) pages.push([...block]);
		else cur.push(...block);
	}
	const last = pages[pages.length - 1];
	if (reserve + [...last, ...footer].join('\n').length > TELEGRAM_MAX) pages.push([]);
	pages[pages.length - 1].push(...footer);
	return pages.map((lines, i) => [`${header} (${i + 1}/${pages.length})`, ...lines].join('\n'));
}
```

- [ ] **Step 4: Rulează — PASS** (`bun run test sentinel/__tests__/digest`). Dacă `dayLabel` produce „29 sept.” cu alt spațiu/punct pe Bun-ul instalat, aliniază aserțiunea la output-ul real al `Intl` (nu hardcoda formatul în cod).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/wordpress/sentinel/digest.ts src/lib/server/wordpress/sentinel/__tests__/digest.test.ts
git commit -m "feat(sentinel): digest Telegram cu împărțire pe site-uri"
```

---

### Task 8: `pull.ts` — citirea unui site (TDD cu client și db mock-uite)

**Files:**
- Create: `src/lib/server/wordpress/sentinel/pull.ts`
- Create: `src/lib/server/wordpress/sentinel/__tests__/pull.test.ts`

- [ ] **Step 1: Testele** (db mock ca în `wordpress/__tests__/plugin-library.test.ts`; `mock.module` e global → un proces per fișier, deci `bun run test`).

```ts
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const inserted: Record<string, unknown>[][] = [];
const updated: Array<{ set: Record<string, unknown> }> = [];
let siteRow: Record<string, unknown> = {};
let pages: Array<Record<string, unknown>> = [];
let calls: Array<{ since: string | null; skip: number }> = [];

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/logger', () => ({ logInfo: () => {}, logWarning: () => {}, logError: () => {}, serializeError: (e: unknown) => ({ message: e instanceof Error ? e.message : String(e), stack: '' }) }));
mock.module('$lib/server/db/schema', () => ({
	wordpressSite: { id: {}, tenantId: {}, sentinelLastPullAt: {}, sentinelLastPullStatus: {}, sentinelFailures: {}, sentinelState: {}, updatedAt: {} },
	wordpressSecurityEvent: { id: {}, siteId: {} }
}));
mock.module('$lib/server/db', () => ({
	db: {
		insert: () => ({ values: (rows: Record<string, unknown>[]) => ({ onConflictDoNothing: async () => { inserted.push(rows); } }) }),
		update: () => ({ set: (s: Record<string, unknown>) => ({ where: async () => { updated.push({ set: s }); } }) })
	}
}));
mock.module('../../sync', () => ({
	loadSiteAndClient: async () => ({
		site: siteRow,
		client: { sentinel: async (args: { since: string | null; skip: number }) => { calls.push(args); return pages.shift(); } }
	})
}));
mock.module('../../connector-release', () => ({
	compareConnectorVersions: (a: string, b: string) => { const pa = a.split('.').map(Number), pb = b.split('.').map(Number); for (let i = 0; i < 3; i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d) return d < 0 ? -1 : 1; } return 0; }
}));

const { pullSite, supportsSentinel } = await import('../pull');

const evt = (id: string, t: string) => ({ id, t, sev: 'INFO', ev: 'login_esuat', user: '-', uid: 0, ip: '1.1.1.1', uri: '/', ua: '', date: { login: 'x', exista: false } });
const page = (events: unknown[], hasMore = false, scan: unknown = { files: [], scannedFiles: 0, truncated: false, durationMs: 1 }) => ({ sentinel: { version: '0.9.0', legacyMuPlugin: false, logBytes: 10 }, events, hasMore, scan, errors: [] });

beforeEach(() => {
	inserted.length = 0; updated.length = 0; calls = []; pages = [];
	siteRow = { id: 's1', tenantId: 't1', name: 'nevada', siteUrl: 'https://x.ro', connectorVersion: '0.9.0', sentinelLastPullAt: null, sentinelFailures: 0, sentinelState: null };
});

describe('supportsSentinel', () => {
	test('doar ≥ 0.9.0', () => {
		expect(supportsSentinel('0.9.0')).toBe(true);
		expect(supportsSentinel('0.8.5')).toBe(false);
		expect(supportsSentinel(null)).toBe(false);
	});
});

describe('pullSite', () => {
	test('conector vechi → unsupported, fără cerere', async () => {
		siteRow.connectorVersion = '0.8.5';
		const r = await pullSite('s1');
		expect(r.status).toBe('unsupported');
		expect(calls).toHaveLength(0);
		expect(updated[0].set.sentinelLastPullStatus).toBe('unsupported');
	});

	test('prima citire: fără since, paginează cu skip, inserează cu ignore, baseline fără findings', async () => {
		pages = [page([evt('a', '2026-09-27T10:00:00Z'), evt('b', '2026-09-27T11:00:00Z')], true), page([evt('c', '2026-09-27T12:00:00Z')], false, null)];
		const r = await pullSite('s1');
		expect(calls).toEqual([{ since: null, skip: 0 }, { since: null, skip: 2 }]);
		expect(inserted.flat()).toHaveLength(3);
		expect(r.status).toBe('ok');
		expect(r.findings).toHaveLength(0);
		const set = updated[0].set;
		expect(set.sentinelFailures).toBe(0);
		expect(JSON.parse(set.sentinelState as string).baselineDone).toBe(true);
	});

	test('a doua citire: since = ultima citire − 1h', async () => {
		siteRow.sentinelLastPullAt = new Date('2026-09-28T06:00:00Z');
		siteRow.sentinelState = JSON.stringify({ baselineDone: true, uploadsBaseline: {}, adminIps: {}, lastError: null });
		pages = [page([])];
		await pullSite('s1');
		expect(calls[0].since).toBe('2026-09-28T05:00:00.000Z');
	});

	test('mu-plugin prezent → status legacy', async () => {
		pages = [{ ...page([]), sentinel: { version: '0.9.0', legacyMuPlugin: true, logBytes: 0 } }];
		expect((await pullSite('s1')).status).toBe('legacy');
	});

	test('site-ul nu răspunde → error, failures++, starea rămâne', async () => {
		siteRow.sentinelFailures = 1;
		pages = []; // client.sentinel întoarce undefined → aruncă
		const r = await pullSite('s1');
		expect(r.status).toBe('error');
		expect(updated[0].set.sentinelFailures).toBe(2);
		expect(updated[0].set.sentinelLastPullStatus).toBe('error');
	});
});
```

- [ ] **Step 2: Rulează — FAIL** (`bun run test sentinel/__tests__/pull`).

- [ ] **Step 3: `pull.ts`**

```ts
/**
 * Citește jurnalul Sentinel al unui site prin conector, îl clasifică și îl
 * salvează. Folosit de jobul zilnic și de butonul „Citește acum”.
 * Nu trimite nimic pe Telegram — asta face jobul, o dată pe zi, pentru toate.
 */
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { loadSiteAndClient } from '../sync';
import { compareConnectorVersions } from '../connector-release';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';
import { detectFindings } from './rules';
import { parseState, type Finding, type SentinelEvent, type SentinelScan } from './types';

export const SENTINEL_MIN_CONNECTOR = '0.9.0';
/** Suprapunere cu citirea anterioară — dedupe pe (site_id, event_uid) o absoarbe. */
const OVERLAP_MS = 60 * 60 * 1000;
const MAX_PAGES = 20;
const INSERT_CHUNK = 100;

export type PullStatus = 'ok' | 'legacy' | 'unsupported' | 'error';

export interface PullResult {
	siteId: string;
	siteName: string;
	status: PullStatus;
	inserted: number;
	findings: Finding[];
	failures: number;
	error?: string;
	scan?: { files: number; scannedFiles: number; truncated: boolean };
}

function newId() {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

export function supportsSentinel(connectorVersion: string | null | undefined): boolean {
	return !!connectorVersion && compareConnectorVersions(connectorVersion, SENTINEL_MIN_CONNECTOR) >= 0;
}

export async function pullSite(siteId: string, now: Date = new Date()): Promise<PullResult> {
	const { site, client } = await loadSiteAndClient(siteId);
	const base = { siteId: site.id, siteName: site.name, inserted: 0, findings: [] as Finding[] };

	if (!supportsSentinel(site.connectorVersion)) {
		await db
			.update(table.wordpressSite)
			.set({ sentinelLastPullStatus: 'unsupported', updatedAt: now })
			.where(eq(table.wordpressSite.id, site.id));
		return { ...base, status: 'unsupported', failures: site.sentinelFailures };
	}

	const since = site.sentinelLastPullAt ? new Date(site.sentinelLastPullAt.getTime() - OVERLAP_MS).toISOString() : null;
	const state = parseState(site.sentinelState);

	try {
		const events: SentinelEvent[] = [];
		let scan: SentinelScan | null = null;
		let legacy = false;
		const errors: string[] = [];
		for (let pageNo = 0; pageNo < MAX_PAGES; pageNo++) {
			const resp = await client.sentinel({ since, skip: events.length }, { siteId: site.id });
			if (!resp || !Array.isArray(resp.events)) throw new Error('Răspuns Sentinel invalid');
			events.push(...resp.events);
			if (pageNo === 0) {
				scan = resp.scan;
				legacy = resp.sentinel.legacyMuPlugin;
			}
			errors.push(...(resp.errors ?? []));
			if (!resp.hasMore || resp.events.length === 0) break;
		}

		const { findings, nextState, levels } = detectFindings({ site: { id: site.id, name: site.name }, events, scan, state, now });

		for (let i = 0; i < events.length; i += INSERT_CHUNK) {
			const rows = events.slice(i, i + INSERT_CHUNK).map((e) => ({
				id: newId(),
				tenantId: site.tenantId,
				siteId: site.id,
				eventUid: e.id,
				occurredAt: new Date(e.t),
				sentinelSev: e.sev,
				level: levels.get(e.id) ?? 'normal',
				event: e.ev,
				username: e.user !== '-' ? e.user : (typeof e.date.login === 'string' ? e.date.login : null),
				ip: e.ip || null,
				uri: e.uri || null,
				userAgent: e.ua || null,
				data: JSON.stringify(e.date ?? {})
			}));
			await db.insert(table.wordpressSecurityEvent).values(rows).onConflictDoNothing();
		}

		const status: PullStatus = legacy ? 'legacy' : 'ok';
		nextState.lastError = errors.length ? errors.join('; ') : null;
		await db
			.update(table.wordpressSite)
			.set({ sentinelLastPullAt: now, sentinelLastPullStatus: status, sentinelFailures: 0, sentinelState: JSON.stringify(nextState), updatedAt: now })
			.where(eq(table.wordpressSite.id, site.id));

		logInfo('wordpress', `Sentinel ${site.siteUrl}: ${events.length} evenimente, ${findings.length} findings${legacy ? ' (mu-plugin vechi prezent)' : ''}`, {
			tenantId: site.tenantId,
			metadata: { siteId: site.id, events: events.length, findings: findings.map((f) => f.kind), scan: scan ? { files: scan.files.length, truncated: scan.truncated } : null, errors }
		});

		return {
			...base,
			status,
			inserted: events.length,
			findings,
			failures: 0,
			scan: scan ? { files: scan.files.length, scannedFiles: scan.scannedFiles, truncated: scan.truncated } : undefined
		};
	} catch (err) {
		const { message } = serializeError(err);
		const failures = (site.sentinelFailures ?? 0) + 1;
		await db
			.update(table.wordpressSite)
			.set({ sentinelLastPullStatus: 'error', sentinelFailures: failures, sentinelState: JSON.stringify({ ...state, lastError: message }), updatedAt: now })
			.where(eq(table.wordpressSite.id, site.id));
		logWarning('wordpress', `Sentinel FAILED ${site.siteUrl}: ${message}`, { tenantId: site.tenantId, metadata: { siteId: site.id, failures } });
		return { ...base, status: 'error', failures, error: message };
	}
}
```

- [ ] **Step 4: Rulează — PASS** (`bun run test sentinel/__tests__/pull`). Notă: `evenimentele` cu `e.t` în viitor sau invalid → `new Date(e.t)` invalid → insert-ul pică; dacă apare în fixture, sari rândul cu `Number.isNaN(d.getTime())`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/wordpress/sentinel/pull.ts src/lib/server/wordpress/sentinel/__tests__/pull.test.ts
git commit -m "feat(sentinel): pullSite — citire paginată, clasificare, salvare cu dedupe"
```

---

### Task 9: Jobul zilnic `wordpress_sentinel_daily` + Telegram

**Files:**
- Create: `src/lib/server/scheduler/tasks/wordpress-sentinel-daily.ts`
- Create: `src/lib/server/scheduler/tasks/__tests__/wordpress-sentinel-daily.test.ts`
- Modify: `src/lib/server/scheduler/index.ts` (import lângă linia 41; handler map după linia 213; `expectedJobIds` linia ~410; `schedulerQueue.add` după blocul de la ~1050; `JOB_LABELS` după linia 1317)

- [ ] **Step 1: Testul** (mock pe `pullSite`, `sendTelegramMessage`, `bun` redis, db).

```ts
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const sent: Array<{ userId: string; text: string }> = [];
const redisSets: string[][] = [];
let redisHas = false;
let pulls: Record<string, unknown>[] = [];
let sites: Record<string, unknown>[] = [];
let users: Record<string, unknown>[] = [];
const deletes: unknown[] = [];

mock.module('$env/dynamic/private', () => ({ env: { PUBLIC_APP_URL: 'https://crm.test' } }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/logger', () => ({ logInfo: () => {}, logWarning: () => {}, logError: () => {}, serializeError: (e: unknown) => ({ message: String(e), stack: '' }) }));
mock.module('$lib/server/db/schema', () => ({
	wordpressSite: { id: {}, tenantId: {}, name: {}, paused: {}, sentinelFailures: {} },
	wordpressSecurityEvent: { occurredAt: {} },
	tenantUser: { userId: {}, tenantId: {} },
	tenant: { id: {}, slug: {} }
}));
const q: unknown[][] = [];
mock.module('$lib/server/db', () => ({
	db: {
		select: () => { const c: Record<string, unknown> = { from: () => c, where: () => c, innerJoin: () => c, then: (r: (v: unknown[]) => unknown) => r(q.shift() ?? []) }; return c; },
		delete: () => ({ where: async (w: unknown) => { deletes.push(w); } })
	}
}));
mock.module('bun', () => ({ redis: { get: async () => (redisHas ? '1' : null), send: async (_c: string, a: string[]) => { redisSets.push(a); return 'OK'; } } }));
mock.module('$lib/server/telegram/sender', () => ({ sendTelegramMessage: async (a: { userId: string; text: string }) => { sent.push(a); return { ok: true }; } }));
mock.module('$lib/server/wordpress/sentinel/pull', () => ({ pullSite: async (id: string) => pulls.find((p) => p.siteId === id) }));

const { processWordpressSentinelDaily } = await import('../wordpress-sentinel-daily');

beforeEach(() => {
	sent.length = 0; redisSets.length = 0; deletes.length = 0; redisHas = false; q.length = 0;
	sites = [{ id: 's1', tenantId: 't1', name: 'nevada' }, { id: 's2', tenantId: 't1', name: 'areni' }, { id: 's3', tenantId: 't1', name: 'topderma' }];
	users = [{ userId: 'u1' }, { userId: 'u2' }];
	pulls = [
		{ siteId: 's1', siteName: 'nevada', status: 'ok', inserted: 5, failures: 0, findings: [{ level: 'important', kind: 'brute_force', text: '3 logări eșuate pe adm (3 IP-uri)' }] },
		{ siteId: 's2', siteName: 'areni', status: 'ok', inserted: 0, failures: 0, findings: [] },
		{ siteId: 's3', siteName: 'topderma', status: 'error', inserted: 0, failures: 1, findings: [], error: 'timeout' }
	];
});

function prime() {
	q.push([{ id: 't1', slug: 'ots' }]); // tenanți cu site-uri
	q.push(sites); // site-urile tenantului
	q.push(users); // utilizatorii
}

describe('processWordpressSentinelDaily', () => {
	test('un mesaj per user, cu findings + „nu răspunde (prima zi)” + liniștite', async () => {
		prime();
		const r = await processWordpressSentinelDaily({});
		expect(r.tenants).toBe(1);
		expect(sent).toHaveLength(2);
		expect(sent[0].text).toContain('🟠 nevada: 3 logări eșuate');
		expect(sent[0].text).toContain('🟠 topderma: nu răspunde (prima zi)');
		expect(sent[0].text).toContain('✅ 1 site-uri liniștite');
		expect(sent[0].text).toContain('https://crm.test/ots/wordpress/security');
		expect(redisSets[0].slice(0, 3)).toEqual([expect.stringMatching(/^sentinel:digest:t1:\d{4}-\d{2}-\d{2}$/), '1', 'NX']);
	});

	test('2 zile la rând fără răspuns = critic', async () => {
		pulls[2] = { ...pulls[2], failures: 2 };
		prime();
		await processWordpressSentinelDaily({});
		expect(sent[0].text).toContain('🔴 topderma: nu răspunde de 2 zile');
	});

	test('cheia Redis există → nu retrimite', async () => {
		redisHas = true;
		prime();
		await processWordpressSentinelDaily({});
		expect(sent).toHaveLength(0);
	});

	test('site-urile unsupported nu apar și nu contează ca liniștite; retenția șterge', async () => {
		pulls[2] = { siteId: 's3', siteName: 'topderma', status: 'unsupported', inserted: 0, failures: 0, findings: [] };
		prime();
		await processWordpressSentinelDaily({});
		expect(sent[0].text).not.toContain('topderma');
		expect(sent[0].text).toContain('✅ 1 site-uri liniștite');
		expect(deletes).toHaveLength(1);
	});
});
```

- [ ] **Step 2: Rulează — FAIL** (`bun run test wordpress-sentinel-daily`).

- [ ] **Step 3: Task-ul**

```ts
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, lt } from 'drizzle-orm';
import { redis } from 'bun';
import { env } from '$env/dynamic/private';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';
import { sendTelegramMessage } from '$lib/server/telegram/sender';
import { pullSite, type PullResult } from '$lib/server/wordpress/sentinel/pull';
import { buildDigest, type DigestSite } from '$lib/server/wordpress/sentinel/digest';

/** Evenimentele se țin 7 zile; memoria lungă e în wordpress_site.sentinel_state. */
export const SENTINEL_RETENTION_DAYS = 7;
const DIGEST_TTL_SEC = 36 * 60 * 60;

/**
 * Zilnic la 09:00 (Europe/Bucharest): citește Sentinel-ul tuturor site-urilor
 * nepauzate, trimite UN mesaj Telegram per tenant (către toți userii cu
 * Telegram legat) și șterge evenimentele mai vechi de 7 zile.
 * Idempotent pe zi: cheia Redis se scrie DUPĂ prima trimitere reușită, ca o
 * reîncercare după un Telegram picat să mai poată trimite.
 */
export async function processWordpressSentinelDaily(_params: Record<string, unknown> = {}, now: Date = new Date()) {
	const tenants = await db
		.selectDistinct({ id: table.tenant.id, slug: table.tenant.slug })
		.from(table.tenant)
		.innerJoin(table.wordpressSite, eq(table.wordpressSite.tenantId, table.tenant.id));

	let sent = 0;
	let pulled = 0;
	for (const tenant of tenants) {
		const sites = await db
			.select({ id: table.wordpressSite.id, tenantId: table.wordpressSite.tenantId, name: table.wordpressSite.name })
			.from(table.wordpressSite)
			.where(eq(table.wordpressSite.paused, 0));

		const results: PullResult[] = [];
		for (const site of sites.filter((s) => s.tenantId === tenant.id)) {
			try {
				results.push(await pullSite(site.id, now));
				pulled++;
			} catch (err) {
				// pullSite prinde singur erorile de site; aici ajung doar cele de infrastructură (db)
				const { message } = serializeError(err);
				logWarning('wordpress', `Sentinel daily: ${site.name} a aruncat: ${message}`, { tenantId: tenant.id, metadata: { siteId: site.id } });
				results.push({ siteId: site.id, siteName: site.name, status: 'error', inserted: 0, findings: [], failures: 1, error: message });
			}
		}

		const digestSites: DigestSite[] = [];
		let quiet = 0;
		for (const r of results) {
			if (r.status === 'unsupported') continue;
			const findings = [...r.findings];
			if (r.status === 'error') {
				findings.push(
					r.failures >= 2
						? { level: 'critical', kind: 'pull_failed', text: `nu răspunde de ${r.failures} zile` }
						: { level: 'important', kind: 'pull_failed', text: 'nu răspunde (prima zi)' }
				);
			}
			if (findings.length === 0) quiet++;
			else digestSites.push({ name: r.siteName, findings });
		}

		const day = now.toISOString().slice(0, 10);
		const key = `sentinel:digest:${tenant.id}:${day}`;
		if (await redis.get(key)) {
			logInfo('wordpress', `Sentinel daily: digest deja trimis azi pentru ${tenant.slug}`, { tenantId: tenant.id });
			continue;
		}

		const appUrl = (env.PUBLIC_APP_URL ?? '').replace(/\/$/, '');
		const messages = buildDigest({ date: now, sites: digestSites, quietSites: quiet, url: `${appUrl}/${tenant.slug}/wordpress/security` });
		const users = await db.select({ userId: table.tenantUser.userId }).from(table.tenantUser).where(eq(table.tenantUser.tenantId, tenant.id));

		let delivered = 0;
		for (const u of users) {
			try {
				let ok = true;
				for (const text of messages) {
					const r = await sendTelegramMessage({ tenantId: tenant.id, userId: u.userId, text });
					if (!r.ok && r.reason !== 'not_linked') ok = false;
					if (r.reason === 'not_linked') { ok = false; break; }
				}
				if (ok) delivered++;
			} catch (e) {
				logWarning('wordpress', `Sentinel daily: Telegram picat pentru ${u.userId}: ${serializeError(e).message}`, { tenantId: tenant.id });
			}
		}
		if (delivered > 0) {
			await redis.send('SET', [key, '1', 'NX', 'EX', String(DIGEST_TTL_SEC)]);
			sent++;
		}
		logInfo('wordpress', `Sentinel daily ${tenant.slug}: ${results.length} site-uri, ${digestSites.length} cu findings, ${quiet} liniștite, ${delivered} useri notificați`, {
			tenantId: tenant.id,
			metadata: { findings: digestSites.map((s) => ({ site: s.name, kinds: s.findings.map((f) => f.kind) })) }
		});
	}

	const cutoff = new Date(now.getTime() - SENTINEL_RETENTION_DAYS * 24 * 60 * 60 * 1000);
	await db.delete(table.wordpressSecurityEvent).where(lt(table.wordpressSecurityEvent.occurredAt, cutoff));

	return { success: true, tenants: tenants.length, pulled, sent };
}
```

Notă pentru test: mock-ul db din Step 1 nu are `selectDistinct` — adaugă în mock `selectDistinct: <la fel ca select>`; și `tenant` din schema mock. Dacă preferi, folosește `select` + `groupBy` — dar atunci mock-ul are nevoie de `groupBy`. Alege o variantă și ține testul consistent.

- [ ] **Step 4: Înregistrarea în `scheduler/index.ts`**

Import (lângă linia 41):
```ts
import { processWordpressSentinelDaily } from './tasks/wordpress-sentinel-daily';
```
Handler map (după `wordpress_connector_auto_update: …`):
```ts
	wordpress_sentinel_daily: processWordpressSentinelDaily,
```
`expectedJobIds` (în lista cu `'wordpress-connector-auto-update'`): adaugă `'wordpress-sentinel-daily'`.
După blocul `wordpress-connector-auto-update`:
```ts
	// Sentinel WordPress — 09:00: citește jurnalele de securitate de pe toate
	// site-urile și trimite un singur rezumat Telegram per tenant.
	await schedulerQueue.add(
		'wordpress-sentinel-daily',
		{ type: 'wordpress_sentinel_daily', params: {} },
		{ repeat: { pattern: '0 9 * * *', tz: 'Europe/Bucharest' }, jobId: 'wordpress-sentinel-daily' }
	);
```
`JOB_LABELS` (după `wordpress_updates_check`):
```ts
	wordpress_connector_auto_update: 'Auto-update Conector WordPress',
	wordpress_sentinel_daily: 'Sentinel WordPress (jurnal securitate + Telegram)',
```

- [ ] **Step 5: Rulează — PASS**

```bash
bun run test wordpress-sentinel-daily
bun run test sentinel
```
Expected: toate `pass`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/scheduler/tasks/wordpress-sentinel-daily.ts src/lib/server/scheduler/tasks/__tests__/wordpress-sentinel-daily.test.ts src/lib/server/scheduler/index.ts
git commit -m "feat(sentinel): job zilnic 09:00 — citire toate site-urile + digest Telegram idempotent"
```

---

### Task 10: Remote functions `wordpress-security.remote.ts`

**Files:**
- Create: `src/lib/remotes/wordpress-security.remote.ts`

- [ ] **Step 1: Fișierul** (pattern: `getRequestEvent` + `requireStaff` + scoping pe `event.locals.tenant.id`, ca în `seo-links.remote.ts`).

```ts
import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, desc, eq, gte, like, lt, or, sql, count } from 'drizzle-orm';
import { requireStaff } from '$lib/server/get-actor';
import { pullSite, supportsSentinel } from '$lib/server/wordpress/sentinel/pull';
import { parseState } from '$lib/server/wordpress/sentinel/types';

const PAGE = 100;
const PERIODS = { '24h': 1, '7d': 7, '30d': 30 } as const;

async function staffTenantId(): Promise<string> {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	await requireStaff(event);
	return event.locals.tenant.id;
}

export const getSecurityOverview = query(async () => {
	const tenantId = await staffTenantId();
	const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
	const sites = await db
		.select({
			id: table.wordpressSite.id,
			name: table.wordpressSite.name,
			siteUrl: table.wordpressSite.siteUrl,
			paused: table.wordpressSite.paused,
			connectorVersion: table.wordpressSite.connectorVersion,
			lastPullAt: table.wordpressSite.sentinelLastPullAt,
			lastPullStatus: table.wordpressSite.sentinelLastPullStatus,
			failures: table.wordpressSite.sentinelFailures,
			state: table.wordpressSite.sentinelState
		})
		.from(table.wordpressSite)
		.where(eq(table.wordpressSite.tenantId, tenantId))
		.orderBy(table.wordpressSite.name);

	const counts = await db
		.select({
			siteId: table.wordpressSecurityEvent.siteId,
			critical: sql<number>`sum(case when ${table.wordpressSecurityEvent.level} = 'critical' then 1 else 0 end)`,
			important: sql<number>`sum(case when ${table.wordpressSecurityEvent.level} = 'important' then 1 else 0 end)`,
			failedLogins: sql<number>`sum(case when ${table.wordpressSecurityEvent.event} = 'login_esuat' then 1 else 0 end)`,
			adminLogins: sql<number>`sum(case when ${table.wordpressSecurityEvent.event} = 'login_ok' and ${table.wordpressSecurityEvent.sentinelSev} = 'WARN' then 1 else 0 end)`
		})
		.from(table.wordpressSecurityEvent)
		.where(and(eq(table.wordpressSecurityEvent.tenantId, tenantId), gte(table.wordpressSecurityEvent.occurredAt, since7d)))
		.groupBy(table.wordpressSecurityEvent.siteId);
	const bySite = new Map(counts.map((c) => [c.siteId, c]));

	return sites.map((s) => {
		const c = bySite.get(s.id);
		const status = !supportsSentinel(s.connectorVersion) ? 'unsupported' : (s.lastPullStatus ?? 'never');
		return {
			id: s.id,
			name: s.name,
			siteUrl: s.siteUrl,
			paused: s.paused === 1,
			connectorVersion: s.connectorVersion,
			status, // 'ok' | 'legacy' | 'error' | 'unsupported' | 'never'
			lastPullAt: s.lastPullAt?.toISOString() ?? null,
			failures: s.failures,
			lastError: parseState(s.state).lastError,
			counts7d: {
				critical: Number(c?.critical ?? 0),
				important: Number(c?.important ?? 0),
				failedLogins: Number(c?.failedLogins ?? 0),
				adminLogins: Number(c?.adminLogins ?? 0)
			}
		};
	});
});

const EventsArgs = v.object({
	siteId: v.optional(v.string()),
	level: v.optional(v.picklist(['critical', 'important', 'normal'])),
	event: v.optional(v.string()),
	period: v.optional(v.picklist(['24h', '7d', '30d'])),
	q: v.optional(v.string()),
	cursor: v.optional(v.string()) // occurredAt ISO al ultimului rând
});

export const getSecurityEvents = query(EventsArgs, async (args) => {
	const tenantId = await staffTenantId();
	const days = PERIODS[args.period ?? '7d'];
	const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
	const where = [eq(table.wordpressSecurityEvent.tenantId, tenantId), gte(table.wordpressSecurityEvent.occurredAt, since)];
	if (args.siteId) where.push(eq(table.wordpressSecurityEvent.siteId, args.siteId));
	if (args.level) where.push(eq(table.wordpressSecurityEvent.level, args.level));
	if (args.event) where.push(eq(table.wordpressSecurityEvent.event, args.event));
	if (args.q) {
		const needle = `%${args.q.trim()}%`;
		where.push(or(like(table.wordpressSecurityEvent.ip, needle), like(table.wordpressSecurityEvent.username, needle))!);
	}
	if (args.cursor) where.push(lt(table.wordpressSecurityEvent.occurredAt, new Date(args.cursor)));

	const rows = await db
		.select({
			id: table.wordpressSecurityEvent.id,
			siteId: table.wordpressSecurityEvent.siteId,
			siteName: table.wordpressSite.name,
			occurredAt: table.wordpressSecurityEvent.occurredAt,
			level: table.wordpressSecurityEvent.level,
			event: table.wordpressSecurityEvent.event,
			username: table.wordpressSecurityEvent.username,
			ip: table.wordpressSecurityEvent.ip,
			uri: table.wordpressSecurityEvent.uri,
			userAgent: table.wordpressSecurityEvent.userAgent,
			data: table.wordpressSecurityEvent.data
		})
		.from(table.wordpressSecurityEvent)
		.innerJoin(table.wordpressSite, eq(table.wordpressSite.id, table.wordpressSecurityEvent.siteId))
		.where(and(...where))
		.orderBy(desc(table.wordpressSecurityEvent.occurredAt))
		.limit(PAGE + 1);

	const hasMore = rows.length > PAGE;
	const page = rows.slice(0, PAGE).map((r) => ({ ...r, occurredAt: r.occurredAt.toISOString() }));
	return { rows: page, nextCursor: hasMore ? page[page.length - 1].occurredAt : null };
});

export const pullSiteNow = command(v.object({ siteId: v.string() }), async ({ siteId }) => {
	const tenantId = await staffTenantId();
	const [site] = await db
		.select({ id: table.wordpressSite.id })
		.from(table.wordpressSite)
		.where(and(eq(table.wordpressSite.id, siteId), eq(table.wordpressSite.tenantId, tenantId)))
		.limit(1);
	if (!site) throw new Error('Site inexistent');
	const r = await pullSite(site.id);
	return { status: r.status, inserted: r.inserted, findings: r.findings, error: r.error ?? null, scan: r.scan ?? null };
});
```

- [ ] **Step 2: Type-check**

```bash
bunx --bun tsc --noEmit -p tsconfig.json 2>&1 | grep -E "wordpress-security" | head
```
Expected: fără linii. (Dacă `or(...)!` deranjează, construiește condiția într-o variabilă și verifică `!== undefined`.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/remotes/wordpress-security.remote.ts
git commit -m "feat(sentinel): remote functions — overview, evenimente, citire la cerere"
```

---

### Task 11: Pagina `/[tenant]/wordpress/security` + buton în `/wordpress`

**Files:**
- Create: `src/routes/[tenant]/wordpress/security/+page.ts`
- Create: `src/routes/[tenant]/wordpress/security/+page.svelte`
- Modify: `src/routes/[tenant]/wordpress/+page.svelte:1064-1076` (butoane header) + import icon

Înainte: încarcă `svelte:svelte-core-bestpractices` și `ui-styling`. Stări definite înainte de markup: **Loading** (skeleton per secțiune în `<svelte:boundary>`), **Empty** (fără site-uri / fără evenimente în filtre), **Error** (`{#snippet failed}` cu „Reîncearcă”).

- [ ] **Step 1: `+page.ts`**

```ts
export const ssr = false;
```

- [ ] **Step 2: `+page.svelte`**

```svelte
<script lang="ts">
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import { Card } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '$lib/components/ui/table';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import ShieldIcon from '@lucide/svelte/icons/shield';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { SvelteSet } from 'svelte/reactivity';
	import { getSecurityOverview, getSecurityEvents, pullSiteNow } from '$lib/remotes/wordpress-security.remote';
	import { EVENT_LABELS, eventLabel, LEVEL_LABELS, LEVEL_EMOJI } from '$lib/logic/wordpress-sentinel-labels';

	const tenantSlug = $derived(page.params.tenant ?? '');

	// === Filtre ===
	const filters = $state({
		siteId: 'all',
		level: 'all' as 'all' | 'critical' | 'important' | 'normal',
		event: 'all',
		period: '7d' as '24h' | '7d' | '30d',
		q: ''
	});
	const eventsArgs = $derived({
		siteId: filters.siteId === 'all' ? undefined : filters.siteId,
		level: filters.level === 'all' ? undefined : filters.level,
		event: filters.event === 'all' ? undefined : filters.event,
		period: filters.period,
		q: filters.q.trim() || undefined
	});

	// === Reads ===
	const sites = $derived(await getSecurityOverview());
	const eventsPage = $derived(await getSecurityEvents(eventsArgs));

	// pagini suplimentare (cursor) — se resetează când se schimbă filtrele
	let extraRows = $state<typeof eventsPage.rows>([]);
	let nextCursor = $state<string | null>(null);
	$effect(() => {
		eventsArgs; // dependență explicită: filtre noi = listă nouă
		extraRows = [];
		nextCursor = null;
	});
	const rows = $derived([...eventsPage.rows, ...extraRows]);
	const cursor = $derived(nextCursor ?? eventsPage.nextCursor);

	let loadingMore = $state(false);
	async function loadMore() {
		if (!cursor || loadingMore) return;
		loadingMore = true;
		try {
			const more = await getSecurityEvents({ ...eventsArgs, cursor });
			extraRows = [...extraRows, ...more.rows];
			nextCursor = more.nextCursor;
		} finally {
			loadingMore = false;
		}
	}

	const pulling = new SvelteSet<string>();
	async function pullNow(siteId: string, name: string) {
		if (pulling.has(siteId)) return;
		pulling.add(siteId);
		try {
			const r = await pullSiteNow({ siteId }).updates(getSecurityOverview(), getSecurityEvents(eventsArgs));
			if (r.status === 'error') toast.error(`${name}: ${r.error ?? 'citire eșuată'}`);
			else if (r.status === 'unsupported') toast.warning(`${name}: conectorul e mai vechi de 0.9.0`);
			else toast.success(`${name}: ${r.inserted} evenimente, ${r.findings.length} de semnalat`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		} finally {
			pulling.delete(siteId);
		}
	}

	const expanded = new SvelteSet<string>();
	const timeFmt = new Intl.DateTimeFormat('ro-RO', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Europe/Bucharest' });

	function statusLabel(s: (typeof sites)[number]): { text: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' } {
		if (s.paused) return { text: 'Pauzat', variant: 'secondary' };
		switch (s.status) {
			case 'ok':
				return { text: `Citit ${s.lastPullAt ? timeFmt.format(new Date(s.lastPullAt)) : ''}`, variant: 'outline' };
			case 'legacy':
				return { text: 'Șterge mu-plugin-ul vechi', variant: 'secondary' };
			case 'error':
				return { text: s.failures >= 2 ? `Nu răspunde de ${s.failures} zile` : 'Nu răspunde', variant: 'destructive' };
			case 'unsupported':
				return { text: `Conector prea vechi (${s.connectorVersion ?? '?'})`, variant: 'secondary' };
			default:
				return { text: 'Necitit', variant: 'outline' };
		}
	}
	const levelClass: Record<string, string> = {
		critical: 'border-red-300 dark:border-red-900',
		important: 'border-amber-300 dark:border-amber-900',
		normal: 'border-border'
	};
	function cardClass(s: (typeof sites)[number]) {
		if (s.counts7d.critical > 0 || s.status === 'error') return levelClass.critical;
		if (s.counts7d.important > 0 || s.status === 'legacy') return levelClass.important;
		return levelClass.normal;
	}
	function prettyData(data: string | null): string {
		if (!data) return '';
		try {
			return JSON.stringify(JSON.parse(data), null, 2);
		} catch {
			return data;
		}
	}
</script>

<svelte:head>
	<title>Securitate WordPress — Sentinel</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div class="flex items-center gap-3">
			<a href="/{tenantSlug}/wordpress" aria-label="Înapoi la site-uri">
				<Button variant="ghost" size="icon"><ArrowLeftIcon class="size-4" /></Button>
			</a>
			<h1 class="flex items-center gap-2 text-2xl font-semibold"><ShieldIcon class="size-6" /> Securitate (Sentinel)</h1>
		</div>
		<p class="text-sm text-muted-foreground">Jurnalele se citesc zilnic la 09:00; rezumatul ajunge pe Telegram.</p>
	</div>

	<svelte:boundary>
		{#snippet pending()}
			<div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
				{#each [1, 2, 3] as i (i)}<Card class="h-28 animate-pulse bg-muted/40" />{/each}
			</div>
		{/snippet}
		{#snippet failed(error, reset)}
			<Card class="p-4 border-red-300 dark:border-red-900">
				<p class="text-sm">Nu am putut încărca site-urile: {error instanceof Error ? error.message : String(error)}</p>
				<Button variant="outline" class="mt-2" onclick={reset}>Reîncearcă</Button>
			</Card>
		{/snippet}

		{#if sites.length === 0}
			<Card class="p-6 text-center text-sm text-muted-foreground">Niciun site WordPress conectat.</Card>
		{:else}
			<div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
				{#each sites as s (s.id)}
					{@const st = statusLabel(s)}
					<Card class="p-4 border-2 {cardClass(s)}">
						<div class="flex items-start justify-between gap-2">
							<div class="min-w-0">
								<p class="truncate font-medium">{s.name}</p>
								<p class="truncate text-xs text-muted-foreground">{s.siteUrl}</p>
							</div>
							<Badge variant={st.variant}>{st.text}</Badge>
						</div>
						<dl class="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
							<div><dt class="text-muted-foreground">Critice</dt><dd class="text-lg font-semibold {s.counts7d.critical ? 'text-red-600 dark:text-red-400' : ''}">{s.counts7d.critical}</dd></div>
							<div><dt class="text-muted-foreground">Importante</dt><dd class="text-lg font-semibold {s.counts7d.important ? 'text-amber-600 dark:text-amber-400' : ''}">{s.counts7d.important}</dd></div>
							<div><dt class="text-muted-foreground">Logări eșuate</dt><dd class="text-lg font-semibold">{s.counts7d.failedLogins}</dd></div>
							<div><dt class="text-muted-foreground">Logări admin</dt><dd class="text-lg font-semibold">{s.counts7d.adminLogins}</dd></div>
						</dl>
						{#if s.lastError}<p class="mt-2 truncate text-xs text-red-600 dark:text-red-400" title={s.lastError}>{s.lastError}</p>{/if}
						<div class="mt-3 flex justify-end">
							<Button size="sm" variant="outline" disabled={pulling.has(s.id) || s.status === 'unsupported' || s.paused} onclick={() => pullNow(s.id, s.name)}>
								{#if pulling.has(s.id)}<LoaderIcon class="mr-2 size-4 animate-spin" />{:else}<RefreshCwIcon class="mr-2 size-4" />{/if}
								Citește acum
							</Button>
						</div>
					</Card>
				{/each}
			</div>
		{/if}
	</svelte:boundary>

	<Card class="p-4">
		<div class="flex flex-wrap items-end gap-3">
			<label class="text-xs">Site
				<select class="mt-1 block rounded-md border bg-background px-2 py-1.5 text-sm" bind:value={filters.siteId}>
					<option value="all">Toate</option>
					{#each sites as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
				</select>
			</label>
			<label class="text-xs">Nivel
				<select class="mt-1 block rounded-md border bg-background px-2 py-1.5 text-sm" bind:value={filters.level}>
					<option value="all">Toate</option>
					{#each Object.entries(LEVEL_LABELS) as [k, label] (k)}<option value={k}>{LEVEL_EMOJI[k as keyof typeof LEVEL_EMOJI]} {label}</option>{/each}
				</select>
			</label>
			<label class="text-xs">Eveniment
				<select class="mt-1 block rounded-md border bg-background px-2 py-1.5 text-sm" bind:value={filters.event}>
					<option value="all">Toate</option>
					{#each Object.entries(EVENT_LABELS) as [k, label] (k)}<option value={k}>{label}</option>{/each}
				</select>
			</label>
			<div class="flex gap-1" role="group" aria-label="Perioadă">
				{#each ['24h', '7d', '30d'] as p (p)}
					<Button size="sm" variant={filters.period === p ? 'default' : 'outline'} onclick={() => (filters.period = p as typeof filters.period)}>{p === '24h' ? '24 h' : p === '7d' ? '7 z' : '30 z'}</Button>
				{/each}
			</div>
			<label class="text-xs">IP / user
				<Input class="mt-1 w-48" placeholder="caută" bind:value={filters.q} />
			</label>
		</div>

		<svelte:boundary>
			{#snippet pending()}<div class="mt-4 h-40 animate-pulse rounded-md bg-muted/40" aria-busy="true"></div>{/snippet}
			{#snippet failed(error, reset)}
				<p class="mt-4 text-sm">Eroare la evenimente: {error instanceof Error ? error.message : String(error)} <Button variant="link" onclick={reset}>Reîncearcă</Button></p>
			{/snippet}

			{#if rows.length === 0}
				<p class="mt-4 text-sm text-muted-foreground">Niciun eveniment pentru filtrele alese.</p>
			{:else}
				<div class="mt-4 overflow-x-auto">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead class="w-8"><span class="sr-only">Detalii</span></TableHead>
								<TableHead>Ora</TableHead>
								<TableHead>Site</TableHead>
								<TableHead>Nivel</TableHead>
								<TableHead>Eveniment</TableHead>
								<TableHead>User</TableHead>
								<TableHead>IP</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{#each rows as r (r.id)}
								<TableRow class="cursor-pointer" onclick={() => (expanded.has(r.id) ? expanded.delete(r.id) : expanded.add(r.id))}>
									<TableCell>
										<button type="button" aria-expanded={expanded.has(r.id)} aria-label="Detalii eveniment" class="rounded p-0.5 focus-visible:outline-2">
											{#if expanded.has(r.id)}<ChevronDownIcon class="size-4" />{:else}<ChevronRightIcon class="size-4" />{/if}
										</button>
									</TableCell>
									<TableCell class="whitespace-nowrap text-xs">{timeFmt.format(new Date(r.occurredAt))}</TableCell>
									<TableCell>{r.siteName}</TableCell>
									<TableCell><Badge variant={r.level === 'critical' ? 'destructive' : r.level === 'important' ? 'secondary' : 'outline'}>{LEVEL_EMOJI[r.level as keyof typeof LEVEL_EMOJI]} {LEVEL_LABELS[r.level as keyof typeof LEVEL_LABELS]}</Badge></TableCell>
									<TableCell>{eventLabel(r.event)}</TableCell>
									<TableCell class="font-mono text-xs">{r.username ?? '—'}</TableCell>
									<TableCell class="font-mono text-xs">{r.ip ?? '—'}</TableCell>
								</TableRow>
								{#if expanded.has(r.id)}
									<TableRow>
										<TableCell colspan={7} class="bg-muted/30">
											<dl class="grid gap-1 text-xs md:grid-cols-[6rem_1fr]">
												<dt class="text-muted-foreground">URI</dt><dd class="break-all font-mono">{r.uri ?? '—'}</dd>
												<dt class="text-muted-foreground">User-agent</dt><dd class="break-all">{r.userAgent ?? '—'}</dd>
												<dt class="text-muted-foreground">Date</dt><dd><pre class="whitespace-pre-wrap break-all font-mono">{prettyData(r.data)}</pre></dd>
											</dl>
										</TableCell>
									</TableRow>
								{/if}
							{/each}
						</TableBody>
					</Table>
				</div>
				{#if cursor}
					<div class="mt-3 flex justify-center">
						<Button variant="outline" disabled={loadingMore} onclick={loadMore}>{loadingMore ? 'Se încarcă…' : 'Încă 100'}</Button>
					</div>
				{/if}
			{/if}
		</svelte:boundary>
	</Card>
</div>
```

- [ ] **Step 3: Butonul „Securitate” în `wordpress/+page.svelte`** (după link-ul „Diagnostics”, la ~linia 1076; import `ShieldIcon from '@lucide/svelte/icons/shield'` lângă celelalte iconițe):

```svelte
			<a href="/{tenantSlug}/wordpress/security">
				<Button variant="outline" title="Jurnal de securitate Sentinel: logări, useri, plugin-uri, PHP în uploads">
					<ShieldIcon class="mr-2 size-4" />
					Securitate
				</Button>
			</a>
```

- [ ] **Step 4: svelte-autofixer + build-check**

`svelte-autofixer` (MCP svelte) pe `security/+page.svelte` și pe `wordpress/+page.svelte`; repară ce raportează; rulează din nou până e curat. Apoi:
```bash
/build-check
```
Expected: nu crește față de baseline (16 err / 56 warn).

- [ ] **Step 5: Verificare în browser (testermcp)** — pe `http://localhost:5173/ots/wordpress/security` (dev server-ul rulează din checkout-ul principal → înainte merge-uiește branch-ul în main local sau pornește un dev server din worktree pe alt port). Golden path: carduri afișate; „Citește acum” pe un site cu conector < 0.9.0 → toast „conector prea vechi”; filtrele schimbă tabelul; rând expandabil. Screenshot-uri light + dark. Apoi `design-auditor` + `web-design-guidelines` pe pagină; repară Critical/High.

- [ ] **Step 6: Commit**

```bash
git add src/routes/[tenant]/wordpress/security/+page.ts src/routes/[tenant]/wordpress/security/+page.svelte src/routes/[tenant]/wordpress/+page.svelte
git commit -m "feat(sentinel): pagina /wordpress/security — carduri per site, evenimente cu filtre, citire la cerere"
```

---

### Task 12: Verificare finală, docs, predare pentru pilot

**Files:**
- Modify: `docs/superpowers/specs/2026-09-28-wp-sentinel-design.md` (dacă implementarea a deviat, notează)
- Create: `docs/superpowers/handoff/2026-09-28-wp-sentinel-pilot.md`

- [ ] **Step 1: Suita completă + type-check**

```bash
bun run test
bunx --bun tsc --noEmit -p tsconfig.json 2>&1 | grep -cE "sentinel|wordpress-security" 
```
Expected: 0 fail; 0 linii.

- [ ] **Step 2: Handoff pentru pilot** (`docs/superpowers/handoff/2026-09-28-wp-sentinel-pilot.md`):

```markdown
# Sentinel — pilot pe areni + nevada

Stare: conector 0.9.0 construit local (`../ots-wp-connector-v0.9.0.zip`), NEPUBLICAT.
CRM: branch `feat/wp-sentinel`, migrările 0569–0576 aplicate pe baza partajată.

## Pași (manual, de utilizator)
1. Confirmat: `wordpress-connector-auto-update` sare site-urile cu versiune ≥ ultima publicată
   (`compareConnectorVersions(current, latest) >= 0` → skip), deci 0.9.0 instalat manual nu e dat jos.
2. Pe areni și nevada: instalează ZIP-ul 0.9.0 din wp-admin (Plugins → Add → Upload, „Replace current”).
3. Șterge `wp-content/mu-plugins/ots-sentinel.php` (altfel cardul arată „Șterge mu-plugin-ul vechi” și
   evenimentele noi nu se scriu de conector).
4. CRM → /ots/wordpress/security → „Citește acum” pe fiecare: prima citire = baseline (fără findings),
   evenimentele vechi apar în tabel.
5. Rulează o dată jobul manual din pagina de scheduler (`wordpress_sentinel_daily`) → un mesaj Telegram
   cu „✅ N site-uri liniștite” (+ celelalte site-uri ca „conector prea vechi”, invizibile în mesaj).
6. A doua zi la 09:00: mesajul automat. Abia după 2–3 zile curate: `bun run connector:release`.

## Ce urmărești în pilot
- nevada: findings 🟠 brute-force dacă mai apar eșecuri; IP-uri de admin noi după baseline.
- Scanarea: `scan.truncated` în log-ul `wordpress` (debug_log) — dacă e true des, crește bugetul.
- Fișierul de jurnal nou: `wp-content/ots-sentinel/sentinel-<hash>.log` (hash din secret).
```

- [ ] **Step 3: Commit + push + PR**

```bash
git add docs/superpowers/specs/2026-09-28-wp-sentinel-design.md docs/superpowers/plans/2026-09-28-wp-sentinel.md docs/superpowers/handoff/2026-09-28-wp-sentinel-pilot.md
git commit -m "docs(sentinel): spec, plan și predare pentru pilot"
git push -u origin feat/wp-sentinel
```
Apoi `superpowers:finishing-a-development-branch`: PR spre main; deploy DOAR după „go” de la user. `graphify . --update` după merge.

---

## Self-review (făcut la scriere)

- **Acoperire spec:** §1 → T2, T3; §2 → T4; §3 → T5, T6, T8; §4 → T7, T9; §5 → T10, T11; §6 (erori) → T2 (`$safe`), T3 (`errors[]`), T8 (catch → `error`/`failures`), T9 (Telegram picat → logWarning); §7 → T1, T6, T7, T8, T9, `php -l` în T2/T3; §8 → T3 Step 5 (fără publicare), T12 (pilot).
- **Consistență de nume:** `WpClient.sentinel({since, skip})` (T5) ↔ `client.sentinel(...)` (T8); `detectFindings({site, events, scan, state, now}) → {findings, nextState, levels}` (T6) ↔ T8; `buildDigest({date, sites, quietSites, url}) → string[]` (T7) ↔ T9; `pullSite(siteId, now?) → PullResult` (T8) ↔ T9, T10; `supportsSentinel` (T8) ↔ T10; coloanele `sentinelLastPullAt/…Status/…Failures/…State` (T4) ↔ T8, T10.
- **Etichete:** stau în `$lib/logic/wordpress-sentinel-labels.ts` (T5), importate din `digest.ts` (T7) și din pagină (T11) — `$lib/server/*` nu se poate importa în client.
- **Test T9:** mock-ul db trebuie să aibă și `selectDistinct` + `innerJoin` (folosite de task); e notat sub Step 3.
