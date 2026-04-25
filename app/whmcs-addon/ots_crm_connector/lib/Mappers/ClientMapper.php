<?php
/**
 * Map WHMCS client records to the canonical `WhmcsClientPayload` shape
 * that the OTS CRM `/clients` endpoint expects.
 *
 * TS type reference:
 *   app/src/lib/server/whmcs/types.ts → WhmcsClientPayload
 *
 * WHMCS source: `tblclients` row (via Capsule or hook $vars).
 */

namespace OtsCrm;

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

use Illuminate\Database\Capsule\Manager as Capsule;

class ClientMapper
{
    /**
     * Build payload from a WHMCS userid. Looks up the full client row so we
     * get all fields the CRM side needs (companyname, tax ID, address, …).
     *
     * @param int    $userId  WHMCS client id (= userid in hook $vars)
     * @param string $event   'added' | 'updated'
     */
    public static function fromUserId(int $userId, string $event): ?array
    {
        $row = Capsule::table('tblclients')
            ->where('id', $userId)
            ->first();

        if (!$row) {
            return null;
        }

        return self::fromRow($row, $event);
    }

    /**
     * Build payload from an already-fetched row (stdClass).
     */
    public static function fromRow($row, string $event): array
    {
        $companyName  = isset($row->companyname) ? trim((string)$row->companyname) : '';
        $isLegal      = $companyName !== '';
        $taxId        = self::pickTaxId($row);
        $countyCode   = self::guessCountyCode((string)($row->state ?? ''));

        return [
            'event'         => $event,
            'whmcsClientId' => (int)$row->id,
            'taxId'         => $taxId !== '' ? $taxId : null,
            'companyName'   => $companyName !== '' ? $companyName : null,
            'firstName'     => !empty($row->firstname) ? (string)$row->firstname : null,
            'lastName'      => !empty($row->lastname)  ? (string)$row->lastname  : null,
            'isLegalPerson' => $isLegal,
            'email'         => !empty($row->email) ? (string)$row->email : null,
            'phone'         => !empty($row->phonenumber) ? (string)$row->phonenumber : null,
            'address'       => self::joinAddress((string)($row->address1 ?? ''), (string)($row->address2 ?? '')),
            'city'          => !empty($row->city) ? (string)$row->city : null,
            'countyName'    => !empty($row->state) ? (string)$row->state : null,
            'countyCode'    => $countyCode,
            'postalCode'    => !empty($row->postcode) ? (string)$row->postcode : null,
            'countryCode'   => !empty($row->country) ? strtoupper((string)$row->country) : null,
            'countryName'   => self::countryNameFromCode((string)($row->country ?? '')),
            'status'        => !empty($row->status) ? (string)$row->status : null,
        ];
    }

    /**
     * Extract CUI / VAT ID. WHMCS stores it in `tax_id` on newer installs or
     * in a custom client-field labeled "CUI" / "CIF" on older ones. We try
     * both and normalize away the "RO" prefix (CRM side normalizes too, so
     * either works — but sending bare digits matches how Keez expects it).
     */
    private static function pickTaxId($row): string
    {
        // Newer WHMCS: `tax_id` column
        if (!empty($row->tax_id)) {
            return self::normalizeCui((string)$row->tax_id);
        }

        // Older WHMCS: custom client field
        $fieldIds = Capsule::table('tblcustomfields')
            ->where('type', 'client')
            ->where(function ($q) {
                $q->where('fieldname', 'like', '%CUI%')
                  ->orWhere('fieldname', 'like', '%CIF%')
                  ->orWhere('fieldname', 'like', '%tax%');
            })
            ->pluck('id')
            ->toArray();

        if (!empty($fieldIds)) {
            $val = Capsule::table('tblcustomfieldsvalues')
                ->whereIn('fieldid', $fieldIds)
                ->where('relid', (int)$row->id)
                ->where('value', '!=', '')
                ->value('value');
            if ($val) {
                return self::normalizeCui((string)$val);
            }
        }

        return '';
    }

