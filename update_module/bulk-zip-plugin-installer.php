<?php
/**
 * Plugin Name: Bulk ZIP Plugin Installer (Enhanced with FTP)
 * Description: Încărcare & update pentru mai multe pluginuri .zip deodată din upload local sau FTP (cu suprascriere) + setări: limită mărime, dry-run, whitelist/blacklist, log. Pagină: Instrumente → Bulk ZIP Plugins.
 * Version: 1.5.0
 * Author: OTS
 * License: GPL-2.0-or-later
 * Text Domain: ots-bulk-zip
 */

if ( ! defined( 'ABSPATH' ) ) exit;

class OTS_Bulk_ZIP_Plugin_Installer {
    private static $instance = null;
    private $opt_key = 'ots_bulk_zip_settings';

    public static function instance() {
        return self::$instance ?: ( self::$instance = new self() );
    }

    private function __construct() {
        add_action( 'admin_menu', [ $this, 'add_menu' ] );
        add_action( 'admin_post_ots_bulk_zip_install', [ $this, 'handle_upload' ] );
        add_action( 'admin_post_ots_bulk_zip_ftp_install', [ $this, 'handle_ftp_install' ] );
        add_action( 'admin_post_ots_bulk_zip_save_settings', [ $this, 'save_settings' ] );
        add_action( 'admin_post_ots_download_logs', [ $this, 'download_logs' ] );
        add_action( 'admin_post_ots_clear_logs', [ $this, 'clear_logs' ] );
        add_action( 'wp_ajax_ots_test_ftp_connection', [ $this, 'test_ftp_connection' ] );
        add_action( 'wp_ajax_ots_list_ftp_files', [ $this, 'list_ftp_files' ] );
        add_action( 'wp_ajax_ots_compare_versions', [ $this, 'compare_versions' ] );
        add_action( 'wp_ajax_ots_save_automation', [ $this, 'save_automation' ] );
        add_action( 'wp_ajax_ots_test_automation', [ $this, 'test_automation' ] );
        add_action( 'wp_ajax_ots_force_automation', [ $this, 'force_automation' ] );
        add_action( 'wp_ajax_ots_test_performance', [ $this, 'test_performance' ] );
        add_action( 'admin_enqueue_scripts', [ $this, 'enqueue_scripts' ] );
        
        // Hook pentru cronjob-ul automat
        add_action( 'ots_auto_update_plugins', [ $this, 'run_automated_update' ] );
        
        // Activează cronjob-ul la activarea plugin-ului
        register_activation_hook( __FILE__, [ $this, 'activate_cron' ] );
        register_deactivation_hook( __FILE__, [ $this, 'deactivate_cron' ] );
        
        // Adaugă hook pentru debugging cronjob-urilor
        add_action( 'init', [ $this, 'debug_cron_status' ] );
        
        // Adaugă hook pentru verificarea și forțarea execuției cronjob-urilor (optimizat)
        add_action( 'wp_loaded', [ $this, 'check_and_force_cron_execution_optimized' ] );
    }

    // Funcția a fost eliminată - nu mai există restricția de super admin

    private function get_settings() {
        $defaults = [
            'max_mb'        => 64,     // limită per fișier
            'dry_run'       => 0,      // 1 = nu instalează, doar simulează
            'whitelist'     => '',     // slugs permise, câte unul pe linie
            'blacklist'     => '',     // slugs interzise, câte unul pe linie
            'logging'       => 1,      // scrie log în uploads
            'ftp_host'      => 'ftp.onetopsolution.ro',     // Server FTP
            'ftp_port'      => 21,     // Port FTP
            'ftp_user'      => 'augustin@onetopsolution.ro',     // Utilizator FTP
            'ftp_pass'      => '',     // Parolă FTP (criptată) - se va completa la prima salvare
            'ftp_path'      => 'public_html/plugins/',    // Calea către folderul cu pluginuri pe FTP
            'ftp_passive'   => 1,      // Mod pasiv FTP
            'ftp_ssl'       => 0,      // FTPS (FTP over SSL)
            'auto_update_enabled' => 0,    // Actualizare automată activată
            'auto_update_frequency' => 'daily',    // Frecvența: daily, weekly, monthly
            'auto_update_time' => '02:00',    // Ora de actualizare (24h format)
            'auto_update_day' => 'monday',    // Ziua pentru actualizări săptămânale
            'auto_update_plugins' => 'all',    // Ce să actualizeze: all, selected, none
            'auto_update_selected_plugins' => '',    // Lista pluginurilor selectate pentru actualizare automată
            'auto_update_notify_email' => '',    // Email pentru notificări
            'auto_update_dry_run' => 0,    // Dry run pentru actualizări automate
        ];
        $opts = get_option( $this->opt_key, [] );
        return wp_parse_args( $opts, $defaults );
    }

    // Criptare simplă pentru parola FTP
    private function encrypt_password( $password ) {
        if ( empty( $password ) ) return '';
        return base64_encode( $password . '|' . AUTH_KEY );
    }

    private function decrypt_password( $encrypted ) {
        if ( empty( $encrypted ) ) return '';
        $decoded = base64_decode( $encrypted );
        if ( strpos( $decoded, '|' ) !== false ) {
            list( $password, $key ) = explode( '|', $decoded, 2 );
            return ( $key === AUTH_KEY ) ? $password : '';
        }
        return '';
    }

    public function enqueue_scripts( $hook ) {
        if ( $hook !== 'tools_page_ots-bulk-zip-plugins' ) return;
        
        wp_enqueue_script( 'ots-bulk-zip-admin', plugin_dir_url( __FILE__ ) . 'admin.js', [ 'jquery' ], '1.2.0', true );
        wp_localize_script( 'ots-bulk-zip-admin', 'ots_ajax', [
            'ajaxurl' => admin_url( 'admin-ajax.php' ),
            'nonce' => wp_create_nonce( 'ots_ftp_ajax' ),
        ] );
    }

    public function add_menu() {
        add_management_page(
            'Bulk ZIP Plugins',
            'Bulk ZIP Plugins',
            'install_plugins',
            'ots-bulk-zip-plugins',
            [ $this, 'render_page' ]
        );
    }

