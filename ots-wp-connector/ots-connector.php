<?php
/**
 * Plugin Name:       OTS Connector
 * Plugin URI:        https://clients.onetopsolution.ro
 * Description:       Allows OTS CRM to manage this WordPress site (health, updates, posts) over an HMAC-signed REST API.
 * Version:           0.1.1
 * Requires at least: 5.6
 * Requires PHP:      7.4
 * Author:            One Top Solution
 * Author URI:        https://onetopsolution.ro
 * License:           GPL-2.0-or-later
 * Text Domain:       ots-connector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'OTS_CONNECTOR_VERSION', '0.1.1' );
define( 'OTS_CONNECTOR_NAMESPACE', 'ots-connector/v1' );
define( 'OTS_CONNECTOR_TIMESTAMP_WINDOW', 60 ); // seconds
define( 'OTS_CONNECTOR_SECRET_OPTION', 'ots_connector_secret' );
define( 'OTS_CONNECTOR_SECRET_SHOWN_OPTION', 'ots_connector_secret_shown' );

/**
 * Generate a fresh 32-byte secret, hex-encoded (64 chars). Matches the
 * TypeScript `generateSecret()` on the CRM side.
 */
function ots_connector_generate_secret(): string {
	return bin2hex( random_bytes( 32 ) );
}

/**
 * Activation hook — creates the initial secret and flags it unseen so the
 * admin UI prompts the user to copy it on the next dashboard visit.
 */
function ots_connector_activate(): void {
	if ( ! get_option( OTS_CONNECTOR_SECRET_OPTION ) ) {
		update_option( OTS_CONNECTOR_SECRET_OPTION, ots_connector_generate_secret(), false );
		update_option( OTS_CONNECTOR_SECRET_SHOWN_OPTION, 0, false );
	}
}
register_activation_hook( __FILE__, 'ots_connector_activate' );

/**
 * Canonical payload for HMAC signing: timestamp + method + path + body,
 * newline-separated. MUST match the CRM's `signRequest()` exactly.
 */
function ots_connector_canonical_payload( int $timestamp, string $method, string $path, string $body ): string {
	return $timestamp . "\n" . strtoupper( $method ) . "\n" . $path . "\n" . $body;
}

/**
 * Permission callback that validates the HMAC signature on every request.
 * On failure returns a WP_Error that the REST stack converts into 401/403.
 */
function ots_connector_verify_request( WP_REST_Request $request ) {
	$secret = get_option( OTS_CONNECTOR_SECRET_OPTION );
	if ( ! $secret ) {
		return new WP_Error( 'ots_no_secret', 'Plugin not configured', [ 'status' => 500 ] );
	}

	$timestamp_header = $request->get_header( 'X-OTS-Timestamp' );
	$signature_header = $request->get_header( 'X-OTS-Signature' );
	if ( ! $timestamp_header || ! $signature_header ) {
		return new WP_Error( 'ots_missing_signature', 'Missing signature headers', [ 'status' => 401 ] );
	}

	$timestamp = (int) $timestamp_header;
	$now       = time();
	if ( abs( $now - $timestamp ) > OTS_CONNECTOR_TIMESTAMP_WINDOW ) {
		return new WP_Error( 'ots_stale_timestamp', 'Timestamp outside allowed window', [ 'status' => 401 ] );
	}

	// Reconstruct the path exactly as the CRM signs it: /wp-json/<ns>/<route>
	$route = $request->get_route(); // e.g. "/ots-connector/v1/health"
	$path  = '/wp-json' . $route;
	$body  = $request->get_body() ?? '';

	$expected = hash_hmac(
		'sha256',
		ots_connector_canonical_payload( $timestamp, $request->get_method(), $path, $body ),
		$secret
	);

	if ( ! hash_equals( $expected, $signature_header ) ) {
		return new WP_Error( 'ots_bad_signature', 'Signature mismatch', [ 'status' => 401 ] );
	}

	return true;
}

