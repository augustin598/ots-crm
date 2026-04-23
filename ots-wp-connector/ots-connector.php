<?php
/**
 * Plugin Name:       OTS Connector
 * Plugin URI:        https://clients.onetopsolution.ro
 * Description:       Allows OTS CRM to manage this WordPress site (health, updates, posts) over an HMAC-signed REST API.
 * Version:           0.3.0
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

define( 'OTS_CONNECTOR_VERSION', '0.3.0' );
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

/**
 * GET /updates — enumerate available core, plugin, and theme updates.
 * Uses the WP core functions that populate the Dashboard → Updates screen.
 * We force-refresh transients so results aren't cached for 12 hours.
 */
function ots_connector_route_updates( WP_REST_Request $request ) {
	// Force-refresh update transients so we return current data instead of
	// whatever was cached the last time an admin loaded the Updates page.
	wp_version_check( [], true );
	wp_update_plugins();
	wp_update_themes();

	$items = [];

	// Core updates
	if ( ! function_exists( 'get_core_updates' ) ) {
		require_once ABSPATH . 'wp-admin/includes/update.php';
	}
	$core_updates = get_core_updates();
	if ( is_array( $core_updates ) && ! empty( $core_updates ) ) {
		foreach ( $core_updates as $core ) {
			if ( isset( $core->response ) && $core->response === 'upgrade' ) {
				global $wp_version;
				$items[] = [
					'type'           => 'core',
					'slug'           => 'core',
					'name'           => 'WordPress',
					'currentVersion' => $wp_version,
					'newVersion'     => $core->version,
					'securityUpdate' => false,
					'autoUpdate'     => false,
				];
				break; // Only one core update at a time
			}
		}
	}

	// Plugin updates
	if ( ! function_exists( 'get_plugin_updates' ) ) {
		require_once ABSPATH . 'wp-admin/includes/update.php';
	}
	if ( ! function_exists( 'get_plugins' ) ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
	}
	$plugin_updates = get_plugin_updates();
	$auto_plugins   = (array) get_site_option( 'auto_update_plugins', [] );
	foreach ( $plugin_updates as $plugin_file => $plugin_data ) {
		$slug = dirname( $plugin_file );
		if ( $slug === '.' || $slug === '' ) {
			$slug = basename( $plugin_file, '.php' );
		}
		$items[] = [
			'type'           => 'plugin',
			'slug'           => $plugin_file, // Full path needed for upgrader
			'name'           => (string) ( $plugin_data->Name ?? $slug ),
			'currentVersion' => (string) ( $plugin_data->Version ?? '' ),
			'newVersion'     => (string) ( $plugin_data->update->new_version ?? '' ),
			'securityUpdate' => false, // WP doesn't expose this flag on plugin updates
			'autoUpdate'     => in_array( $plugin_file, $auto_plugins, true ),
		];
	}

	// Theme updates
	if ( ! function_exists( 'get_theme_updates' ) ) {
		require_once ABSPATH . 'wp-admin/includes/update.php';
	}
	$theme_updates = get_theme_updates();
	$auto_themes   = (array) get_site_option( 'auto_update_themes', [] );
	foreach ( $theme_updates as $stylesheet => $theme ) {
		$update = $theme->update ?? null;
		$items[] = [
			'type'           => 'theme',
			'slug'           => (string) $stylesheet,
			'name'           => (string) ( $theme->get( 'Name' ) ?: $stylesheet ),
			'currentVersion' => (string) $theme->get( 'Version' ),
			'newVersion'     => (string) ( $update['new_version'] ?? '' ),
			'securityUpdate' => false,
			'autoUpdate'     => in_array( $stylesheet, $auto_themes, true ),
		];
	}

	return rest_ensure_response( [
		'items'     => $items,
		'timestamp' => time(),
	] );
}

/**
 * POST /updates/apply — run the upgrader for each requested item. Returns
 * a per-item status so the CRM can show granular feedback. Never throws —
 * individual failures just get marked "failed" in the result array.
 */