    public function render_page() {
        if ( ! current_user_can( 'install_plugins' ) ) {
            wp_die( esc_html__( 'Nu ai permisiuni.', 'ots-bulk-zip' ) );
        }

        $s = $this->get_settings();
        ?>
        <div class="wrap">
            <h1>Bulk ZIP Plugins Installer</h1>
            <p>Încarcă mai multe arhive <code>.zip</code> cu pluginuri pentru <strong>instalare</strong> sau <strong>actualizare</strong> în lanț din upload local sau server FTP.</p>
            
            <!-- Tab Navigation -->
            <h2 class="nav-tab-wrapper">
                <a href="#tab-local" class="nav-tab nav-tab-active" onclick="switchTab(event, 'tab-local')">📁 Upload Local</a>
                <a href="#tab-ftp" class="nav-tab" onclick="switchTab(event, 'tab-ftp')">🌐 FTP Download</a>
                <a href="#tab-settings" class="nav-tab" onclick="switchTab(event, 'tab-settings')">⚙️ Setări</a>
                                    <a href="#tab-logs" class="nav-tab" onclick="switchTab(event, 'tab-logs')">📋 Logs</a>
                    <a href="#tab-automation" class="nav-tab" onclick="switchTab(event, 'tab-automation')">🤖 Automatizare</a>
            </h2>

            <!-- Tab Local Upload -->
            <div id="tab-local" class="tab-content">
                <h3>Upload Local de Pluginuri ZIP</h3>
                <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" enctype="multipart/form-data" style="margin:2em 0;">
                <?php wp_nonce_field( 'ots_bulk_zip_install' ); ?>
                <input type="hidden" name="action" value="ots_bulk_zip_install">
                    <table class="form-table" role="presentation">
                        <tr>
                            <th scope="row">Selectează fișiere ZIP</th>
                            <td>
                                <input type="file" name="plugin_zips[]" accept=".zip" multiple required>
                                <p class="description">Poți selecta mai multe fișiere ZIP deodată (Ctrl+Click sau Cmd+Click)</p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row">Opțiuni</th>
                            <td>
                                <label><input type="checkbox" name="activate_after" value="1"> Activează automat după instalare</label><br>
                    <label><input type="checkbox" name="dry_run" value="1" <?php checked( $s['dry_run'], 1 ); ?>> Dry-run (simulare, nu instalează)</label>
                            </td>
                        </tr>
                    </table>
                    <div class="action-buttons" style="margin-top: 20px;">
                        <button type="submit" name="action_type" value="install" class="button button-primary button-large" style="width: 100%; margin-bottom: 10px; padding: 15px 20px; font-size: 16px; font-weight: 600; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); transition: all 0.3s ease;">
                            🆕 Instalează și Activează Module Noi
                        </button>
                        <button type="submit" name="action_type" value="update" class="button button-secondary button-large" style="width: 100%; padding: 15px 20px; font-size: 16px; font-weight: 600; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); transition: all 0.3s ease; background: #f8f9fa; border: 2px solid #0073aa; color: #0073aa;">
                            🔄 Actualizează Module Existente
                        </button>
                    </div>
                </form>
                <div class="notice notice-info inline">
                    <p><strong>Notă:</strong> Se aplică setările din secțiunea "Setări" (limită mărime, whitelist/blacklist, logging).</p>
                </div>
            </div>

            <!-- Tab FTP -->
            <div id="tab-ftp" class="tab-content" style="display:none;">
                <h3>Download și Instalare din Server FTP</h3>
                <div style="margin:2em 0;">
                    <?php if ( ! empty( $s['ftp_host'] ) ): ?>
                        <div class="ftp-connection-info">
                            <p><strong>Server configurat:</strong> 
                                <code><?php echo esc_html( $s['ftp_host'] ); ?>:<?php echo esc_html( $s['ftp_port'] ); ?></code>
                                <?php if ( $s['ftp_ssl'] ): ?><span class="dashicons dashicons-lock" title="FTPS (SSL)"></span><?php endif; ?>
                            </p>
                            <p><strong>Utilizator:</strong> <code><?php echo esc_html( $s['ftp_user'] ); ?></code></p>
                            <p><strong>Cale:</strong> <code><?php echo esc_html( $s['ftp_path'] ); ?></code></p>
                            <?php if ( empty( $s['ftp_pass'] ) ): ?>
                                <p style="color: #dba617; margin-top: 10px;"><strong>⚠️ Atenție:</strong> Parola FTP nu este încă configurată. Mergi la tab-ul "⚙️ Setări" și salvează setările pentru a configura parola automat.</strong></p>
                            <?php endif; ?>
                        </div>
                        
                        <p>
                            <button type="button" class="button button-secondary" onclick="testFtpConnection()" id="test-ftp-btn">
                                <span class="dashicons dashicons-admin-network"></span> Testează Conexiunea
                            </button>
                            <button type="button" class="button button-secondary" onclick="listFtpFiles()" id="list-files-btn">
                                <span class="dashicons dashicons-media-archive"></span> Listează Fișiere ZIP
                            </button>
                            <button type="button" class="button button-secondary" onclick="compareVersions()" id="compare-versions-btn">
                                <span class="dashicons dashicons-update-alt"></span> Compară Versiuni
                            </button>
                            <button type="button" class="button button-secondary" onclick="refreshFtpFiles()" id="refresh-files-btn" style="display:none;">
                                <span class="dashicons dashicons-update"></span> Reîmprospătează
                            </button>
                        </p>
                        
                        <div id="ftp-status" class="ftp-status"></div>
                        <div id="ftp-files" class="ftp-files"></div>
                        <div id="version-comparison" class="version-comparison" style="display:none;"></div>
                        
                        <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" id="ftp-install-form" style="margin-top:2em; display:none;">
                            <?php wp_nonce_field( 'ots_bulk_zip_ftp_install' ); ?>
                            <input type="hidden" name="action" value="ots_bulk_zip_ftp_install">
                            <input type="hidden" name="selected_files" id="selected_files" value="">
                            
                            <table class="form-table" role="presentation">
                                <tr>
                                    <th scope="row">Fișiere selectate</th>
                                    <td>
                                        <div id="selected-files-display" class="selected-files-display">
                                            Niciun fișier selectat
                                        </div>
                                    </td>
                                </tr>
                                <tr>
                                    <th scope="row">Opțiuni</th>
                                    <td>
                                        <label><input type="checkbox" name="activate_after" value="1"> Activează automat după instalare</label><br>
                                        <label><input type="checkbox" name="dry_run" value="1" <?php checked( $s['dry_run'], 1 ); ?>> Dry-run (simulare, nu instalează)</label>
                                    </td>
                                </tr>
                            </table>
                            <div class="action-buttons" style="margin-top: 20px;">
                                <button type="submit" name="action_type" value="install" class="button button-primary button-large" id="ftp-install-btn" style="width: 100%; margin-bottom: 10px; padding: 15px 20px; font-size: 16px; font-weight: 600; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); transition: all 0.3s ease;">
                                    🌐 Instalează și Activează Module Noi din FTP
                                </button>
                                <button type="submit" name="action_type" value="update" class="button button-secondary button-large" id="ftp-update-btn" style="width: 100%; padding: 15px 20px; font-size: 16px; font-weight: 600; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); transition: all 0.3s ease; background: #f8f9fa; border: 2px solid #0073aa; color: #0073aa;">
                                    🌐 Actualizează Module Existente din FTP
                                </button>
                            </div>
            </form>
                    <?php else: ?>
                        <div class="notice notice-warning inline">
                            <p><strong>Nu ai configurat încă setările FTP.</strong> Mergi la tab-ul "⚙️ Setări" pentru a configura conexiunea FTP.</p>
                        </div>
                    <?php endif; ?>
                </div>
            </div>

            <!-- Tab Settings -->
            <div id="tab-settings" class="tab-content" style="display:none;">
                <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="margin:2em 0;">
                <?php wp_nonce_field( 'ots_bulk_zip_save_settings' ); ?>
                <input type="hidden" name="action" value="ots_bulk_zip_save_settings">
                    
                    <h3>Setări Generale</h3>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row"><label for="max_mb">Limită mărime fișier (MB)</label></th>
                            <td>
                                <input type="number" id="max_mb" name="max_mb" min="1" step="1" value="<?php echo esc_attr( (int) $s['max_mb'] ); ?>" class="small-text"> MB
                                <p class="description">Fișierele mai mari de această limită vor fi respinse (implicit: 64 MB)</p>
                            </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="whitelist">Whitelist slugs (opțional)</label></th>
                            <td>
                                <textarea id="whitelist" name="whitelist" rows="4" cols="60" placeholder="elementor&#10;woocommerce&#10;advanced-custom-fields"><?php echo esc_textarea( $s['whitelist'] ); ?></textarea>
                                <p class="description">Dacă este completat, se acceptă <strong>DOAR</strong> aceste slugs (câte unul pe linie)</p>
                            </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="blacklist">Blacklist slugs (opțional)</label></th>
                            <td>
                                <textarea id="blacklist" name="blacklist" rows="4" cols="60" placeholder="old-plugin&#10;bad-plugin&#10;deprecated-plugin"><?php echo esc_textarea( $s['blacklist'] ); ?></textarea>
                                <p class="description">Pluginurile cu aceste slugs vor fi <strong>respinse</strong> (câte unul pe linie)</p>
                            </td>
                    </tr>
                    <tr>
                        <th scope="row">Logging</th>
                            <td>
                                <label><input type="checkbox" name="logging" value="1" <?php checked( $s['logging'], 1 ); ?>> Activează logging-ul</label>
                                <p class="description">Scrie log detaliat în <code>wp-content/uploads/ots-bulk-zip-installer.log</code></p>
                            </td>
                    </tr>
                </table>

                    <h3>Setări FTP/FTPS</h3>
                    <div class="notice notice-info inline" style="margin-bottom: 20px;">
                        <p><strong>ℹ️ Configurație predefinită:</strong> Setările FTP sunt preconfigurate pentru serverul onetopsolution.ro. Poți modifica aceste setări dacă ai nevoie să te conectezi la alt server FTP.</p>
                    </div>
                    <table class="form-table" role="presentation">
                        <tr>
                            <th scope="row"><label for="ftp_host">Server FTP</label></th>
                            <td>
                                <input type="text" id="ftp_host" name="ftp_host" value="<?php echo esc_attr( $s['ftp_host'] ); ?>" placeholder="ftp.example.com" class="regular-text">
                                <p class="description">Adresa IP sau hostname-ul serverului FTP</p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="ftp_port">Port</label></th>
                            <td>
                                <input type="number" id="ftp_port" name="ftp_port" min="1" max="65535" value="<?php echo esc_attr( (int) $s['ftp_port'] ); ?>" class="small-text">
                                <p class="description">Port-ul serverului FTP (implicit: 21 pentru FTP, 990 pentru FTPS)</p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="ftp_user">Utilizator</label></th>
                            <td>
                                <input type="text" id="ftp_user" name="ftp_user" value="<?php echo esc_attr( $s['ftp_user'] ); ?>" class="regular-text" autocomplete="username">
                                <p class="description">Username-ul pentru autentificare FTP</p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="ftp_pass">Parolă</label></th>
                            <td>
                                <input type="password" id="ftp_pass" name="ftp_pass" value="" placeholder="<?php echo ! empty( $s['ftp_pass'] ) ? '••••••••' : 'Introdu parola'; ?>" class="regular-text" autocomplete="current-password">
                                <p class="description">
                                    <?php if ( ! empty( $s['ftp_pass'] ) ): ?>
                                        Parola este salvată. Lasă gol pentru a păstra parola curentă.
                                    <?php else: ?>
                                        Parola pentru autentificare FTP (va fi criptată în baza de date)
                                        <br><strong>Notă:</strong> La prima instalare, parola va fi setată automat din configurația predefinită.
                                    <?php endif; ?>
                                </p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="ftp_path">Cale către pluginuri</label></th>
                            <td>
                                <input type="text" id="ftp_path" name="ftp_path" value="<?php echo esc_attr( $s['ftp_path'] ); ?>" placeholder="/plugins/" class="regular-text">
                                <p class="description">Folderul de pe serverul FTP unde sunt stocate fișierele ZIP cu pluginuri</p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row">Opțiuni avansate</th>
                            <td>
                                <label><input type="checkbox" name="ftp_passive" value="1" <?php checked( $s['ftp_passive'], 1 ); ?>> Mod pasiv FTP</label><br>
                                <label><input type="checkbox" name="ftp_ssl" value="1" <?php checked( $s['ftp_ssl'], 1 ); ?>> FTPS (FTP over SSL/TLS)</label>
                                <p class="description">Modul pasiv este recomandat pentru majoritatea serverelor. FTPS oferă o conexiune criptată.</p>
                            </td>
                        </tr>
                    </table>
                    <p><button class="button button-primary">💾 Salvează Setările</button></p>
            </form>
        </div>

            <!-- Tab Logs -->
            <div id="tab-logs" class="tab-content" style="display:none;">
                <h3>📋 Logs Plugin Installer</h3>
                <div style="margin:2em 0;">
        <?php
                    $upload_dir = wp_upload_dir();
                    $log_file = trailingslashit( $upload_dir['basedir'] ) . 'ots-bulk-zip-installer.log';
                    
                    if ( file_exists( $log_file ) ) {
                        $log_content = file_get_contents( $log_file );
                        $log_lines = explode( PHP_EOL, $log_content );
                        $log_lines = array_filter( $log_lines ); // Elimină liniile goale
                        
                        if ( ! empty( $log_lines ) ) {
                            $total_lines = count( $log_lines );
                            $lines_to_show = 100; // Afișează ultimele 100 de linii
                            $start_line = max( 0, $total_lines - $lines_to_show );
                            $recent_lines = array_slice( $log_lines, $start_line );
                            
                            echo '<div class="log-info" style="background: #f8f9fa; padding: 15px; border-left: 4px solid #0073aa; margin-bottom: 20px;">';
                            echo '<p><strong>📊 Informații Log:</strong></p>';
                            echo '<ul style="margin-left: 20px;">';
                            echo '<li><strong>Fișier log:</strong> <code>' . esc_html( $log_file ) . '</code></li>';
                            echo '<li><strong>Total linii:</strong> ' . number_format( $total_lines ) . '</li>';
                            echo '<li><strong>Ultima modificare:</strong> ' . date( 'd.m.Y H:i:s', filemtime( $log_file ) ) . '</li>';
                            echo '<li><strong>Dimensiune:</strong> ' . $this->format_file_size( filesize( $log_file ) ) . '</li>';
                            echo '</ul>';
                            echo '</div>';
                            
                            echo '<div class="log-actions" style="margin-bottom: 20px;">';
                            echo '<button type="button" class="button button-secondary" onclick="refreshLogs()" id="refresh-logs-btn">';
                            echo '<span class="dashicons dashicons-update"></span> Reîmprospătează Logs';
                            echo '</button>';
                            echo '<button type="button" class="button button-secondary" onclick="downloadLogs()" id="download-logs-btn">';
                            echo '<span class="dashicons dashicons-download"></span> Descarcă Log Complet';
                            echo '</button>';
                            echo '<button type="button" class="button button-secondary" onclick="clearLogs()" id="clear-logs-btn" style="margin-left: 10px;">';
                            echo '<span class="dashicons dashicons-trash"></span> Șterge Log';
                            echo '</button>';
                            echo '</div>';
                            
                            echo '<div class="log-content" style="background: #1e1e1e; color: #d4d4d4; padding: 20px; border-radius: 4px; font-family: \'Courier New\', monospace; font-size: 12px; line-height: 1.4; max-height: 500px; overflow-y: auto; border: 1px solid #ddd;">';
                            
                            if ( $start_line > 0 ) {
                                echo '<div style="color: #888; margin-bottom: 15px; padding: 10px; background: #2d2d2d; border-radius: 3px;">';
                                echo '📝 Afișez ultimele ' . $lines_to_show . ' linii din ' . $total_lines . ' (linia ' . ( $start_line + 1 ) . ' - ' . $total_lines . ')';
                                echo '</div>';
                            }
                            
                            foreach ( $recent_lines as $line ) {
                                if ( ! empty( trim( $line ) ) ) {
                                    // Colorează diferite tipuri de mesaje
                                    $line_class = '';
                                    if ( strpos( $line, 'EROARE' ) !== false ) {
                                        $line_class = 'log-error';
                                    } elseif ( strpos( $line, 'INSTALAT' ) !== false ) {
                                        $line_class = 'log-success';
                                    } elseif ( strpos( $line, 'DRY-RUN' ) !== false ) {
                                        $line_class = 'log-warning';
                                    } elseif ( strpos( $line, 'RESPINS' ) !== false ) {
                                        $line_class = 'log-info';
                                    }
                                    
                                    echo '<div class="log-line ' . $line_class . '">' . esc_html( $line ) . '</div>';
                                }
                            }
                            
                            echo '</div>';
                        } else {
                            echo '<div class="notice notice-info inline">';
                            echo '<p><strong>📝 Log gol:</strong> Nu există încă înregistrări în log.</p>';
                            echo '</div>';
                        }
                    } else {
                        echo '<div class="notice notice-warning inline">';
                        echo '<p><strong>⚠️ Fișier log inexistent:</strong> Fișierul de log nu a fost încă creat.</p>';
                        echo '<p>Logurile vor apărea aici după prima operațiune de instalare/actualizare.</p>';
                        echo '</div>';
                    }
                    ?>
                </div>
            </div>

            <!-- Tab Automatizare -->
            <div id="tab-automation" class="tab-content" style="display:none;">
                <h3>🤖 Automatizare Actualizări Pluginuri</h3>
                <p>Configurează actualizările automate ale pluginurilor din serverul FTP la intervale regulate.</p>
                
                <div class="automation-status" style="margin: 20px 0; padding: 15px; background: #f8f9fa; border-left: 4px solid #0073aa; border-radius: 4px;">
                    <h4>📊 Status Automatizare</h4>
                    <?php
                    $next_run = wp_next_scheduled( 'ots_auto_update_plugins' );
                    $settings = $this->get_settings();
                    
                    if ( $next_run && $settings['auto_update_enabled'] ) {
                        $next_run_local = get_date_from_gmt( date( 'Y-m-d H:i:s', $next_run ), 'd.m.Y H:i:s' );
                        echo '<p><strong>✅ Automatizarea este activă</strong></p>';
                        echo '<p><strong>🕒 Următoarea execuție:</strong> ' . $next_run_local . '</p>';
                        echo '<p><strong>🔄 Frecvența:</strong> ' . ucfirst( $settings['auto_update_frequency'] ) . ' la ' . $settings['auto_update_time'] . '</p>';
                        
                        if ( $settings['auto_update_frequency'] === 'weekly' ) {
                            $day_names = [
                                'monday' => 'Luni', 'tuesday' => 'Marți', 'wednesday' => 'Miercuri',
                                'thursday' => 'Joi', 'friday' => 'Vineri', 'saturday' => 'Sâmbătă', 'sunday' => 'Duminică'
                            ];
                            echo '<p><strong>📅 Ziua săptămânii:</strong> ' . $day_names[ $settings['auto_update_day'] ] . '</p>';
                        }
                    } else {
                        if ( $settings['auto_update_enabled'] ) {
                            echo '<p><strong>⚠️ Automatizarea este configurată dar nu rulează</strong></p>';
                            echo '<p><em>Salvează setările pentru a activa cronjob-ul.</em></p>';
                        } else {
                            echo '<p><strong>❌ Automatizarea este inactivă</strong></p>';
                            echo '<p><em>Bifează "Activează Automatizarea" și salvează setările.</em></p>';
                        }
                    }
                    ?>
                </div>

                <form id="automation-form" method="post">
                    <?php wp_nonce_field( 'ots_automation_settings' ); ?>
                    
                    <table class="form-table" role="presentation">
                        <tr>
                            <th scope="row">
                                <label for="auto_update_enabled">Activează Automatizarea</label>
                            </th>
                            <td>
                                <input type="checkbox" id="auto_update_enabled" name="auto_update_enabled" value="1" <?php checked( $s['auto_update_enabled'], 1 ); ?>>
                                <p class="description">Activează actualizările automate ale pluginurilor</p>
                            </td>
                        </tr>
                        
                        <tr>
                            <th scope="row">
                                <label for="auto_update_frequency">Frecvența</label>
                            </th>
                            <td>
                                <select id="auto_update_frequency" name="auto_update_frequency">
                                    <option value="daily" <?php selected( $s['auto_update_frequency'], 'daily' ); ?>>Zilnic</option>
                                    <option value="weekly" <?php selected( $s['auto_update_frequency'], 'weekly' ); ?>>Săptămânal</option>
                                    <option value="monthly" <?php selected( $s['auto_update_frequency'], 'monthly' ); ?>>Lunar</option>
                                </select>
                                <p class="description">Cât de des să se execute actualizările automate</p>
                            </td>
                        </tr>
                        
                        <tr>
                            <th scope="row">
                                <label for="auto_update_time">Ora de Execuție</label>
                            </th>
                            <td>
                                <input type="time" id="auto_update_time" name="auto_update_time" value="<?php echo esc_attr( $s['auto_update_time'] ); ?>" step="900">
                                <p class="description">Ora la care să se execute actualizările (format 24h, ex: 13:30 pentru 1:30 PM)</p>
                                <p class="description"><strong>Notă:</strong> Folosește formatul 24h: 00:00-23:59</p>
                            </td>
                        </tr>
                        
                        <tr id="weekly-day-row" style="display: none;">
                            <th scope="row">
                                <label for="auto_update_day">Ziua Săptămânii</label>
                            </th>
                            <td>
                                <select id="auto_update_day" name="auto_update_day">
                                    <option value="monday" <?php selected( $s['auto_update_day'], 'monday' ); ?>>Luni</option>
                                    <option value="tuesday" <?php selected( $s['auto_update_day'], 'tuesday' ); ?>>Marți</option>
                                    <option value="wednesday" <?php selected( $s['auto_update_day'], 'wednesday' ); ?>>Miercuri</option>
                                    <option value="thursday" <?php selected( $s['auto_update_day'], 'thursday' ); ?>>Joi</option>
                                    <option value="friday" <?php selected( $s['auto_update_day'], 'friday' ); ?>>Vineri</option>
                                    <option value="saturday" <?php selected( $s['auto_update_day'], 'saturday' ); ?>>Sâmbătă</option>
                                    <option value="sunday" <?php selected( $s['auto_update_day'], 'sunday' ); ?>>Duminică</option>
                                </select>
                                <p class="description">Ziua săptămânii pentru actualizări săptămânale</p>
                            </td>
                        </tr>
                        
                        <tr>
                            <th scope="row">
                                <label for="auto_update_plugins">Ce să Actualizeze</label>
                            </th>
                            <td>
                                <select id="auto_update_plugins" name="auto_update_plugins">
                                    <option value="all" <?php selected( $s['auto_update_plugins'], 'all' ); ?>>Toate pluginurile cu actualizări disponibile</option>
                                    <option value="selected" <?php selected( $s['auto_update_plugins'], 'selected' ); ?>>Doar pluginurile selectate</option>
                                    <option value="none" <?php selected( $s['auto_update_plugins'], 'none' ); ?>>Nu actualiza nimic (doar verifică)</option>
                                </select>
                                <p class="description">Ce pluginuri să fie actualizate automat</p>
                            </td>
                        </tr>
                        
                        <tr id="selected-plugins-row" style="display: none;">
                            <th scope="row">
                                <label for="auto_update_selected_plugins">Pluginuri Selectate</label>
                            </th>
                            <td>
                                <textarea id="auto_update_selected_plugins" name="auto_update_selected_plugins" rows="5" cols="50" placeholder="Introdu slug-urile pluginurilor, câte unul pe linie&#10;Exemplu:&#10;woocommerce&#10;yoast-seo&#10;contact-form-7"><?php echo esc_textarea( $s['auto_update_selected_plugins'] ); ?></textarea>
                                <p class="description">Lista pluginurilor care vor fi actualizate automat (doar dacă "Ce să Actualizeze" este setat pe "Doar pluginurile selectate")</p>
                            </td>
                        </tr>
                        
                        <tr>
                            <th scope="row">
                                <label for="auto_update_notify_email">Email Notificări</label>
                            </th>
                            <td>
                                <input type="email" id="auto_update_notify_email" name="auto_update_notify_email" value="<?php echo esc_attr( $s['auto_update_notify_email'] ); ?>" class="regular-text">
                                <p class="description">Email-ul unde să se trimită notificări despre actualizările automate (opțional)</p>
                            </td>
                        </tr>
                        
                        <tr>
                            <th scope="row">
                                <label for="auto_update_dry_run">Dry Run (Test)</label>
                            </th>
                            <td>
                                <input type="checkbox" id="auto_update_dry_run" name="auto_update_dry_run" value="1" <?php checked( $s['auto_update_dry_run'], 1 ); ?>>
                                <p class="description">Activează pentru a testa automatizarea fără a face actualizări reale</p>
                            </td>
                        </tr>
                    </table>
                    
                    <div class="automation-actions" style="margin-top: 20px;">
                        <button type="button" class="button button-primary" onclick="saveAutomationSettings()">
                            <span class="dashicons dashicons-saved"></span> Salvează Setările
                        </button>
                        <button type="button" class="button button-secondary" onclick="testAutomation()" style="margin-left: 10px;">
                            <span class="dashicons dashicons-controls-play"></span> Testează Automatizarea
                        </button>
                        <button type="button" class="button button-warning" onclick="forceAutomationExecution()" style="margin-left: 10px;">
                            <span class="dashicons dashicons-update"></span> Forțează Execuția
                        </button>
                    </div>
                </form>
            </div>
        </div>

        <style>
        .nav-tab-wrapper { margin-bottom: 0; }
        .tab-content { padding: 20px; border: 1px solid #ccd0d4; border-top: none; background: #fff; }
        .ftp-connection-info { background: #f8f9fa; padding: 15px; border-left: 4px solid #0073aa; margin-bottom: 20px; }
        .ftp-status { margin: 15px 0; padding: 10px; border-radius: 4px; }
        .ftp-status.success { background: #d1edff; border-left: 4px solid #0073aa; }
        .ftp-status.error { background: #ffebe9; border-left: 4px solid #d63638; }
        .ftp-status.loading { background: #fff3cd; border-left: 4px solid #dba617; }
        .ftp-files { max-height: 400px; overflow-y: auto; border: 1px solid #ddd; margin: 15px 0; }
        .ftp-file-item { 
            padding: 12px 15px; 
            border-bottom: 1px solid #eee; 
            cursor: pointer; 
            display: flex; 
            align-items: center;
            transition: background-color 0.2s;
        }
        .ftp-file-item:hover { background-color: #f0f6fc; }
        .ftp-file-item.selected { background-color: #0073aa; color: white; }
        .ftp-file-item input[type="checkbox"] { margin-right: 12px; }
        .ftp-file-info { flex: 1; }
        .ftp-file-name { font-weight: 600; margin-bottom: 4px; }
        .ftp-file-size { font-size: 12px; opacity: 0.8; }
        .selected-files-display { 
            background: #f8f9fa; 
            padding: 10px; 
            border: 1px solid #ddd; 
            border-radius: 4px;
            min-height: 40px;
            line-height: 1.5;
        }
        .button-large { padding: 8px 16px !important; height: auto !important; line-height: 1.4 !important; }
        .notice.inline { display: block; margin: 20px 0; }
        
        /* Stiluri îmbunătățite pentru butoane */
        .button-primary.button-large:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.2) !important;
        }
        
        .button-secondary.button-large:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.2) !important;
            background: #e3f2fd !important;
        }
        
        /* Stiluri pentru butoanele de acțiune */
        .action-buttons .button {
            position: relative;
            overflow: hidden;
        }
        
        .action-buttons .button::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
            transition: left 0.5s;
        }
        
        .action-buttons .button:hover::before {
            left: 100%;
        }
        </style>

        <script>
        function switchTab(evt, tabName) {
            var i, tabcontent, tablinks;
            tabcontent = document.getElementsByClassName("tab-content");
            for (i = 0; i < tabcontent.length; i++) {
                tabcontent[i].style.display = "none";
            }
            tablinks = document.getElementsByClassName("nav-tab");
            for (i = 0; i < tablinks.length; i++) {
                tablinks[i].classList.remove("nav-tab-active");
            }
            document.getElementById(tabName).style.display = "block";
            evt.currentTarget.classList.add("nav-tab-active");
        }

        function showStatus(message, type = 'info') {
            const statusDiv = document.getElementById('ftp-status');
            statusDiv.className = 'ftp-status ' + type;
            statusDiv.innerHTML = message;
        }

        function testFtpConnection() {
            const btn = document.getElementById('test-ftp-btn');
            btn.disabled = true;
            btn.innerHTML = '<span class="dashicons dashicons-update-alt spin"></span> Testez...';
            
            showStatus('<span class="dashicons dashicons-update-alt"></span> Testez conexiunea FTP...', 'loading');
            
            fetch('<?php echo admin_url( 'admin-ajax.php' ); ?>', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'action=ots_test_ftp_connection&_ajax_nonce=' + '<?php echo wp_create_nonce( 'ots_ftp_ajax' ); ?>'
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    showStatus('<span class="dashicons dashicons-yes-alt"></span> Conexiune FTP reușită! Serverul este accesibil.', 'success');
                } else {
                    showStatus('<span class="dashicons dashicons-dismiss"></span> Eroare conexiune: ' + data.data, 'error');
                }
            })
            .catch(error => {
                showStatus('<span class="dashicons dashicons-warning"></span> Eroare de rețea: ' + error.message, 'error');
            })
            .finally(() => {
                btn.disabled = false;
                btn.innerHTML = '<span class="dashicons dashicons-admin-network"></span> Testează Conexiunea';
            });
        }

        function listFtpFiles() {
            const btn = document.getElementById('list-files-btn');
            btn.disabled = true;
            btn.innerHTML = '<span class="dashicons dashicons-update-alt spin"></span> Se încarcă...';
            
            document.getElementById('ftp-files').innerHTML = '<p style="padding: 20px; text-align: center;"><span class="dashicons dashicons-update-alt spin"></span> Se încarcă lista de fișiere...</p>';
            
            fetch('<?php echo admin_url( 'admin-ajax.php' ); ?>', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'action=ots_list_ftp_files&_ajax_nonce=' + '<?php echo wp_create_nonce( 'ots_ftp_ajax' ); ?>'
            })
            .then(response => response.json())
            .then(data => {
                if (data.success && data.data.length > 0) {
                    let html = '';
                    data.data.forEach(file => {
                        html += `<div class="ftp-file-item" onclick="toggleFileSelection('${file.name}', this)">
                            <input type="checkbox" onchange="updateSelectedFiles()" onclick="event.stopPropagation();">
                            <div class="ftp-file-info">
                                <div class="ftp-file-name">${file.name}</div>
                                <div class="ftp-file-size">${file.size}</div>
                            </div>
                        </div>`;
                    });
                    document.getElementById('ftp-files').innerHTML = html;
                    document.getElementById('ftp-install-form').style.display = 'block';
                    document.getElementById('refresh-files-btn').style.display = 'inline-block';
                    showStatus(`<span class="dashicons dashicons-yes-alt"></span> S-au găsit ${data.data.length} fișiere ZIP pe serverul FTP.`, 'success');
                } else {
                    document.getElementById('ftp-files').innerHTML = '<p style="padding: 20px; text-align: center; color: #666;">Nu s-au găsit fișiere ZIP în directorul specificat.</p>';
                    document.getElementById('ftp-install-form').style.display = 'none';
                    showStatus('<span class="dashicons dashicons-info"></span> Nu s-au găsit fișiere ZIP: ' + (data.data || 'Director gol'), 'error');
                }
            })
            .catch(error => {
                document.getElementById('ftp-files').innerHTML = '<p style="padding: 20px; text-align: center; color: #d63638;">Eroare la încărcarea fișierelor: ' + error.message + '</p>';
                showStatus('<span class="dashicons dashicons-warning"></span> Eroare: ' + error.message, 'error');
            })
            .finally(() => {
                btn.disabled = false;
                btn.innerHTML = '<span class="dashicons dashicons-media-archive"></span> Listează Fișiere ZIP';
            });
        }

        function refreshFtpFiles() {
            listFtpFiles();
        }

        function toggleFileSelection(filename, element) {
            const checkbox = element.querySelector('input[type="checkbox"]');
            checkbox.checked = !checkbox.checked;
            element.classList.toggle('selected', checkbox.checked);
            updateSelectedFiles();
        }

        function updateSelectedFiles() {
            const checkboxes = document.querySelectorAll('#ftp-files input[type="checkbox"]:checked');
            const selectedFiles = Array.from(checkboxes).map(cb => {
                return cb.closest('.ftp-file-item').querySelector('.ftp-file-name').textContent;
            });
            
            document.getElementById('selected_files').value = selectedFiles.join(',');
            
            if (selectedFiles.length > 0) {
                document.getElementById('selected-files-display').innerHTML = 
                    `<strong>${selectedFiles.length} fișier${selectedFiles.length > 1 ? 'e' : ''} selectat${selectedFiles.length > 1 ? 'e' : ''}:</strong><br>` + 
                    selectedFiles.join(', ');
            } else {
                document.getElementById('selected-files-display').innerHTML = 'Niciun fișier selectat';
            }
            
            const installBtn = document.getElementById('ftp-install-btn');
            installBtn.disabled = selectedFiles.length === 0;
        }

        // CSS pentru animația de spin și stiluri log
        const style = document.createElement('style');
        style.textContent = `
            @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            .spin { animation: spin 1s linear infinite; }
            
            .log-line.log-error { color: #ff6b6b; }
            .log-line.log-success { color: #51cf66; }
            .log-line.log-warning { color: #ffd43b; }
            .log-line.log-info { color: #74c0fc; }
            
            .log-content::-webkit-scrollbar { width: 8px; }
            .log-content::-webkit-scrollbar-track { background: #2d2d2d; }
            .log-content::-webkit-scrollbar-thumb { background: #555; border-radius: 4px; }
            .log-content::-webkit-scrollbar-thumb:hover { background: #777; }
            
            .version-comparison {
                margin-top: 20px;
                padding: 20px;
                background: #fff;
                border: 1px solid #ddd;
                border-radius: 5px;
            }

            .version-comparison table {
                margin-top: 15px;
            }

            .version-comparison th,
            .version-comparison td {
                border: 1px solid #ddd;
                padding: 12px;
            }

            .update-section h4 {
                color: #d63638;
            }

            .uptodate-section h4 {
                color: #00a32a;
            }

            .noftp-section h4 {
                color: #dba617;
            }

            .update-checkbox {
                transform: scale(1.2);
                margin: 0;
            }

            .update-section button {
                margin-bottom: 10px;
            }

            .update-section .button-primary {
                background: #d63638;
                border-color: #d63638;
                color: white;
            }

            .update-section .button-primary:hover {
                background: #b32d2e;
                border-color: #b32d2e;
            }

            #select-all-updates {
                transform: scale(1.2);
                margin: 0;
            }
        `;
        document.head.appendChild(style);
        
        // Funcții pentru tab-ul de logs
        function refreshLogs() {
            location.reload();
        }
        
        function downloadLogs() {
            const link = document.createElement('a');
            link.href = '<?php echo admin_url( 'admin-post.php' ); ?>?action=ots_download_logs&_wpnonce=<?php echo wp_create_nonce( 'ots_download_logs' ); ?>';
            link.download = 'ots-bulk-zip-installer.log';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
        
        function clearLogs() {
            if (confirm('Ești sigur că vrei să ștergi toate logurile? Această acțiune nu poate fi anulată.')) {
                const link = document.createElement('a');
                link.href = '<?php echo admin_url( 'admin-post.php' ); ?>?action=ots_clear_logs&_wpnonce=<?php echo wp_create_nonce( 'ots_clear_logs' ); ?>';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }
        }

        function compareVersions() {
            const btn = document.getElementById('compare-versions-btn');
            btn.disabled = true;
            btn.innerHTML = '<span class="dashicons dashicons-update-alt spin"></span> Compar...';
            
            document.getElementById('version-comparison').innerHTML = '<p style="padding: 20px; text-align: center;"><span class="dashicons dashicons-update-alt spin"></span> Se compară versiunile pluginurilor...</p>';
            document.getElementById('version-comparison').style.display = 'block';
            
            fetch('<?php echo admin_url( 'admin-ajax.php' ); ?>', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'action=ots_compare_versions&_ajax_nonce=' + '<?php echo wp_create_nonce( 'ots_ftp_ajax' ); ?>'
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    displayVersionComparison(data.data);
                } else {
                    document.getElementById('version-comparison').innerHTML = '<p style="padding: 20px; text-align: center; color: #d63638;">Eroare la compararea versiunilor: ' + data.data + '</p>';
                }
            })
            .catch(error => {
                document.getElementById('version-comparison').innerHTML = '<p style="padding: 20px; text-align: center; color: #d63638;">Eroare: ' + error.message + '</p>';
            })
            .finally(() => {
                btn.disabled = false;
                btn.innerHTML = '<span class="dashicons dashicons-update-alt"></span> Compară Versiuni';
            });
        }

