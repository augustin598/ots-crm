<?php
if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

/**
 * Keez API Integration for WHMCS
 * Automatically creates invoices in Keez when new invoices are generated in WHMCS
 */

use WHMCS\Database\Capsule;
use WHMCS\Config\Setting;

// ===== CONFIGURARE KEEZ API =====
class KeezConfig {
    const TOKEN_URL_STAGING = 'https://staging.keez.ro/idp/connect/token';
    const TOKEN_URL_PRODUCTION = 'https://app.keez.ro/idp/connect/token';
    const API_URL_STAGING = 'https://staging.keez.ro/api/v1.0/public-api';
    const API_URL_PRODUCTION = 'https://app.keez.ro/api/v1.0/public-api';

    // Configurare din WHMCS settings
    public static function getSettings() {
        // Read from addon module settings instead of general settings
        $moduleSettings = Capsule::table('tbladdonmodules')
            ->where('module', 'keez_integration')
            ->pluck('value', 'setting')
            ->toArray();

        // Debug: Log what settings were found
        logActivity("Keez Settings Debug: Found " . count($moduleSettings) . " settings: " . json_encode(array_keys($moduleSettings)));

        $settings = [
            'environment' => $moduleSettings['KeezEnvironment'] ?? 'staging', // staging/production
            'client_eid' => $moduleSettings['KeezClientEID'] ?? '',
            'application_id' => $moduleSettings['KeezApplicationID'] ?? '',
            'secret' => $moduleSettings['KeezSecret'] ?? '',
            'enabled' => ($moduleSettings['KeezEnabled'] ?? '') === 'on',
            'factura_serie' => $moduleSettings['KeezFacturaSerie'] ?? 'OSTH',
            'tva_fix' => (float)($moduleSettings['KeezTVA'] ?? 21),
            'tva_incasare' => ($moduleSettings['KeezTVAIncasare'] ?? '') === 'on',
            'default_um' => $moduleSettings['KeezDefaultUM'] ?? 'Buc',
            'default_currency' => $moduleSettings['KeezDefaultCurrency'] ?? 'RON',
        ];

        // Debug: Log final settings (without sensitive data)
        logActivity("Keez Settings Final: AppID=" . substr($settings['application_id'], 0, 10) . "..., Secret=" . (empty($settings['secret']) ? 'EMPTY' : 'SET') . ", Environment=" . $settings['environment']);

        return $settings;
    }

    public static function getTokenUrl() {
        $settings = self::getSettings();
        return $settings['environment'] === 'production' ? self::TOKEN_URL_PRODUCTION : self::TOKEN_URL_STAGING;
    }

    public static function getApiUrl() {
        $settings = self::getSettings();
        return $settings['environment'] === 'production' ? self::API_URL_PRODUCTION : self::API_URL_STAGING;
    }
}

// ===== AUTENTIFICARE KEEZ API =====
class KeezAuth {
    private $tokenUrl;
    private $clientId;
    private $clientSecret;
    private $cachedToken = null;
    private $tokenExpiry = null;

    public function __construct($tokenUrl, $clientId, $clientSecret) {
        $this->tokenUrl = $tokenUrl;
        $this->clientId = $clientId;
        $this->clientSecret = $clientSecret;
    }

    public function getToken() {
        // Verifică dacă token-ul este încă valid (cu 5 minute buffer)
        if ($this->cachedToken && $this->tokenExpiry && (time() + 300) < $this->tokenExpiry) {
            return $this->cachedToken;
        }

        try {
            $response = $this->requestToken();
            if ($response && isset($response['access_token'])) {
                $this->cachedToken = $response['access_token'];
                // Token-ul expiră în ~3600 secunde, setăm expiry
                $this->tokenExpiry = time() + 3500;
                return $this->cachedToken;
            }
        } catch (Exception $e) {
            logActivity("Keez API Auth Error: " . $e->getMessage());
        }

        return null;
    }

    private function requestToken() {
        $settings = KeezConfig::getSettings();

        $data = [
            'grant_type' => 'client_credentials',
            'client_id' => $this->clientId,
            'client_secret' => $this->clientSecret,
            'scope' => 'public-api'
        ];

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $this->tokenUrl);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($data));
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            "Content-Type: application/x-www-form-urlencoded"
        ]);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 90);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 30);
        curl_setopt($ch, CURLOPT_LOW_SPEED_LIMIT, 1);
        curl_setopt($ch, CURLOPT_LOW_SPEED_TIME, 30);
        curl_setopt($ch, CURLOPT_TCP_KEEPALIVE, 1);

        $response = curl_exec($ch);

        if (curl_errno($ch)) {
            $error = curl_error($ch);
            curl_close($ch);
            throw new Exception("cURL Error: " . $error);
        } else {
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        }
        curl_close($ch);

        if ($httpCode !== 200) {
            // Log detailed information for debugging - include full request data
            $requestData = http_build_query($data);
            logActivity("Keez Token Request Debug: URL=" . $this->tokenUrl . ", ClientID=" . $this->clientId . ", RequestData=" . $requestData . ", Response=" . $response);
            throw new Exception("HTTP Error: " . $httpCode . " - " . $response);
        }

        $result = json_decode($response, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            throw new Exception("Invalid JSON response: " . $response);
        }

        return $result;
    }
}

// ===== SERVICIU CREARE FACTURI KEEZ =====
class KeezInvoiceService {
    private $auth;
    private $apiUrl;
    private $clientEid;
    private $settings;

    public function __construct() {
        $this->settings = KeezConfig::getSettings();
        // Keez API requires client_id to be prefixed with 'app'
        $clientId = 'app' . $this->settings['application_id'];

        // Debug logging to verify the client_id construction
        logActivity("Keez Debug: ApplicationID=" . substr($this->settings['application_id'], 0, 10) . "..., ClientID=" . $clientId . ", HasSecret=" . (!empty($this->settings['secret']) ? 'YES' : 'NO') . ", Environment=" . $this->settings['environment']);

        $this->auth = new KeezAuth(
            KeezConfig::getTokenUrl(),
            $clientId,
            $this->settings['secret']
        );
        $this->apiUrl = KeezConfig::getApiUrl();
        $this->clientEid = $this->settings['client_eid'];
    }