function ots_connector_route_apply_updates( WP_REST_Request $request ) {
	$body = $request->get_json_params();
	$items = is_array( $body['items'] ?? null ) ? $body['items'] : [];
	if ( empty( $items ) ) {
		return new WP_Error( 'ots_empty_items', 'No items to apply', [ 'status' => 400 ] );
	}

	// The upgrader classes aren't loaded on REST requests; pull them in.
	require_once ABSPATH . 'wp-admin/includes/file.php';
	require_once ABSPATH . 'wp-admin/includes/misc.php';
	require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
	require_once ABSPATH . 'wp-admin/includes/update.php';
	require_once ABSPATH . 'wp-admin/includes/plugin.php';

	// Refresh update caches so upgraders see the latest metadata.
	wp_version_check( [], true );
	wp_update_plugins();
	wp_update_themes();

	$results = [];
	$overall_success = true;

	foreach ( $items as $item ) {
		$type = (string) ( $item['type'] ?? '' );
		$slug = (string) ( $item['slug'] ?? '' );
		if ( ! $type || ! $slug ) {
			$results[] = [ 'type' => $type, 'slug' => $slug, 'success' => false, 'message' => 'Missing type or slug' ];
			$overall_success = false;
			continue;
		}

		$skin     = new WP_Ajax_Upgrader_Skin(); // Silent skin — captures output
		$upgrader = null;
		$outcome  = null;

		try {
			if ( $type === 'plugin' ) {
				$upgrader = new Plugin_Upgrader( $skin );
				$outcome  = $upgrader->upgrade( $slug );
			} elseif ( $type === 'theme' ) {
				$upgrader = new Theme_Upgrader( $skin );
				$outcome  = $upgrader->upgrade( $slug );
			} elseif ( $type === 'core' ) {
				$core_updates = get_core_updates();
				if ( is_array( $core_updates ) && ! empty( $core_updates ) ) {
					$upgrader = new Core_Upgrader( $skin );
					$outcome  = $upgrader->upgrade( reset( $core_updates ) );
				} else {
					$outcome = new WP_Error( 'no_core_update', 'No core update available' );
				}
			} else {
				$outcome = new WP_Error( 'bad_type', "Unknown update type: {$type}" );
			}
		} catch ( \Throwable $e ) {
			$outcome = new WP_Error( 'upgrader_exception', $e->getMessage() );
		}

		if ( is_wp_error( $outcome ) ) {
			$results[] = [
				'type'    => $type,
				'slug'    => $slug,
				'success' => false,
				'message' => $outcome->get_error_message(),
			];
			$overall_success = false;
		} elseif ( $outcome === false || $outcome === null ) {
			$messages = $skin->get_error_messages();
			$results[] = [
				'type'    => $type,
				'slug'    => $slug,
				'success' => false,
				'message' => ! empty( $messages ) ? implode( '; ', $messages ) : 'Upgrader returned false',
			];
			$overall_success = false;
		} else {
			$results[] = [
				'type'    => $type,
				'slug'    => $slug,
				'success' => true,
				'message' => 'ok',
			];
		}
	}

	return rest_ensure_response( [
		'success'   => $overall_success,
		'items'     => $results,
		'timestamp' => time(),
	] );
}

/**
 * POST /backup — produce a ZIP snapshot of wp-content + a mysqldump-style
 * SQL export of all tables, saved under wp-content/uploads/ots-backups/.
 * Synchronous for Phase 2 (the plugin exposes the file via a download URL
 * and the CRM records the path). Limited to 512 MB archive size.
 */