        function displayVersionComparison(plugins) {
            let html = '<h3>📊 Comparare Versiuni Pluginuri</h3>';
            html += '<div class="version-comparison-table" style="margin-top: 20px;">';
            
            // Grupează pluginurile după status
            const updateAvailable = plugins.filter(p => p.status === 'update_available');
            const upToDate = plugins.filter(p => p.status === 'up_to_date');
            const noFtpFile = plugins.filter(p => p.status === 'no_ftp_file');
            
            if (updateAvailable.length > 0) {
                html += '<div class="update-section" style="margin-bottom: 30px;">';
                html += '<h4 style="color: #d63638; margin-bottom: 15px;">🔄 Actualizări Disponibile (' + updateAvailable.length + ')</h4>';
                
                // Adaugă butoanele de selectare
                html += '<div style="margin-bottom: 15px;">';
                html += '<button type="button" class="button button-secondary" onclick="checkAllUpdates()" style="margin-right: 10px;">';
                html += '<span class="dashicons dashicons-yes-alt"></span> Selectează Toate';
                html += '</button>';
                html += '<button type="button" class="button button-secondary" onclick="uncheckAllUpdates()" style="margin-right: 10px;">';
                html += '<span class="dashicons dashicons-no-alt"></span> Deselectează Toate';
                html += '</button>';
                html += '<button type="button" class="button button-primary" onclick="installSelectedUpdates()" style="margin-right: 10px;">';
                html += '<span class="dashicons dashicons-update"></span> Instalează Selecția (' + updateAvailable.length + ')';
                html += '</button>';
                html += '</div>';
                
                html += '<table class="wp-list-table widefat fixed striped" style="border-collapse: collapse; width: 100%;">';
                html += '<thead><tr>';
                html += '<th style="padding: 12px; text-align: center; border: 1px solid #ddd; width: 50px;">';
                html += '<input type="checkbox" id="select-all-updates" onchange="toggleAllUpdates(this)">';
                html += '</th>';
                html += '<th style="padding: 12px; text-align: left; border: 1px solid #ddd;">Plugin</th>';
                html += '<th style="padding: 12px; text-align: center; border: 1px solid #ddd;">Versiune Curentă</th>';
                html += '<th style="padding: 12px; text-align: center; border: 1px solid #ddd;">Versiune FTP</th>';
                html += '<th style="padding: 12px; text-align: center; border: 1px solid #ddd;">Status</th>';
                html += '</tr></thead><tbody>';
                
                updateAvailable.forEach(plugin => {
                    html += '<tr>';
                    html += '<td style="padding: 12px; text-align: center; border: 1px solid #ddd;">';
                    html += '<input type="checkbox" class="update-checkbox" value="' + plugin.ftp_file + '" data-plugin="' + plugin.plugin_slug + '" data-current-version="' + plugin.current_version + '" data-ftp-version="' + plugin.ftp_version + '">';
                    html += '</td>';
                    html += '<td style="padding: 12px; border: 1px solid #ddd;"><strong>' + plugin.plugin_name + '</strong><br><small style="color: #666;">' + plugin.plugin_slug + '</small></td>';
                    html += '<td style="padding: 12px; text-align: center; border: 1px solid #ddd;"><span style="color: #d63638;">' + plugin.current_version + '</span></td>';
                    html += '<td style="padding: 12px; text-align: center; border: 1px solid #ddd;"><span style="color: #00a32a; font-weight: bold;">' + plugin.ftp_version + '</span></td>';
                    html += '<td style="padding: 12px; text-align: center; border: 1px solid #ddd;"><span style="background: #d63638; color: white; padding: 4px 8px; border-radius: 3px; font-size: 12px;">Actualizare Disponibilă</span></td>';
                    html += '</tr>';
                });
                
                html += '</tbody></table>';
                html += '</div>';
            }
            
            if (upToDate.length > 0) {
                html += '<div class="uptodate-section" style="margin-bottom: 30px;">';
                html += '<h4 style="color: #00a32a; margin-bottom: 15px;">✅ La Zi (' + upToDate.length + ')</h4>';
                html += '<table class="wp-list-table widefat fixed striped" style="border-collapse: collapse; width: 100%;">';
                html += '<thead><tr>';
                html += '<th style="padding: 12px; text-align: left; border: 1px solid #ddd;">Plugin</th>';
                html += '<th style="padding: 12px; text-align: center; border: 1px solid #ddd;">Versiune</th>';
                html += '<th style="padding: 12px; text-align: center; border: 1px solid #ddd;">Status</th>';
                html += '</tr></thead><tbody>';
                
                upToDate.forEach(plugin => {
                    html += '<tr>';
                    html += '<td style="padding: 12px; border: 1px solid #ddd;"><strong>' + plugin.plugin_name + '</strong><br><small style="color: #666;">' + plugin.plugin_slug + '</small></td>';
                    html += '<td style="padding: 12px; text-align: center; border: 1px solid #ddd;"><span style="color: #666;">' + plugin.current_version + '</span></td>';
                    html += '<td style="padding: 12px; text-align: center; border: 1px solid #ddd;"><span style="background: #00a32a; color: white; padding: 4px 8px; border-radius: 3px; font-size: 12px;">La Zi</span></td>';
                    html += '</tr>';
                });
                
                html += '</tbody></table>';
                html += '</div>';
            }
            
            if (noFtpFile.length > 0) {
                html += '<div class="noftp-section" style="margin-bottom: 30px;">';
                html += '<h4 style="color: #dba617; margin-bottom: 15px;">⚠️ Fără Fișier FTP (' + noFtpFile.length + ')</h4>';
                html += '<p style="color: #666; margin-bottom: 15px;">Următoarele pluginuri sunt instalate pe website dar nu au fișiere corespunzătoare pe serverul FTP:</p>';
                html += '<ul style="list-style: disc; margin-left: 20px; color: #666;">';
                noFtpFile.forEach(plugin => {
                    html += '<li><strong>' + plugin.plugin_name + '</strong> (' + plugin.plugin_slug + ') - Versiunea ' + plugin.current_version + '</li>';
                });
                html += '</ul>';
                html += '</div>';
            }
            
            html += '</div>';
            document.getElementById('version-comparison').innerHTML = html;
        }