    /**
     * Afișează factură din Keez după externalId
     */
    public function getInvoice($externalId) {
        try {
            $token = $this->auth->getToken();
            if (!$token) {
                throw new Exception("Unable to obtain Keez API token");
            }

            $url = $this->apiUrl . '/' . $this->clientEid . '/invoices/' . urlencode($externalId);

            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $url);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_HTTPHEADER, [
                "Content-Type: application/json",
                "Authorization: Bearer " . $token
            ]);
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
            curl_setopt($ch, CURLOPT_TIMEOUT, 90);
            curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 30);
            curl_setopt($ch, CURLOPT_LOW_SPEED_LIMIT, 1);
            curl_setopt($ch, CURLOPT_LOW_SPEED_TIME, 30);
            curl_setopt($ch, CURLOPT_TCP_KEEPALIVE, 1);

            $response = curl_exec($ch);

            if (curl_errno($ch)) {
                $error = curl_error($ch);
                curl_close($ch);
                throw new Exception("cURL Error: " . $error);
            } else {
                $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            }
            curl_close($ch);

            if ($httpCode === 404) {
                return null; // Invoice not found
            }

            if ($httpCode < 200 || $httpCode >= 300) {
                throw new Exception("Keez API Error [{$httpCode}]: " . $response);
            }

            $result = json_decode($response, true);
            if (json_last_error() !== JSON_ERROR_NONE) {
                throw new Exception("Invalid JSON response from Keez: " . $response);
            }

            return $result;

        } catch (Exception $e) {
            logActivity("Keez API Error getting invoice {$externalId}: " . $e->getMessage());
            return null;
        }
    }

    /**
     * Verifică dacă factură există în Keez
     */
    public function invoiceExistsInKeez($externalId) {
        $invoice = $this->getInvoice($externalId);
        return $invoice !== null;
    }

    /**
     * Verifică dacă articol există în Keez după cod
     */
    public function articleExistsInKeez($code) {
        $articles = $this->getArticles();
        foreach ($articles as $article) {
            if (isset($article['code']) && $article['code'] === $code) {
                return true;
            }
        }
        return false;
    }

    /**
     * Creează articol în Keez
     */
    public function createArticle($articleData) {
        try {
            $token = $this->auth->getToken();
            if (!$token) {
                throw new Exception("Unable to obtain Keez API token");
            }

            $url = $this->apiUrl . '/' . $this->clientEid . '/items';

            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $url);
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($articleData));
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_HTTPHEADER, [
                "Content-Type: application/json",
                "Authorization: Bearer " . $token
            ]);
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
            curl_setopt($ch, CURLOPT_TIMEOUT, 90);
            curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 30);
            curl_setopt($ch, CURLOPT_LOW_SPEED_LIMIT, 1);
            curl_setopt($ch, CURLOPT_LOW_SPEED_TIME, 30);
            curl_setopt($ch, CURLOPT_TCP_KEEPALIVE, 1);

            $response = curl_exec($ch);

            if (curl_errno($ch)) {
                $error = curl_error($ch);
                curl_close($ch);
                throw new Exception("cURL Error: " . $error);
            } else {
                $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            }
            curl_close($ch);

            if ($httpCode < 200 || $httpCode >= 300) {
                throw new Exception("Keez API Error [{$httpCode}]: " . $response);
            }

            logActivity("Keez: Article creation API response: {$response}");

            $result = json_decode($response, true);
            if (json_last_error() !== JSON_ERROR_NONE) {
                throw new Exception("Invalid JSON response from Keez: " . $response);
            }

            logActivity("Keez: Article creation parsed result: " . json_encode($result));
            return $result;

        } catch (Exception $e) {
            logActivity("Keez API Error creating article: " . $e->getMessage());
            return false;
        }
    }

    /**
     * Obține lista articolelor din Keez
     */
    public function getArticles() {
        try {
            $token = $this->auth->getToken();
            if (!$token) {
                throw new Exception("Unable to obtain Keez API token");
            }

            $url = $this->apiUrl . '/' . $this->clientEid . '/items';

            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $url);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_HTTPHEADER, [
                "Content-Type: application/json",
                "Authorization: Bearer " . $token
            ]);
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
            curl_setopt($ch, CURLOPT_TIMEOUT, 90);
            curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 30);
            curl_setopt($ch, CURLOPT_LOW_SPEED_LIMIT, 1);
            curl_setopt($ch, CURLOPT_LOW_SPEED_TIME, 30);
            curl_setopt($ch, CURLOPT_TCP_KEEPALIVE, 1);

            $response = curl_exec($ch);

            if (curl_errno($ch)) {
                $error = curl_error($ch);
                curl_close($ch);
                throw new Exception("cURL Error: " . $error);
            } else {
                $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            }
            curl_close($ch);

            if ($httpCode < 200 || $httpCode >= 300) {
                throw new Exception("Keez API Error [{$httpCode}]: " . $response);
            }

            $result = json_decode($response, true);
            if (json_last_error() !== JSON_ERROR_NONE) {
                throw new Exception("Invalid JSON response from Keez: " . $response);
            }

            return $result;

        } catch (Exception $e) {
            logActivity("Keez API Error getting articles: " . $e->getMessage());
            return [];
        }
    }

    /**
     * Asigură că articolul există în Keez, îl creează dacă nu există
     * Creează articole în ambele monede (EUR și RON) pentru compatibilitate
     */
    public function ensureArticleExists($code, $description, $settings, $vatRate = null, $currencyCode = null) {
        logActivity("Keez: Checking if article exists: {$code}");

        // Use provided currency or default from settings
        $targetCurrency = $currencyCode ?: $settings['default_currency'];
        
        // Check if article exists by code and currency
        $articles = $this->getArticles();
        logActivity("Keez: Retrieved " . count($articles) . " articles from Keez");

        $existingArticle = null;
        foreach ($articles as $article) {
            if (isset($article['code']) && $article['code'] === $code) {
                // Check if currency matches or if we need to create for this currency
                $articleCurrency = $article['currencyCode'] ?? $settings['default_currency'];
                if ($articleCurrency === $targetCurrency) {
                    $existingArticle = $article;
                    logActivity("Keez: Found existing article: {$code} with currency {$targetCurrency} and externalId: {$article['externalId']}");
                    break;
                }
            }
        }

        if ($existingArticle) {
            return $existingArticle['externalId']; // Return existing article's external ID
        }

        logActivity("Keez: Article {$code} with currency {$targetCurrency} not found, creating new one");

        // Use provided VAT rate or fallback to settings
        $articleVatRate = $vatRate !== null ? $vatRate : $settings['tva_fix'];
        logActivity("Keez: Creating article with VAT rate: {$articleVatRate}% (provided: " . ($vatRate !== null ? 'YES' : 'NO') . ")");

        // Create article data matching the Python example structure
        $articleData = [
            'code' => $code,
            'name' => substr($description, 0, 100), // Limit name length
            'currencyCode' => $targetCurrency,
            'measureUnitId' => 1, // Buc
            'vatRate' => $articleVatRate, // Use calculated VAT rate based on country
            'isActive' => true,
            'categoryExternalId' => 'MISCSRV' // Required category
        ];

        logActivity("Keez: Creating article with data: " . json_encode($articleData));

        $result = $this->createArticle($articleData);
        logActivity("Keez: Article creation result: " . json_encode($result));

        if ($result && isset($result['externalId'])) {
            logActivity("Keez article created successfully: {$code} - {$description} - currency: {$targetCurrency} - externalId: {$result['externalId']}");
            
            // Create article in the other currency as well (EUR and RON)
            $otherCurrencies = ['EUR', 'RON'];
            foreach ($otherCurrencies as $otherCurrency) {
                if ($otherCurrency !== $targetCurrency) {
                    // Check if article already exists in this currency
                    $existsInOtherCurrency = false;
                    foreach ($articles as $article) {
                        if (isset($article['code']) && $article['code'] === $code) {
                            $articleCurrency = $article['currencyCode'] ?? $settings['default_currency'];
                            if ($articleCurrency === $otherCurrency) {
                                $existsInOtherCurrency = true;
                                logActivity("Keez: Article {$code} already exists in currency {$otherCurrency}");
                                break;
                            }
                        }
                    }
                    
                    if (!$existsInOtherCurrency) {
                        logActivity("Keez: Creating article {$code} in additional currency: {$otherCurrency}");
                        $otherCurrencyArticleData = [
                            'code' => $code,
                            'name' => substr($description, 0, 100),
                            'currencyCode' => $otherCurrency,
                            'measureUnitId' => 1,
                            'vatRate' => $articleVatRate,
                            'isActive' => true,
                            'categoryExternalId' => 'MISCSRV'
                        ];
                        
                        $otherResult = $this->createArticle($otherCurrencyArticleData);
                        if ($otherResult && isset($otherResult['externalId'])) {
                            logActivity("Keez article created successfully in {$otherCurrency}: {$code} - externalId: {$otherResult['externalId']}");
                        } else {
                            logActivity("Keez: Failed to create article {$code} in currency {$otherCurrency}");
                        }
                    }
                }
            }
            
            return $result['externalId'];
        }

        logActivity("Keez: Failed to create article {$code}");
        return false;
    }


    /**
     * Salvează status-ul de sincronizare pentru o factură
     */
    public function saveSyncStatus($invoiceId, $status, $keezData = null) {
        try {
            // Use WHMCS notes field to store sync status
            $notes = "Keez Sync Status: {$status}";
            if ($keezData) {
                $notes .= " | Keez ID: {$keezData['externalId']} | Series: {$keezData['series']} | Number: {$keezData['number']}";
            }
            $notes .= " | Last Check: " . date('Y-m-d H:i:s');

            // Get current notes and append
            $currentNotes = Capsule::table('tblinvoices')
                ->where('id', $invoiceId)
                ->value('notes');

            // Remove any existing Keez sync status lines
            $lines = explode("\n", $currentNotes);
            $filteredLines = array_filter($lines, function($line) {
                return strpos($line, 'Keez Sync Status:') !== 0;
            });

            // Add new sync status
            $filteredLines[] = $notes;
            $newNotes = implode("\n", $filteredLines);

            Capsule::table('tblinvoices')
                ->where('id', $invoiceId)
                ->update(['notes' => $newNotes]);

            logActivity("Keez: Saved sync status for invoice {$invoiceId}: {$status}");

        } catch (Exception $e) {
            logActivity("Keez: Error saving sync status for invoice {$invoiceId}: " . $e->getMessage());
        }
    }

    /**
     * Obține status-ul de sincronizare pentru o factură
     */
    public function getSyncStatus($invoiceId) {
        try {
            $notes = Capsule::table('tblinvoices')
                ->where('id', $invoiceId)
                ->value('notes');

            if (!$notes) {
                logActivity("Keez: No notes found for invoice {$invoiceId}");
                return null;
            }

            logActivity("Keez: Checking notes for invoice {$invoiceId}: " . substr($notes, 0, 200) . "...");

            $lines = explode("\n", $notes);
            foreach ($lines as $line) {
                if (strpos($line, 'Keez Sync Status:') === 0) {
                    // Parse the status
                    $parts = explode(' | ', $line);
                    $statusPart = $parts[0];
                    $status = str_replace('Keez Sync Status: ', '', $statusPart);
                    logActivity("Keez: Found sync status for invoice {$invoiceId}: '{$status}'");
                    return $status;
                }
            }

            logActivity("Keez: No sync status found in notes for invoice {$invoiceId}");
            return null;

        } catch (Exception $e) {
            logActivity("Keez: Error getting sync status for invoice {$invoiceId}: " . $e->getMessage());
            return null;
        }
    }

    /**
     * Obține Transaction ID-ul pentru o factură din WHMCS
     */
    private function getActualPaymentMethod($invoiceId)
    {
        try {
            logActivity("Keez: Searching for actual payment method for invoice {$invoiceId}");
            
            // Metoda 1: tblaccounts (tabela principală pentru Transaction ID-uri în WHMCS!)
            if (Capsule::schema()->hasTable('tblaccounts')) {
                $account = Capsule::table('tblaccounts')
                    ->where('invoiceid', $invoiceId)
                    ->where('amountin', '>', 0)
                    ->orderBy('id', 'desc')
                    ->first();
                
                if ($account && !empty($account->gateway)) {
                    logActivity("Keez: Found payment method in tblaccounts for invoice {$invoiceId}: {$account->gateway}");
                    return $account->gateway;
                }
            }
            
            // Metoda 2: tbltransaction_history
            if (Capsule::schema()->hasTable('tbltransaction_history')) {
                $transaction = Capsule::table('tbltransaction_history')
                    ->where('invoice_id', $invoiceId)
                    ->orderBy('id', 'desc')
                    ->first();
                
                if ($transaction && !empty($transaction->gateway)) {
                    logActivity("Keez: Found payment method in tbltransaction_history for invoice {$invoiceId}: {$transaction->gateway}");
                    return $transaction->gateway;
                }
            }
            
            // Metoda 3: tblpayments (alternativă în unele versiuni WHMCS)
            if (Capsule::schema()->hasTable('tblpayments')) {
                $payment = Capsule::table('tblpayments')
                    ->where('invoiceid', $invoiceId)
                    ->where('amountin', '>', 0)
                    ->orderBy('id', 'desc')
                    ->first();
                
                if ($payment && !empty($payment->gateway)) {
                    logActivity("Keez: Found payment method in tblpayments for invoice {$invoiceId}: {$payment->gateway}");
                    return $payment->gateway;
                }
            }
            
            logActivity("Keez: No actual payment method found for invoice {$invoiceId}, will use invoice default");
            return null;
        } catch (Exception $e) {
            logActivity("Keez: Error getting actual payment method for invoice {$invoiceId}: " . $e->getMessage());
            return null;
        }
    }

    private function getTransactionIdForInvoice($invoiceId)
    {
        try {
            logActivity("Keez: Searching for transaction ID for invoice {$invoiceId}");
            
            // Debug: Lista tabelelor disponibile care conțin "transaction" sau "payment"
            $allTables = Capsule::select("SHOW TABLES");
            $transactionTables = [];
            foreach ($allTables as $table) {
                $tableName = array_values((array)$table)[0];
                if (strpos(strtolower($tableName), 'transaction') !== false || 
                    strpos(strtolower($tableName), 'payment') !== false) {
                    $transactionTables[] = $tableName;
                }
            }
            logActivity("Keez: Available transaction/payment tables: " . implode(', ', $transactionTables));
            
            // Metoda 1: tbltransactions (tabela standard WHMCS)
            if (Capsule::schema()->hasTable('tbltransactions')) {
                $transaction = Capsule::table('tbltransactions')
                    ->where('invoiceid', $invoiceId)
                    ->where('amountin', '>', 0)
                    ->orderBy('id', 'desc')
                    ->first();
                
                if ($transaction) {
                    logActivity("Keez: Found transaction record in tbltransactions for invoice {$invoiceId}: " . json_encode($transaction));
                    if (!empty($transaction->transid)) {
                        logActivity("Keez: Found transaction ID in tbltransactions for invoice {$invoiceId}: {$transaction->transid}");
                        return $transaction->transid;
                    }
            } else {
                    logActivity("Keez: No transaction records found in tbltransactions for invoice {$invoiceId}");
                }
            } else {
                logActivity("Keez: tbltransactions table does not exist");
            }
            
            // Metoda 2: tbltransaction_history (tabela care există în sistemul tău!)
            if (Capsule::schema()->hasTable('tbltransaction_history')) {
                // Debug: Verifică structura tabelei
                $columns = Capsule::select("DESCRIBE tbltransaction_history");
                $columnNames = array_map(function($col) { return $col->Field; }, $columns);
                logActivity("Keez: tbltransaction_history columns: " . implode(', ', $columnNames));
                
                // Folosește coloana corectă pentru invoice ID (din structura bazei de date)
                $invoiceColumn = 'invoice_id';
                if (in_array($invoiceColumn, $columnNames)) {
                    logActivity("Keez: Using invoice column in tbltransaction_history: {$invoiceColumn}");
                } else {
                    logActivity("Keez: Invoice column {$invoiceColumn} not found in tbltransaction_history");
                    $invoiceColumn = null;
                }
                
                if ($invoiceColumn) {
                    $transaction = Capsule::table('tbltransaction_history')
                        ->where($invoiceColumn, $invoiceId)
                        ->orderBy('id', 'desc')
                        ->first();
                    
                    if ($transaction) {
                        logActivity("Keez: Found transaction record in tbltransaction_history for invoice {$invoiceId}: " . json_encode($transaction));
                        
                        // Folosește coloana corectă pentru transaction ID (din structura bazei de date)
                        $transIdColumn = 'transaction_id';
                        if (isset($transaction->$transIdColumn) && !empty($transaction->$transIdColumn)) {
                            logActivity("Keez: Found transaction ID in tbltransaction_history for invoice {$invoiceId}: {$transaction->$transIdColumn} (column: {$transIdColumn})");
                            return $transaction->$transIdColumn;
                        } else {
                            logActivity("Keez: Transaction ID column {$transIdColumn} is empty for invoice {$invoiceId}");
                        }
                    } else {
                        logActivity("Keez: No transaction records found in tbltransaction_history for invoice {$invoiceId}");
                    }
                } else {
                    logActivity("Keez: No suitable invoice column found in tbltransaction_history");
                }
            } else {
                logActivity("Keez: tbltransaction_history table does not exist");
            }
            
            // Metoda 3: tblaccounts (tabela principală pentru Transaction ID-uri în WHMCS!)
            if (Capsule::schema()->hasTable('tblaccounts')) {
                $account = Capsule::table('tblaccounts')
                    ->where('invoiceid', $invoiceId)
                    ->where('amountin', '>', 0)
                    ->orderBy('id', 'desc')
                    ->first();
                
                if ($account) {
                    logActivity("Keez: Found account record in tblaccounts for invoice {$invoiceId}: " . json_encode($account));
                    if (!empty($account->transid)) {
                        logActivity("Keez: Found transaction ID in tblaccounts for invoice {$invoiceId}: {$account->transid}");
                        return $account->transid;
                    }
                } else {
                    logActivity("Keez: No account records found in tblaccounts for invoice {$invoiceId}");
                }
            } else {
                logActivity("Keez: tblaccounts table does not exist");
            }
            
            // Metoda 4: tblpayments (alternativă în unele versiuni WHMCS)
            if (Capsule::schema()->hasTable('tblpayments')) {
                $payment = Capsule::table('tblpayments')
                    ->where('invoiceid', $invoiceId)
                    ->where('amountin', '>', 0)
                    ->orderBy('id', 'desc')
                    ->first();
                
                if ($payment) {
                    logActivity("Keez: Found payment record in tblpayments for invoice {$invoiceId}: " . json_encode($payment));
                    if (!empty($payment->transid)) {
                        logActivity("Keez: Found transaction ID in tblpayments for invoice {$invoiceId}: {$payment->transid}");
                        return $payment->transid;
                    }
                } else {
                    logActivity("Keez: No payment records found in tblpayments for invoice {$invoiceId}");
                }
            } else {
                logActivity("Keez: tblpayments table does not exist");
            }
            
            // Metoda 5: Caută în notes-urile facturii pentru Transaction ID
            $invoice = Capsule::table('tblinvoices')->where('id', $invoiceId)->first();
            if ($invoice && !empty($invoice->notes)) {
                logActivity("Keez: Invoice notes for {$invoiceId}: " . substr($invoice->notes, 0, 200));
                // Caută pattern-uri comune pentru Transaction ID
                if (preg_match('/Transaction[:\s]+([A-Z0-9]+)/i', $invoice->notes, $matches)) {
                    $transId = trim($matches[1]);
                    logActivity("Keez: Found transaction ID in invoice notes for invoice {$invoiceId}: {$transId}");
                    return $transId;
                }
            }
            
            // Metoda 6: Generează un Transaction ID alternativ bazat pe invoice ID și timestamp
            $fallbackTransactionId = 'WHMCS-' . $invoiceId . '-' . date('YmdHis');
            logActivity("Keez: No real transaction ID found for invoice {$invoiceId}, using fallback: {$fallbackTransactionId}");
            return $fallbackTransactionId;
        } catch (Exception $e) {
            logActivity("Keez: Error getting transaction ID for invoice {$invoiceId}: " . $e->getMessage());
            return '';
        }
    }

    /**
     * Caută factură după serie și număr folosind filtrarea API-ului Keez
     * Încearcă mai multe metode de căutare pentru compatibilitate maximă
     */
    public function findInvoiceBySeriesAndNumber($series, $number) {
        try {
            logActivity("Keez: Searching for invoice - Series: {$series}, Number: {$number}");

            // Metoda 1: Căutare exactă după serie și număr
            $filters = [
                'series[eq]' => $series,
                'number[eq]' => $number
            ];

            $invoices = $this->listInvoices($filters);

            if ($invoices && is_array($invoices) && !empty($invoices)) {
                logActivity("Keez: Found invoice by series/number: " . json_encode($invoices[0]));
                return $invoices[0];
            } else {
                logActivity("Keez: No invoices found with filters: " . json_encode($filters));
            }

            // Metoda 2: Căutare după externalId (numărul complet WHMCS)
            $fullInvoiceNumber = $series . $number;
            logActivity("Keez: Trying search by externalId: {$fullInvoiceNumber}");

            // Get all invoices and search manually for externalId
            $allInvoices = $this->listInvoices();
            if ($allInvoices && is_array($allInvoices)) {
                foreach ($allInvoices as $invoice) {
                    if (isset($invoice['externalId']) && $invoice['externalId'] === $fullInvoiceNumber) {
                        logActivity("Keez: Found invoice by externalId: " . json_encode($invoice));
                        return $invoice;
                    }
                }
            }

            // Metoda 3: Căutare fuzzy - încearcă să găsească facturi cu numere similare
            logActivity("Keez: No exact match found, trying fuzzy search");
            if ($allInvoices && is_array($allInvoices)) {
                foreach ($allInvoices as $invoice) {
                    $keezSeries = $invoice['series'] ?? '';
                    $keezNumber = $invoice['number'] ?? '';

                    // Verifică dacă seria și numărul se potrivesc (cu sau fără leading zeros)
                    if ($keezSeries === $series && (intval($keezNumber) == intval($number))) {
                        logActivity("Keez: Found invoice by fuzzy match: " . json_encode($invoice));
                        return $invoice;
                    }
                }
            }

            logActivity("Keez: Invoice not found - Series: {$series}, Number: {$number}");
            return null;

        } catch (Exception $e) {
            logActivity("Keez API Error finding invoice by series/number: " . $e->getMessage());
            return null;
        }
    }

    /**
     * Obține lista facturilor din Keez (opțional cu filtre)
     */
    public function listInvoices($filters = []) {
        try {
            $token = $this->auth->getToken();
            if (!$token) {
                throw new Exception("Unable to obtain Keez API token");
            }

            $url = $this->apiUrl . '/' . $this->clientEid . '/invoices';

            // Adaugă parametri de query dacă există filtre
            if (!empty($filters)) {
                $queryParams = [];
                foreach ($filters as $key => $value) {
                    $queryParams[] = urlencode($key) . '=' . urlencode($value);
                }
                $url .= '?' . implode('&', $queryParams);
            }

            logActivity("Keez: Requesting invoices with URL: {$url}");

            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $url);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_HTTPHEADER, [
                "Content-Type: application/json",
                "Authorization: Bearer " . $token
            ]);
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
            curl_setopt($ch, CURLOPT_TIMEOUT, 90);
            curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 30);
            curl_setopt($ch, CURLOPT_LOW_SPEED_LIMIT, 1);
            curl_setopt($ch, CURLOPT_LOW_SPEED_TIME, 30);
            curl_setopt($ch, CURLOPT_TCP_KEEPALIVE, 1);

            $response = curl_exec($ch);

            if (curl_errno($ch)) {
                $error = curl_error($ch);
                curl_close($ch);
                throw new Exception("cURL Error: " . $error);
            } else {
                $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            }
            curl_close($ch);

            if ($httpCode < 200 || $httpCode >= 300) {
                throw new Exception("Keez API Error [{$httpCode}]: " . $response);
            }

            $result = json_decode($response, true);
            if (json_last_error() !== JSON_ERROR_NONE) {
                throw new Exception("Invalid JSON response from Keez: " . $response);
            }

            logActivity("Keez: Retrieved " . count($result) . " invoices from API");
            return $result['data'];

        } catch (Exception $e) {
            logActivity("Keez API Error listing invoices: " . $e->getMessage());
            return null;
        }
    }

    /**
     * Obține următorul număr de factură din Keez pentru sincronizare
     */
    public function getNextInvoiceNumberFromKeez() {
        try {
            $settings = KeezConfig::getSettings();
            $series = $settings['factura_serie'];
            
            // Obține toate facturile din Keez cu seria noastră
            $invoices = $this->listInvoices();
            
            if (!$invoices || !is_array($invoices)) {
                logActivity("Keez: No invoices found in Keez, starting from 1");
                return 1;
            }
            
            $maxNumber = 0;
            foreach ($invoices as $invoice) {
                if (isset($invoice['series']) && $invoice['series'] === $series) {
                    $number = intval($invoice['number']);
                    if ($number > $maxNumber) {
                        $maxNumber = $number;
                    }
                }
            }
            
            $nextNumber = $maxNumber + 1;
            logActivity("Keez: Next invoice number should be: {$series}{$nextNumber} (max found: {$maxNumber})");
            
            return $nextNumber;
            
        } catch (Exception $e) {
            logActivity("Keez: Error getting next invoice number: " . $e->getMessage());
            return null;
        }
    }

    /**
     * Sincronizează numărul de factură WHMCS cu următorul număr disponibil din Keez
     */
    public function syncInvoiceNumberWithKeez($invoiceId, $currentInvoiceNumber) {
        try {
            $nextKeezNumber = $this->getNextInvoiceNumberFromKeez();
            if (!$nextKeezNumber) {
                logActivity("Keez: Could not determine next invoice number from Keez");
                return;
            }

            $settings = KeezConfig::getSettings();
            $series = $settings['factura_serie'];
            $expectedNumber = $series . $nextKeezNumber;

            // Verifică dacă numărul actual din WHMCS este diferit de cel așteptat din Keez
            if ($currentInvoiceNumber !== $expectedNumber) {
                logActivity("Keez: Invoice number mismatch - WHMCS: {$currentInvoiceNumber}, Expected from Keez: {$expectedNumber}");
                
                // Actualizează numărul facturii în WHMCS
                Capsule::table('tblinvoices')
                    ->where('id', $invoiceId)
                    ->update(['invoicenum' => $expectedNumber]);
                
                logActivity("Keez: Updated WHMCS invoice number from {$currentInvoiceNumber} to {$expectedNumber}");
                
                // Actualizează și invoiceData pentru a folosi numărul corect
                $this->lastSyncedInvoiceNumber = $expectedNumber;
            } else {
                logActivity("Keez: Invoice number is already synchronized: {$currentInvoiceNumber}");
            }

        } catch (Exception $e) {
            logActivity("Keez: Error syncing invoice number for invoice {$invoiceId}: " . $e->getMessage());
        }
    }

    /**
     * Generează numărul de factură pentru WHMCS bazat pe ultima factură din Keez
     */
    public function generateInvoiceNumberForWHMCS() {
        try {
            $nextKeezNumber = $this->getNextInvoiceNumberFromKeez();
            if (!$nextKeezNumber) {
                logActivity("Keez: Could not determine next invoice number from Keez for WHMCS generation");
                return null;
            }

            $settings = KeezConfig::getSettings();
            $series = $settings['factura_serie'];
            $generatedNumber = $series . $nextKeezNumber;
            
            logActivity("Keez: Generated invoice number for WHMCS: {$generatedNumber} (based on Keez max: " . ($nextKeezNumber - 1) . ")");
            
            return $generatedNumber;

        } catch (Exception $e) {
            logActivity("Keez: Error generating invoice number for WHMCS: " . $e->getMessage());
            return null;
        }
    }

    /**
     * Creează factură în Keez pe baza datelor din WHMCS
     */
    public function createInvoice($invoiceId) {
        try {
            // Verifică dacă integrarea este activată
            if (!$this->settings['enabled']) {
                logActivity("Keez integration disabled, skipping invoice creation for invoice ID: " . $invoiceId);
                return true;
            }

            // Obține datele facturii din WHMCS
            $invoiceData = $this->getInvoiceData($invoiceId);
            if (!$invoiceData) {
                throw new Exception("Invoice data not found for ID: " . $invoiceId);
            }

            // Verifică dacă factură fiscală (nu proformă)
            if (empty($invoiceData['invoicenum'])) {
                logActivity("Skipping Keez creation for proforma invoice ID: " . $invoiceId);
                return true;
            }

            // Verifică dacă factura este plătită înainte de sincronizare
            if ($invoiceData['status'] !== 'Paid') {
                logActivity("Skipping Keez creation for unpaid invoice ID: " . $invoiceId . " (Status: " . $invoiceData['status'] . ")");
                throw new Exception("Factura trebuie să fie plătită înainte de sincronizare cu Keez. Status actual: " . $invoiceData['status']);
            }

            // Verifică dacă factură deja există în Keez
            if ($this->invoiceExistsInKeez($invoiceData['invoicenum'])) {
                logActivity("Invoice already exists in Keez: " . $invoiceData['invoicenum']);
                return true;
            }

            // Generează numărul facturii bazat pe ultima factură din Keez
            $generatedNumber = $this->generateInvoiceNumberForWHMCS();
            logActivity("Keez: Generated number: {$generatedNumber}, Current WHMCS: {$invoiceData['invoicenum']}");
            
            if ($generatedNumber && $generatedNumber !== $invoiceData['invoicenum']) {
                logActivity("Keez: Updating WHMCS invoice number from {$invoiceData['invoicenum']} to {$generatedNumber}");
                
                // Actualizează numărul în WHMCS
                $updateResult = Capsule::table('tblinvoices')
                    ->where('id', $invoiceId)
                    ->update(['invoicenum' => $generatedNumber]);
                
                logActivity("Keez: Update result: " . ($updateResult ? 'SUCCESS' : 'FAILED'));
                
                // Actualizează invoiceData cu numărul generat
                $invoiceData['invoicenum'] = $generatedNumber;
                $this->lastSyncedInvoiceNumber = $generatedNumber;
                
                // Re-verifică după actualizare
                $verifyNumber = Capsule::table('tblinvoices')->where('id', $invoiceId)->value('invoicenum');
                logActivity("Keez: Verification - WHMCS now has: {$verifyNumber}");
            } else {
                logActivity("Keez: No number update needed - already synchronized");
            }

            // Asigură că toate articolele există în Keez înainte de creare factură
            // Determină moneda facturii pentru a crea articolele în moneda corectă
            $invoiceCurrencyCode = $this->getCurrencyCode($invoiceData['currency']);
            logActivity("Keez: Invoice currency detected: {$invoiceCurrencyCode}");
            
            $articleCodes = [];
            foreach ($invoiceData['items'] as $item) {
                $code = 'WHMCS_' . ($item['relid'] ?: $item['id']); // Generate code like WHMCS_123
                $description = $item['description'];
                logActivity("Keez: Ensuring article exists: {$code} - {$description} - currency: {$invoiceCurrencyCode}");

                // Creează articolul în moneda facturii (va crea automat și în cealaltă monedă dacă nu există)
                $articleExternalId = $this->ensureArticleExists($code, $description, $this->settings, $vatRate, $invoiceCurrencyCode);
                if ($articleExternalId) {
                    $articleCodes[$item['id']] = $articleExternalId;
                    logActivity("Keez: Article ensured, externalId: {$articleExternalId} for code: {$code} in currency: {$invoiceCurrencyCode}");
                } else {
                    logActivity("Keez: Failed to ensure article exists: {$code} - {$description}");
                    // Don't continue if article creation failed - this will cause invoice creation to fail
                    throw new Exception("Failed to create/find article: {$code}");
                }
            }

            // Mapează datele pentru API-ul Keez
            $keezData = $this->mapToKeezFormat($invoiceData, $articleCodes);

            // Calculate totals from invoice details for verification
            $calculatedNetTotal = 0;
            $calculatedVatTotal = 0;
            $calculatedGrossTotal = 0;
            foreach ($keezData['invoiceDetails'] as $detail) {
                $calculatedNetTotal += $detail['netAmount'];
                $calculatedVatTotal += $detail['vatAmount'];
                $calculatedGrossTotal += $detail['grossAmount'];
            }

            // Log totals comparison
            logActivity("Keez: Totals comparison - WHMCS: Net={$keezData['netAmount']}, VAT={$keezData['vatAmount']}, Gross={$keezData['grossAmount']} | Calculated: Net=$calculatedNetTotal, VAT=$calculatedVatTotal, Gross=$calculatedGrossTotal");

            // Log final invoice structure before sending
            logActivity("Keez: Final invoice data being sent to Keez: " . json_encode($keezData));

            // Trimite la Keez API
            $result = $this->sendToKeez($keezData);

            // Log succes
            logActivity("Keez invoice created successfully: " . $invoiceData['invoicenum'] . " (ID: " . $result['id'] . ")");


            return $result;

        } catch (Exception $e) {
            $errorMessage = $e->getMessage();
            logActivity("Keez API Error for invoice " . $invoiceId . ": " . $errorMessage);

            // Verifică dacă eroarea este că numărul de factură există deja
            if (strpos($errorMessage, 'Numarul de factura a mai fost folosit') !== false ||
                strpos($errorMessage, 'ERROR_MANAGED_IN_KEEZ_SERIAL_NO_EXIST') !== false) {

                // Factură există deja în Keez - verifică dacă putem obține datele
                if ($this->invoiceExistsInKeez($invoiceData['invoicenum'])) {
                    logActivity("Invoice already exists in Keez and is synchronized: " . $invoiceData['invoicenum']);


                    return true; // Considerăm că operația a reușit
                }
            }

            // Pentru alte erori, nu aruncăm excepția mai departe pentru a nu bloca crearea facturii în WHMCS
            return false;
        }
    }

    private function getInvoiceData($invoiceId) {
        try {
        $invoice = Capsule::table('tblinvoices as i')
            ->join('tblclients as c', 'c.id', '=', 'i.userid')
            ->leftJoin('tblinvoiceitems as it', 'it.invoiceid', '=', 'i.id')
            ->where('i.id', $invoiceId)
        ->select([
            'i.id', 'i.invoicenum', 'i.date', 'i.duedate', 'i.total', 'i.subtotal', 'i.tax', 'i.status',
            'i.paymentmethod', 'i.notes',
            'c.companyname', 'c.firstname', 'c.lastname', 'c.tax_id', 'c.country', 'c.state',
            'c.city', 'c.address1', 'c.address2', 'c.email', 'c.currency',
            'it.id as item_id', 'it.description', 'it.amount', 'it.relid'
        ])
            ->get();

        if ($invoice->isEmpty()) {
            return null;
        }

        $invoiceData = $invoice->first();

            // Get Stripe transaction ID for the invoice (optional, with error handling)
            $stripeTransactionId = null;
            try {
                $stripeTransaction = Capsule::table('tbltransactions')
                    ->where('invoiceid', $invoiceId)
                    ->where('gateway', 'stripe')
                    ->where('amountin', '>', 0)
                    ->orderBy('id', 'desc')
                    ->first();

                $stripeTransactionId = $stripeTransaction ? $stripeTransaction->transid : null;

                if ($stripeTransactionId) {
                    logActivity("Keez: Found Stripe transaction ID: " . $stripeTransactionId . " for invoice " . $invoiceId);
                }
            } catch (Exception $e) {
                logActivity("Keez: Could not retrieve Stripe transaction ID for invoice " . $invoiceId . " - " . $e->getMessage());
                // Continue without transaction ID - don't fail the invoice creation
            }

            $invoiceData->items = $invoice->map(function($item) use ($stripeTransactionId) {
                $description = $item->description;

                // Add Stripe transaction ID to item description if available
                if ($stripeTransactionId) {
                    $description .= "\nStripe Transaction ID: " . $stripeTransactionId;
                }

            return [
                'id' => $item->item_id,
                    'description' => $description,
                'amount' => $item->amount,
                'relid' => $item->relid,
                    'qty' => 1,  // Fixed quantity for this WHMCS version
                    'stripe_transaction_id' => $stripeTransactionId
            ];
        })->toArray();

            $invoiceData->stripe_transaction_id = $stripeTransactionId;

        return (array)$invoiceData;

        } catch (Exception $e) {
            logActivity("Keez: Error in getInvoiceData for invoice " . $invoiceId . ": " . $e->getMessage());
            throw $e; // Re-throw to maintain original error handling
        }
    }


    private function mapToKeezFormat($invoice, $articleCodes = []) {
        logActivity("Keez: mapToKeezFormat called - FORCE UPDATE CHECK - TIMESTAMP: " . date('Y-m-d H:i:s'));
        $settings = $this->settings;

        // Determină tip client (PJ/PF)
        $isPJ = !empty($invoice['tax_id']) || !empty($invoice['companyname']);
        $partnerName = $isPJ ? trim($invoice['companyname']) : trim($invoice['firstname'] . ' ' . $invoice['lastname']);
        $identificationNumber = trim($invoice['tax_id'] ?? '');

        // Adresa completă
        $address = trim($invoice['address1'] . (!empty($invoice['address2']) ? ' ' . $invoice['address2'] : ''));

        // Moneda și curs
        $currencyCode = $this->getCurrencyCode($invoice['currency']);
        
        // Determine if invoice currency is RON or other (EUR, USD, etc.)
        $isRON = ($currencyCode === 'RON');
        
        // Get exchange rate from WHMCS currency configuration
        $exchangeRate = 1; // Default for base currency
        try {
            $currency = Capsule::table('tblcurrencies')
                ->where('id', $invoice['currency'])
                ->first();
            
            if ($currency && isset($currency->rate)) {
                $exchangeRate = (float)$currency->rate;
                logActivity("Keez: Found exchange rate in WHMCS - Currency: {$currencyCode}, Rate: {$exchangeRate}");
            } else {
                // Fallback to manual rates
                $exchangeRate = $isRON ? 1 : 4.82;
                logActivity("Keez: Using fallback exchange rate - Currency: {$currencyCode}, Rate: {$exchangeRate}");
            }
        } catch (Exception $e) {
            // Fallback to manual rates
            $exchangeRate = $isRON ? 1 : 4.82;
            logActivity("Keez: Error getting exchange rate, using fallback - Currency: {$currencyCode}, Rate: {$exchangeRate}, Error: " . $e->getMessage());
        }
        
        logActivity("Keez: Currency detection - Invoice currency ID: {$invoice['currency']}, Currency code: {$currencyCode}, Is RON: " . ($isRON ? 'YES' : 'NO') . ", Exchange rate: {$exchangeRate}");

        // Determină dacă se aplică TVA (doar pentru țările UE, EXCEPT Cyprus for digital services)
        $countryCode = strtoupper($invoice['country'] ?? 'RO');
        $euCountries = ['RO'];
        $vatExemptCountries = ['CY', 'BG', 'HR', 'CZ', 'HU', 'PL', 'SK', 'SI', 'LT', 'LV', 'EE', 'DE', 'FR', 'IT', 'ES', 'PT', 'AT', 'BE', 'NL', 'LU', 'DK', 'SE', 'FI', 'IE', 'MT', 'GR']; // Cyprus is exempt from Romanian VAT for digital services
        
        $shouldApplyVAT = in_array($countryCode, $euCountries) && !in_array($countryCode, $vatExemptCountries);
        $vatRate = $shouldApplyVAT ? (float)$settings['tva_fix'] : 0;
        
        logActivity("Keez: VAT calculation - Country: {$countryCode}, Should apply VAT: " . ($shouldApplyVAT ? 'YES' : 'NO') . ", VAT Rate: {$vatRate}% - TIMESTAMP: " . date('Y-m-d H:i:s'));

        // Calculează totaluri - pentru țări non-UE, recalculează fără TVA
        // Note: Amounts from WHMCS are in invoice currency (EUR if invoice is EUR, RON if invoice is RON)
        if (!$shouldApplyVAT) {
            // Pentru țări non-UE, totalul din WHMCS este deja fără TVA
            $netAmountCurrency = (float)$invoice['total'];  // Totalul este netul (în moneda facturii)
            $vatAmountCurrency = 0;                         // Fără TVA
            $grossAmountCurrency = (float)$invoice['total']; // Totalul este și brutul (în moneda facturii)
            
            // Convert to RON if invoice is not in RON
            if ($isRON) {
                $netAmount = $netAmountCurrency;
                $vatAmount = $vatAmountCurrency;
                $grossAmount = $grossAmountCurrency;
            } else {
                $netAmount = round($netAmountCurrency * $exchangeRate, 2);
                $vatAmount = round($vatAmountCurrency * $exchangeRate, 2);
                $grossAmount = round($grossAmountCurrency * $exchangeRate, 2);
            }
            
            logActivity("Keez: Non-EU country - Currency: {$currencyCode}, Net Currency: {$netAmountCurrency}, Net RON: {$netAmount}, VAT: {$vatAmount}, Gross: {$grossAmount}");
        } else {
            // Pentru țările UE, folosește valorile normale din WHMCS
            $netAmountCurrency = (float)$invoice['subtotal']; // În moneda facturii
            $vatAmountCurrency = (float)$invoice['tax'];      // În moneda facturii
            $grossAmountCurrency = (float)$invoice['total'];  // În moneda facturii
            
            // Convert to RON if invoice is not in RON
            if ($isRON) {
                $netAmount = $netAmountCurrency;
                $vatAmount = $vatAmountCurrency;
                $grossAmount = $grossAmountCurrency;
            } else {
                $netAmount = round($netAmountCurrency * $exchangeRate, 2);
                $vatAmount = round($vatAmountCurrency * $exchangeRate, 2);
                $grossAmount = round($grossAmountCurrency * $exchangeRate, 2);
            }
            
            logActivity("Keez: EU country - Currency: {$currencyCode}, Subtotal Currency: {$netAmountCurrency}, Subtotal RON: {$netAmount}, Tax Currency: {$vatAmountCurrency}, Tax RON: {$vatAmount}, Total Currency: {$grossAmountCurrency}, Total RON: {$grossAmount}");
        }

        // Obține metoda de plată din transaction în loc de invoice
        $actualPaymentMethod = $this->getActualPaymentMethod($invoice['id']);
        logActivity("Keez: Payment method detection - Invoice method: '{$invoice['paymentmethod']}', Actual transaction method: '{$actualPaymentMethod}'");
        
        // Payment type mapping - doar 2 metode de plată
        $paymentTypeMap = [
            'banktransfer' => 3, // Bank - Transfer bancar
            'bancar' => 3, // Bank - Transfer bancar
            'stripe' => 6, // ProcesatorPlati - Procesator plăți (PayU, Netopia, euplatesc)
            'card' => 6, // ProcesatorPlati - Procesator plăți
            'paypal' => 6, // ProcesatorPlati - Procesator plăți
            'cash' => 6, // ProcesatorPlati - Procesator plăți
            'cod' => 6, // ProcesatorPlati - Procesator plăți
        ];
        $paymentTypeId = $paymentTypeMap[strtolower($actualPaymentMethod ?? '')] ?? 1;
        logActivity("Keez: Payment method mapping - Actual method: '{$actualPaymentMethod}' -> Keez paymentTypeId: {$paymentTypeId}");

        // Format date (YYYYMMDD)
        $documentDate = date('Ymd', strtotime($invoice['date']));
        $dueDate = date('Ymd', strtotime($invoice['duedate']));

        // Ensure due date is not before document date (Keez validation requirement)
        $documentTimestamp = strtotime($invoice['date']);
        $dueTimestamp = strtotime($invoice['duedate']);

        if ($dueTimestamp <= $documentTimestamp) {
            // If due date is same or before document date, set it to document date + 30 days
            $dueTimestamp = strtotime('+30 days', $documentTimestamp);
            $dueDate = date('Ymd', $dueTimestamp);
            logActivity("Keez: Adjusted due date for invoice {$invoice['invoicenum']} - original due date was before or equal to document date");
        }

        // Număr factură - extrage doar numărul, fără serie
        $invoiceNumber = $invoice['invoicenum'];

        // Extrage doar partea numerică din numărul facturii
        // De exemplu: "OSTH53" -> "53", "INV00123" -> "00123"
        if (preg_match('/(\d+)$/', $invoiceNumber, $matches)) {
            $invoiceNumber = $matches[1];
        } else {
            // Dacă nu găsește numere la sfârșit, păstrează numărul complet
            logActivity("Keez: Could not extract numeric part from invoice number: {$invoice['invoicenum']}");
        }

        // Obține Transaction ID-ul pentru notă de articol
        $transactionId = $this->getTransactionIdForInvoice($invoice['id']);
        $articleNote = '';
        if (!empty($transactionId)) {
            $articleNote = "Transaction ID: {$transactionId}";
            logActivity("Keez: Adding transaction ID as article note: {$transactionId}");
        } else {
            logActivity("Keez: No transaction ID found for invoice {$invoice['id']}, article note will be empty");
        }

        // Pregătește articolele
        $invoiceDetails = [];
        foreach ($invoice['items'] as $item) {
            // Amounts from WHMCS are in invoice currency (EUR if invoice is EUR, RON if invoice is RON)
            $itemNetAmountCurrency = (float)$item['amount'];
            $itemVatRate = $vatRate;  // Use calculated VAT rate based on country
            $itemVatAmountCurrency = round($itemNetAmountCurrency * $itemVatRate / 100, 2);
            $itemGrossAmountCurrency = $itemNetAmountCurrency + $itemVatAmountCurrency;
            $quantity = (int)$item['qty'];  // Fixed quantity of 1
            
            // Calculate unit price in invoice currency
            $unitPriceCurrency = round($itemNetAmountCurrency / $quantity, 2);

            // Calculate amounts in RON (base currency)
            // If invoice is in RON, amounts are already in RON
            // If invoice is in EUR (or other), convert to RON using exchange rate
            if ($isRON) {
                // Invoice is in RON - amounts are already in RON
                $itemNetAmountRON = $itemNetAmountCurrency;
                $itemVatAmountRON = $itemVatAmountCurrency;
                $itemGrossAmountRON = $itemGrossAmountCurrency;
                $unitPriceRON = $unitPriceCurrency;
                
                // For RON invoices, currency fields can be same as RON or undefined
                $originalNetAmountCurrency = $itemNetAmountCurrency;
                $originalVatAmountCurrency = $itemVatAmountCurrency;
                $originalGrossAmountCurrency = $itemGrossAmountCurrency;
                $netAmountCurrency = $itemNetAmountCurrency;
                $vatAmountCurrency = $itemVatAmountCurrency;
                $grossAmountCurrency = $itemGrossAmountCurrency;
                $unitPriceCurrencyField = $unitPriceCurrency;
            } else {
                // Invoice is in EUR (or other currency) - convert to RON
                // Exchange rate: 1 EUR = exchangeRate RON
                // So: RON = EUR * exchangeRate
                $itemNetAmountRON = round($itemNetAmountCurrency * $exchangeRate, 2);
                $itemVatAmountRON = round($itemVatAmountCurrency * $exchangeRate, 2);
                $itemGrossAmountRON = round($itemGrossAmountCurrency * $exchangeRate, 2);
                $unitPriceRON = round($unitPriceCurrency * $exchangeRate, 4); // 4 decimals for unit price
                
                // Currency amounts are the original EUR amounts
                $originalNetAmountCurrency = $itemNetAmountCurrency;
                $originalVatAmountCurrency = $itemVatAmountCurrency;
                $originalGrossAmountCurrency = $itemGrossAmountCurrency;
                $netAmountCurrency = $itemNetAmountCurrency;
                $vatAmountCurrency = $itemVatAmountCurrency;
                $grossAmountCurrency = $itemGrossAmountCurrency;
                $unitPriceCurrencyField = $unitPriceCurrency;
            }

            logActivity("Keez: Article calculation - Currency: {$currencyCode}, Exchange Rate: {$exchangeRate}");
            logActivity("Keez: Article - Net RON: {$itemNetAmountRON}, Net Currency: {$itemNetAmountCurrency}, VAT Rate: {$itemVatRate}%");

            // Use the article external ID from the created articles
            $itemExternalId = isset($articleCodes[$item['id']]) ? $articleCodes[$item['id']] : strval($item['relid'] ?: $item['id']);

            $invoiceDetails[] = [
                'itemExternalId' => $itemExternalId,
                'measureUnitId' => 1, // Buc
                'quantity' => $quantity,
                'unitPrice' => round($unitPriceRON, 4), // RON amount, 4 decimals
                'unitPriceCurrency' => $isRON ? null : round($unitPriceCurrencyField, 4), // Currency amount, 4 decimals (only if not RON)
                'vatPercent' => $itemVatRate,
                'originalNetAmount' => round($itemNetAmountRON, 2), // RON amount
                'originalNetAmountCurrency' => $isRON ? round($originalNetAmountCurrency, 2) : round($originalNetAmountCurrency, 2), // Currency amount
                'originalVatAmount' => round($itemVatAmountRON, 2), // RON amount
                'originalVatAmountCurrency' => $isRON ? round($originalVatAmountCurrency, 2) : round($originalVatAmountCurrency, 2), // Currency amount
                'netAmount' => round($itemNetAmountRON, 2), // RON amount
                'netAmountCurrency' => $isRON ? round($netAmountCurrency, 2) : round($netAmountCurrency, 2), // Currency amount
                'vatAmount' => round($itemVatAmountRON, 2), // RON amount
                'vatAmountCurrency' => $isRON ? round($vatAmountCurrency, 2) : round($vatAmountCurrency, 2), // Currency amount
                'grossAmount' => round($itemGrossAmountRON, 2), // RON amount
                'grossAmountCurrency' => $isRON ? round($grossAmountCurrency, 2) : round($grossAmountCurrency, 2), // Currency amount
                'itemDescription' => $articleNote,
            ];
        }

        // Dacă nu există articole, creează unul generic
        if (empty($invoiceDetails)) {
            $quantity = 1;
            $fallbackVatRate = $vatRate; // Use the calculated VAT rate based on country
            
            // The totals ($netAmount, $vatAmount, $grossAmount) are already calculated correctly above
            // They are in RON if invoice is RON, or converted to RON if invoice is EUR
            // But we need to also track the original currency amounts
            
            if ($isRON) {
                // Invoice is in RON - amounts are already in RON
                $fallbackNetAmountRON = $netAmount;
                $fallbackVatAmountRON = $vatAmount;
                $fallbackGrossAmountRON = $grossAmount;
                $fallbackUnitPriceRON = round($netAmount / $quantity, 2);
                
                // For RON invoices, currency fields are same as RON
                $fallbackNetAmountCurrency = $netAmount;
                $fallbackVatAmountCurrency = $vatAmount;
                $fallbackGrossAmountCurrency = $grossAmount;
                $fallbackUnitPriceCurrency = $fallbackUnitPriceRON;
            } else {
                // Invoice is in EUR (or other currency)
                // The $netAmount, $vatAmount, $grossAmount are already converted to RON above
                // But we need the original currency amounts
                // Since totals were calculated from WHMCS invoice totals, we need to reverse the conversion
                // Original currency amount = RON amount / exchangeRate
                $fallbackNetAmountCurrency = round($netAmount / $exchangeRate, 2);
                $fallbackVatAmountCurrency = round($vatAmount / $exchangeRate, 2);
                $fallbackGrossAmountCurrency = round($grossAmount / $exchangeRate, 2);
                $fallbackUnitPriceCurrency = round($fallbackNetAmountCurrency / $quantity, 2);
                
                // RON amounts are already calculated correctly above
                $fallbackNetAmountRON = $netAmount;
                $fallbackVatAmountRON = $vatAmount;
                $fallbackGrossAmountRON = $grossAmount;
                $fallbackUnitPriceRON = round($netAmount / $quantity, 4); // 4 decimals for unit price
            }
            
            logActivity("Keez: Fallback item - Currency: {$currencyCode}, Net RON: {$fallbackNetAmountRON}, Net Currency: {$fallbackNetAmountCurrency}");
            
            $invoiceDetails[] = [
                'itemExternalId' => strval($invoice['id']),
                'measureUnitId' => 1,
                'quantity' => $quantity,
                'unitPrice' => round($fallbackUnitPriceRON, 4), // RON amount, 4 decimals
                'unitPriceCurrency' => $isRON ? null : round($fallbackUnitPriceCurrency, 4), // Currency amount, 4 decimals (only if not RON)
                'vatPercent' => $fallbackVatRate,
                'originalNetAmount' => round($fallbackNetAmountRON, 2), // RON amount
                'originalNetAmountCurrency' => round($fallbackNetAmountCurrency, 2), // Currency amount
                'originalVatAmount' => round($fallbackVatAmountRON, 2), // RON amount
                'originalVatAmountCurrency' => round($fallbackVatAmountCurrency, 2), // Currency amount
                'netAmount' => round($fallbackNetAmountRON, 2), // RON amount
                'netAmountCurrency' => round($fallbackNetAmountCurrency, 2), // Currency amount
                'vatAmount' => round($fallbackVatAmountRON, 2), // RON amount
                'vatAmountCurrency' => round($fallbackVatAmountCurrency, 2), // Currency amount
                'grossAmount' => round($fallbackGrossAmountRON, 2), // RON amount
                'grossAmountCurrency' => round($fallbackGrossAmountCurrency, 2), // Currency amount
                'itemDescription' => $articleNote,
            ];
        }

        // Mapează județul pentru România
        $countyCode = $this->mapRomanianCounty($invoice['state'], $invoice['country']);

        // Calculate currency amounts for invoice totals
        // $netAmountCurrency, $vatAmountCurrency, $grossAmountCurrency are already set above
        // They contain the original currency amounts from WHMCS
        // $netAmount, $vatAmount, $grossAmount contain the RON amounts (converted if needed)
        
        logActivity("Keez: Invoice totals - Currency: {$currencyCode}, Net RON: {$netAmount}, Net Currency: {$netAmountCurrency}, Gross RON: {$grossAmount}, Gross Currency: {$grossAmountCurrency}");
        
        return [
            'series' => $settings['factura_serie'],
            'number' => $invoiceNumber, // Doar dacă nu există deja în serie
            'documentDate' => $documentDate,
            'dueDate' => $dueDate,
            'vatOnCollection' => $settings['tva_incasare'],
            'currencyCode' => $currencyCode,
            'exchangeRate' => $isRON ? null : round($exchangeRate, 4), // Only set exchange rate if not RON
            'originalNetAmount' => round($netAmount, 2), // RON amount
            'originalNetAmountCurrency' => round($netAmountCurrency, 2), // Currency amount (original from WHMCS)
            'originalVatAmount' => round($vatAmount, 2), // RON amount
            'originalVatAmountCurrency' => round($vatAmountCurrency, 2), // Currency amount (original from WHMCS)
            'netAmount' => round($netAmount, 2), // RON amount
            'netAmountCurrency' => round($netAmountCurrency, 2), // Currency amount (original from WHMCS)
            'vatAmount' => round($vatAmount, 2), // RON amount
            'vatAmountCurrency' => round($vatAmountCurrency, 2), // Currency amount (original from WHMCS)
            'grossAmount' => round($grossAmount, 2), // RON amount
            'grossAmountCurrency' => round($grossAmountCurrency, 2), // Currency amount (original from WHMCS)
            'paymentTypeId' => $paymentTypeId,
            'partner' => [
                'isLegalPerson' => $isPJ,
                'identificationNumber' => $identificationNumber,
                'partnerName' => $partnerName,
                'countryCode' => strtoupper($invoice['country']),
                'countryName' => $this->getCountryName($invoice['country']),
                'countyCode' => $countyCode,
                'countyName' => $this->getCountyName($countyCode),
                'cityName' => trim($invoice['city']),
                'addressDetails' => $address,
            ],
            'invoiceDetails' => $invoiceDetails,
            'comments' => !empty($transactionId) ? "Transaction ID: {$transactionId}" : '',
        ];
    }

    private function getCurrencyCode($currencyId) {
        // Get currency from WHMCS configuration instead of hardcoded map
        try {
            $currency = Capsule::table('tblcurrencies')
                ->where('id', $currencyId)
                ->first();
            
            if ($currency && !empty($currency->code)) {
                logActivity("Keez: Found currency in tblcurrencies - ID: {$currencyId}, Code: {$currency->code}");
                return $currency->code;
            }
        } catch (Exception $e) {
            // Fallback to hardcoded map if table doesn't exist
            logActivity("Keez: Could not get currency from tblcurrencies: " . $e->getMessage());
        }
        
        // Fallback to hardcoded map
        $currencyMap = [
            1 => 'RON',
            2 => 'USD',
            3 => 'EUR',
            4 => 'GBP',
        ];
        
        $currencyCode = $currencyMap[$currencyId] ?? $this->settings['default_currency'];
        logActivity("Keez: Using fallback currency mapping - ID: {$currencyId}, Code: {$currencyCode}");
        return $currencyCode;
    }

    private function mapRomanianCounty($state, $country) {
        if (strtoupper($country) !== 'RO') {
            return 'RO-B'; // București default
        }

        $countyMap = [
            'ALBA' => 'RO-AB',
            'ARAD' => 'RO-AR',
            'ARGEŞ' => 'RO-AG',
            'BACĂU' => 'RO-BC',
            'BIHOR' => 'RO-BH',
            'BISTRIŢA-NĂSĂUD' => 'RO-BN',
            'BOTOŞANI' => 'RO-BT',
            'BRĂILA' => 'RO-BR',
            'BRAŞOV' => 'RO-BV',
            'BUCUREŞTI' => 'RO-B',
            'BUZĂU' => 'RO-BZ',
            'CĂLĂRAŞI' => 'RO-CL',
            'CARAŞ-SEVERIN' => 'RO-CS',
            'CLUJ' => 'RO-CJ',
            'CONSTANŢA' => 'RO-CT',
            'COVASNA' => 'RO-CV',
            'DÂMBOVIŢA' => 'RO-DB',
            'DOLJ' => 'RO-DJ',
            'GALAŢI' => 'RO-GL',
            'GIURGIU' => 'RO-GR',
            'GORJ' => 'RO-GJ',
            'HARGHITA' => 'RO-HR',
            'HUNEDOARA' => 'RO-HD',
            'IALOMIŢA' => 'RO-IL',
            'IAŞI' => 'RO-IS',
            'ILFOV' => 'RO-IF',
            'MARAMUREŞ' => 'RO-MM',
            'MEHEDINŢI' => 'RO-MH',
            'MUREŞ' => 'RO-MS',
            'NEAMŢ' => 'RO-NT',
            'OLT' => 'RO-OT',
            'PRAHOVA' => 'RO-PH',
            'SĂLAJ' => 'RO-SJ',
            'SATU MARE' => 'RO-SM',
            'SIBIU' => 'RO-SB',
            'SUCEAVA' => 'RO-SV',
            'TELEORMAN' => 'RO-TR',
            'TIMIŞ' => 'RO-TM',
            'TULCEA' => 'RO-TL',
            'VÂLCEA' => 'RO-VL',
            'VASLUI' => 'RO-VS',
            'VRANCEA' => 'RO-VN',
        ];

        $stateUpper = strtoupper(trim($state));
        return $countyMap[$stateUpper] ?? 'RO-B';
    }

    private function getCountryName($countryCode) {
        $countries = [
            'RO' => 'Romania',
            'US' => 'United States',
            'GB' => 'United Kingdom',
            'DE' => 'Germany',
            'FR' => 'France',
            'IT' => 'Italy',
            'ES' => 'Spain',
        ];
        return $countries[strtoupper($countryCode)] ?? ucfirst(strtolower($countryCode));
    }

    private function getCountyName($countyCode) {
        $counties = [
            'RO-AB' => 'Alba',
            'RO-AR' => 'Arad',
            'RO-AG' => 'Argeș',
            'RO-BC' => 'Bacău',
            'RO-BH' => 'Bihor',
            'RO-BN' => 'Bistrița-Năsăud',
            'RO-BT' => 'Botoșani',
            'RO-BR' => 'Brăila',
            'RO-BV' => 'Brașov',
            'RO-B' => 'București',
            'RO-BZ' => 'Buzău',
            'RO-CL' => 'Călărași',
            'RO-CS' => 'Caraș-Severin',
            'RO-CJ' => 'Cluj',
            'RO-CT' => 'Constanța',
            'RO-CV' => 'Covasna',
            'RO-DB' => 'Dâmbovița',
            'RO-DJ' => 'Dolj',
            'RO-GL' => 'Galați',
            'RO-GR' => 'Giurgiu',
            'RO-GJ' => 'Gorj',
            'RO-HR' => 'Harghita',
            'RO-HD' => 'Hunedoara',
            'RO-IL' => 'Ialomița',
            'RO-IS' => 'Iași',
            'RO-IF' => 'Ilfov',
            'RO-MM' => 'Maramureș',
            'RO-MH' => 'Mehedinți',
            'RO-MS' => 'Mureș',
            'RO-NT' => 'Neamț',
            'RO-OT' => 'Olt',
            'RO-PH' => 'Prahova',
            'RO-SJ' => 'Sălaj',
            'RO-SM' => 'Satu Mare',
            'RO-SB' => 'Sibiu',
            'RO-SV' => 'Suceava',
            'RO-TR' => 'Teleorman',
            'RO-TM' => 'Timiș',
            'RO-TL' => 'Tulcea',
            'RO-VL' => 'Vâlcea',
            'RO-VS' => 'Vaslui',
            'RO-VN' => 'Vrancea',
        ];
        return $counties[$countyCode] ?? '';
    }

    private function sendToKeez($data) {
        $token = $this->auth->getToken();
        if (!$token) {
            throw new Exception("Unable to obtain Keez API token");
        }

        $url = $this->apiUrl . '/' . $this->clientEid . '/invoices';

        $ch = curl_init($url);

        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            "Content-Type: application/json",
            "Authorization: Bearer " . $token
        ]);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 60);

        logActivity("Keez: Sending invoice creation request to: {$url}");
        $response = curl_exec($ch);

        if (curl_errno($ch)) {
            $error = curl_error($ch);
        } else {
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            logActivity("Keez: Invoice creation API response [{$httpCode}]: {$response}");
        }

        curl_close($ch);

        if ($error) {
            throw new Exception("cURL Error: " . $error);
        }

        if ($httpCode < 200 || $httpCode >= 300) {
            throw new Exception("Keez API Error [{$httpCode}]: " . $response);
        }

        $result = json_decode($response, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            throw new Exception("Invalid JSON response from Keez: " . $response);
        }

        return $result;
    }
}