/**
 * GET /health — returns WP/PHP versions, SSL expiry (best effort), and the
 * plugin's own version. Used by the CRM as the primary authenticated probe.
 */
function ots_connector_route_health( WP_REST_Request $request ) {
	global $wp_version;

	$site_url = get_site_url();
	$ssl_expires_at = null;

	// SSL expiry is best-effort — never let a cert parse failure break /health.
	$parsed = wp_parse_url( $site_url );
	if ( is_array( $parsed ) && ! empty( $parsed['host'] ) && ( $parsed['scheme'] ?? 'http' ) === 'https' ) {
		$host = $parsed['host'];
		$port = isset( $parsed['port'] ) ? (int) $parsed['port'] : 443;
		$ssl_expires_at = ots_connector_probe_ssl_expiry( $host, $port );
	}

	return rest_ensure_response( [
		'connectorVersion' => OTS_CONNECTOR_VERSION,
		'wpVersion'        => $wp_version,
		'phpVersion'       => PHP_VERSION,
		'siteUrl'          => $site_url,
		'sslExpiresAt'     => $ssl_expires_at,
		'timestamp'        => time(),
	] );
}

/**
 * Attempt a short TLS handshake and extract the certificate's notAfter field.
 * Returns an ISO-8601 string or null on any failure. Timeout: 3 seconds.
 */
function ots_connector_probe_ssl_expiry( string $host, int $port ): ?string {
	$context = stream_context_create( [
		'ssl' => [
			'capture_peer_cert' => true,
			'verify_peer'       => false,
			'verify_peer_name'  => false,
		],
	] );

	$errno = 0;
	$errstr = '';
	$socket = @stream_socket_client(
		'ssl://' . $host . ':' . $port,
		$errno,
		$errstr,
		3,
		STREAM_CLIENT_CONNECT,
		$context
	);
	if ( ! $socket ) {
		return null;
	}

	$params = stream_context_get_params( $socket );
	fclose( $socket );

	$cert_resource = $params['options']['ssl']['peer_certificate'] ?? null;
	if ( ! $cert_resource ) {
		return null;
	}

	$cert = openssl_x509_parse( $cert_resource );
	if ( ! $cert || empty( $cert['validTo_time_t'] ) ) {
		return null;
	}

	return gmdate( 'c', (int) $cert['validTo_time_t'] );
}

add_action( 'rest_api_init', function () {
	register_rest_route( OTS_CONNECTOR_NAMESPACE, '/health', [
		'methods'             => WP_REST_Server::READABLE,
		'callback'            => 'ots_connector_route_health',
		'permission_callback' => 'ots_connector_verify_request',
	] );
} );

/* ──────────────────────────── Admin UI ────────────────────────────── */

add_action( 'admin_menu', function () {
	add_options_page(
		'OTS Connector',
		'OTS Connector',
		'manage_options',
		'ots-connector',
		'ots_connector_render_admin_page'
	);
} );