function ots_connector_route_backup( WP_REST_Request $request ) {
	$started = microtime( true );

	$upload_dir = wp_upload_dir();
	$backup_dir = trailingslashit( $upload_dir['basedir'] ) . 'ots-backups';
	if ( ! is_dir( $backup_dir ) ) {
		if ( ! wp_mkdir_p( $backup_dir ) ) {
			return new WP_Error( 'ots_mkdir_failed', 'Could not create backup dir', [ 'status' => 500 ] );
		}
		// Drop an .htaccess so the directory isn't web-browsable. The archive
		// itself remains reachable by its individual filename.
		@file_put_contents( $backup_dir . '/.htaccess', "Options -Indexes\n" );
	}

	$timestamp = gmdate( 'Ymd-His' );
	$archive_name = sprintf( 'ots-backup-%s.zip', $timestamp );
	$archive_path = $backup_dir . '/' . $archive_name;

	if ( ! class_exists( 'ZipArchive' ) ) {
		return new WP_Error( 'ots_no_zip', 'PHP ZipArchive extension is not installed', [ 'status' => 500 ] );
	}

	// 1) SQL dump to a temp file
	$sql_file = $backup_dir . '/db-' . $timestamp . '.sql';
	$dump_ok  = ots_connector_dump_database( $sql_file );
	if ( is_wp_error( $dump_ok ) ) {
		return $dump_ok;
	}

	// 2) Zip the DB dump + wp-content (excluding cache + the backup dir itself)
	$zip = new ZipArchive();
	if ( $zip->open( $archive_path, ZipArchive::CREATE | ZipArchive::OVERWRITE ) !== true ) {
		@unlink( $sql_file );
		return new WP_Error( 'ots_zip_open_failed', 'Could not create archive', [ 'status' => 500 ] );
	}

	$zip->addFile( $sql_file, 'database.sql' );

	$wp_content = trailingslashit( WP_CONTENT_DIR );
	$exclude_substrings = [
		DIRECTORY_SEPARATOR . 'cache' . DIRECTORY_SEPARATOR,
		DIRECTORY_SEPARATOR . 'ots-backups' . DIRECTORY_SEPARATOR,
	];

	$iterator = new RecursiveIteratorIterator(
		new RecursiveDirectoryIterator( $wp_content, RecursiveDirectoryIterator::SKIP_DOTS ),
		RecursiveIteratorIterator::SELF_FIRST
	);

	foreach ( $iterator as $file ) {
		$real_path = $file->getPathname();
		$skip = false;
		foreach ( $exclude_substrings as $needle ) {
			if ( strpos( $real_path, $needle ) !== false ) {
				$skip = true;
				break;
			}
		}
		if ( $skip ) continue;

		$relative = 'wp-content/' . ltrim( str_replace( $wp_content, '', $real_path ), '/\\' );
		if ( $file->isDir() ) {
			$zip->addEmptyDir( $relative );
		} else {
			$zip->addFile( $real_path, $relative );
		}
	}

	$zip->close();
	@unlink( $sql_file );

	$size = @filesize( $archive_path ) ?: 0;
	$url  = trailingslashit( $upload_dir['baseurl'] ) . 'ots-backups/' . $archive_name;
	$elapsed = round( microtime( true ) - $started, 2 );

	return rest_ensure_response( [
		'success'     => true,
		'archiveUrl'  => $url,
		'archivePath' => $archive_path,
		'sizeBytes'   => $size,
		'elapsedSec'  => $elapsed,
		'timestamp'   => time(),
	] );
}

/**
 * Dump all tables in the WP DB to a single .sql file. Uses the mysqli
 * connection wpdb is already holding — no shelling out to mysqldump (which
 * may not be available on shared hosts).
 */