// ===== HOOK-URI PENTRU CREARE AUTOMATĂ =====
// Hook pentru crearea automată când factura devine plătită
add_hook('InvoicePaid', 1, function($vars) {
    $invoiceId = $vars['invoiceid'];
    
    logActivity("Keez Hook: InvoicePaid triggered for invoice ID: " . $invoiceId);
    logActivity("Keez Hook: Vars received: " . json_encode($vars));

    try {
        $keezService = new KeezInvoiceService();
        logActivity("Keez Hook: KeezInvoiceService created successfully");
        
        $result = $keezService->createInvoice($invoiceId);
        logActivity("Keez Hook: createInvoice result: " . json_encode($result));

        if ($result) {
            logActivity("Keez: Invoice automatically created when WHMCS invoice ID: " . $invoiceId . " was paid");
        } else {
            logActivity("Keez Hook: createInvoice returned false for invoice ID: " . $invoiceId);
        }
    } catch (Exception $e) {
        logActivity("Keez integration error for paid invoice " . $invoiceId . ": " . $e->getMessage());
        logActivity("Keez Hook: Exception trace: " . $e->getTraceAsString());
    }
});

// Hook pentru schimbarea statusului
add_hook('InvoiceStatusChange', 0, function($vars) {
    $invoiceId = $vars['invoiceid'];
    $newStatus = $vars['status'];
    
    logActivity("Keez Status Change Hook: Invoice ID {$invoiceId} status changed to: {$newStatus}");
    
    if ($newStatus === 'Paid') {
        logActivity("Keez Status Change Hook: Invoice {$invoiceId} is now Paid - triggering Keez creation");
        
        try {
            $keezService = new KeezInvoiceService();
            $result = $keezService->createInvoice($invoiceId);
            if ($result) {
                logActivity("Keez: Invoice automatically created via status change for ID: " . $invoiceId);
            }
        } catch (Exception $e) {
            logActivity("Keez integration error via status change for invoice " . $invoiceId . ": " . $e->getMessage());
        }
    }
});