        function checkAllUpdates() {
            const checkboxes = document.querySelectorAll('.update-checkbox');
            checkboxes.forEach(checkbox => {
                checkbox.checked = true;
            });
            document.getElementById('select-all-updates').checked = true;
            updateInstallButtonText();
        }

        function uncheckAllUpdates() {
            const checkboxes = document.querySelectorAll('.update-checkbox');
            checkboxes.forEach(checkbox => {
                checkbox.checked = false;
            });
            document.getElementById('select-all-updates').checked = false;
            updateInstallButtonText();
        }

        function toggleAllUpdates(selectAllCheckbox) {
            const checkboxes = document.querySelectorAll('.update-checkbox');
            checkboxes.forEach(checkbox => {
                checkbox.checked = selectAllCheckbox.checked;
            });
            updateInstallButtonText();
        }

        function updateInstallButtonText() {
            const checkboxes = document.querySelectorAll('.update-checkbox:checked');
            const installButton = document.querySelector('button[onclick="installSelectedUpdates()"]');
            if (installButton) {
                installButton.innerHTML = '<span class="dashicons dashicons-update"></span> Instalează Selecția (' + checkboxes.length + ')';
            }
        }

        function installSelectedUpdates() {
            const checkboxes = document.querySelectorAll('.update-checkbox:checked');
            if (checkboxes.length === 0) {
                alert('Te rog selectează cel puțin un plugin pentru actualizare.');
                return;
            }

            const selectedFiles = Array.from(checkboxes).map(checkbox => checkbox.value);
            const selectedPlugins = Array.from(checkboxes).map(checkbox => checkbox.dataset.plugin);
            
            // Afișează confirmarea
            const confirmMessage = 'Ești sigur că vrei să actualizezi următoarele pluginuri?\n\n' + 
                                 selectedPlugins.join('\n') + '\n\n' +
                                 'Această acțiune va suprascrie versiunile curente.';
            
            if (confirm(confirmMessage)) {
                // Redirecționează către formularul de instalare FTP
                const form = document.getElementById('ftp-install-form');
                if (form) {
                    // Setează fișierele selectate
                    const selectedFilesInput = form.querySelector('input[name="selected_files"]');
                    if (selectedFilesInput) {
                        selectedFilesInput.value = selectedFiles.join(',');
                    }
                    
                    // Setează tipul acțiunii la update
                    const actionTypeInput = form.querySelector('input[name="action_type"]');
                    if (actionTypeInput) {
                        actionTypeInput.value = 'update';
                    }
                    
                    // Afișează formularul
                    form.style.display = 'block';
                    
                    // Scroll la formular
                    form.scrollIntoView({ behavior: 'smooth' });
                    
                    // Marchează checkbox-urile din formular
                    selectedFiles.forEach(filename => {
                        const formCheckbox = form.querySelector('input[value="' + filename + '"]');
                        if (formCheckbox) {
                            formCheckbox.checked = true;
                        }
                    });
                }
            }
        }

        // Adaugă event listener pentru checkbox-urile individuale
        document.addEventListener('change', function(e) {
            if (e.target.classList.contains('update-checkbox')) {
                updateInstallButtonText();
                
                // Actualizează checkbox-ul "select all"
                const selectAllCheckbox = document.getElementById('select-all-updates');
                const allCheckboxes = document.querySelectorAll('.update-checkbox');
                const checkedCheckboxes = document.querySelectorAll('.update-checkbox:checked');
                
                if (checkedCheckboxes.length === 0) {
                    selectAllCheckbox.checked = false;
                    selectAllCheckbox.indeterminate = false;
                } else if (checkedCheckboxes.length === allCheckboxes.length) {
                    selectAllCheckbox.checked = true;
                    selectAllCheckbox.indeterminate = false;
                } else {
                    selectAllCheckbox.checked = false;
                    selectAllCheckbox.indeterminate = true;
                }
            }
        });