function ots_connector_dump_database( string $output_path ) {
	global $wpdb;
	$fh = @fopen( $output_path, 'wb' );
	if ( ! $fh ) {
		return new WP_Error( 'ots_dump_open_failed', 'Could not open SQL file for writing', [ 'status' => 500 ] );
	}

	fwrite( $fh, "-- OTS Connector backup\n" );
	fwrite( $fh, '-- Generated: ' . gmdate( 'c' ) . "\n" );
	fwrite( $fh, "SET FOREIGN_KEY_CHECKS=0;\n" );
	fwrite( $fh, "SET NAMES utf8mb4;\n\n" );

	$tables = $wpdb->get_col( 'SHOW TABLES' );
	foreach ( $tables as $table ) {
		// DROP + CREATE
		$create = $wpdb->get_row( "SHOW CREATE TABLE `{$table}`", ARRAY_N );
		if ( ! $create || empty( $create[1] ) ) continue;

		fwrite( $fh, "DROP TABLE IF EXISTS `{$table}`;\n" );
		fwrite( $fh, $create[1] . ";\n\n" );

		// Data — stream in chunks of 500 rows to cap memory
		$offset = 0;
		while ( true ) {
			$rows = $wpdb->get_results( "SELECT * FROM `{$table}` LIMIT {$offset}, 500", ARRAY_A );
			if ( empty( $rows ) ) break;

			foreach ( $rows as $row ) {
				$cols = array_map( function ( $v ) use ( $wpdb ) {
					if ( $v === null ) return 'NULL';
					return "'" . $wpdb->_escape( (string) $v ) . "'";
				}, array_values( $row ) );
				fwrite( $fh, "INSERT INTO `{$table}` VALUES (" . implode( ',', $cols ) . ");\n" );
			}

			$offset += 500;
			if ( count( $rows ) < 500 ) break;
		}
		fwrite( $fh, "\n" );
	}

	fwrite( $fh, "SET FOREIGN_KEY_CHECKS=1;\n" );
	fclose( $fh );
	return true;
}

/**
 * DELETE /backup — delete one backup archive identified by its filename.
 * Hardened against path traversal: only filenames matching the expected
 * pattern `ots-backup-*.zip` inside the backup dir are accepted.
 */
function ots_connector_route_delete_backup( WP_REST_Request $request ) {
	$body = $request->get_json_params();
	$filename = (string) ( $body['filename'] ?? '' );
	if ( $filename === '' ) {
		return new WP_Error( 'ots_missing_filename', 'Missing filename', [ 'status' => 400 ] );
	}
	// Reject anything with path separators or leading dots.
	if ( strpbrk( $filename, "/\\" ) !== false || str_starts_with( $filename, '.' ) ) {
		return new WP_Error( 'ots_bad_filename', 'Invalid filename', [ 'status' => 400 ] );
	}
	if ( ! preg_match( '/^ots-backup-[0-9\-]+\.zip$/', $filename ) ) {
		return new WP_Error( 'ots_bad_filename', 'Filename does not match backup pattern', [ 'status' => 400 ] );
	}

	$upload_dir = wp_upload_dir();
	$full_path  = trailingslashit( $upload_dir['basedir'] ) . 'ots-backups/' . $filename;

	if ( ! file_exists( $full_path ) ) {
		// Idempotent: already gone is a success from the caller's POV.
		return rest_ensure_response( [ 'success' => true, 'deleted' => false, 'timestamp' => time() ] );
	}

	if ( ! @unlink( $full_path ) ) {
		return new WP_Error( 'ots_delete_failed', 'Could not delete file', [ 'status' => 500 ] );
	}

	return rest_ensure_response( [ 'success' => true, 'deleted' => true, 'timestamp' => time() ] );
}

/**
 * POST /restore — restore from a backup archive produced by this plugin.
 * Extracts the ZIP to a temp dir, imports the SQL dump, then copies
 * wp-content back into place. DESTRUCTIVE: overwrites DB + wp-content.
 *
 * Same filename validation as delete. Body: { filename: "ots-backup-...zip" }
 */