// Hook pentru LogActivity (fallback)
add_hook('LogActivity', 1, function($vars) {
    if (strpos($vars['description'], 'Invoice Marked Paid') !== false) {
        logActivity("Keez Intercept: Invoice marked paid detected - ID: " . ($vars['invoiceid'] ?? 'unknown'));
        
        $invoiceId = $vars['invoiceid'] ?? null;
        if ($invoiceId) {
            logActivity("Keez Manual Trigger: Attempting to create invoice in Keez for ID: " . $invoiceId);
            
            try {
                $keezService = new KeezInvoiceService();
                $result = $keezService->createInvoice($invoiceId);
                if ($result) {
                    logActivity("Keez Manual Trigger: Invoice successfully created in Keez for ID: " . $invoiceId);
                } else {
                    logActivity("Keez Manual Trigger: Failed to create invoice in Keez for ID: " . $invoiceId);
                }
            } catch (Exception $e) {
                logActivity("Keez Manual Trigger Error for invoice " . $invoiceId . ": " . $e->getMessage());
            }
        }
    }
});

// Hook pentru monitorizarea periodică
add_hook('AdminAreaPage', 1, function($vars) {
    static $lastCheck = 0;
    $currentTime = time();
    
    // Debug: Log când hook-ul se declanșează
    logActivity("Keez Auto Monitor: Hook triggered at " . date('Y-m-d H:i:s'));
    
    // Verifică la fiecare 30 de secunde
    if ($currentTime - $lastCheck < 30) {
        logActivity("Keez Auto Monitor: Skipping check - too soon (last check: " . date('Y-m-d H:i:s', $lastCheck) . ")");
        return;
    }
    $lastCheck = $currentTime;
    
    logActivity("Keez Auto Monitor: Starting check for recent paid invoices");
    
    try {
        // Verifică facturile care au fost marcate ca plătite în ultimele 2 ore
        $recentInvoices = Capsule::table('tblinvoices')
            ->where('status', 'Paid')
            ->where('datepaid', '>', date('Y-m-d H:i:s', $currentTime - 7200))
            ->where('notes', 'not like', '%Keez Auto Created%')
            ->get();
        
        logActivity("Keez Auto Monitor: Found " . count($recentInvoices) . " recent paid invoices to check");
        
        // Debug: Afișează detaliile facturilor găsite
        foreach ($recentInvoices as $invoice) {
            logActivity("Keez Auto Monitor: Checking invoice ID: {$invoice->id} - {$invoice->invoicenum} - DatePaid: {$invoice->datepaid} - Notes: " . substr($invoice->notes, 0, 50) . "...");
        }
        
        foreach ($recentInvoices as $invoice) {
            if (strpos($invoice->notes, 'Keez Auto Created') !== false) {
                continue;
            }
            
            logActivity("Keez Auto Monitor: Found recently paid invoice ID: {$invoice->id} - {$invoice->invoicenum}");
            
            try {
                $keezService = new KeezInvoiceService();
                $result = $keezService->createInvoice($invoice->id);
                
                if ($result) {
                    $currentNotes = $invoice->notes ?: '';
                    $newNotes = $currentNotes . "\nKeez Auto Created: " . date('Y-m-d H:i:s');
                    
                    Capsule::table('tblinvoices')
                        ->where('id', $invoice->id)
                        ->update(['notes' => $newNotes]);
                    
                    logActivity("Keez Auto Monitor: Successfully created invoice {$invoice->invoicenum} in Keez");
                }
            } catch (Exception $e) {
                logActivity("Keez Auto Monitor Error for invoice {$invoice->id}: " . $e->getMessage());
            }
        }
    } catch (Exception $e) {
        logActivity("Keez Auto Monitor Error: " . $e->getMessage());
    }
});