        // Funcții pentru automatizare
        function saveAutomationSettings() {
            const form = document.getElementById('automation-form');
            const formData = new FormData(form);
            formData.append('action', 'ots_save_automation');
            formData.append('_ajax_nonce', '<?php echo wp_create_nonce( 'ots_automation_ajax' ); ?>');

            const saveBtn = document.querySelector('button[onclick="saveAutomationSettings()"]');
            const originalText = saveBtn.innerHTML;
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span class="dashicons dashicons-update spin"></span> Salvez...';

            fetch('<?php echo admin_url( 'admin-ajax.php' ); ?>', {
                method: 'POST',
                body: formData
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    showStatus('✅ Setările de automatizare au fost salvate cu succes!', 'success');
                    setTimeout(() => location.reload(), 2000);
                } else {
                    showStatus('❌ Eroare la salvarea setărilor: ' + data.data, 'error');
                }
            })
            .catch(error => {
                showStatus('❌ Eroare: ' + error.message, 'error');
            })
            .finally(() => {
                saveBtn.disabled = false;
                saveBtn.innerHTML = originalText;
            });
        }

        function testAutomation() {
            const testBtn = document.querySelector('button[onclick="testAutomation()"]');
            const originalText = testBtn.innerHTML;
            testBtn.disabled = true;
            testBtn.innerHTML = '<span class="dashicons dashicons-update spin"></span> Testez...';

            fetch('<?php echo admin_url( 'admin-ajax.php' ); ?>', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'action=ots_test_automation&_ajax_nonce=<?php echo wp_create_nonce( 'ots_automation_ajax' ); ?>'
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    showStatus('✅ Testul de automatizare a fost executat cu succes! Verifică logurile pentru detalii.', 'success');
                } else {
                    showStatus('❌ Eroare la testarea automatizării: ' + data.data, 'error');
                }
            })
            .catch(error => {
                showStatus('❌ Eroare: ' + error.message, 'error');
            })
            .finally(() => {
                testBtn.disabled = false;
                testBtn.innerHTML = originalText;
            });
        }

        function forceAutomationExecution() {
            if (!confirm('Ești sigur că vrei să forțezi execuția automatizării? Aceasta va rula imediat, indiferent de programarea normală.')) {
                return;
            }

            const forceBtn = document.querySelector('button[onclick="forceAutomationExecution()"]');
            const originalText = forceBtn.innerHTML;
            forceBtn.disabled = true;
            forceBtn.innerHTML = '<span class="dashicons dashicons-update spin"></span> Forțez...';

            fetch('<?php echo admin_url( 'admin-ajax.php' ); ?>', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'action=ots_force_automation&_ajax_nonce=<?php echo wp_create_nonce( 'ots_automation_ajax' ); ?>'
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    showStatus('✅ Execuția automatizării a fost forțată cu succes! Verifică logurile pentru detalii.', 'success');
                    setTimeout(() => location.reload(), 3000);
                } else {
                    showStatus('❌ Eroare la forțarea execuției: ' + data.data, 'error');
                }
            })
            .catch(error => {
                showStatus('❌ Eroare: ' + error.message, 'error');
            })
            .finally(() => {
                forceBtn.disabled = false;
                forceBtn.innerHTML = originalText;
            });
        }

        // Gestionare afișare/ascundere rânduri în funcție de selecții
        document.addEventListener('DOMContentLoaded', function() {
            const frequencySelect = document.getElementById('auto_update_frequency');
            const weeklyDayRow = document.getElementById('weekly-day-row');
            const pluginsSelect = document.getElementById('auto_update_plugins');
            const selectedPluginsRow = document.getElementById('selected-plugins-row');

            if (frequencySelect) {
                frequencySelect.addEventListener('change', function() {
                    if (this.value === 'weekly') {
                        weeklyDayRow.style.display = 'table-row';
                    } else {
                        weeklyDayRow.style.display = 'none';
                    }
                });
                
                // Inițializează afișarea
                if (frequencySelect.value === 'weekly') {
                    weeklyDayRow.style.display = 'table-row';
                }
            }

            if (pluginsSelect) {
                pluginsSelect.addEventListener('change', function() {
                    if (this.value === 'selected') {
                        selectedPluginsRow.style.display = 'table-row';
                    } else {
                        selectedPluginsRow.style.display = 'none';
                    }
                });
                
                // Inițializează afișarea
                if (pluginsSelect.value === 'selected') {
                    selectedPluginsRow.style.display = 'table-row';
                }
            }
        });
        </script>
        <?php
    }

    public function test_ftp_connection() {
        check_ajax_referer( 'ots_ftp_ajax' );
        
        if ( ! current_user_can( 'install_plugins' ) ) {
            wp_send_json_error( 'Acces restricționat.' );
        }

        $settings = $this->get_settings();
        $result = $this->connect_to_ftp( $settings );

        if ( $result['success'] ) {
            $ftp = $result['resource'];
            
            // Testează și listarea fișierelor pentru debug
            $debug_info = [];
            $debug_info['connection'] = 'OK';
            $debug_info['host'] = $settings['ftp_host'];
            $debug_info['port'] = $settings['ftp_port'];
            $debug_info['user'] = $settings['ftp_user'];
            $debug_info['path'] = $settings['ftp_path'];
            
            // Încearcă să listeze fișierele din directorul curent
            $current_dir = ftp_pwd( $ftp );
            $debug_info['current_dir'] = $current_dir;
            
            // Testează listarea din directorul specificat
            $test_files = ftp_nlist( $ftp, $settings['ftp_path'] );
            $debug_info['test_files_count'] = $test_files ? count( $test_files ) : 0;
            $debug_info['test_files_sample'] = $test_files ? array_slice( $test_files, 0, 5 ) : [];
            
            ftp_close( $ftp );
            wp_send_json_success( 'Conexiunea FTP a fost stabilită cu succes. Debug: ' . json_encode( $debug_info ) );
        } else {
            wp_send_json_error( $result['message'] );
        }
    }

    public function list_ftp_files() {
        check_ajax_referer( 'ots_ftp_ajax' );
        
        if ( ! current_user_can( 'install_plugins' ) ) {
            wp_send_json_error( 'Acces restricționat.' );
        }

        $settings = $this->get_settings();
        $connection = $this->connect_to_ftp( $settings );

        if ( ! $connection['success'] ) {
            wp_send_json_error( $connection['message'] );
        }

        $ftp = $connection['resource'];
        
        // Debug: să vedem ce returnează ftp_nlist
        $debug_info = [];
        
        // Obține directorul curent
        $current_dir = ftp_pwd( $ftp );
        $debug_info['current_dir'] = $current_dir;
        $debug_info['requested_path'] = $settings['ftp_path'];
        
        // Încearcă să listeze din directorul curent (unde am navigat)
        $files = ftp_nlist( $ftp, '.' );
        
        if ( ! $files ) {
            // Încearcă cu calea specificată
            $files = ftp_nlist( $ftp, $settings['ftp_path'] );
        }
        
        if ( ! $files ) {
            // Încearcă cu calea absolută
            $files = ftp_nlist( $ftp, '/' . ltrim( $settings['ftp_path'], '/' ) );
        }
        
        if ( ! $files ) {
            ftp_close( $ftp );
            wp_send_json_error( 'Nu s-au putut lista fișierele din directorul specificat. Calea: ' . $settings['ftp_path'] . ', Director curent: ' . $current_dir );
        }

        $zip_files = [];
        $debug_info['total_files'] = count( $files );
        $debug_info['path_used'] = $settings['ftp_path'];
        $debug_info['current_directory'] = $current_dir;
        
        foreach ( $files as $file ) {
            $filename = basename( $file );
            $extension = strtolower( pathinfo( $filename, PATHINFO_EXTENSION ) );
            
            // Debug info
            $debug_info['files'][] = [
                'original' => $file,
                'basename' => $filename,
                'extension' => $extension
            ];
            
            if ( $extension === 'zip' ) {
                // Încearcă să obții dimensiunea fișierului
                $size = ftp_size( $ftp, $file );
                $size_text = $size > 0 ? $this->format_file_size( $size ) : 'Necunoscută';
                
                $zip_files[] = [
                    'name' => $filename,
                    'path' => $file,
                    'size' => $size_text
                ];
            }
        }

        ftp_close( $ftp );
        
        // Dacă nu am găsit fișiere ZIP, să returnăm info de debug
        if ( empty( $zip_files ) ) {
            wp_send_json_error( 'Nu s-au găsit fișiere ZIP. Debug info: ' . json_encode( $debug_info ) );
        }
        
        wp_send_json_success( $zip_files );
    }

    public function compare_versions() {
        check_ajax_referer( 'ots_ftp_ajax' );
        
        if ( ! current_user_can( 'install_plugins' ) ) {
            wp_send_json_error( 'Acces restricționat.' );
        }

        $settings = $this->get_settings();
        
        // Log pentru debugging
        $this->log_line( 'DEBUG COMPARE: Începe compararea versiunilor' );
        $this->log_line( 'DEBUG COMPARE: Host FTP: ' . $settings['ftp_host'] );
        $this->log_line( 'DEBUG COMPARE: Port FTP: ' . $settings['ftp_port'] );
        $this->log_line( 'DEBUG COMPARE: User FTP: ' . $settings['ftp_user'] );
        
        $connection = $this->connect_to_ftp( $settings );

        if ( ! $connection['success'] ) {
            $this->log_line( 'ERROR COMPARE: ' . $connection['message'] );
            wp_send_json_error( $connection['message'] );
        }

        $ftp = $connection['resource'];
        
        $this->log_line( 'DEBUG COMPARE: Conexiune FTP reușită, obțin lista fișierelor' );
        
        // Obține lista pluginurilor instalate pe website
        if ( ! function_exists( 'get_plugins' ) ) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }
        $installed_plugins = get_plugins();
        $this->log_line( 'DEBUG COMPARE: Pluginuri instalate găsite: ' . count( $installed_plugins ) );
        
        $ftp_files = ftp_nlist( $ftp, '.' );
        $this->log_line( 'DEBUG COMPARE: Fișiere FTP găsite: ' . ( $ftp_files ? count( $ftp_files ) : 0 ) );
        
        if ( ! $ftp_files ) {
            ftp_close( $ftp );
            wp_send_json_error( 'Nu s-au putut lista fișierele de pe FTP.' );
        }

        $comparison_results = [];
        
        foreach ( $installed_plugins as $plugin_file => $plugin_data ) {
            $plugin_slug = dirname( $plugin_file );
            if ( $plugin_slug === '.' ) continue; // Skip plugins în rădăcină
            
            $current_version = $plugin_data['Version'] ?? '0.0.0';
            $plugin_name = $plugin_data['Name'] ?? 'Plugin necunoscut';
            
            // Caută fișierul ZIP corespunzător pe FTP
            $this->log_line( 'DEBUG COMPARE: Caut fișier pentru plugin: ' . $plugin_name . ' (slug: ' . $plugin_slug . ')' );
            $matching_zip = $this->find_matching_zip_file( $plugin_slug, $plugin_name, $ftp_files );

            

            
            foreach ( $ftp_files as $ftp_file ) {
                $filename = basename( $ftp_file );
                if ( strtolower( pathinfo( $filename, PATHINFO_EXTENSION ) ) === 'zip' ) {
                    $filename_lower = strtolower( $filename );
                    

                    
                    // Încearcă să găsească potrivirea după numele plugin-ului (pentru cazuri speciale)
                    $plugin_name_clean = strtolower( str_replace( [' ', '-', '_'], '', $plugin_name ) );
                    if ( strpos( $filename_lower, $plugin_name_clean ) !== false ) {
                        $matching_zip = $filename;
                        $this->log_line( 'DEBUG COMPARE: Găsit fișier ZIP după nume: ' . $filename . ' pentru plugin: ' . $plugin_name );
                        break;
                    }
                    
                    // Cazuri speciale pentru pluginuri cunoscute
                    $special_mappings = [
                        'astra-addon' => ['astra-pro', 'astra-addon', 'astra'],
                        'elementor-pro' => ['elementor-pro', 'elementor'],
                        'wp-mail-smtp-pro' => ['wp-mail-smtp-pro', 'wp-mail-smtp'],
                        'admin-site-enhancements-pro' => ['admin-site-enhancements-pro', 'ase-pro', 'ase']
                    ];
                    
                    if ( isset( $special_mappings[ $plugin_slug_clean ] ) ) {
                        foreach ( $special_mappings[ $plugin_slug_clean ] as $search_term ) {
                            if ( strpos( $filename_lower, $search_term ) !== false ) {
                                $matching_zip = $filename;
                                $this->log_line( 'DEBUG COMPARE: Găsit fișier ZIP prin mapping special: ' . $filename . ' pentru plugin: ' . $plugin_slug );
                                break 2;
                            }
                        }
                    }
                }
            }
            
            if ( $matching_zip ) {
                // Încearcă să extragă versiunea din numele fișierului ZIP
                $zip_version = $this->extract_version_from_filename( $matching_zip );
                
                $comparison_results[] = [
                    'plugin_name' => $plugin_name,
                    'plugin_slug' => $plugin_slug,
                    'current_version' => $current_version,
                    'ftp_file' => $matching_zip,
                    'ftp_version' => $zip_version,
                    'needs_update' => $this->is_version_newer( $current_version, $zip_version ),
                    'status' => $this->get_update_status( $current_version, $zip_version )
                ];
            } else {
                $comparison_results[] = [
                    'plugin_name' => $plugin_name,
                    'plugin_slug' => $plugin_slug,
                    'current_version' => $current_version,
                    'ftp_file' => null,
                    'ftp_version' => null,
                    'needs_update' => false,
                    'status' => 'no_ftp_file'
                ];
            }
        }

        ftp_close( $ftp );
        wp_send_json_success( $comparison_results );
    }

    public function save_automation() {
        check_ajax_referer( 'ots_automation_ajax' );
        
        if ( ! current_user_can( 'install_plugins' ) ) {
            wp_send_json_error( 'Acces restricționat.' );
        }

        $settings = $this->get_settings();
        
        // Actualizează setările de automatizare
        $settings['auto_update_enabled'] = ! empty( $_POST['auto_update_enabled'] ) ? 1 : 0;
        $settings['auto_update_frequency'] = sanitize_text_field( $_POST['auto_update_frequency'] ?? 'daily' );
        $settings['auto_update_time'] = sanitize_text_field( $_POST['auto_update_time'] ?? '02:00' );
        $settings['auto_update_day'] = sanitize_text_field( $_POST['auto_update_day'] ?? 'monday' );
        $settings['auto_update_plugins'] = sanitize_text_field( $_POST['auto_update_plugins'] ?? 'all' );
        $settings['auto_update_selected_plugins'] = sanitize_textarea_field( $_POST['auto_update_selected_plugins'] ?? '' );
        $settings['auto_update_notify_email'] = sanitize_email( $_POST['auto_update_notify_email'] ?? '' );
        $settings['auto_update_dry_run'] = ! empty( $_POST['auto_update_dry_run'] ) ? 1 : 0;

        // Salvează setările
        update_option( $this->opt_key, $settings );

        // Configurează cronjob-ul
        $this->setup_cronjob( $settings );

        $this->log_line( 'AUTOMATION: Setările de automatizare au fost salvate' );
        wp_send_json_success( 'Setările de automatizare au fost salvate cu succes!' );
    }

    public function test_automation() {
        check_ajax_referer( 'ots_automation_ajax' );
        
        if ( ! current_user_can( 'install_plugins' ) ) {
            wp_send_json_error( 'Acces restricționat.' );
        }

        $this->log_line( 'AUTOMATION TEST: Începe testul de automatizare' );
        
        // Rulează actualizarea automată
        $result = $this->run_automated_update( true );
        
        if ( $result['success'] ) {
            wp_send_json_success( 'Testul de automatizare a fost executat cu succes! Verifică logurile pentru detalii.' );
        } else {
            wp_send_json_error( 'Eroare la testarea automatizării: ' . $result['message'] );
        }
    }

    private function setup_cronjob( $settings ) {
        // Șterge cronjob-ul existent
        wp_clear_scheduled_hook( 'ots_auto_update_plugins' );

        if ( ! $settings['auto_update_enabled'] ) {
            return;
        }

        // Calculează timestamp-ul pentru următoarea execuție
        $next_run = $this->calculate_next_run( $settings );
        
        if ( $next_run ) {
            wp_schedule_event( $next_run, $this->get_cron_interval( $settings ), 'ots_auto_update_plugins' );
            $this->log_line( 'AUTOMATION: Cronjob programat pentru ' . date( 'Y-m-d H:i:s', $next_run ) );
        }
    }

    private function calculate_next_run( $settings ) {
        $time_parts = explode( ':', $settings['auto_update_time'] );
        $hour = (int) $time_parts[0];
        $minute = (int) $time_parts[1];
        
        $now = current_time( 'timestamp' );
        $today = strtotime( 'today', $now );
        $next_run = $today + ( $hour * 3600 ) + ( $minute * 60 );
        
        // Dacă ora a trecut azi, programează pentru mâine
        if ( $next_run <= $now ) {
            $next_run += 86400; // +1 zi
        }
        
        switch ( $settings['auto_update_frequency'] ) {
            case 'weekly':
                $day_map = [
                    'monday' => 1, 'tuesday' => 2, 'wednesday' => 3,
                    'thursday' => 4, 'friday' => 5, 'saturday' => 6, 'sunday' => 0
                ];
                $target_day = $day_map[ $settings['auto_update_day'] ];
                $current_day = date( 'w', $next_run );
                
                if ( $current_day != $target_day ) {
                    $days_to_add = ( $target_day - $current_day + 7 ) % 7;
                    $next_run += ( $days_to_add * 86400 );
                }
                break;
                
            case 'monthly':
                $next_run = strtotime( '+1 month', $next_run );
                break;
        }
        
        return $next_run;
    }

    private function get_cron_interval( $settings ) {
        switch ( $settings['auto_update_frequency'] ) {
            case 'daily':
                return 'daily';
            case 'weekly':
                return 'weekly';
            case 'monthly':
                return 'monthly';
            default:
                return 'daily';
        }
    }

    public function run_automated_update( $is_test = false ) {
        $this->log_line( 'AUTOMATION' . ( $is_test ? ' TEST' : '' ) . ': Începe actualizarea automată' );
        $this->log_line( 'AUTOMATION: Timestamp execuție: ' . current_time( 'Y-m-d H:i:s' ) );
        $this->log_line( 'AUTOMATION: WordPress cron enabled: ' . ( defined( 'DISABLE_WP_CRON' ) && DISABLE_WP_CRON ? 'NU' : 'DA' ) );
        
        $settings = $this->get_settings();
        $this->log_line( 'AUTOMATION: Setări - Enabled: ' . $settings['auto_update_enabled'] . ', Frequency: ' . $settings['auto_update_frequency'] . ', Time: ' . $settings['auto_update_time'] );
        
        if ( ! $settings['auto_update_enabled'] && ! $is_test ) {
            $this->log_line( 'AUTOMATION: Automatizarea este dezactivată' );
            return [ 'success' => false, 'message' => 'Automatizarea este dezactivată' ];
        }

        // Conectare FTP
        $connection = $this->connect_to_ftp( $settings );
        if ( ! $connection['success'] ) {
            $this->log_line( 'AUTOMATION ERROR: ' . $connection['message'] );
            return [ 'success' => false, 'message' => $connection['message'] ];
        }

        $ftp = $connection['resource'];
        
        // Obține lista pluginurilor instalate și fișierele FTP
        if ( ! function_exists( 'get_plugins' ) ) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }
        
        $installed_plugins = get_plugins();
        $ftp_files = ftp_nlist( $ftp, '.' );
        
        if ( ! $ftp_files ) {
            ftp_close( $ftp );
            $this->log_line( 'AUTOMATION ERROR: Nu s-au putut lista fișierele FTP' );
            return [ 'success' => false, 'message' => 'Nu s-au putut lista fișierele FTP' ];
        }

        $updates_available = [];
        $updates_installed = [];
        $errors = [];

        // Analizează pluginurile pentru actualizări
        foreach ( $installed_plugins as $plugin_file => $plugin_data ) {
            $plugin_slug = dirname( $plugin_file );
            if ( $plugin_slug === '.' ) continue;
            
            $current_version = $plugin_data['Version'] ?? '0.0.0';
            $plugin_name = $plugin_data['Name'] ?? 'Plugin necunoscut';
            
            // Caută fișierul ZIP corespunzător pe FTP
            $this->log_line( 'AUTOMATION: Caut fișier pentru plugin: ' . $plugin_name . ' (slug: ' . $plugin_slug . ')' );
            $matching_zip = $this->find_matching_zip_file( $plugin_slug, $plugin_name, $ftp_files );
            foreach ( $ftp_files as $ftp_file ) {
                $filename = basename( $ftp_file );
                if ( strtolower( pathinfo( $filename, PATHINFO_EXTENSION ) ) === 'zip' ) {
                    if ( strpos( strtolower( $filename ), strtolower( $plugin_slug ) ) !== false ) {
                        $matching_zip = $filename;
                        break;
                    }
                }
            }
            
            if ( $matching_zip ) {
                $zip_version = $this->extract_version_from_filename( $matching_zip );
                
                if ( $this->is_version_newer( $current_version, $zip_version ) ) {
                    $updates_available[] = [
                        'plugin_name' => $plugin_name,
                        'plugin_slug' => $plugin_slug,
                        'current_version' => $current_version,
                        'ftp_version' => $zip_version,
                        'ftp_file' => $matching_zip
                    ];
                }
            }
        }

        $this->log_line( 'AUTOMATION: Găsite ' . count( $updates_available ) . ' actualizări disponibile' );

        // Filtrează pluginurile conform setărilor
        $plugins_to_update = $this->filter_plugins_for_update( $updates_available, $settings );
        
        if ( empty( $plugins_to_update ) ) {
            $this->log_line( 'AUTOMATION: Nu sunt pluginuri de actualizat conform setărilor' );
            ftp_close( $ftp );
            return [ 'success' => true, 'message' => 'Nu sunt pluginuri de actualizat' ];
        }

        // Instalează actualizările
        foreach ( $plugins_to_update as $update ) {
            if ( $settings['auto_update_dry_run'] && ! $is_test ) {
                $this->log_line( 'AUTOMATION DRY-RUN: Ar actualiza ' . $update['plugin_name'] . ' de la ' . $update['current_version'] . ' la ' . $update['ftp_version'] );
                continue;
            }

            $result = $this->install_plugin_from_ftp( $ftp, $update['ftp_file'], $settings, true );
            
            if ( $result['success'] ) {
                $updates_installed[] = $update['plugin_name'];
                $this->log_line( 'AUTOMATION SUCCESS: ' . $update['plugin_name'] . ' actualizat de la ' . $update['current_version'] . ' la ' . $update['ftp_version'] );
            } else {
                $errors[] = $update['plugin_name'] . ': ' . $result['message'];
                $this->log_line( 'AUTOMATION ERROR: ' . $update['plugin_name'] . ' - ' . $result['message'] );
            }
        }

        ftp_close( $ftp );

        // Trimite notificare email dacă este configurat
        if ( ! empty( $settings['auto_update_notify_email'] ) ) {
            $this->send_automation_notification( $settings['auto_update_notify_email'], $updates_installed, $errors, $is_test );
        }
        
        // Trimite email și pentru actualizările manuale dacă este configurat
        if ( ! empty( $settings['auto_update_notify_email'] ) && ! $is_test ) {
            $this->send_manual_update_notification( $settings['auto_update_notify_email'], $updates_installed, $errors );
        }

        $this->log_line( 'AUTOMATION: Actualizare automată completă. ' . count( $updates_installed ) . ' actualizări instalate, ' . count( $errors ) . ' erori' );

        return [
            'success' => true,
            'updates_installed' => $updates_installed,
            'errors' => $errors,
            'message' => 'Actualizare automată completă'
        ];
    }

    public function force_automation() {
        check_ajax_referer( 'ots_automation_ajax' );
        
        if ( ! current_user_can( 'install_plugins' ) ) {
            wp_send_json_error( 'Acces restricționat.' );
        }

        $this->log_line( 'FORCE AUTOMATION: Execuție forțată solicitată de utilizator' );
        
        // Șterge cronjob-ul existent
        wp_clear_scheduled_hook( 'ots_auto_update_plugins' );
        
        // Rulează actualizarea imediat
        $result = $this->run_automated_update( false );
        
        if ( $result['success'] ) {
            // Reprogramează următoarea execuție
            $settings = $this->get_settings();
            $this->setup_cronjob( $settings );
            
                    $this->log_line( 'FORCE AUTOMATION: Execuție forțată completă cu succes' );
        wp_send_json_success( 'Execuția automatizării a fost forțată cu succes! Verifică logurile pentru detalii.' );
    } else {
        $this->log_line( 'FORCE AUTOMATION: Eroare la execuția forțată: ' . $result['message'] );
        wp_send_json_error( 'Eroare la execuția forțată: ' . $result['message'] );
    }
}

    public function test_performance() {
        check_ajax_referer( 'ots_automation_ajax' );
        
        if ( ! current_user_can( 'install_plugins' ) ) {
            wp_send_json_error( 'Acces restricționat.' );
        }

        $this->log_line( 'PERFORMANCE TEST: Începe testul de performanță' );
        
        // Testează performanța verificării cronjob-urilor
        $start_time = microtime(true);
        
        // Simulează verificarea cronjob-urilor
        $settings = $this->get_settings();
        $next_run = wp_next_scheduled( 'ots_auto_update_plugins' );
        
        $execution_time = microtime(true) - $start_time;
        $execution_time_ms = round($execution_time * 1000, 2);
        
        $this->log_line( 'PERFORMANCE TEST: Verificare cronjob în ' . $execution_time_ms . 'ms' );
        
        // Testează performanța conexiunii FTP
        $start_time = microtime(true);
        $connection = $this->connect_to_ftp( $settings );
        $ftp_time = microtime(true) - $start_time;
        $ftp_time_ms = round($ftp_time * 1000, 2);
        
        if ( $connection['success'] ) {
            ftp_close( $connection['resource'] );
            $this->log_line( 'PERFORMANCE TEST: Conexiune FTP în ' . $ftp_time_ms . 'ms' );
        }
        
        $total_time = $execution_time + $ftp_time;
        $total_time_ms = round($total_time * 1000, 2);
        
        $this->log_line( 'PERFORMANCE TEST: Test complet în ' . $total_time_ms . 'ms' );
        
        $performance_data = [
            'cron_check' => $execution_time_ms,
            'ftp_connection' => $ftp_time_ms,
            'total_time' => $total_time_ms,
            'status' => 'OK'
        ];
        
        wp_send_json_success( $performance_data );
    }

    private function filter_plugins_for_update( $updates_available, $settings ) {
        switch ( $settings['auto_update_plugins'] ) {
            case 'all':
                return $updates_available;
                
            case 'selected':
                if ( empty( $settings['auto_update_selected_plugins'] ) ) {
                    return [];
                }
                
                $selected_slugs = array_map( 'trim', explode( "\n", $settings['auto_update_selected_plugins'] ) );
                $selected_slugs = array_filter( $selected_slugs );
                
                // Creează un array cu toate variațiile posibile ale slug-urilor
                $expanded_slugs = [];
                foreach ( $selected_slugs as $slug ) {
                    $expanded_slugs[] = $slug;
                    
                    // Adaugă variații pentru pluginuri cunoscute
                    $special_mappings = [
                        'astra-addon' => ['astra-pro', 'astra-addon', 'astra'],
                        'elementor-pro' => ['elementor-pro', 'elementor'],
                        'wp-mail-smtp-pro' => ['wp-mail-smtp-pro', 'wp-mail-smtp'],
                        'admin-site-enhancements-pro' => ['admin-site-enhancements-pro', 'ase-pro', 'ase']
                    ];
                    
                    if ( isset( $special_mappings[ $slug ] ) ) {
                        $expanded_slugs = array_merge( $expanded_slugs, $special_mappings[ $slug ] );
                    }
                }
                
                return array_filter( $updates_available, function( $update ) use ( $expanded_slugs ) {
                    return in_array( $update['plugin_slug'], $expanded_slugs );
                } );
                
            case 'none':
            default:
                return [];
        }
    }

    private function install_plugin_from_ftp( $ftp, $filename, $settings, $is_automation = false ) {
        // Implementare similară cu handle_ftp_install dar pentru automatizare
        // Aceasta este o versiune simplificată pentru cronjob
        
        $temp_file = wp_tempnam( $filename );
        if ( ! $temp_file ) {
            return [ 'success' => false, 'message' => 'Nu s-a putut crea fișierul temporar' ];
        }

        // Descarcă fișierul de pe FTP
        if ( ! ftp_get( $ftp, $temp_file, $filename, FTP_BINARY ) ) {
            unlink( $temp_file );
            return [ 'success' => false, 'message' => 'Nu s-a putut descărca fișierul de pe FTP' ];
        }

        // Instalează plugin-ul
        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
        require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';

        $upgrader = new Plugin_Upgrader( new Automatic_Upgrader_Skin() );
        
        // Setează opțiunile pentru actualizare
        add_filter( 'upgrader_package_options', function( $options ) {
            $options['clear_destination'] = true;
            $options['abort_if_destination_exists'] = false;
            return $options;
        } );

        $result = $upgrader->install( $temp_file );
        
        // Curăță fișierul temporar
        unlink( $temp_file );

        if ( is_wp_error( $result ) ) {
            return [ 'success' => false, 'message' => $result->get_error_message() ];
        }

        return [ 'success' => true, 'message' => 'Plugin instalat cu succes' ];
    }

    private function send_automation_notification( $email, $updates_installed, $errors, $is_test ) {
        $subject = '[' . get_bloginfo( 'name' ) . '] ' . ( $is_test ? 'TEST ' : '' ) . 'Actualizare Automată Pluginuri';
        
        $message = "🤖 ACTUALIZARE AUTOMATĂ PLUGINURI\n";
        $message .= "=====================================\n\n";
        
        // Informații despre website și execuție
        $message .= "🌐 WEBSITE: " . get_bloginfo( 'name' ) . "\n";
        $message .= "🔗 URL: " . get_bloginfo( 'url' ) . "\n";
        $message .= "📅 DATA EXECUȚIE: " . current_time( 'd.m.Y H:i:s' ) . "\n";
        $message .= "⏰ TIMESTAMP: " . current_time( 'U' ) . "\n";
        $message .= "🔧 TIP EXECUȚIE: " . ( $is_test ? 'TEST' : 'PRODUCȚIE' ) . "\n\n";
        
        // Informații despre server
        $message .= "🖥️ INFORMATII SERVER:\n";
        $message .= "PHP Version: " . PHP_VERSION . "\n";
        $message .= "WordPress Version: " . get_bloginfo( 'version' ) . "\n";
        $message .= "Server: " . $_SERVER['SERVER_SOFTWARE'] . "\n\n";
        
        // Rezultate actualizări
        if ( ! empty( $updates_installed ) ) {
            $message .= "✅ PLUGINURI ACTUALIZATE CU SUCCES (" . count( $updates_installed ) . "):\n";
            $message .= "----------------------------------------\n";
            foreach ( $updates_installed as $plugin ) {
                $message .= "✓ " . $plugin . "\n";
            }
            $message .= "\n";
        }
        
        if ( ! empty( $errors ) ) {
            $message .= "❌ ERORI ÎNTÂLNITE (" . count( $errors ) . "):\n";
            $message .= "----------------------------------------\n";
            foreach ( $errors as $error ) {
                $message .= "✗ " . $error . "\n";
            }
            $message .= "\n";
        }
        
        if ( empty( $updates_installed ) && empty( $errors ) ) {
            $message .= "ℹ️ NU AU FOST GĂSITE ACTUALIZĂRI DISPONIBILE\n";
            $message .= "----------------------------------------\n";
            $message .= "Toate pluginurile sunt la zi sau nu au versiuni noi pe FTP.\n\n";
        }
        
        // Statistici
        $message .= "📊 STATISTICI:\n";
        $message .= "Total pluginuri actualizate: " . count( $updates_installed ) . "\n";
        $message .= "Total erori: " . count( $errors ) . "\n";
        $message .= "Rata de succes: " . ( count( $updates_installed ) > 0 ? round( ( count( $updates_installed ) / ( count( $updates_installed ) + count( $errors ) ) ) * 100, 2 ) . '%' : '0%' ) . "\n\n";
        
        // Informații despre automatizare
        $settings = $this->get_settings();
        $message .= "⚙️ SETĂRI AUTOMATIZARE:\n";
        $message .= "Frecvența: " . ucfirst( $settings['auto_update_frequency'] ) . "\n";
        $message .= "Ora de execuție: " . $settings['auto_update_time'] . "\n";
        if ( $settings['auto_update_frequency'] === 'weekly' ) {
            $day_names = [
                'monday' => 'Luni', 'tuesday' => 'Marți', 'wednesday' => 'Miercuri',
                'thursday' => 'Joi', 'friday' => 'Vineri', 'saturday' => 'Sâmbătă', 'sunday' => 'Duminică'
            ];
            $message .= "Ziua săptămânii: " . $day_names[ $settings['auto_update_day'] ] . "\n";
        }
        $message .= "Ce să actualizeze: " . ( $settings['auto_update_plugins'] === 'all' ? 'Toate pluginurile' : ( $settings['auto_update_plugins'] === 'selected' ? 'Doar pluginurile selectate' : 'Nu actualiza nimic' ) ) . "\n";
        $message .= "Dry Run: " . ( $settings['auto_update_dry_run'] ? 'Activ' : 'Inactiv' ) . "\n\n";
        
        // Următoarea execuție
        $next_run = wp_next_scheduled( 'ots_auto_update_plugins' );
        if ( $next_run ) {
            $next_run_local = get_date_from_gmt( date( 'Y-m-d H:i:s', $next_run ), 'd.m.Y H:i:s' );
            $message .= "🕒 URMĂTOAREA EXECUȚIE:\n";
            $message .= $next_run_local . "\n\n";
        }
        
        // Footer
        $message .= "=====================================\n";
        $message .= "📧 Acest email a fost generat automat de plugin-ul Bulk ZIP Plugin Installer\n";
        $message .= "🔗 Plugin: " . plugin_dir_url( __FILE__ ) . "\n";
        $message .= "📝 Pentru suport sau întrebări, contactează administratorul website-ului.\n";
        
        // Headers pentru email
        $headers = [
            'Content-Type: text/plain; charset=UTF-8',
            'From: ' . get_bloginfo( 'name' ) . ' <noreply@' . parse_url( get_bloginfo( 'url' ), PHP_URL_HOST ) . '>',
            'Reply-To: noreply@' . parse_url( get_bloginfo( 'url' ), PHP_URL_HOST ),
            'X-Mailer: WordPress Bulk ZIP Plugin Installer'
        ];
        
        wp_mail( $email, $subject, $message, $headers );
        
        // Log email-ul trimis
        $this->log_line( 'AUTOMATION: Email notificare trimis la ' . $email . ' cu ' . count( $updates_installed ) . ' actualizări și ' . count( $errors ) . ' erori' );
    }

    private function send_manual_update_notification( $email, $updates_installed, $errors ) {
        $subject = '[' . get_bloginfo( 'name' ) . '] Actualizare Manuală Pluginuri';
        
        $message = "🔧 ACTUALIZARE MANUALĂ PLUGINURI\n";
        $message .= "=====================================\n\n";
        
        // Informații despre website și execuție
        $message .= "🌐 WEBSITE: " . get_bloginfo( 'name' ) . "\n";
        $message .= "🔗 URL: " . get_bloginfo( 'url' ) . "\n";
        $message .= "📅 DATA EXECUȚIE: " . current_time( 'd.m.Y H:i:s' ) . "\n";
        $message .= "⏰ TIMESTAMP: " . current_time( 'U' ) . "\n";
        $message .= "🔧 TIP EXECUȚIE: MANUALĂ\n\n";
        
        // Informații despre server
        $message .= "🖥️ INFORMATII SERVER:\n";
        $message .= "PHP Version: " . PHP_VERSION . "\n";
        $message .= "WordPress Version: " . get_bloginfo( 'version' ) . "\n";
        $message .= "Server: " . $_SERVER['SERVER_SOFTWARE'] . "\n\n";
        
        // Rezultate actualizări
        if ( ! empty( $updates_installed ) ) {
            $message .= "✅ PLUGINURI ACTUALIZATE CU SUCCES (" . count( $updates_installed ) . "):\n";
            $message .= "----------------------------------------\n";
            foreach ( $updates_installed as $plugin ) {
                $message .= "✓ " . $plugin . "\n";
            }
            $message .= "\n";
        }
        
        if ( ! empty( $errors ) ) {
            $message .= "❌ ERORI ÎNTÂLNITE (" . count( $errors ) . "):\n";
            $message .= "----------------------------------------\n";
            foreach ( $errors as $error ) {
                $message .= "✗ " . $error . "\n";
            }
            $message .= "\n";
        }
        
        if ( empty( $updates_installed ) && empty( $errors ) ) {
            $message .= "ℹ️ NU AU FOST GĂSITE ACTUALIZĂRI DISPONIBILE\n";
            $message .= "----------------------------------------\n";
            $message .= "Toate pluginurile sunt la zi sau nu au versiuni noi pe FTP.\n\n";
        }
        
        // Statistici
        $message .= "📊 STATISTICI:\n";
        $message .= "Total pluginuri actualizate: " . count( $updates_installed ) . "\n";
        $message .= "Total erori: " . count( $errors ) . "\n";
        $message .= "Rata de succes: " . ( count( $updates_installed ) > 0 ? round( ( count( $updates_installed ) / ( count( $updates_installed ) + count( $errors ) ) ) * 100, 2 ) . '%' : '0%' ) . "\n\n";
        
        // Footer
        $message .= "=====================================\n";
        $message .= "📧 Acest email a fost generat automat de plugin-ul Bulk ZIP Plugin Installer\n";
        $message .= "🔗 Plugin: " . plugin_dir_url( __FILE__ ) . "\n";
        $message .= "📝 Pentru suport sau întrebări, contactează administratorul website-ului.\n";
        
        // Headers pentru email
        $headers = [
            'Content-Type: text/plain; charset=UTF-8',
            'From: ' . get_bloginfo( 'name' ) . ' <noreply@' . parse_url( get_bloginfo( 'url' ), PHP_URL_HOST ) . '>',
            'Reply-To: noreply@' . parse_url( get_bloginfo( 'url' ), PHP_URL_HOST ),
            'X-Mailer: WordPress Bulk ZIP Plugin Installer'
        ];
        
        wp_mail( $email, $subject, $message, $headers );
        
        // Log email-ul trimis
        $this->log_line( 'MANUAL UPDATE: Email notificare trimis la ' . $email . ' cu ' . count( $updates_installed ) . ' actualizări și ' . count( $errors ) . ' erori' );
    }

    public function activate_cron() {
        $settings = $this->get_settings();
        $this->setup_cronjob( $settings );
    }

    public function deactivate_cron() {
        wp_clear_scheduled_hook( 'ots_auto_update_plugins' );
    }

    public function debug_cron_status() {
        // Rulează doar o dată pe zi pentru a evita spam-ul în loguri
        $last_debug = get_transient( 'ots_cron_debug_last_run' );
        if ( $last_debug && ( time() - $last_debug ) < 86400 ) {
            return;
        }
        
        $this->log_line( 'CRON DEBUG: Verificare status cronjob-uri WordPress' );
        
        // Verifică dacă WordPress cron este activat
        $this->log_line( 'CRON DEBUG: DISABLE_WP_CRON: ' . ( defined( 'DISABLE_WP_CRON' ) && DISABLE_WP_CRON ? 'DA (dezactivat)' : 'NU (activat)' ) );
        
        // Verifică cronjob-ul nostru
        $next_run = wp_next_scheduled( 'ots_auto_update_plugins' );
        if ( $next_run ) {
            $next_run_local = get_date_from_gmt( date( 'Y-m-d H:i:s', $next_run ), 'Y-m-d H:i:s' );
            $this->log_line( 'CRON DEBUG: Următoarea execuție programată: ' . $next_run_local . ' (timestamp: ' . $next_run . ')' );
            
            // Calculează cât timp până la următoarea execuție
            $time_until = $next_run - time();
            if ( $time_until > 0 ) {
                $this->log_line( 'CRON DEBUG: Timp până la următoarea execuție: ' . gmdate( 'H:i:s', $time_until ) );
            } else {
                $this->log_line( 'CRON DEBUG: Cronjob-ul ar fi trebuit să ruleze acum! (întârziat cu ' . gmdate( 'H:i:s', abs( $time_until ) ) . ')' );
            }
        } else {
            $this->log_line( 'CRON DEBUG: NU există cronjob programat pentru ots_auto_update_plugins!' );
        }
        
        // Verifică toate cronjob-urile WordPress
        $crons = _get_cron_array();
        $this->log_line( 'CRON DEBUG: Total cronjob-uri WordPress: ' . count( $crons ) );
        
        // Verifică dacă există cronjob-uri pentru plugin-ul nostru
        $our_crons = [];
        foreach ( $crons as $timestamp => $cron ) {
            if ( isset( $cron['ots_auto_update_plugins'] ) ) {
                $our_crons[] = date( 'Y-m-d H:i:s', $timestamp );
            }
        }
        
        if ( ! empty( $our_crons ) ) {
            $this->log_line( 'CRON DEBUG: Cronjob-uri găsite pentru plugin: ' . implode( ', ', $our_crons ) );
        } else {
            $this->log_line( 'CRON DEBUG: NU există cronjob-uri pentru plugin în array-ul WordPress!' );
        }
        
        // Setează timestamp-ul pentru ultima verificare
        set_transient( 'ots_cron_debug_last_run', time(), 86400 );
    }

    public function check_and_force_cron_execution_optimized() {
        // Măsurare timp execuție pentru monitorizare performanță
        $start_time = microtime(true);
        
        // Rulează doar pentru administratori și doar o dată la 5 minute
        if ( ! current_user_can( 'install_plugins' ) ) {
            return;
        }
        
        $last_check = get_transient( 'ots_cron_force_check_last_run' );
        if ( $last_check && ( time() - $last_check ) < 300 ) { // 5 minute = 300 secunde
            return;
        }
        
        $settings = $this->get_settings();
        if ( ! $settings['auto_update_enabled'] ) {
            return;
        }
        
        $next_run = wp_next_scheduled( 'ots_auto_update_plugins' );
        if ( ! $next_run ) {
            return;
        }
        
        // Verifică dacă cronjob-ul ar fi trebuit să ruleze
        $current_time = time();
        $time_diff = $current_time - $next_run;
        
        // Dacă cronjob-ul ar fi trebuit să ruleze în ultimele 10 minute, forțează execuția
        if ( $time_diff >= 0 && $time_diff <= 600 ) { // 10 minute = 600 secunde
            $this->log_line( 'CRON FORCE: Cronjob întârziat cu ' . gmdate( 'H:i:s', $time_diff ) . ' - forțez execuția!' );
            
            // Șterge cronjob-ul vechi
            wp_clear_scheduled_hook( 'ots_auto_update_plugins' );
            
            // Rulează actualizarea imediat
            $this->run_automated_update( false );
            
            // Reprogramează următoarea execuție
            $this->setup_cronjob( $settings );
            
            $this->log_line( 'CRON FORCE: Execuție forțată completă, cronjob reprogramat' );
        }
        
        // Calculează timpul de execuție și loghează performanța
        $execution_time = microtime(true) - $start_time;
        $execution_time_ms = round($execution_time * 1000, 2);
        
        $this->log_line( 'CRON FORCE: Verificare completă în ' . $execution_time_ms . 'ms - Performanță OK' );
        
        // Setează timestamp-ul pentru ultima verificare (5 minute)
        set_transient( 'ots_cron_force_check_last_run', time(), 300 );
    }

    private function extract_version_from_filename( $filename ) {
        // Extrage versiunea din numele fișierului (ex: plugin-name-1.2.3.zip -> 1.2.3)
        if ( preg_match( '/-(\d+\.\d+\.\d+)(?:-.*)?\.zip$/i', $filename, $matches ) ) {
            return $matches[1];
        }
        
        // Încearcă alte formate
        if ( preg_match( '/-(\d+\.\d+)\.zip$/i', $filename, $matches ) ) {
            return $matches[1] . '.0';
        }
        
        if ( preg_match( '/-(\d+)\.zip$/i', $filename, $matches ) ) {
            return $matches[1] . '.0.0';
        }
        
        return '0.0.0';
    }

    private function is_version_newer( $current, $new ) {
        // Compară versiunile și returnează true dacă versiunea nouă este mai mare
        $current_parts = array_map( 'intval', explode( '.', $current ) );
        $new_parts = array_map( 'intval', explode( '.', $new ) );
        
        // Completează cu 0 dacă nu sunt suficiente părți
        while ( count( $current_parts ) < 3 ) $current_parts[] = 0;
        while ( count( $new_parts ) < 3 ) $new_parts[] = 0;
        
        for ( $i = 0; $i < 3; $i++ ) {
            if ( $new_parts[$i] > $current_parts[$i] ) return true;
            if ( $new_parts[$i] < $current_parts[$i] ) return false;
        }
        
        return false; // Versiuni egale
    }

    private function get_update_status( $current, $new ) {
        if ( ! $new || $new === '0.0.0' ) return 'no_ftp_file';
        if ( $this->is_version_newer( $current, $new ) ) return 'update_available';
        if ( $current === $new ) return 'up_to_date';
        return 'downgrade';
    }

    private function format_file_size( $bytes ) {
        if ( $bytes >= 1073741824 ) {
            return round( $bytes / 1073741824, 2 ) . ' GB';
        } elseif ( $bytes >= 1048576 ) {
            return round( $bytes / 1048576, 2 ) . ' MB';
        } elseif ( $bytes >= 1024 ) {
            return round( $bytes / 1024, 2 ) . ' KB';
        } else {
            return $bytes . ' bytes';
        }
    }

    private function find_matching_zip_file( $plugin_slug, $plugin_name, $ftp_files ) {
        $plugin_slug_clean = strtolower( $plugin_slug );
        $plugin_name_clean = strtolower( str_replace( [' ', '-', '_'], '', $plugin_name ) );
        
        // Cazuri speciale pentru pluginuri cunoscute
        $special_mappings = [
            'astra-addon' => ['astra-pro', 'astra-addon', 'astra'],
            'elementor-pro' => ['elementor-pro', 'elementor'],
            'wp-mail-smtp-pro' => ['wp-mail-smtp-pro', 'wp-mail-smtp'],
            'admin-site-enhancements-pro' => ['admin-site-enhancements-pro', 'ase-pro', 'ase']
        ];
        
        foreach ( $ftp_files as $ftp_file ) {
            $filename = basename( $ftp_file );
            if ( strtolower( pathinfo( $filename, PATHINFO_EXTENSION ) ) === 'zip' ) {
                $filename_lower = strtolower( $filename );
                
                // Încearcă să găsească potrivirea după slug
                if ( strpos( $filename_lower, $plugin_slug_clean ) !== false ) {
                    return $filename;
                }
                
                // Încearcă să găsească potrivirea după numele plugin-ului
                if ( strpos( $filename_lower, $plugin_name_clean ) !== false ) {
                    return $filename;
                }
                
                // Verifică mapping-urile speciale
                if ( isset( $special_mappings[ $plugin_slug_clean ] ) ) {
                    foreach ( $special_mappings[ $plugin_slug_clean ] as $search_term ) {
                        if ( strpos( $filename_lower, $search_term ) !== false ) {
                            return $filename;
                        }
                    }
                }
            }
        }
        
        return null;
    }

    private function connect_to_ftp( $settings ) {
        if ( empty( $settings['ftp_host'] ) || empty( $settings['ftp_user'] ) ) {
            return [ 'success' => false, 'message' => 'Setările FTP nu sunt complete.' ];
        }

        // Conectare FTP sau FTPS
        if ( $settings['ftp_ssl'] ) {
            $ftp = ftp_ssl_connect( $settings['ftp_host'], (int) $settings['ftp_port'], 30 );
        } else {
            $ftp = ftp_connect( $settings['ftp_host'], (int) $settings['ftp_port'], 30 );
        }

        if ( ! $ftp ) {
            return [ 'success' => false, 'message' => 'Nu s-a putut conecta la serverul FTP. Verifică adresa și portul.' ];
        }

        if ( $settings['ftp_passive'] ) {
            ftp_pasv( $ftp, true );
        }

        $password = $this->decrypt_password( $settings['ftp_pass'] );
        if ( ! ftp_login( $ftp, $settings['ftp_user'], $password ) ) {
            ftp_close( $ftp );
            return [ 'success' => false, 'message' => 'Autentificare FTP eșuată. Verifică utilizatorul și parola.' ];
        }

        // Încearcă să navighezi la directorul specificat
        if ( ! empty( $settings['ftp_path'] ) && $settings['ftp_path'] !== '/' ) {
            $path = rtrim( $settings['ftp_path'], '/' );
            if ( ! ftp_chdir( $ftp, $path ) ) {
                // Dacă nu poate naviga, să încerce să listeze din directorul curent
                $current_dir = ftp_pwd( $ftp );
                return [ 'success' => true, 'resource' => $ftp, 'warning' => 'Nu s-a putut naviga la ' . $path . '. Rămânem în ' . $current_dir ];
            }
        }

        return [ 'success' => true, 'resource' => $ftp ];
    }

    public function handle_ftp_install() {
        if ( ! current_user_can( 'install_plugins' ) ) {
            wp_die( esc_html__( 'Nu ai permisiuni.', 'ots-bulk-zip' ) );
        }
        check_admin_referer( 'ots_bulk_zip_ftp_install' );

        $selected_files = array_filter( array_map( 'trim', explode( ',', $_POST['selected_files'] ?? '' ) ) );
        if ( empty( $selected_files ) ) {
            wp_redirect( add_query_arg( [ 'page' => 'ots-bulk-zip-plugins', 'ots_status' => 'no_files' ], admin_url( 'tools.php' ) ) );
            exit;
        }

        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
        require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';

        $settings = $this->get_settings();
        $max_bytes = (int) $settings['max_mb'] * 1024 * 1024;
        $use_dry_run = ! empty( $_POST['dry_run'] );
        $activate_after = ! empty( $_POST['activate_after'] );
        $action_type = $_POST['action_type'] ?? 'install'; // 'install' sau 'update'

        // Connect to FTP
        $connection = $this->connect_to_ftp( $settings );
        if ( ! $connection['success'] ) {
            wp_die( 'Eroare conexiune FTP: ' . $connection['message'] );
        }

        $ftp = $connection['resource'];
        
        // Debug info despre conexiunea FTP
        $current_dir = ftp_pwd( $ftp );
        $this->log_line( "DEBUG FTP: Conectat la server. Director curent: {$current_dir}" );
        $this->log_line( "DEBUG FTP: Calea configurată: {$settings['ftp_path']}" );
        $this->log_line( "DEBUG FTP: Tip acțiune: {$action_type}" );
        
        $results = [];

        // Configurăm opțiunile în funcție de tipul de acțiune
        if ( $action_type === 'install' ) {
            // Pentru instalare: nu suprascrie, doar instalează dacă nu există
            add_filter( 'upgrader_package_options', function( $options ) {
                $options['clear_destination'] = false;
                $options['abort_if_destination_exists'] = true;
                return $options;
            } );
        } else {
            // Pentru actualizare: suprascrie pluginul existent
            add_filter( 'upgrader_package_options', function( $options ) {
                $options['clear_destination'] = true;
                $options['abort_if_destination_exists'] = false;
                return $options;
            } );
        }

        WP_Filesystem();

        foreach ( $selected_files as $filename ) {
            // Încearcă mai multe căi pentru fișier
            $remote_file_paths = [];
            
            // 1. Calea specificată în setări
            $remote_file_paths[] = trailingslashit( $settings['ftp_path'] ) . $filename;
            
            // 2. Calea relativă din directorul curent
            $remote_file_paths[] = $filename;
            
            // 3. Calea absolută
            $remote_file_paths[] = '/' . ltrim( $settings['ftp_path'], '/' ) . '/' . $filename;
            
            $file_found = false;
            $remote_file = '';
            $file_size = 0;
            
            // Încearcă să găsească fișierul pe diferite căi
            foreach ( $remote_file_paths as $path ) {
                $size = ftp_size( $ftp, $path );
                if ( $size > 0 ) {
                    $remote_file = $path;
                    $file_size = $size;
                    $file_found = true;
                    $this->log_line( "DEBUG FTP: Fișier găsit la calea: {$path}, mărime: {$size}" );
                    break;
                }
            }
            
            if ( ! $file_found ) {
                $results[] = [ 'file' => $filename, 'ok' => false, 'msg' => 'Fișierul nu a fost găsit pe serverul FTP.' ];
                $this->log_line( "EROARE FTP: Fișierul {$filename} nu a fost găsit pe server. Căi încercate: " . implode( ', ', $remote_file_paths ) );
                continue;
            }
            
            // Verifică mărimea fișierului
            if ( $file_size > $max_bytes ) {
                $results[] = [ 'file' => $filename, 'ok' => false, 'msg' => 'Dimensiune peste limită (' . $this->format_file_size( $file_size ) . ').' ];
                $this->log_line( "RESPINS FTP (mărime): {$filename} ({$this->format_file_size( $file_size )})" );
                continue;
            }

            // Download fișierul temporar
            $temp_file = wp_tempnam( $filename );
            $this->log_line( "DEBUG FTP: Încerc descărcarea {$filename} de la {$remote_file}" );
            
            if ( ! ftp_get( $ftp, $temp_file, $remote_file, FTP_BINARY ) ) {
                $results[] = [ 'file' => $filename, 'ok' => false, 'msg' => 'Eroare descărcare FTP.' ];
                $this->log_line( "EROARE FTP download: {$filename} de la calea {$remote_file}" );
                continue;
            }

            // Verifică slug-ul
            $slug = $this->zip_top_level_slug( $temp_file );
            list( $allowed, $why ) = $this->is_slug_allowed( $slug, $settings );
            if ( ! $allowed ) {
                $results[] = [ 'file' => $filename, 'ok' => false, 'msg' => $why . " (slug: {$slug})" ];
                $this->log_line( "RESPINS FTP (slug): {$filename} — {$why} — slug={$slug}" );
                unlink( $temp_file );
                continue;
            }

            if ( $use_dry_run ) {
                $action_text = ( $action_type === 'install' ) ? 'instalat' : 'actualizat';
                $results[] = [ 'file' => $filename, 'ok' => true, 'msg' => "Dry-run OK (slug: {$slug}) — NU s-a {$action_text}." ];
                $this->log_line( "DRY-RUN FTP {$action_type}: {$filename} — slug={$slug}" );
                unlink( $temp_file );
                continue;
            }

            // Instalează pluginul
            $skin = new Automatic_Upgrader_Skin();
            $upgrader = new Plugin_Upgrader( $skin );
            $installed = $upgrader->install( $temp_file );

            unlink( $temp_file );

            if ( is_wp_error( $installed ) ) {
                $msg = $installed->get_error_message();
                $results[] = [ 'file' => $filename, 'ok' => false, 'msg' => $msg ];
                $this->log_line( "EROARE instalare FTP: {$filename} — {$msg}" );
                continue;
            }

            // Activare dacă este solicitată
            $plugin_main_file = $this->guess_plugin_file_from_result( $upgrader->result );
            $action_text = ( $action_type === 'install' ) ? 'instalat' : 'actualizat';
            
            // Debug info pentru activare
            $this->log_line( "DEBUG FTP: Result upgrader: " . json_encode( $upgrader->result ) );
            $this->log_line( "DEBUG FTP: Plugin main file găsit: " . ( $plugin_main_file ?: 'NU' ) );
            $this->log_line( "DEBUG FTP: Activate after: " . ( $activate_after ? 'DA' : 'NU' ) );
            
            if ( $activate_after && $plugin_main_file ) {
                $is_already_active = is_plugin_active( $plugin_main_file );
                $this->log_line( "DEBUG FTP: Plugin deja activ: " . ( $is_already_active ? 'DA' : 'NU' ) );
                
                if ( ! $is_already_active ) {
                    $activate = activate_plugin( $plugin_main_file );
                    if ( is_wp_error( $activate ) ) {
                        $msg = ucfirst( $action_text ) . ' din FTP, DAR activarea a eșuat: ' . $activate->get_error_message();
                        $results[] = [ 'file' => $filename, 'ok' => true, 'msg' => $msg ];
                        $this->log_line( strtoupper( $action_type ) . " FTP dar activare eșuată: {$filename} — {$msg}" );
                        continue;
                    }
                    $results[] = [ 'file' => $filename, 'ok' => true, 'msg' => ucfirst( $action_text ) . ' din FTP și activat.' ];
                    $this->log_line( strtoupper( $action_type ) . "+ACTIVAT FTP: {$filename} — slug={$slug}" );
                } else {
                    $results[] = [ 'file' => $filename, 'ok' => true, 'msg' => ucfirst( $action_text ) . ' din FTP (era deja activat).' ];
                    $this->log_line( strtoupper( $action_type ) . " FTP (deja activat): {$filename} — slug={$slug}" );
                }
            } else {
                if ( ! $plugin_main_file ) {
                    $this->log_line( "DEBUG FTP: Nu s-a putut găsi fișierul principal al plugin-ului pentru {$filename}" );
                }
                $results[] = [ 'file' => $filename, 'ok' => true, 'msg' => ucfirst( $action_text ) . ' din FTP.' ];
                $this->log_line( strtoupper( $action_type ) . " FTP: {$filename} — slug={$slug}" );
            }
        }

        ftp_close( $ftp );

        // Trimite email notificare dacă este configurat
        if ( ! empty( $settings['auto_update_notify_email'] ) ) {
            $successful = array_filter( $results, function( $item ) { return $item['ok']; } );
            $failed = array_filter( $results, function( $item ) { return ! $item['ok']; } );
            
            $successful_names = array_map( function( $item ) { return $item['file']; }, $successful );
            $failed_messages = array_map( function( $item ) { return $item['file'] . ': ' . $item['msg']; }, $failed );
            
            $this->send_manual_update_notification( $settings['auto_update_notify_email'], $successful_names, $failed_messages );
        }

        set_transient( 'ots_bulk_zip_report', $results, 120 );
        wp_redirect( add_query_arg( [ 'page' => 'ots-bulk-zip-plugins', 'ots_status' => 'done' ], admin_url( 'tools.php' ) ) );
        exit;
    }

    public function save_settings() {
        if ( ! current_user_can( 'install_plugins' ) ) {
            wp_die( esc_html__( 'Nu ai permisiuni.', 'ots-bulk-zip' ) );
        }
        check_admin_referer( 'ots_bulk_zip_save_settings' );

        $current_settings = $this->get_settings();

        $opts = [
            'max_mb'        => max( 1, (int) ($_POST['max_mb'] ?? 64) ),
            'dry_run'       => isset( $_POST['dry_run'] ) ? 1 : 0,
            'whitelist'     => wp_unslash( $_POST['whitelist'] ?? '' ),
            'blacklist'     => wp_unslash( $_POST['blacklist'] ?? '' ),
            'logging'       => isset( $_POST['logging'] ) ? 1 : 0,
            'ftp_host'      => sanitize_text_field( $_POST['ftp_host'] ?? '' ),
            'ftp_port'      => max( 1, min( 65535, (int) ($_POST['ftp_port'] ?? 21) ) ),
            'ftp_user'      => sanitize_text_field( $_POST['ftp_user'] ?? '' ),
            'ftp_path'      => trailingslashit( sanitize_text_field( $_POST['ftp_path'] ?? '/' ) ),
            'ftp_passive'   => isset( $_POST['ftp_passive'] ) ? 1 : 0,
            'ftp_ssl'       => isset( $_POST['ftp_ssl'] ) ? 1 : 0,
        ];

        // Gestionează parola FTP
        if ( ! empty( $_POST['ftp_pass'] ) ) {
            $opts['ftp_pass'] = $this->encrypt_password( $_POST['ftp_pass'] );
        } elseif ( empty( $current_settings['ftp_pass'] ) ) {
            // Prima instalare - folosește parola implicită
            $opts['ftp_pass'] = $this->encrypt_password( 'Just$Fun%(*' );
        } else {
            $opts['ftp_pass'] = $current_settings['ftp_pass']; // Păstrează parola existentă
        }

        update_option( $this->opt_key, $opts );
        wp_redirect( add_query_arg( [ 'page' => 'ots-bulk-zip-plugins', 'ots_settings' => 'saved' ], admin_url( 'tools.php' ) ) );
        exit;
    }

    private function log_line( $message ) {
        $s = $this->get_settings();
        if ( ! $s['logging'] ) return;

        $upload_dir = wp_upload_dir();
        $log_file = trailingslashit( $upload_dir['basedir'] ) . 'ots-bulk-zip-installer.log';
        $prefix = '[' . gmdate( 'Y-m-d H:i:s' ) . ' UTC] ';
        @file_put_contents( $log_file, $prefix . $message . PHP_EOL, FILE_APPEND );
    }

    private function zip_top_level_slug( $zip_path ) {
        if ( ! class_exists( 'ZipArchive' ) ) return '';
        $zip = new ZipArchive();
        if ( $zip->open( $zip_path ) === true ) {
            $slug = '';
            for ( $i = 0; $i < $zip->numFiles; $i++ ) {
                $name = $zip->getNameIndex( $i );
                if ( $name && strpos( $name, '/' ) !== false ) {
                    $candidate = strtok( $name, '/' );
                    if ( $candidate ) { $slug = $candidate; break; }
                } elseif ( $name && strpos( $name, '/' ) === false ) {
                    // Rădăcină fără folder - fallback la nume fișier
                    $slug = sanitize_title( basename( $zip_path, '.zip' ) );
                    break;
                }
            }
            $zip->close();
            return sanitize_title( $slug );
        }
        return '';
    }

    private function is_slug_allowed( $slug, $settings ) {
        $wl = array_filter( array_map( 'trim', preg_split( "/\r\n|\r|\n/", (string) $settings['whitelist'] ) ) );
        $bl = array_filter( array_map( 'trim', preg_split( "/\r\n|\r|\n/", (string) $settings['blacklist'] ) ) );
        if ( ! empty( $wl ) && ! in_array( $slug, $wl, true ) ) return [ false, 'Slug nepermis (nu este în whitelist).' ];
        if ( ! empty( $bl ) && in_array( $slug, $bl, true ) ) return [ false, 'Slug interzis (se află în blacklist).' ];
        return [ true, '' ];
    }

    public function handle_upload() {
        if ( ! current_user_can( 'install_plugins' ) ) {
            wp_die( esc_html__( 'Nu ai permisiuni.', 'ots-bulk-zip' ) );
        }
        check_admin_referer( 'ots_bulk_zip_install' );

        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
        require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';

        $settings = $this->get_settings();
        $max_bytes = (int) $settings['max_mb'] * 1024 * 1024;
        $use_dry_run = ! empty( $_POST['dry_run'] ); // per-acțiune
        $action_type = $_POST['action_type'] ?? 'install'; // 'install' sau 'update'

        // Configurăm opțiunile în funcție de tipul de acțiune
        if ( $action_type === 'install' ) {
            // Pentru instalare: nu suprascrie, doar instalează dacă nu există
            add_filter( 'upgrader_package_options', function( $options ) {
                $options['clear_destination'] = false;
                $options['abort_if_destination_exists'] = true;
                return $options;
            } );
        } else {
            // Pentru actualizare: suprascrie pluginul existent
        add_filter( 'upgrader_package_options', function( $options ) {
            $options['clear_destination'] = true;
            $options['abort_if_destination_exists'] = false;
            return $options;
        } );
        }

        $results = [];
        $activate_after = ! empty( $_POST['activate_after'] );

        // Init filesystem
        WP_Filesystem();

        $files = $_FILES['plugin_zips'] ?? null;
        if ( ! $files || empty( $files['name'][0] ) ) {
            wp_redirect( add_query_arg( [ 'page' => 'ots-bulk-zip-plugins', 'ots_status' => 'no_files' ], admin_url( 'tools.php' ) ) );
            exit;
        }

        for ( $i = 0; $i < count( $files['name'] ); $i++ ) {
            $orig_name = $files['name'][$i];
            if ( $files['error'][$i] !== UPLOAD_ERR_OK ) {
                $results[] = [ 'file' => $orig_name, 'ok' => false, 'msg' => 'Eroare la upload.' ];
                $this->log_line( "EROARE upload: {$orig_name}" );
                continue;
            }
            if ( $files['size'][$i] > $max_bytes ) {
                $results[] = [ 'file' => $orig_name, 'ok' => false, 'msg' => 'Dimensiune peste limită (' . $this->format_file_size( $files['size'][$i] ) . ').' ];
                $this->log_line( "RESPINS (mărime): {$orig_name} ({$this->format_file_size( $files['size'][$i] )})" );
                continue;
            }

            $file_array = [
                'name'     => sanitize_file_name( $orig_name ),
                'type'     => $files['type'][$i],
                'tmp_name' => $files['tmp_name'][$i],
                'error'    => $files['error'][$i],
                'size'     => $files['size'][$i],
            ];

            $moved = wp_handle_upload( $file_array, [ 'test_form' => false, 'mimes' => [ 'zip' => 'application/zip' ] ] );
            if ( isset( $moved['error'] ) ) {
                $results[] = [ 'file' => $file_array['name'], 'ok' => false, 'msg' => $moved['error'] ];
                $this->log_line( "EROARE handle_upload: {$file_array['name']} — {$moved['error']}" );
                continue;
            }

            $zip_path = $moved['file'];
            $slug = $this->zip_top_level_slug( $zip_path );
            list( $allowed, $why ) = $this->is_slug_allowed( $slug, $settings );
            if ( ! $allowed ) {
                $results[] = [ 'file' => $file_array['name'], 'ok' => false, 'msg' => $why . " (slug: {$slug})" ];
                $this->log_line( "RESPINS (slug): {$file_array['name']} — {$why} — slug={$slug}" );
                continue;
            }

            if ( $use_dry_run ) {
                $action_text = ( $action_type === 'install' ) ? 'instalat' : 'actualizat';
                $results[] = [ 'file' => $file_array['name'], 'ok' => true, 'msg' => "Dry-run OK (slug: {$slug}) — NU s-a {$action_text}." ];
                $this->log_line( "DRY-RUN {$action_type}: {$file_array['name']} — slug={$slug}" );
                continue;
            }

            $skin = new Automatic_Upgrader_Skin();
            $upgrader = new Plugin_Upgrader( $skin );
            $installed = $upgrader->install( $zip_path );

            if ( is_wp_error( $installed ) ) {
                $msg = $installed->get_error_message();
                $results[] = [ 'file' => $file_array['name'], 'ok' => false, 'msg' => $msg ];
                $this->log_line( "EROARE instalare: {$file_array['name']} — {$msg}" );
                continue;
            }

            // Determinăm pluginul principal din pachet pentru activare
            $plugin_main_file = $this->guess_plugin_file_from_result( $upgrader->result );
            $action_text = ( $action_type === 'install' ) ? 'instalat' : 'actualizat';
            
            if ( $activate_after && $plugin_main_file && ! is_plugin_active( $plugin_main_file ) ) {
                $activate = activate_plugin( $plugin_main_file );
                if ( is_wp_error( $activate ) ) {
                    $msg = ucfirst( $action_text ) . ', DAR activarea a eșuat: ' . $activate->get_error_message();
                    $results[] = [ 'file' => $file_array['name'], 'ok' => true, 'msg' => $msg ];
                    $this->log_line( strtoupper( $action_type ) . " dar activare eșuată: {$file_array['name']} — {$msg}" );
                    continue;
                }
                $results[] = [ 'file' => $file_array['name'], 'ok' => true, 'msg' => ucfirst( $action_text ) . ' și activat.' ];
                $this->log_line( strtoupper( $action_type ) . "+ACTIVAT: {$file_array['name']} — slug={$slug}" );
            } else {
                $results[] = [ 'file' => $file_array['name'], 'ok' => true, 'msg' => ucfirst( $action_text ) . '.' ];
                $this->log_line( strtoupper( $action_type ) . ": {$file_array['name']} — slug={$slug}" );
            }
        }

        set_transient( 'ots_bulk_zip_report', $results, 120 );
        wp_redirect( add_query_arg( [ 'page' => 'ots-bulk-zip-plugins', 'ots_status' => 'done' ], admin_url( 'tools.php' ) ) );
        exit;
    }

    private function guess_plugin_file_from_result( $result ) {
        $this->log_line( "DEBUG: Încerc să găsesc fișierul principal din result: " . json_encode( $result ) );
        
        if ( is_array( $result ) && ! empty( $result['destination'] ) ) {
            $dir = trailingslashit( $result['destination'] );
            $this->log_line( "DEBUG: Director destinație: {$dir}" );
            
            if ( is_dir( $dir ) ) {
                // Încearcă să găsească fișierele PHP în director
                $php_files = glob( $dir . '*.php' );
                $this->log_line( "DEBUG: Fișiere PHP găsite: " . implode( ', ', $php_files ) );
                
                foreach ( $php_files as $file ) {
                    $data = get_plugin_data( $file, false, false );
                    $this->log_line( "DEBUG: Fișier {$file} - Name: " . ( $data['Name'] ?? 'NU' ) . ", PluginURI: " . ( $data['PluginURI'] ?? 'NU' ) );
                    
                    if ( ! empty( $data['Name'] ) ) {
                        $plugins_dir = trailingslashit( WP_PLUGIN_DIR );
                        if ( strpos( $file, $plugins_dir ) === 0 ) {
                            $relative_path = ltrim( str_replace( $plugins_dir, '', $file ), '/' );
                            $this->log_line( "DEBUG: Fișier principal găsit: {$relative_path}" );
                            return $relative_path;
                        }
                    }
                }
                
                // Fallback: încearcă să găsească orice fișier PHP cu nume sugestiv
                foreach ( $php_files as $file ) {
                    $filename = basename( $file );
                    if ( strpos( $filename, 'plugin' ) !== false || strpos( $filename, 'main' ) !== false || strpos( $filename, 'index' ) !== false ) {
                        $plugins_dir = trailingslashit( WP_PLUGIN_DIR );
                        if ( strpos( $file, $plugins_dir ) === 0 ) {
                            $relative_path = ltrim( str_replace( $plugins_dir, '', $file ), '/' );
                            $this->log_line( "DEBUG: Fallback - fișier principal găsit: {$relative_path}" );
                            return $relative_path;
                        }
                    }
                }
                
                // Ultimul fallback: primul fișier PHP găsit
                if ( ! empty( $php_files ) ) {
                    $first_file = $php_files[0];
                    $plugins_dir = trailingslashit( WP_PLUGIN_DIR );
                    if ( strpos( $first_file, $plugins_dir ) === 0 ) {
                        $relative_path = ltrim( str_replace( $plugins_dir, '', $first_file ), '/' );
                        $this->log_line( "DEBUG: Ultimul fallback - fișier principal găsit: {$relative_path}" );
                        return $relative_path;
                    }
                }
            }
        }
        
        $this->log_line( "DEBUG: Nu s-a putut găsi fișierul principal al plugin-ului" );
        return '';
    }

    public function download_logs() {
        if ( ! current_user_can( 'install_plugins' ) ) {
            wp_die( esc_html__( 'Nu ai permisiuni.', 'ots-bulk-zip' ) );
        }
        check_admin_referer( 'ots_download_logs' );

        $upload_dir = wp_upload_dir();
        $log_file = trailingslashit( $upload_dir['basedir'] ) . 'ots-bulk-zip-installer.log';

        if ( ! file_exists( $log_file ) ) {
            wp_die( 'Fișierul de log nu există.' );
        }

        $log_content = file_get_contents( $log_file );
        $filename = 'ots-bulk-zip-installer-' . date( 'Y-m-d-H-i-s' ) . '.log';

        header( 'Content-Type: text/plain' );
        header( 'Content-Disposition: attachment; filename="' . $filename . '"' );
        header( 'Content-Length: ' . strlen( $log_content ) );
        header( 'Cache-Control: no-cache, must-revalidate' );
        header( 'Pragma: no-cache' );

        echo $log_content;
        exit;
    }

    public function clear_logs() {
        if ( ! current_user_can( 'install_plugins' ) ) {
            wp_die( esc_html__( 'Nu ai permisiuni.', 'ots-bulk-zip' ) );
        }
        check_admin_referer( 'ots_clear_logs' );

        $upload_dir = wp_upload_dir();
        $log_file = trailingslashit( $upload_dir['basedir'] ) . 'ots-bulk-zip-installer.log';

        if ( file_exists( $log_file ) ) {
            if ( unlink( $log_file ) ) {
                wp_redirect( add_query_arg( [ 'page' => 'ots-bulk-zip-plugins', 'ots_logs' => 'cleared' ], admin_url( 'tools.php' ) ) );
            } else {
                wp_redirect( add_query_arg( [ 'page' => 'ots-bulk-zip-plugins', 'ots_logs' => 'error' ], admin_url( 'tools.php' ) ) );
            }
        } else {
            wp_redirect( add_query_arg( [ 'page' => 'ots-bulk-zip-plugins', 'ots_logs' => 'not_found' ], admin_url( 'tools.php' ) ) );
        }
        exit;
    }
}