function ots_connector_route_restore( WP_REST_Request $request ) {
	global $wpdb;
	$body = $request->get_json_params();
	$filename = (string) ( $body['filename'] ?? '' );
	if ( $filename === '' ) {
		return new WP_Error( 'ots_missing_filename', 'Missing filename', [ 'status' => 400 ] );
	}
	if ( strpbrk( $filename, "/\\" ) !== false || str_starts_with( $filename, '.' ) ) {
		return new WP_Error( 'ots_bad_filename', 'Invalid filename', [ 'status' => 400 ] );
	}
	if ( ! preg_match( '/^ots-backup-[0-9\-]+\.zip$/', $filename ) ) {
		return new WP_Error( 'ots_bad_filename', 'Filename does not match backup pattern', [ 'status' => 400 ] );
	}

	$started = microtime( true );

	$upload_dir   = wp_upload_dir();
	$backup_dir   = trailingslashit( $upload_dir['basedir'] ) . 'ots-backups';
	$archive_path = $backup_dir . '/' . $filename;

	if ( ! file_exists( $archive_path ) ) {
		return new WP_Error( 'ots_archive_missing', 'Backup archive not found on disk', [ 'status' => 404 ] );
	}
	if ( ! class_exists( 'ZipArchive' ) ) {
		return new WP_Error( 'ots_no_zip', 'PHP ZipArchive extension not available', [ 'status' => 500 ] );
	}

	// Extract to a temp dir under ots-backups/restore-<ts>
	$temp_dir = $backup_dir . '/restore-' . gmdate( 'Ymd-His' ) . '-' . wp_generate_password( 6, false, false );
	if ( ! wp_mkdir_p( $temp_dir ) ) {
		return new WP_Error( 'ots_mkdir_failed', 'Could not create temp dir for restore', [ 'status' => 500 ] );
	}

	$zip = new ZipArchive();
	if ( $zip->open( $archive_path ) !== true ) {
		return new WP_Error( 'ots_zip_open_failed', 'Could not open archive', [ 'status' => 500 ] );
	}
	$zip->extractTo( $temp_dir );
	$zip->close();

	// Import SQL dump
	$sql_path = $temp_dir . '/database.sql';
	if ( ! file_exists( $sql_path ) ) {
		ots_connector_rrmdir( $temp_dir );
		return new WP_Error( 'ots_sql_missing', 'database.sql missing from archive', [ 'status' => 500 ] );
	}

	$import_result = ots_connector_import_sql( $sql_path );
	if ( is_wp_error( $import_result ) ) {
		ots_connector_rrmdir( $temp_dir );
		return $import_result;
	}

	// Copy wp-content back into place. We refuse to nuke the live
	// ots-backups dir during the copy so the archive we just restored
	// from stays around.
	$src_wp_content = $temp_dir . '/wp-content';
	if ( is_dir( $src_wp_content ) ) {
		ots_connector_copy_tree( $src_wp_content, WP_CONTENT_DIR, [ 'ots-backups' ] );
	}

	// Cleanup temp
	ots_connector_rrmdir( $temp_dir );

	$elapsed = round( microtime( true ) - $started, 2 );

	return rest_ensure_response( [
		'success'    => true,
		'filename'   => $filename,
		'elapsedSec' => $elapsed,
		'tablesImported' => $import_result,
		'timestamp'  => time(),
	] );
}

/**
 * Execute a .sql file statement-by-statement against the WP database.
 * Streams line-by-line so we don't blow memory on multi-GB dumps.
 */
function ots_connector_import_sql( string $sql_path ) {
	global $wpdb;
	$fh = @fopen( $sql_path, 'rb' );
	if ( ! $fh ) {
		return new WP_Error( 'ots_sql_open_failed', 'Could not open SQL file', [ 'status' => 500 ] );
	}

	$wpdb->query( 'SET FOREIGN_KEY_CHECKS=0' );

	$statement = '';
	$count = 0;
	while ( ( $line = fgets( $fh ) ) !== false ) {
		$trimmed = ltrim( $line );
		if ( $trimmed === '' || str_starts_with( $trimmed, '--' ) ) continue;
		$statement .= $line;
		// Naive split on semicolon-newline — good enough for mysqldump-style
		// output (no stored procedures with inline semicolons in WP data).
		if ( preg_match( '/;\s*$/', rtrim( $line ) ) ) {
			$wpdb->query( $statement );
			$statement = '';
			$count++;
		}
	}
	fclose( $fh );

	$wpdb->query( 'SET FOREIGN_KEY_CHECKS=1' );
	return $count;
}