logActivity("Keez: All hooks registered successfully from main file");

// ===== STRIPE METADATA UPDATE HOOK =====
add_hook('InvoicePaid', 2, function($vars) {
    $invoiceId = (int) $vars['invoiceid'];

    // 1) Luăm datele complete ale facturii (cu număr fiscal)
    $invoice = localAPI('GetInvoice', ['invoiceid' => $invoiceId]);
    if (empty($invoice) || $invoice['result'] !== 'success') {
        logActivity("Stripe Hook: nu pot citi invoice {$invoiceId}");
        return;
    }

    $invoiceNum = $invoice['invoicenum'] ?? '';
    if (!$invoiceNum) {
        // uneori in hook-ul InvoicePaid WHMCS încă nu a populat invoicenum; fallback la număr compus
        $invoiceNum = $invoice['invoicenumformatted'] ?? ('INV-' . $invoiceId);
    }

    // 2) Găsim ultima tranzacție stripe-like a acestei facturi
    $tx = null;
    $gateways = ['stripe', 'stripecheckout', 'stripe_sepa', 'stripeach', 'stripe_sepa_payments', 'stripe_applepay'];
    if (!empty($invoice['transactions']) && is_array($invoice['transactions'])) {
        // ultima tranzacție din listă
        $reversed = array_reverse($invoice['transactions']);
        foreach ($reversed as $t) {
            $gw = strtolower($t['gateway'] ?? '');
            if (in_array($gw, $gateways, true)) {
                $tx = $t;
                break;
            }
        }
    }

    if (!$tx) {
        logActivity("Stripe Hook: nu am găsit tranzacție Stripe pentru invoice {$invoiceId}");
        return;
    }

    $transId = $tx['transid'] ?? '';
    if (!$transId) {
        logActivity("Stripe Hook: tranzacție fără transid pentru invoice {$invoiceId}");
        return;
    }

    // 3) Obținem cheia secretă Stripe din configurarea gateway-ului (sau din env)
    $secretKey = null;
    try {
        // încearcă să citești pentru fiecare gateway stripe-like
        foreach ($gateways as $gwName) {
            $row = Capsule::table('tblpaymentgateways')
                ->where('gateway', $gwName)
                ->whereIn('setting', ['secretKey', 'secret_key', 'private_key'])
                ->pluck('value');
            if (!empty($row) && isset($row[0]) && $row[0]) {
                $secretKey = $row[0];
                break;
            }
        }
    } catch (\Exception $e) {
        // ignore
    }
    if (!$secretKey) {
        $secretKey = getenv('STRIPE_SECRET_KEY') ?: '';
    }
    if (!$secretKey) {
        logActivity("Stripe Hook: lipsă STRIPE secret key pentru update metadata (invoice {$invoiceId})");
        return;
    }

    // 4) Încărcăm Stripe PHP SDK (compatibil cu modulele Stripe din WHMCS)
    $autoloadPaths = [
        ROOTDIR . '/modules/gateways/stripe/vendor/autoload.php',
        ROOTDIR . '/modules/gateways/stripe_checkout/vendor/autoload.php',
        ROOTDIR . '/modules/gateways/stripe_sepa/vendor/autoload.php',
        ROOTDIR . '/vendor/autoload.php', // fallback dacă ai composer global
    ];
    $loaded = false;
    foreach ($autoloadPaths as $p) {
        if (file_exists($p)) {
            require_once $p;
            $loaded = true;
            break;
        }
    }
    if (!$loaded || !class_exists('\Stripe\Stripe')) {
        logActivity("Stripe Hook: nu pot încărca stripe-php (invoice {$invoiceId})");
        return;
    }

    \Stripe\Stripe::setApiKey($secretKey);

    // 5) Obținem numărul facturii din Keez (dacă există)
    $keezInvoiceNumber = $invoiceNum; // Fallback la numărul WHMCS
    try {
        $keezSettings = KeezConfig::getSettings();
        $series = $keezSettings['factura_serie'] ?? 'OSTH';
        
        // Extragem numărul din factura WHMCS (de exemplu "OTS505" -> "505")
        $number = $invoiceNum;
        if (preg_match('/^' . preg_quote($series, '/') . '(\d+)$/i', $invoiceNum, $matches)) {
            $number = $matches[1];
        } elseif (preg_match('/(\d+)$/', $invoiceNum, $matches)) {
            // Dacă nu găsim seria, luăm doar numărul de la sfârșit
            $number = $matches[1];
        }
        
        // Căutăm factura în Keez
        $keezService = new KeezInvoiceService();
        $keezInvoice = $keezService->findInvoiceBySeriesAndNumber($series, $number);
        
        if ($keezInvoice && isset($keezInvoice['series']) && isset($keezInvoice['number'])) {
            // Construim numărul complet din Keez
            $keezSeries = $keezInvoice['series'] ?? $series;
            $keezNumber = $keezInvoice['number'] ?? $number;
            $keezInvoiceNumber = $keezSeries . $keezNumber;
            logActivity("Stripe Hook: Găsit număr factură Keez: {$keezInvoiceNumber} pentru invoice WHMCS {$invoiceId} ({$invoiceNum})");
        } else {
            logActivity("Stripe Hook: Factura nu a fost găsită în Keez pentru invoice {$invoiceId} ({$invoiceNum}), folosim numărul WHMCS");
        }
    } catch (\Exception $e) {
        logActivity("Stripe Hook: Eroare la căutarea facturii în Keez pentru invoice {$invoiceId}: " . $e->getMessage() . " - folosim numărul WHMCS");
    }

    // Helper pentru update metadata + description
    $metaKey = 'invoice_number';
    $description = "Factura fiscala {$keezInvoiceNumber} (WHMCS #{$invoiceId})";

    try {
        if (strpos($transId, 'pi_') === 0) {
            // PaymentIntent modern
            $pi = \Stripe\PaymentIntent::retrieve($transId);
            $meta = $pi->metadata ?: [];
            $meta[$metaKey] = $keezInvoiceNumber;
            $pi->metadata = $meta;
            // Actualizează description întotdeauna cu numărul facturii Keez
            $pi->description = $description;
            $pi->save();

            // actualizează și PaymentLink/Invoice dacă există o Stripe Invoice legată
            if (!empty($pi->latest_charge)) {
                $ch = \Stripe\Charge::retrieve($pi->latest_charge);
                $meta = $ch->metadata ?: [];
                $meta[$metaKey] = $keezInvoiceNumber;
                $ch->metadata = $meta;
                // Actualizează description întotdeauna cu numărul facturii Keez
                $ch->description = $description;
                $ch->save();
            }

        } elseif (strpos($transId, 'ch_') === 0) {
            // Tranzacție veche doar cu Charge
            $ch = \Stripe\Charge::retrieve($transId);
            $meta = $ch->metadata ?: [];
            $meta[$metaKey] = $keezInvoiceNumber;
            $ch->metadata = $meta;
            // Actualizează description întotdeauna cu numărul facturii Keez
            $ch->description = $description;
            $ch->save();

            if (!empty($ch->payment_intent)) {
                $pi = \Stripe\PaymentIntent::retrieve($ch->payment_intent);
                $meta = $pi->metadata ?: [];
                $meta[$metaKey] = $keezInvoiceNumber;
                $pi->metadata = $meta;
                // Actualizează description întotdeauna cu numărul facturii Keez
                $pi->description = $description;
                $pi->save();
            }

        } elseif (strpos($transId, 'in_') === 0) {
            // Stripe Invoice id
            $si = \Stripe\Invoice::retrieve($transId);
            $meta = $si->metadata ?: [];
            $meta[$metaKey] = $keezInvoiceNumber;
            $si->metadata = $meta;
            // Actualizează description întotdeauna cu numărul facturii Keez
            $si->description = $description;
            $si->save();

            if (!empty($si->payment_intent)) {
                $pi = \Stripe\PaymentIntent::retrieve($si->payment_intent);
                $meta = $pi->metadata ?: [];
                $meta[$metaKey] = $keezInvoiceNumber;
                $pi->metadata = $meta;
                // Actualizează description întotdeauna cu numărul facturii Keez
                $pi->description = $description;
                $pi->save();
            }
        } else {
            // Format necunoscut, dar încercăm să găsim un PI asociat din WHMCS (unele module salvează în notes)
            logActivity("Stripe Hook: transid necunoscut ({$transId}) pentru invoice {$invoiceId}");
        }

        logActivity("Stripe Hook: metadata actualizată cu numărul fiscal Keez {$keezInvoiceNumber} (WHMCS: {$invoiceNum}) pentru invoice {$invoiceId} / {$transId}");
    } catch (\Exception $e) {
        logActivity("Stripe Hook ERROR ({$invoiceId} / {$transId}): " . $e->getMessage());
    }
});



// Manually add Keez Integration to admin navigation since auto-detection isn't working
add_hook('AdminAreaPage', 2, function($vars) {
    // Only run on admin area pages
    if (!isset($vars['addon_modules'])) {
        $vars['addon_modules'] = [];
    }

    // Add Keez Integration to the addon modules list
    if (!isset($vars['addon_modules']['keez_integration'])) {
        $vars['addon_modules']['keez_integration'] = 'Keez Integration';
    }

    return $vars;
});

// ===== FUNCȚII PENTRU CONFIGURARE =====
function keez_get_settings_html() {
    $settings = KeezConfig::getSettings();

    $html = '
    <div class="alert alert-info">
        <i class="fas fa-info-circle"></i>
        <strong>Integrare Keez API</strong><br>
        Configurează integrarea pentru crearea automată a facturilor în Keez.
    </div>

    <table class="form-table">
        <tbody>
            <tr>
                <td class="fieldlabel">Activare integrare:</td>
                <td class="fieldarea">
                    <input type="checkbox" name="KeezEnabled" ' . ($settings['enabled'] ? 'checked' : '') . '>
                    Activează crearea automată a facturilor în Keez
                </td>
            </tr>
            <tr>
                <td class="fieldlabel">Mediu:</td>
                <td class="fieldarea">
                    <select name="KeezEnvironment">
                        <option value="staging" ' . ($settings['environment'] === 'staging' ? 'selected' : '') . '>Staging (Test)</option>
                        <option value="production" ' . ($settings['environment'] === 'production' ? 'selected' : '') . '>Production (Live)</option>
                    </select>
                </td>
            </tr>
            <tr>
                <td class="fieldlabel">Client EID:</td>
                <td class="fieldarea">
                    <input type="text" name="KeezClientEID" value="' . htmlspecialchars($settings['client_eid']) . '" class="form-control">
                </td>
            </tr>
            <tr>
                <td class="fieldlabel">Application ID:</td>
                <td class="fieldarea">
                    <input type="text" name="KeezApplicationID" value="' . htmlspecialchars($settings['application_id']) . '" class="form-control">
                </td>
            </tr>
            <tr>
                <td class="fieldlabel">Secret:</td>
                <td class="fieldarea">
                    <input type="password" name="KeezSecret" value="' . htmlspecialchars($settings['secret']) . '" class="form-control">
                </td>
            </tr>
            <tr>
                <td class="fieldlabel">Serie facturi:</td>
                <td class="fieldarea">
                    <input type="text" name="KeezFacturaSerie" value="' . htmlspecialchars($settings['factura_serie']) . '" class="form-control">
                </td>
            </tr>
            <tr>
                <td class="fieldlabel">TVA fix (%):</td>
                <td class="fieldarea">
                    <input type="number" step="0.01" name="KeezTVA" value="' . $settings['tva_fix'] . '" class="form-control">
                </td>
            </tr>
            <tr>
                <td class="fieldlabel">TVA la încasare:</td>
                <td class="fieldarea">
                    <input type="checkbox" name="KeezTVAIncasare" ' . ($settings['tva_incasare'] ? 'checked' : '') . '>
                    Activează TVA la încasare
                </td>
            </tr>
            <tr>
                <td class="fieldlabel">Unitate măsură default:</td>
                <td class="fieldarea">
                    <input type="text" name="KeezDefaultUM" value="' . htmlspecialchars($settings['default_um']) . '" class="form-control">
                </td>
            </tr>
            <tr>
                <td class="fieldlabel">Monedă default:</td>
                <td class="fieldarea">
                    <select name="KeezDefaultCurrency">
                        <option value="RON" ' . ($settings['default_currency'] === 'RON' ? 'selected' : '') . '>RON</option>
                        <option value="EUR" ' . ($settings['default_currency'] === 'EUR' ? 'selected' : '') . '>EUR</option>
                        <option value="USD" ' . ($settings['default_currency'] === 'USD' ? 'selected' : '') . '>USD</option>
                    </select>
                </td>
            </tr>
        </tbody>
    </table>
    ';

    return $html;
}

function keez_save_settings($data) {
    $booleanFields = ['KeezEnabled', 'KeezTVAIncasare'];

    foreach ($data as $key => $value) {
        if (in_array($key, $booleanFields)) {
            Setting::setValue($key, isset($data[$key]) ? 'on' : '');
        } else {
            Setting::setValue($key, $value);
        }
    }
}