function ots_connector_render_admin_page(): void {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}

	// Handle regenerate POST.
	if ( ! empty( $_POST['ots_regenerate'] ) && check_admin_referer( 'ots_connector_regen' ) ) {
		update_option( OTS_CONNECTOR_SECRET_OPTION, ots_connector_generate_secret(), false );
		update_option( OTS_CONNECTOR_SECRET_SHOWN_OPTION, 0, false );
		echo '<div class="notice notice-success"><p>Secret regenerat. Copiază-l mai jos și actualizează-l în CRM.</p></div>';
	}

	// Handle manual secret set (for the case where the CRM generated the secret
	// and the user needs to paste it into WordPress).
	if ( ! empty( $_POST['ots_set_manual_secret'] ) && check_admin_referer( 'ots_connector_set_manual' ) ) {
		$new_secret = trim( (string) wp_unslash( $_POST['manual_secret'] ?? '' ) );
		if ( strlen( $new_secret ) === 64 && ctype_xdigit( $new_secret ) ) {
			update_option( OTS_CONNECTOR_SECRET_OPTION, $new_secret, false );
			update_option( OTS_CONNECTOR_SECRET_SHOWN_OPTION, 1, false );
			echo '<div class="notice notice-success"><p>Secret actualizat. Apasă „Refresh" în CRM pentru a valida conexiunea.</p></div>';
		} else {
			echo '<div class="notice notice-error"><p>Secretul invalid: trebuie exact 64 de caractere hex (0-9, a-f).</p></div>';
		}
	}

	$secret       = (string) get_option( OTS_CONNECTOR_SECRET_OPTION, '' );
	$already_seen = (int) get_option( OTS_CONNECTOR_SECRET_SHOWN_OPTION, 0 ) === 1;

	// First-view reveal: show secret once, then mark as seen so future visits
	// only show a masked version + "regenerate" button.
	if ( ! $already_seen ) {
		update_option( OTS_CONNECTOR_SECRET_SHOWN_OPTION, 1, false );
	}

	$site_url = esc_url( get_site_url() );
	?>
	<div class="wrap">
		<h1>OTS Connector</h1>
		<p>Pluginul permite CRM-ului OTS să administreze acest site (health, updates, postări) printr-un API REST semnat HMAC.</p>

		<h2>Secret HMAC</h2>
		<?php if ( ! $already_seen ) : ?>
			<p><strong>Copiază acest secret acum.</strong> Nu va mai fi afișat integral după ce părăsești pagina.</p>
			<code style="display:block;padding:12px;background:#f6f7f7;border:1px solid #ccd0d4;word-break:break-all;">
				<?php echo esc_html( $secret ); ?>
			</code>
		<?php else : ?>
			<p>Secret-ul a fost deja afișat. Dacă l-ai pierdut, regenerează-l mai jos și actualizează-l în CRM.</p>
			<code style="display:block;padding:12px;background:#f6f7f7;border:1px solid #ccd0d4;">
				<?php echo esc_html( substr( $secret, 0, 8 ) . str_repeat( '•', 48 ) . substr( $secret, -8 ) ); ?>
			</code>
		<?php endif; ?>

		<h2>Adaugă acest site în CRM</h2>
		<ol>
			<li>URL site: <code><?php echo $site_url; ?></code></li>
			<li>În CRM → WordPress → „Adaugă site", lipește URL-ul și secretul de mai sus.</li>
		</ol>

		<h2>Setează secret manual (din CRM)</h2>
		<p>
			Dacă la „Adaugă site" în CRM ai lăsat câmpul „Secret HMAC" gol, CRM-ul a generat
			un secret și l-a afișat o singură dată. Lipește-l aici pentru a sincroniza plugin-ul.
		</p>
		<form method="post">
			<?php wp_nonce_field( 'ots_connector_set_manual' ); ?>
			<p>
				<textarea name="manual_secret" rows="2" style="width:100%;max-width:700px;font-family:monospace;"
					placeholder="Lipește aici secretul hex de 64 caractere din CRM"></textarea>
			</p>
			<p>
				<button type="submit" name="ots_set_manual_secret" value="1" class="button button-primary">
					Salvează secret manual
				</button>
			</p>
		</form>

		<h2>Regenerare secret</h2>
		<p>
			Alternativ, generează aici un secret nou și copiază-l în CRM (la „Adaugă site" sau la
			„Rotire secret" pentru un site existent).
		</p>
		<form method="post">
			<?php wp_nonce_field( 'ots_connector_regen' ); ?>
			<p>
				<button type="submit" name="ots_regenerate" value="1" class="button button-secondary"
					onclick="return confirm('Sigur regenerezi secretul? Va trebui să-l actualizezi imediat în CRM.');">
					Regenerează secret
				</button>
			</p>
		</form>

		<h2>Endpoint-uri active</h2>
		<ul>
			<li><code>GET <?php echo $site_url; ?>/wp-json/ots-connector/v1/health</code> — verificare stare (necesită semnătură HMAC)</li>
		</ul>

		<p><small>Versiune plugin: <?php echo esc_html( OTS_CONNECTOR_VERSION ); ?></small></p>
	</div>
	<?php
}