    private static function normalizeCui(string $raw): string
    {
        $s = strtolower(trim($raw));
        $s = preg_replace('/^ro/', '', $s) ?? '';
        $s = preg_replace('/\D/', '', $s) ?? '';
        return $s;
    }

    private static function joinAddress(string $line1, string $line2): ?string
    {
        $parts = array_filter([trim($line1), trim($line2)], 'strlen');
        if (empty($parts)) return null;
        return implode(', ', $parts);
    }

    /**
     * Romanian counties — WHMCS usually stores the full name in `state`.
     * Return ISO 3166-2 code when we recognize it; otherwise null (CRM
     * accepts null and keeps just the name).
     */
    private static function guessCountyCode(string $state): ?string
    {
        static $map = [
            'alba'               => 'RO-AB',
            'arad'               => 'RO-AR',
            'argeș'              => 'RO-AG', 'arges' => 'RO-AG',
            'bacău'              => 'RO-BC', 'bacau' => 'RO-BC',
            'bihor'              => 'RO-BH',
            'bistrița-năsăud'    => 'RO-BN', 'bistrita-nasaud' => 'RO-BN',
            'botoșani'           => 'RO-BT', 'botosani' => 'RO-BT',
            'brăila'             => 'RO-BR', 'braila' => 'RO-BR',
            'brașov'             => 'RO-BV', 'brasov' => 'RO-BV',
            'bucurești'          => 'RO-B',  'bucuresti' => 'RO-B', 'bucharest' => 'RO-B',
            'buzău'              => 'RO-BZ', 'buzau' => 'RO-BZ',
            'caraș-severin'      => 'RO-CS', 'caras-severin' => 'RO-CS',
            'călărași'           => 'RO-CL', 'calarasi' => 'RO-CL',
            'cluj'               => 'RO-CJ',
            'constanța'          => 'RO-CT', 'constanta' => 'RO-CT',
            'covasna'            => 'RO-CV',
            'dâmbovița'          => 'RO-DB', 'dambovita' => 'RO-DB',
            'dolj'               => 'RO-DJ',
            'galați'             => 'RO-GL', 'galati' => 'RO-GL',
            'giurgiu'            => 'RO-GR',
            'gorj'               => 'RO-GJ',
            'harghita'           => 'RO-HR',
            'hunedoara'          => 'RO-HD',
            'ialomița'           => 'RO-IL', 'ialomita' => 'RO-IL',
            'iași'               => 'RO-IS', 'iasi' => 'RO-IS',
            'ilfov'              => 'RO-IF',
            'maramureș'          => 'RO-MM', 'maramures' => 'RO-MM',
            'mehedinți'          => 'RO-MH', 'mehedinti' => 'RO-MH',
            'mureș'              => 'RO-MS', 'mures' => 'RO-MS',
            'neamț'              => 'RO-NT', 'neamt' => 'RO-NT',
            'olt'                => 'RO-OT',
            'prahova'            => 'RO-PH',
            'sălaj'              => 'RO-SJ', 'salaj' => 'RO-SJ',
            'satu mare'          => 'RO-SM',
            'sibiu'              => 'RO-SB',
            'suceava'            => 'RO-SV',
            'teleorman'          => 'RO-TR',
            'timiș'              => 'RO-TM', 'timis' => 'RO-TM',
            'tulcea'             => 'RO-TL',
            'vâlcea'             => 'RO-VL', 'valcea' => 'RO-VL',
            'vaslui'             => 'RO-VS',
            'vrancea'            => 'RO-VN',
        ];
        $key = strtolower(trim($state));
        return $map[$key] ?? null;
    }

    private static function countryNameFromCode(string $code): ?string
    {
        $c = strtoupper(trim($code));
        if ($c === '') return null;
        if ($c === 'RO') return 'România';
        return $c; // keep ISO code for non-RO; CRM displays it as-is
    }
}