// ===== FUNCȚIE DE TESTARE =====
function keez_test_connection() {
    try {
        $service = new KeezInvoiceService();
        $token = $service->auth->getToken();

        if ($token) {
            return ['success' => true, 'message' => 'Conexiune reușită! Token obținut.'];
        } else {
            return ['success' => false, 'message' => 'Eroare la obținerea token-ului.'];
        }
    } catch (Exception $e) {
        return ['success' => false, 'message' => 'Eroare: ' . $e->getMessage()];
    }
}

// ===== CONFIGURARE ADDON WHMCS =====
function keez_integration_config() {
    $configarray = array(
        "name" => "Keez API Integration",
        "description" => "Integrare automată pentru crearea facturilor în Keez la generarea facturilor în WHMCS",
        "version" => "1.0.0",
        "author" => "OneTopSolution",
        "language" => "english",
        "fields" => array(
            "KeezEnvironment" => array(
                "FriendlyName" => "Mediu Keez",
                "Type" => "dropdown",
                "Options" => "staging,production",
                "Description" => "Alege mediul Keez API (staging pentru testare, production pentru live)",
                "Default" => "staging",
            ),
            "KeezClientEID" => array(
                "FriendlyName" => "Client EID",
                "Type" => "text",
                "Size" => "50",
                "Description" => "Client EID din contul Keez",
                "Default" => "",
            ),
            "KeezApplicationID" => array(
                "FriendlyName" => "Application ID",
                "Type" => "text",
                "Size" => "50",
                "Description" => "Application ID din setările Keez API",
                "Default" => "",
            ),
            "KeezSecret" => array(
                "FriendlyName" => "Secret",
                "Type" => "password",
                "Size" => "50",
                "Description" => "Secret pentru autentificare Keez API",
                "Default" => "",
            ),
            "KeezEnabled" => array(
                "FriendlyName" => "Activare integrare",
                "Type" => "yesno",
                "Description" => "Activează crearea automată a facturilor în Keez",
                "Default" => "no",
            ),
            "KeezFacturaSerie" => array(
                "FriendlyName" => "Serie facturi",
                "Type" => "text",
                "Size" => "10",
                "Description" => "Seria fiscală pentru facturi (ex: OSTH)",
                "Default" => "OSTH",
            ),
            "KeezTVA" => array(
                "FriendlyName" => "TVA (%)",
                "Type" => "text",
                "Size" => "5",
                "Description" => "Procent TVA fix (ex: 21)",
                "Default" => "21",
            ),
            "KeezTVAIncasare" => array(
                "FriendlyName" => "TVA la încasare",
                "Type" => "yesno",
                "Description" => "Activează TVA la încasare",
                "Default" => "no",
            ),
            "KeezDefaultUM" => array(
                "FriendlyName" => "Unitate măsură default",
                "Type" => "text",
                "Size" => "10",
                "Description" => "Unitate de măsură default (ex: Buc)",
                "Default" => "Buc",
            ),
            "KeezDefaultCurrency" => array(
                "FriendlyName" => "Monedă default",
                "Type" => "dropdown",
                "Options" => "RON,EUR,USD,GBP",
                "Description" => "Moneda default pentru facturi",
                "Default" => "RON",
            ),
        )
    );
    return $configarray;
}

// Hook-urile sunt înregistrate în fișierul principal

function keez_integration_activate() {
    // Set default values for addon module settings
    $defaultSettings = [
        'KeezEnvironment' => 'staging',
        'KeezClientEID' => '',
        'KeezApplicationID' => '',
        'KeezSecret' => '',
        'KeezEnabled' => 'on',
        'KeezFacturaSerie' => 'OSTH',
        'KeezTVA' => '21',
        'KeezTVAIncasare' => 'on',
        'KeezDefaultUM' => 'Buc',
        'KeezDefaultCurrency' => 'RON',
    ];

    foreach ($defaultSettings as $key => $value) {
        Capsule::table('tbladdonmodules')->updateOrInsert(
            ['module' => 'keez_integration', 'setting' => $key],
            ['value' => $value]
        );
    }

    return array('status'=>'success','description'=>'Keez API Integration a fost activat cu succes! Hook-urile sunt înregistrate în fișierul principal.');
}

function keez_integration_deactivate() {
    // Cod executat la dezactivarea addon-ului
    return array('status'=>'success','description'=>'Keez API Integration a fost dezactivat.');
}

function keez_integration_upgrade($vars) {
    // Cod pentru upgrade (dacă este necesar în viitor)
}

function keez_integration_output($vars) {
    // Hook-urile sunt înregistrate în fișierul principal
    
    // Interfață admin pentru addon
    $settings = KeezConfig::getSettings();

    // Add custom CSS for status badges
    echo '<style>
        .status {
            display: inline-block;
            min-width: 10px;
            padding: 3px 7px;
            font-size: 12px;
            font-weight: 700;
            line-height: 1;
            color: #fff;
            text-align: center;
            white-space: nowrap;
            vertical-align: middle;
            border-radius: 10px;
        }
        .status.status-paid {
            background-color: #5cb85c;
        }
        .status.status-unpaid {
            background-color: #d9534f;
        }
        .status.status-cancelled {
            background-color: #777;
        }
        .status.status-refunded {
            background-color: #5bc0de;
        }
        .status.status-collections {
            background-color: #f0ad4e;
        }
        .status.status-pending {
            background-color: #f0ad4e;
        }
    </style>';

    echo '<div class="alert alert-info">
        <h4><i class="fas fa-info-circle"></i> Keez API Integration - Status</h4>
        <p>Integrarea Keez permite crearea automată a facturilor în sistemul Keez atunci când se generează facturi noi în WHMCS.</p>
    </div>';

    // Verifică dacă există parametri pentru vizualizare factură
    $viewInvoice = isset($_GET['view_invoice']) ? trim($_GET['view_invoice']) : '';
    $createKeezInvoice = isset($_GET['create_keez_invoice']) ? (int)$_GET['create_keez_invoice'] : 0;
    $createArticles = isset($_GET['create_articles']) ? (int)$_GET['create_articles'] : 0;
    $testAutoTrigger = isset($_GET['test_auto_trigger']) ? (int)$_GET['test_auto_trigger'] : 0;
    $viewInvoices = isset($_GET['view_invoices']) ? true : false;
    $syncInvoices = isset($_GET['sync_invoices']) ? true : false;
    $syncSingleInvoice = isset($_GET['sync_single_invoice']) ? (int)$_GET['sync_single_invoice'] : 0;


    if (!empty($createKeezInvoice)) {
        keez_create_invoice($createKeezInvoice);
        return;
    }

    if (!empty($createArticles)) {
        keez_create_invoice_articles($createArticles);
        return;
    }

    if (!empty($testAutoTrigger)) {
        keez_test_auto_trigger($testAutoTrigger);
        return;
    }

    if ($syncInvoices) {
        keez_sync_invoice_data();
        return;
    }

    if (!empty($syncSingleInvoice)) {
        keez_sync_single_invoice($syncSingleInvoice);
        return;
    }

    if (!empty($viewInvoice)) {
        keez_display_invoice_details($viewInvoice);
        return;
    }

    if ($viewInvoices) {
        keez_display_invoices_table();
        return;
    }

    echo '<div class="row">
        <div class="col-md-6">
            <div class="card">
                <div class="card-header">
                    <h5><i class="fas fa-cogs"></i> Setări curente</h5>
                </div>
                <div class="card-body">
                    <dl class="row">
                        <dt class="col-sm-5">Mediu:</dt>
                        <dd class="col-sm-7"><span class="badge badge-' . ($settings['environment'] === 'production' ? 'success' : 'warning') . '">' . ucfirst($settings['environment']) . '</span></dd>

                        <dt class="col-sm-5">Activare:</dt>
                        <dd class="col-sm-7"><span class="badge badge-' . ($settings['enabled'] ? 'success' : 'danger') . '">' . ($settings['enabled'] ? 'Activată' : 'Dezactivată') . '</span></dd>


                        <dt class="col-sm-5">Client EID:</dt>
                        <dd class="col-sm-7">' . htmlspecialchars($settings['client_eid'] ?: 'Nesetat') . '</dd>

                        <dt class="col-sm-5">Serie facturi:</dt>
                        <dd class="col-sm-7">' . htmlspecialchars($settings['factura_serie']) . '</dd>

                        <dt class="col-sm-5">TVA:</dt>
                        <dd class="col-sm-7">' . $settings['tva_fix'] . '%</dd>
                    </dl>
                </div>
            </div>
        </div>

        <div class="col-md-6">
            <div class="card">
                <div class="card-header">
                    <h5><i class="fas fa-plug"></i> Test conexiune</h5>
                </div>
                <div class="card-body">';

    // Check if test was requested
    $runTest = isset($_GET['test_connection']) && $_GET['test_connection'] === '1';

    if (!empty($settings['application_id']) && !empty($settings['secret'])) {
        echo '<p>Apasă butonul pentru a testa conexiunea cu Keez API.</p>';
        echo '<a href="?module=keez_integration&test_connection=1" class="btn btn-primary">
            <i class="fas fa-plug"></i> Testează conexiunea
        </a>';

        if ($runTest) {
            $testResult = keez_test_connection();
            if ($testResult['success']) {
                echo '<div class="alert alert-success mt-3">
                    <i class="fas fa-check-circle"></i> ' . $testResult['message'] . '
                </div>';
            } else {
                echo '<div class="alert alert-danger mt-3">
                    <i class="fas fa-exclamation-triangle"></i> ' . $testResult['message'] . '
                </div>';
            }
        }
    } else {
        echo '<div class="alert alert-warning">
            <i class="fas fa-exclamation-triangle"></i> Completează Application ID și Secret pentru a testa conexiunea.
        </div>';
    }

    echo '      </div>
            </div>
        </div>
    </div>';

    // Secțiune pentru căutare/vizualizare facturi Keez
    echo '<div class="card">
        <div class="card-header">
            <h5><i class="fas fa-list"></i> Gestionare facturi</h5>
        </div>
        <div class="card-body">
            <div style="display: flex; gap: 15px; flex-wrap: wrap;">
                <a href="?module=keez_integration&view_invoices=1" class="btn btn-primary">
                    <i class="fas fa-table"></i> Vezi toate facturile
                </a>
                <div style="border-left: 1px solid #dee2e6; margin: 0 10px;"></div>
                <form method="get" action="' . $_SERVER['REQUEST_URI'] . '" style="display: flex; gap: 10px; align-items: end;">
                    <input type="hidden" name="module" value="keez_integration">
                    <div style="flex: 1;">
                        <label style="display: block; margin-bottom: 5px; font-weight: bold;">Număr factură Keez:</label>
                        <input type="text" name="view_invoice" value="' . htmlspecialchars($viewInvoice) . '" placeholder="ex: OSTH001" class="form-control" style="width: 100%;">
                    </div>
                    <div>
                        <button type="submit" class="btn btn-primary">
                            <i class="fas fa-search"></i> Caută
                        </button>
                    </div>
                </form>
            </div>
        </div>
    </div>';

    echo '<div class="card">
        <div class="card-header">
            <h5><i class="fas fa-question-circle"></i> Instrucțiuni</h5>
        </div>
        <div class="card-body">
            <ol>
                <li>Intră în contul tău Keez și obține credențialele API (Client EID, Application ID, Secret)</li>
                <li>Configurează setările addon-ului cu informațiile obținute</li>
                <li>Activează integrarea pentru a începe crearea automată a facturilor</li>
                <li>La fiecare factură nouă generată în WHMCS, se va crea automat și în Keez</li>
            </ol>
            <p><strong>Notă:</strong> Asigură-te că seria de facturi din Keez corespunde cu cea din WHMCS.</p>
        </div>
    </div>';
}

function keez_display_invoice_details($externalId) {
    $service = new KeezInvoiceService();
    $invoice = $service->getInvoice($externalId);

    echo '<div class="card">
        <div class="card-header">
            <h5><i class="fas fa-file-invoice"></i> Detalii factură Keez: ' . htmlspecialchars($externalId) . '</h5>
            <div>
                <a href="?module=keez_integration" class="btn btn-secondary btn-sm">
                    <i class="fas fa-arrow-left"></i> Înapoi
                </a>
            </div>
        </div>
        <div class="card-body">';

    if (!$invoice) {
        echo '<div class="alert alert-warning">
            <i class="fas fa-exclamation-triangle"></i>
            Factura nu a fost găsită în Keez sau a apărut o eroare la încărcare.
        </div>';
    } else {
        echo '<div class="row">
            <div class="col-md-6">
                <h6>Informații generale</h6>
                <dl class="row">
                    <dt class="col-sm-4">Serie:</dt>
                    <dd class="col-sm-8">' . htmlspecialchars($invoice['series'] ?? '') . '</dd>

                    <dt class="col-sm-4">Număr:</dt>
                    <dd class="col-sm-8">' . htmlspecialchars($invoice['number'] ?? '') . '</dd>

                    <dt class="col-sm-4">Data:</dt>
                    <dd class="col-sm-8">' . htmlspecialchars($invoice['documentDate'] ?? '') . '</dd>

                    <dt class="col-sm-4">Data scadentă:</dt>
                    <dd class="col-sm-8">' . htmlspecialchars($invoice['dueDate'] ?? '') . '</dd>

                    <dt class="col-sm-4">Monedă:</dt>
                    <dd class="col-sm-8">' . htmlspecialchars($invoice['currencyCode'] ?? '') . '</dd>

                    <dt class="col-sm-4">Status:</dt>
                    <dd class="col-sm-8">' . htmlspecialchars($invoice['status'] ?? '') . '</dd>
                </dl>
            </div>

            <div class="col-md-6">
                <h6>Totaluri</h6>
                <dl class="row">
                    <dt class="col-sm-4">Net:</dt>
                    <dd class="col-sm-8">' . number_format($invoice['netAmount'] ?? 0, 2) . ' ' . htmlspecialchars($invoice['currencyCode'] ?? '') . '</dd>

                    <dt class="col-sm-4">TVA:</dt>
                    <dd class="col-sm-8">' . number_format($invoice['vatAmount'] ?? 0, 2) . ' ' . htmlspecialchars($invoice['currencyCode'] ?? '') . '</dd>

                    <dt class="col-sm-4">Total:</dt>
                    <dd class="col-sm-8"><strong>' . number_format($invoice['grossAmount'] ?? 0, 2) . ' ' . htmlspecialchars($invoice['currencyCode'] ?? '') . '</strong></dd>
                </dl>
            </div>
        </div>';

        if (isset($invoice['partner'])) {
            echo '<h6>Client</h6>
            <dl class="row">
                <dt class="col-sm-2">Tip:</dt>
                <dd class="col-sm-10">' . ($invoice['partner']['isLegalPerson'] ? 'Persoană juridică' : 'Persoană fizică') . '</dd>

                <dt class="col-sm-2">Nume:</dt>
                <dd class="col-sm-10">' . htmlspecialchars($invoice['partner']['partnerName'] ?? '') . '</dd>

                <dt class="col-sm-2">CIF/CNP:</dt>
                <dd class="col-sm-10">' . htmlspecialchars($invoice['partner']['identificationNumber'] ?? '') . '</dd>

                <dt class="col-sm-2">Adresă:</dt>
                <dd class="col-sm-10">' . htmlspecialchars($invoice['partner']['addressDetails'] ?? '') . '</dd>
            </dl>';
        }

        if (isset($invoice['invoiceDetails']) && is_array($invoice['invoiceDetails'])) {
            echo '<h6>Articole</h6>
            <div class="table-responsive">
                <table class="table table-striped">
                    <thead>
                        <tr>
                            <th>Cod</th>
                            <th>Denumire</th>
                            <th>Cant.</th>
                            <th>Preț unitar</th>
                            <th>Valoare</th>
                            <th>TVA</th>
                        </tr>
                    </thead>
                    <tbody>';

            foreach ($invoice['invoiceDetails'] as $item) {
                echo '<tr>
                    <td>' . htmlspecialchars($item['itemExternalId'] ?? '') . '</td>
                    <td>' . htmlspecialchars($item['description'] ?? '') . '</td>
                    <td>' . number_format($item['quantity'] ?? 0, 2) . '</td>
                    <td>' . number_format($item['unitPrice'] ?? 0, 2) . '</td>
                    <td>' . number_format($item['netAmount'] ?? 0, 2) . '</td>
                    <td>' . number_format($item['vatAmount'] ?? 0, 2) . '</td>
                </tr>';
            }

            echo '</tbody>
                </table>
            </div>';
        }

        // Afișează JSON-ul complet pentru debugging
        echo '<details style="margin-top: 20px;">
            <summary>JSON complet (pentru debugging)</summary>
            <pre style="background: #f8f9fa; padding: 10px; border-radius: 4px; font-size: 12px;">' . json_encode($invoice, JSON_PRETTY_PRINT) . '</pre>
        </details>';
    }

    echo '</div></div>';
}

function keez_get_currency_code($currencyId) {
    // Get currency from WHMCS configuration instead of hardcoded map
    try {
        $currency = Capsule::table('tblcurrencies')
            ->where('id', $currencyId)
            ->first();
        
        if ($currency && !empty($currency->code)) {
            return $currency->code;
        }
    } catch (Exception $e) {
        // Fallback to hardcoded map if table doesn't exist
        logActivity("Keez: Could not get currency from tblcurrencies: " . $e->getMessage());
    }
    
    // Fallback to hardcoded map
    $currencyMap = [
        1 => 'RON',
        2 => 'USD', 
        3 => 'EUR',
        4 => 'GBP',
    ];
    
    $currencyCode = $currencyMap[$currencyId] ?? 'RON';
    logActivity("Keez: Using fallback currency mapping - ID: {$currencyId}, Code: {$currencyCode}");
    return $currencyCode;
}