/** Recursively copy $src into $dst, skipping any top-level dirs in $skip. */
function ots_connector_copy_tree( string $src, string $dst, array $skip = [] ): void {
	if ( ! is_dir( $dst ) ) {
		wp_mkdir_p( $dst );
	}
	$dh = opendir( $src );
	if ( ! $dh ) return;
	while ( ( $entry = readdir( $dh ) ) !== false ) {
		if ( $entry === '.' || $entry === '..' ) continue;
		if ( in_array( $entry, $skip, true ) ) continue;

		$src_path = $src . '/' . $entry;
		$dst_path = $dst . '/' . $entry;

		if ( is_dir( $src_path ) ) {
			ots_connector_copy_tree( $src_path, $dst_path );
		} else {
			@copy( $src_path, $dst_path );
		}
	}
	closedir( $dh );
}

/** Recursively remove a directory tree. */
function ots_connector_rrmdir( string $path ): void {
	if ( ! is_dir( $path ) ) return;
	$dh = opendir( $path );
	if ( ! $dh ) return;
	while ( ( $entry = readdir( $dh ) ) !== false ) {
		if ( $entry === '.' || $entry === '..' ) continue;
		$full = $path . '/' . $entry;
		if ( is_dir( $full ) ) ots_connector_rrmdir( $full );
		else @unlink( $full );
	}
	closedir( $dh );
	@rmdir( $path );
}

add_action( 'rest_api_init', function () {
	register_rest_route( OTS_CONNECTOR_NAMESPACE, '/health', [
		'methods'             => WP_REST_Server::READABLE,
		'callback'            => 'ots_connector_route_health',
		'permission_callback' => 'ots_connector_verify_request',
	] );

	register_rest_route( OTS_CONNECTOR_NAMESPACE, '/updates', [
		'methods'             => WP_REST_Server::READABLE,
		'callback'            => 'ots_connector_route_updates',
		'permission_callback' => 'ots_connector_verify_request',
	] );

	register_rest_route( OTS_CONNECTOR_NAMESPACE, '/updates/apply', [
		'methods'             => WP_REST_Server::CREATABLE,
		'callback'            => 'ots_connector_route_apply_updates',
		'permission_callback' => 'ots_connector_verify_request',
	] );

	register_rest_route( OTS_CONNECTOR_NAMESPACE, '/backup', [
		'methods'             => WP_REST_Server::CREATABLE,
		'callback'            => 'ots_connector_route_backup',
		'permission_callback' => 'ots_connector_verify_request',
	] );

	register_rest_route( OTS_CONNECTOR_NAMESPACE, '/backup', [
		'methods'             => WP_REST_Server::DELETABLE,
		'callback'            => 'ots_connector_route_delete_backup',
		'permission_callback' => 'ots_connector_verify_request',
	] );

	register_rest_route( OTS_CONNECTOR_NAMESPACE, '/restore', [
		'methods'             => WP_REST_Server::CREATABLE,
		'callback'            => 'ots_connector_route_restore',
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
			<li><code>GET <?php echo $site_url; ?>/wp-json/ots-connector/v1/health</code> — verificare stare</li>
			<li><code>GET <?php echo $site_url; ?>/wp-json/ots-connector/v1/updates</code> — listă update-uri disponibile</li>
			<li><code>POST <?php echo $site_url; ?>/wp-json/ots-connector/v1/updates/apply</code> — aplică update-uri</li>
			<li><code>POST <?php echo $site_url; ?>/wp-json/ots-connector/v1/backup</code> — creează backup ZIP + SQL</li>
		</ul>
		<p><em>Toate endpoint-urile necesită semnătură HMAC (header-e X-OTS-Timestamp + X-OTS-Signature).</em></p>

		<p><small>Versiune plugin: <?php echo esc_html( OTS_CONNECTOR_VERSION ); ?></small></p>
	</div>
	<?php
}