OTS_Bulk_ZIP_Plugin_Installer::instance();

// Notificări admin
add_action( 'admin_notices', function() {
    if ( isset( $_GET['page'] ) && $_GET['page'] === 'ots-bulk-zip-plugins' ) {
        if ( isset( $_GET['ots_status'] ) && $_GET['ots_status'] === 'no_files' ) {
            echo '<div class="notice notice-error"><p><strong>Eroare:</strong> Nu ai selectat niciun fișier pentru instalare.</p></div>';
        } elseif ( isset( $_GET['ots_status'] ) && $_GET['ots_status'] === 'done' ) {
            $report = get_transient( 'ots_bulk_zip_report' );
            if ( $report ) {
                $successful = array_filter( $report, function( $item ) { return $item['ok']; } );
                $failed = array_filter( $report, function( $item ) { return ! $item['ok']; } );
                
                echo '<div class="notice notice-info is-dismissible">';
                echo '<h3>📋 Raport Instalare Completă</h3>';
                echo '<p><strong>Total procesate:</strong> ' . count( $report ) . ' pluginuri</p>';
                
                if ( ! empty( $successful ) ) {
                    echo '<p><strong style="color:#2271b1;">✅ Reușite (' . count( $successful ) . '):</strong></p>';
                    echo '<ul style="margin-left:20px; list-style: disc;">';
                    foreach ( $successful as $item ) {
                        echo '<li><strong>' . esc_html( $item['file'] ) . '</strong> — ' . esc_html( $item['msg'] ) . '</li>';
                    }
                    echo '</ul>';
                }
                
                if ( ! empty( $failed ) ) {
                    echo '<p><strong style="color:#d63638;">❌ Eșuate (' . count( $failed ) . '):</strong></p>';
                    echo '<ul style="margin-left:20px; list-style: disc;">';
                    foreach ( $failed as $item ) {
                        echo '<li><strong>' . esc_html( $item['file'] ) . '</strong> — <em style="color:#d63638;">' . esc_html( $item['msg'] ) . '</em></li>';
                    }
                    echo '</ul>';
                }
                
                echo '</div>';
                delete_transient( 'ots_bulk_zip_report' );
            }
        }
        if ( isset( $_GET['ots_settings'] ) && $_GET['ots_settings'] === 'saved' ) {
            echo '<div class="notice notice-success is-dismissible"><p><strong>✅ Setările au fost salvate cu succes!</strong></p></div>';
        }
        
        // Notificări pentru acțiunile cu logurile
        if ( isset( $_GET['ots_logs'] ) ) {
            switch ( $_GET['ots_logs'] ) {
                case 'cleared':
                    echo '<div class="notice notice-success is-dismissible"><p><strong>🗑️ Logurile au fost șterse cu succes!</strong></p></div>';
                    break;
                case 'error':
                    echo '<div class="notice notice-error is-dismissible"><p><strong>❌ Eroare la ștergerea logurilor!</strong></p></div>';
                    break;
                case 'not_found':
                    echo '<div class="notice notice-warning is-dismissible"><p><strong>⚠️ Fișierul de log nu a fost găsit!</strong></p></div>';
                    break;
            }
        }
    }
} );