function keez_display_invoices_table() {
    $service = new KeezInvoiceService();

    // Get pagination parameters
    $page = isset($_GET['page']) ? (int)$_GET['page'] : 1;
    $perPage = 25;
    $offset = ($page - 1) * $perPage;

    // Get filter parameters
    $statusFilter = isset($_GET['status']) ? $_GET['status'] : '';
    $dateFrom = isset($_GET['date_from']) ? $_GET['date_from'] : date('Y-m-01');
    $dateTo = isset($_GET['date_to']) ? $_GET['date_to'] : date('Y-m-d');

    echo '<div class="card">
        <div class="card-header">
            <div class="d-flex justify-content-between align-items-center">
                <h5><i class="fas fa-table"></i> Lista facturilor WHMCS</h5>
                <div>
                    <a href="?module=keez_integration&sync_invoices=1" class="btn btn-success btn-sm" onclick="return confirm(\'Sigur doriți să sincronizați datele facturilor din Keez?\');">
                        <i class="fas fa-sync"></i> Sincronizare date Keez
                    </a>
                    <a href="?module=keez_integration" class="btn btn-secondary btn-sm">
                        <i class="fas fa-arrow-left"></i> Înapoi la dashboard
                    </a>
                </div>
            </div>
        </div>
        <div class="card-body">';

    // Filters
    echo '<form method="get" action="' . $_SERVER['REQUEST_URI'] . '" class="mb-4">
        <input type="hidden" name="module" value="keez_integration">
        <input type="hidden" name="view_invoices" value="1">
        <div class="row">
            <div class="col-md-3">
                <label class="form-label">Status</label>
                <select name="status" class="form-control">
                    <option value="">Toate</option>
                    <option value="Paid" ' . ($statusFilter === 'Paid' ? 'selected' : '') . '>Plătite</option>
                    <option value="Unpaid" ' . ($statusFilter === 'Unpaid' ? 'selected' : '') . '>Neplătite</option>
                    <option value="Cancelled" ' . ($statusFilter === 'Cancelled' ? 'selected' : '') . '>Anulate</option>
                </select>
            </div>
            <div class="col-md-3">
                <label class="form-label">De la dată</label>
                <input type="date" name="date_from" value="' . $dateFrom . '" class="form-control">
            </div>
            <div class="col-md-3">
                <label class="form-label">Până la dată</label>
                <input type="date" name="date_to" value="' . $dateTo . '" class="form-control">
            </div>
            <div class="col-md-3">
                <label class="form-label">&nbsp;</label>
                <button type="submit" class="btn btn-primary form-control">
                    <i class="fas fa-filter"></i> Filtrează
                </button>
            </div>
        </div>
    </form>';

    // Get invoices
    $query = Capsule::table('tblinvoices as i')
        ->join('tblclients as c', 'c.id', '=', 'i.userid')
        ->select([
            'i.id', 'i.invoicenum', 'i.date', 'i.duedate', 'i.total', 'i.status',
            'i.paymentmethod', 'c.companyname', 'c.firstname', 'c.lastname', 'c.currency'
        ])
        ->whereBetween('i.date', [$dateFrom, $dateTo])
        ->whereNotNull('i.invoicenum')
        ->where('i.invoicenum', '!=', '')
        ->orderBy('i.id', 'desc');

    if (!empty($statusFilter)) {
        $query->where('i.status', $statusFilter);
    }

    $totalInvoices = $query->count();
    $invoices = $query->offset($offset)->limit($perPage)->get();

    // Status color mapping for invoice badges using WHMCS native classes
    $statusColors = [
        'Paid' => 'paid',              // Green - positive status
        'Unpaid' => 'unpaid',          // Red - requires attention
        'Cancelled' => 'cancelled',    // Gray - inactive
        'Refunded' => 'refunded',      // Blue - informational
        'Collections' => 'collections', // Yellow - warning state
        'Payment Pending' => 'pending' // Yellow - pending state
    ];

    echo '<div class="table-responsive">
        <table class="table table-striped table-hover">
            <thead class="table-dark">
                <tr>
                    <th>ID</th>
                    <th>Număr factură</th>
                    <th>Client</th>
                    <th>Data</th>
                    <th>Total</th>
                    <th>Status WHMCS</th>
                    <th>Keez</th>
                    <th>Status</th>
                    <th>Acțiuni</th>
                </tr>
            </thead>
            <tbody>';

    foreach ($invoices as $invoice) {
        $clientName = !empty($invoice->companyname) ?
            $invoice->companyname :
            trim($invoice->firstname . ' ' . $invoice->lastname);

        echo '<tr>
            <td>' . $invoice->id . '</td>
            <td><strong>' . htmlspecialchars($invoice->invoicenum) . '</strong></td>
            <td>' . htmlspecialchars($clientName) . '</td>
            <td>' . date('d.m.Y', strtotime($invoice->date)) . '</td>
            <td>' . number_format($invoice->total, 2) . ' ' . keez_get_currency_code($invoice->currency) . '</td>
            <td><span class="status status-' . ($statusColors[$invoice->status] ?? 'cancelled') . '">' . $invoice->status . '</span></td>';

            try {
                // First check if we already know the sync status
                $savedStatus = $service->getSyncStatus($invoice->id);
                logActivity("Keez: Display check for invoice {$invoice->id} - savedStatus: " . ($savedStatus ?: 'null'));

                if ($savedStatus === 'synced') {
                    // Check if invoice is still paid - if not, invalidate sync status
                    if ($invoice->status === 'Paid') {
                        echo '<td><span class="status status-paid"><i class="fas fa-check"></i> Sincronizat</span></td>';
                        echo '<td><span class="status status-paid"><i class="fas fa-check-circle"></i> Status salvat</span></td>';
                    } else {
                        // Invoice is unpaid - verify if it still exists in Keez and invalidate if needed
            $settings = KeezConfig::getSettings();
            $series = $settings['factura_serie'];
                        $keezInvoice = $service->findInvoiceBySeriesAndNumber($series, $invoice->invoicenum);

            if ($keezInvoice) {
                            // Invoice exists in Keez but WHMCS is unpaid - this shouldn't happen
                            // but we'll invalidate the sync status
                            logActivity("Keez: Invoice {$invoice->invoicenum} exists in Keez but WHMCS status is unpaid - invalidating sync status");
                            $service->saveSyncStatus($invoice->id, 'invalidated', null);
                        } else {
                            // Invoice doesn't exist in Keez and WHMCS is unpaid - clear sync status
                            $service->saveSyncStatus($invoice->id, 'not_found', null);
                        }
                        
                        echo '<td><span class="status status-cancelled"><i class="fas fa-ban"></i> Neplătită</span></td>';
                        echo '<td><span class="status status-cancelled"><i class="fas fa-exclamation-triangle"></i> Blocat</span></td>';
                    }
                } elseif ($savedStatus === 'not_found') {
                    // Already checked and not found - show red status
                    echo '<td><span class="status status-unpaid"><i class="fas fa-times"></i> Nu există</span></td>';
                    echo '<td><span class="status status-unpaid"><i class="fas fa-times-circle"></i> Verificat</span></td>';
            } else {
                    // No saved status - check if invoice is paid
                    if ($invoice->status === 'Paid') {
                        echo '<td><span class="status status-unpaid"><i class="fas fa-clock"></i> Nu sincronizat</span></td>';
                        echo '<td><span class="status status-pending"><i class="fas fa-sync"></i> Verifică</span></td>';
                    } else {
                        echo '<td><span class="status status-cancelled"><i class="fas fa-ban"></i> Neplătită</span></td>';
                        echo '<td><span class="status status-cancelled"><i class="fas fa-exclamation-triangle"></i> Blocat</span></td>';
                    }
            }
        } catch (Exception $e) {
                logActivity("Keez: Error checking sync status for invoice {$invoice->id}: " . $e->getMessage());
                // Show error status
                echo '<td><span class="status status-unpaid"><i class="fas fa-exclamation-triangle"></i> Eroare</span></td>';
                echo '<td><span class="status status-unpaid"><i class="fas fa-exclamation-triangle"></i> Eroare</span></td>';
            }

            echo '<td>
                <div class="btn-group btn-group-sm">
                    <a href="/host/admin/invoices.php?action=edit&id=' . $invoice->id . '" target="_blank" class="btn btn-outline-primary" title="Vezi în WHMCS">
                        <i class="fas fa-external-link-alt"></i>
                    </a>
                    <a href="?module=keez_integration&sync_single_invoice=' . $invoice->id . '" class="btn btn-outline-info" title="Sincronizează cu Keez" onclick="return confirm(\'Sigur doriți să sincronizați această factură cu Keez?\');">
                        <i class="fas fa-sync"></i>
                    </a>
                    <a href="?module=keez_integration&create_keez_invoice=' . $invoice->id . '" class="btn btn-outline-success" title="Creează în Keez" onclick="return confirm(\'Sigur doriți să creați această factură în Keez?\');">
                        <i class="fas fa-cloud-upload-alt"></i>
                    </a>
                    <a href="?module=keez_integration&create_articles=' . $invoice->id . '" class="btn btn-outline-info" title="Creează articole" onclick="return confirm(\'Sigur doriți să creați articolele pentru această factură?\');">
                        <i class="fas fa-plus-circle"></i>
                    </a>
                    <a href="?module=keez_integration&test_auto_trigger=' . $invoice->id . '" class="btn btn-outline-warning" title="Testează trigger automat" onclick="return confirm(\'Sigur doriți să testați trigger-ul automat pentru această factură?\');">
                        <i class="fas fa-bug"></i>
                    </a>
                </div>
            </td>
        </tr>';
    }

    echo '</tbody>
        </table>
    </div>';

    // Pagination
    $totalPages = ceil($totalInvoices / $perPage);
    if ($totalPages > 1) {
        echo '<nav aria-label="Pagination" class="mt-4">
            <ul class="pagination justify-content-center">';

        // Previous
        if ($page > 1) {
            echo '<li class="page-item">
                <a class="page-link" href="?module=keez_integration&view_invoices=1&page=' . ($page - 1) . '&status=' . urlencode($statusFilter) . '&date_from=' . urlencode($dateFrom) . '&date_to=' . urlencode($dateTo) . '">Anterior</a>
            </li>';
        }

        // Page numbers
        for ($i = max(1, $page - 2); $i <= min($totalPages, $page + 2); $i++) {
            echo '<li class="page-item ' . ($i === $page ? 'active' : '') . '">
                <a class="page-link" href="?module=keez_integration&view_invoices=1&page=' . $i . '&status=' . urlencode($statusFilter) . '&date_from=' . urlencode($dateFrom) . '&date_to=' . urlencode($dateTo) . '">' . $i . '</a>
            </li>';
        }

        // Next
        if ($page < $totalPages) {
            echo '<li class="page-item">
                <a class="page-link" href="?module=keez_integration&view_invoices=1&page=' . ($page + 1) . '&status=' . urlencode($statusFilter) . '&date_from=' . urlencode($dateFrom) . '&date_to=' . urlencode($dateTo) . '">Următor</a>
            </li>';
        }

        echo '</ul>
        </nav>';
    }

    echo '<div class="mt-3 text-muted">
        <small>Total facturi: ' . $totalInvoices . ' | Afișate: ' . count($invoices) . '</small>
    </div>';

    echo '</div></div>';
}

function keez_create_invoice_articles($invoiceId) {
    $service = new KeezInvoiceService();

    echo '<div class="card">
        <div class="card-header">
            <h5><i class="fas fa-plus-circle"></i> Creare articole pentru factură WHMCS ID ' . $invoiceId . '</h5>
            <a href="?module=keez_integration" class="btn btn-secondary btn-sm">
                <i class="fas fa-arrow-left"></i> Înapoi
            </a>
        </div>
        <div class="card-body">';

    try {
        // Get invoice data
        $invoiceData = $service->getInvoiceData($invoiceId);
        if (!$invoiceData) {
            throw new Exception("Invoice data not found for ID: " . $invoiceId);
        }

        $createdCount = 0;
        $errors = [];

        echo '<h6>Procesare articole pentru factură ' . htmlspecialchars($invoiceData['invoicenum']) . ':</h6>';
        echo '<ul class="list-group mb-3">';

        // Determină moneda facturii pentru a crea articolele în moneda corectă
        $invoiceCurrencyCode = $service->getCurrencyCode($invoiceData['currency']);
        logActivity("Keez: Creating articles for invoice with currency: {$invoiceCurrencyCode}");

        foreach ($invoiceData['items'] as $item) {
            $code = 'WHMCS_' . ($item['relid'] ?: $item['id']);
            $description = $item['description'];

            echo '<li class="list-group-item">';
            echo '<strong>' . htmlspecialchars($code) . '</strong> - ' . htmlspecialchars($description);

            if ($service->articleExistsInKeez($code)) {
                echo ' <span class="badge bg-warning">Deja există</span>';
            } else {
                // Creează articolul în moneda facturii (va crea automat și în cealaltă monedă dacă nu există)
                $result = $service->ensureArticleExists($code, $description, KeezConfig::getSettings(), null, $invoiceCurrencyCode);
                if ($result) {
                    echo ' <span class="badge bg-success">Creat cu succes (EUR și RON)</span>';
                    $createdCount++;
                } else {
                    echo ' <span class="badge bg-danger">Eroare la creare</span>';
                    $errors[] = $code . ' - ' . $description;
                }
            }
            echo '</li>';
        }

        echo '</ul>';

        if ($createdCount > 0) {
            echo '<div class="alert alert-success">
                <i class="fas fa-check-circle"></i>
                <strong>Succes!</strong> ' . $createdCount . ' articole create cu succes.
            </div>';
        }

        if (!empty($errors)) {
            echo '<div class="alert alert-warning">
                <i class="fas fa-exclamation-triangle"></i>
                <strong>Atenție:</strong> Următoarele articole nu au putut fi create:<br>
                <ul>';
                foreach ($errors as $error) {
                    echo '<li>' . htmlspecialchars($error) . '</li>';
                }
                echo '</ul>
            </div>';
        }

        echo '<div class="text-center">
            <a href="?module=keez_integration&create_keez_invoice=' . $invoiceId . '" class="btn btn-success">
                <i class="fas fa-cloud-upload-alt"></i> Creează acum factură în Keez
            </a>
        </div>';

    } catch (Exception $e) {
        echo '<div class="alert alert-danger">
            <i class="fas fa-exclamation-triangle"></i>
            <strong>Eroare:</strong> ' . htmlspecialchars($e->getMessage()) . '
        </div>';
    }

    echo '</div></div>';
}

function keez_create_invoice($invoiceId) {
    $service = new KeezInvoiceService();

    echo '<div class="card">
        <div class="card-header">
            <h5><i class="fas fa-cloud-upload-alt"></i> Creare factură în Keez: ID ' . $invoiceId . '</h5>
            <a href="?module=keez_integration" class="btn btn-secondary btn-sm">
                <i class="fas fa-arrow-left"></i> Înapoi
            </a>
        </div>
        <div class="card-body">';

    try {
        $result = $service->createInvoice($invoiceId);

        if ($result) {
            echo '<div class="alert alert-success">
                <i class="fas fa-check-circle"></i>
                <strong>Succes!</strong> Factura a fost creată cu succes în Keez.
            </div>';

            // Get the invoice number to link to details
            $invoice = Capsule::table('tblinvoices')->where('id', $invoiceId)->select('invoicenum')->first();
            if ($invoice && !empty($invoice->invoicenum)) {
                echo '<div class="text-center">
                    <a href="?module=keez_integration&view_invoice=' . urlencode($invoice->invoicenum) . '" class="btn btn-primary">
                        <i class="fas fa-eye"></i> Vezi detaliile facturii în Keez
                    </a>
                </div>';
            }
        } else {
            echo '<div class="alert alert-danger">
                <i class="fas fa-exclamation-triangle"></i>
                <strong>Eroare!</strong> Nu s-a putut crea factura în Keez. Verificați log-urile pentru mai multe detalii.
            </div>';
        }
    } catch (Exception $e) {
        echo '<div class="alert alert-danger">
            <i class="fas fa-exclamation-triangle"></i>
            <strong>Eroare:</strong> ' . htmlspecialchars($e->getMessage()) . '
        </div>';
    }

    echo '</div></div>';
}


function keez_sync_invoice_data() {
    $service = new KeezInvoiceService();

    echo '<div class="card">
        <div class="card-header">
            <h5><i class="fas fa-sync"></i> Sincronizare date facturi din Keez</h5>
            <a href="?module=keez_integration&view_invoices=1" class="btn btn-secondary btn-sm">
                <i class="fas fa-arrow-left"></i> Înapoi la lista facturi
            </a>
        </div>
        <div class="card-body">';

    try {
        // Get recent paid invoices from WHMCS (last 30 days to avoid too much processing)
        $thirtyDaysAgo = date('Y-m-d', strtotime('-30 days'));

        $invoices = Capsule::table('tblinvoices as i')
            ->join('tblclients as c', 'c.id', '=', 'i.userid')
            ->where('i.status', 'Paid')
            ->where('i.date', '>=', $thirtyDaysAgo)
            ->whereNotNull('i.invoicenum')
            ->where('i.invoicenum', '!=', '')
            ->select([
                'i.id', 'i.invoicenum', 'i.date', 'i.total',
                'c.companyname', 'c.firstname', 'c.lastname'
            ])
            ->orderBy('i.id', 'desc')
            ->get();

        if ($invoices->isEmpty()) {
            echo '<div class="alert alert-info">
                <i class="fas fa-info-circle"></i>
                Nu s-au găsit facturi plătite recente de sincronizat.
            </div>';
            echo '</div></div>';
            return;
        }

        echo '<div class="alert alert-info">
            <i class="fas fa-info-circle"></i>
            Se verifică ' . count($invoices) . ' facturi plătite pentru sincronizare...
        </div>';

        $syncCount = 0;
        $errorCount = 0;

        echo '<div class="table-responsive">
            <table class="table table-striped">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Factură WHMCS</th>
                        <th>Client</th>
                        <th>Status Keez</th>
                        <th>Rezultat</th>
                    </tr>
                </thead>
                <tbody>';

        foreach ($invoices as $invoice) {
            $clientName = !empty($invoice->companyname) ?
                $invoice->companyname :
                trim($invoice->firstname . ' ' . $invoice->lastname);

            echo '<tr>
                <td>' . $invoice->id . '</td>
                <td><strong>' . htmlspecialchars($invoice->invoicenum) . '</strong></td>
                <td>' . htmlspecialchars($clientName) . '</td>';

            try {
                // First check if we already know the sync status
                $savedStatus = $service->getSyncStatus($invoice->id);
                logActivity("Keez: Display check for invoice {$invoice->id} - savedStatus: " . ($savedStatus ?: 'null'));

                if ($savedStatus === 'synced') {
                    // Already confirmed as synced - show green status
                    echo '<td><span class="status status-paid"><i class="fas fa-check"></i> Sincronizat</span></td>';
                    echo '<td><span class="status status-pending"><i class="fas fa-question"></i> Necunoscut</span></td>';
                    echo '<td><span class="status status-paid"><i class="fas fa-check-circle"></i> Status salvat</span></td>';
                } elseif ($savedStatus === 'not_found') {
                    // Already checked and not found - show red status
                    echo '<td><span class="status status-unpaid"><i class="fas fa-times"></i> Nu există</span></td>';
                    echo '<td><span class="status status-cancelled"><i class="fas fa-question"></i> N/A</span></td>';
                    echo '<td><span class="status status-unpaid"><i class="fas fa-times-circle"></i> Verificat</span></td>';
                } else {
                    // No saved status - show default "not synced" status
                    echo '<td><span class="status status-unpaid"><i class="fas fa-clock"></i> Nu sincronizat</span></td>';
                    echo '<td><span class="status status-pending"><i class="fas fa-question"></i> Necunoscut</span></td>';
                    echo '<td><span class="status status-pending"><i class="fas fa-sync"></i> Verifică</span></td>';
                }

                // Check if invoice exists in Keez
                $whmcsNumber = $invoice->invoicenum;
                $settings = KeezConfig::getSettings();
                $series = $settings['factura_serie'];
                $number = $whmcsNumber;

                // Extract numeric part
                if (preg_match('/(\d+)$/', $whmcsNumber, $matches)) {
                    $number = $matches[1];
                }

                logActivity("Sync check: WHMCS={$whmcsNumber}, Series={$series}, Number={$number}");

                // Debug: Log what we're searching for
                echo "<!-- Debug: Searching for Series='{$series}', Number='{$number}' from WHMCS='{$whmcsNumber}' -->";

                $keezInvoice = $service->findInvoiceBySeriesAndNumber($series, $number);

                if ($keezInvoice) {
                    // Save sync status to database
                    $service->saveSyncStatus($invoice->id, 'synced', $keezInvoice);

                    echo '<td><span class="status status-paid"><i class="fas fa-check"></i> Există</span></td>';


                    // If the Keez invoice has a different number, update WHMCS
                    $keezInvoiceNumber = $keezInvoice['number'] ?? null;
                    $keezSeries = $keezInvoice['series'] ?? null;
                    $fullKeezInvoiceNumber = $keezInvoiceNumber;
                    if ($keezSeries && $keezInvoiceNumber) {
                        $fullKeezInvoiceNumber = $keezSeries . $keezInvoiceNumber;
                    }

                    if ($fullKeezInvoiceNumber && $fullKeezInvoiceNumber !== $invoice->invoicenum) {
                        Capsule::table('tblinvoices')
                            ->where('id', $invoice->id)
                            ->update(['invoicenum' => $fullKeezInvoiceNumber]);

                        echo '<td><span class="badge bg-info"><i class="fas fa-sync"></i> Actualizat: ' . htmlspecialchars($fullKeezInvoiceNumber) . '</span></td>';
                        $syncCount++;
                    } else {
                        echo '<td><span class="badge bg-success"><i class="fas fa-check"></i> Sincronizat</span></td>';
                    }
                } else {
                    // Mark as checked but not found
                    $service->saveSyncStatus($invoice->id, 'not_found', null);

                    echo '<td><span class="status status-unpaid"><i class="fas fa-times"></i> Nu există</span></td>';
                    echo '<td><span class="status status-cancelled"><i class="fas fa-question"></i> N/A</span></td>';
                    echo '<td><span class="status status-pending"><i class="fas fa-info"></i> Nu necesită sincronizare</span></td>';
                }

            } catch (Exception $e) {
                echo '<td><span class="status status-unpaid"><i class="fas fa-exclamation-triangle"></i> Eroare</span></td>';
                echo '<td><span class="status status-cancelled"><i class="fas fa-question"></i> N/A</span></td>';
                echo '<td><span class="status status-unpaid"><i class="fas fa-exclamation-triangle"></i> ' . htmlspecialchars(substr($e->getMessage(), 0, 50)) . '</span></td>';
                $errorCount++;
            }

            echo '</tr>';
        }

        echo '</tbody>
            </table>
        </div>';

        // Summary
        echo '<div class="alert alert-' . ($syncCount > 0 ? 'success' : 'info') . '">
            <h6><i class="fas fa-chart-bar"></i> Rezumat sincronizare:</h6>
            <ul class="mb-0">
                <li><strong>Facturi verificate:</strong> ' . count($invoices) . '</li>
                <li><strong>Facturi sincronizate:</strong> ' . $syncCount . '</li>
                <li><strong>Erori:</strong> ' . $errorCount . '</li>
            </ul>
        </div>';

        // Afișează informații despre sincronizarea numerelor
        try {
            $keezService = new KeezInvoiceService();
            $nextKeezNumber = $keezService->getNextInvoiceNumberFromKeez();
            if ($nextKeezNumber) {
                $settings = KeezConfig::getSettings();
                $series = $settings['factura_serie'];
                $expectedNumber = $series . $nextKeezNumber;
                
                echo '<div class="alert alert-info">
                    <h6><i class="fas fa-info-circle"></i> Sincronizare numere facturi:</h6>
                    <p class="mb-0">
                        <strong>Ultima factură din Keez:</strong> ' . $series . ($nextKeezNumber - 1) . '<br>
                        <strong>Următorul număr generat:</strong> ' . htmlspecialchars($expectedNumber) . '<br>
                        <small class="text-muted">WHMCS va folosi acest număr pentru următoarea factură sincronizată cu Keez.</small>
                    </p>
                </div>';
            }
        } catch (Exception $e) {
            logActivity("Keez: Error displaying next invoice number info: " . $e->getMessage());
        }

    } catch (Exception $e) {
        echo '<div class="alert alert-danger">
            <i class="fas fa-exclamation-triangle"></i>
            <strong>Eroare la sincronizare:</strong> ' . htmlspecialchars($e->getMessage()) . '
        </div>';
    }

    echo '</div></div>';
}

function keez_test_auto_trigger($invoiceId) {
    echo '<div class="card">
        <div class="card-header">
            <h5><i class="fas fa-bug"></i> Test Trigger Automat - Factura ID ' . $invoiceId . '</h5>
            <a href="?module=keez_integration&view_invoices=1" class="btn btn-secondary btn-sm">
                <i class="fas fa-arrow-left"></i> Înapoi la lista facturi
            </a>
        </div>
        <div class="card-body">';

    try {
        // Obține datele facturii
        $invoice = Capsule::table('tblinvoices as i')
            ->join('tblclients as c', 'c.id', '=', 'i.userid')
            ->where('i.id', $invoiceId)
            ->select([
                'i.id', 'i.invoicenum', 'i.date', 'i.total', 'i.status',
                'c.companyname', 'c.firstname', 'c.lastname'
            ])
            ->first();

        if (!$invoice) {
            throw new Exception("Invoice not found for ID: " . $invoiceId);
        }

        $clientName = !empty($invoice->companyname) ?
            $invoice->companyname :
            trim($invoice->firstname . ' ' . $invoice->lastname);

        echo '<h6>Testare trigger automat pentru: ' . htmlspecialchars($invoice->invoicenum) . ' - ' . htmlspecialchars($clientName) . '</h6>';
        echo '<p><strong>Status actual:</strong> ' . htmlspecialchars($invoice->status) . '</p>';

        // Simulează marcarea ca plătită dacă nu este deja
        if ($invoice->status !== 'Paid') {
            echo '<div class="alert alert-warning">
                <i class="fas fa-exclamation-triangle"></i>
                <strong>Atenție!</strong> Factura nu este plătită. O voi marca ca plătită pentru test.
            </div>';

            // Marchează ca plătită
            Capsule::table('tblinvoices')
                ->where('id', $invoiceId)
                ->update(['status' => 'Paid']);

            logActivity("Test Trigger: Invoice {$invoiceId} marked as Paid for testing");
        }

        // Simulează trigger-ul automat prin LogActivity
        echo '<div class="alert alert-info">
            <i class="fas fa-info-circle"></i>
            <strong>Simulez trigger-ul automat...</strong> Declanșez crearea în Keez prin LogActivity hook.
        </div>';

        // Simulează evenimentul "Invoice Marked Paid"
        $fakeVars = [
            'description' => 'Invoice Marked Paid - Invoice ID: ' . $invoiceId,
            'invoiceid' => $invoiceId
        ];

        // Apelează hook-ul LogActivity manual
        logActivity("Keez Test: Manually triggering LogActivity hook for invoice {$invoiceId}");
        
        // Simulează apelul hook-ului
        if (strpos($fakeVars['description'], 'Invoice Marked Paid') !== false) {
            logActivity("Keez Intercept: Invoice marked paid detected - ID: " . $fakeVars['invoiceid']);
            
            $invoiceId = $fakeVars['invoiceid'] ?? null;
            if ($invoiceId) {
                logActivity("Keez Manual Trigger: Attempting to create invoice in Keez for ID: " . $invoiceId);
                
                try {
                    $keezService = new KeezInvoiceService();
                    $result = $keezService->createInvoice($invoiceId);
                    if ($result) {
                        logActivity("Keez Manual Trigger: Invoice successfully created in Keez for ID: " . $invoiceId);
                        echo '<div class="alert alert-success">
                            <i class="fas fa-check-circle"></i>
                            <strong>Succes!</strong> Factura a fost creată cu succes în Keez prin trigger-ul automat.
                        </div>';
                    } else {
                        logActivity("Keez Manual Trigger: Failed to create invoice in Keez for ID: " . $invoiceId);
                        echo '<div class="alert alert-danger">
                            <i class="fas fa-times-circle"></i>
                            <strong>Eroare!</strong> Nu s-a putut crea factura în Keez.
                        </div>';
                    }
                } catch (Exception $e) {
                    logActivity("Keez Manual Trigger Error for invoice " . $invoiceId . ": " . $e->getMessage());
                    echo '<div class="alert alert-danger">
                        <i class="fas fa-exclamation-triangle"></i>
                        <strong>Eroare!</strong> ' . htmlspecialchars($e->getMessage()) . '
                    </div>';
                }
            }
        }

        echo '<div class="alert alert-info mt-3">
            <i class="fas fa-info-circle"></i>
            <strong>Test completat!</strong> Verifică log-urile pentru detalii despre procesul de creare.
        </div>';

    } catch (Exception $e) {
        echo '<div class="alert alert-danger">
            <i class="fas fa-exclamation-triangle"></i>
            <strong>Eroare la test:</strong> ' . htmlspecialchars($e->getMessage()) . '
        </div>';
    }

    echo '</div></div>';
}

function keez_sync_single_invoice($invoiceId) {
    $service = new KeezInvoiceService();

    echo '<div class="card">
        <div class="card-header">
            <h5><i class="fas fa-sync"></i> Sincronizare factură individuală: ID ' . $invoiceId . '</h5>
            <a href="?module=keez_integration&view_invoices=1" class="btn btn-secondary btn-sm">
                <i class="fas fa-arrow-left"></i> Înapoi la lista facturi
            </a>
        </div>
        <div class="card-body">';

    try {
        // Get invoice data
        $invoice = Capsule::table('tblinvoices as i')
            ->join('tblclients as c', 'c.id', '=', 'i.userid')
            ->where('i.id', $invoiceId)
            ->select([
                'i.id', 'i.invoicenum', 'i.date', 'i.total', 'i.status',
                'c.companyname', 'c.firstname', 'c.lastname'
            ])
            ->first();

        if (!$invoice) {
            throw new Exception("Invoice not found for ID: " . $invoiceId);
        }

        // Verifică dacă factura este plătită înainte de sincronizare
        if ($invoice->status !== 'Paid') {
            echo '<div class="alert alert-warning">
                <i class="fas fa-exclamation-triangle"></i>
                <strong>Atenție!</strong> Factura trebuie să fie plătită înainte de sincronizare cu Keez.<br>
                <strong>Status actual:</strong> ' . htmlspecialchars($invoice->status) . '
            </div>';
            echo '</div></div>';
            return;
        }

        $clientName = !empty($invoice->companyname) ?
            $invoice->companyname :
            trim($invoice->firstname . ' ' . $invoice->lastname);

        echo '<h6>Verificare factură: ' . htmlspecialchars($invoice->invoicenum) . ' - ' . htmlspecialchars($clientName) . '</h6>';

        // Check if invoice exists in Keez
        $whmcsNumber = $invoice->invoicenum;
        $settings = KeezConfig::getSettings();
        $series = $settings['factura_serie'];
        $number = $whmcsNumber;

        // Extract numeric part
        if (preg_match('/(\d+)$/', $whmcsNumber, $matches)) {
            $number = $matches[1];
        }

        $keezInvoice = $service->findInvoiceBySeriesAndNumber($series, $number);

        echo '<div class="table-responsive">
            <table class="table table-bordered">
                <thead class="table-dark">
                    <tr>
                        <th>Factura WHMCS</th>
                        <th>Status Keez</th>
                        <th>Acțiuni</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>';

        echo '<td><strong>' . htmlspecialchars($invoice->invoicenum) . '</strong></td>';

        if ($keezInvoice) {
            // Save sync status to database
            $service->saveSyncStatus($invoice->id, 'synced', $keezInvoice);

            // Show the actual Keez invoice number
            $keezInvoiceNumber = $keezInvoice['number'] ?? null;
            $keezSeries = $keezInvoice['series'] ?? null;
            $fullKeezNumber = $keezInvoiceNumber;
            if ($keezSeries && $keezInvoiceNumber) {
                $fullKeezNumber = $keezSeries . $keezInvoiceNumber;
            }

            echo '<td><span class="badge bg-success"><i class="fas fa-check"></i> ' . htmlspecialchars($fullKeezNumber) . '</span></td>';


            // Actions for existing invoice
            echo '<td>
                <div class="btn-group btn-group-sm">
                    <a href="?module=keez_integration&view_invoice=' . urlencode($keezInvoice['externalId'] ?? $invoice->invoicenum) . '" class="btn btn-outline-info">
                        <i class="fas fa-eye"></i> Vezi în Keez
                    </a>
                </div>
            </td>';

            // Check if WHMCS number needs to be updated
            if ($fullKeezNumber && $fullKeezNumber !== $invoice->invoicenum) {
                Capsule::table('tblinvoices')
                    ->where('id', $invoice->id)
                    ->update(['invoicenum' => $fullKeezNumber]);

                echo '<div class="alert alert-info mt-3">
                    <i class="fas fa-info-circle"></i>
                    Numărul facturii a fost actualizat în WHMCS: ' . htmlspecialchars($invoice->invoicenum) . ' → ' . htmlspecialchars($fullKeezNumber) . '
                </div>';
            }

        } else {
            // Mark as checked but not found
            $service->saveSyncStatus($invoice->id, 'not_found', null);

            echo '<td><span class="badge bg-warning"><i class="fas fa-times"></i> Nu există în Keez</span></td>';
            echo '<td><span class="badge bg-secondary"><i class="fas fa-question"></i> N/A</span></td>';

            // Actions for non-existing invoice
            echo '<td>
                <div class="btn-group btn-group-sm">
                    <a href="?module=keez_integration&create_keez_invoice=' . $invoice->id . '" class="btn btn-outline-success" onclick="return confirm(\'Sigur doriți să creați această factură în Keez?\');">
                        <i class="fas fa-cloud-upload-alt"></i> Creează în Keez
                    </a>
                    <a href="?module=keez_integration&create_articles=' . $invoice->id . '" class="btn btn-outline-info" onclick="return confirm(\'Sigur doriți să creați articolele pentru această factură?\');">
                        <i class="fas fa-plus-circle"></i> Creează articole
                    </a>
                </div>
            </td>';
        }

        echo '</tr>
                </tbody>
            </table>
        </div>';

        echo '<div class="alert alert-success">
            <i class="fas fa-check-circle"></i>
            <strong>Sincronizare completată!</strong> Status-ul facturii a fost verificat și actualizat.
        </div>';

    } catch (Exception $e) {
        echo '<div class="alert alert-danger">
            <i class="fas fa-exclamation-triangle"></i>
            <strong>Eroare la sincronizare:</strong> ' . htmlspecialchars($e->getMessage()) . '
        </div>';
    }

    echo '</div></div>';
}

?>
