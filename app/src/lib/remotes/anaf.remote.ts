import { query } from "$app/server";
import * as v from "valibot";

// Schema for CUI validation (Romanian CUI format)
const cuiSchema = v.pipe(
  v.string(),
  v.minLength(2, "CUI trebuie să aibă cel puțin 2 caractere"),
  v.maxLength(20, "CUI nu poate avea mai mult de 20 de caractere"),
  v.regex(/^[0-9]+$/, "CUI trebuie să conțină doar cifre")
);

// Schema for ANAF API response based on the new documentation
const anafResponseSchema = v.object({
  found: v.array(
    v.object({
      date_generale: v.object({
        cui: v.number(),
        data: v.string(),
        denumire: v.string(),
        adresa: v.string(),
        nrRegCom: v.string(),
        telefon: v.optional(v.string()),
        fax: v.optional(v.string()),
        codPostal: v.optional(v.string()),
        act: v.optional(v.string()),
        stare_inregistrare: v.optional(v.string()),
        data_inregistrare: v.optional(v.string()),
        cod_CAEN: v.string(),
        iban: v.optional(v.string()),
        statusRO_e_Factura: v.optional(v.boolean()),
        organFiscalCompetent: v.optional(v.string()),
        forma_de_proprietate: v.optional(v.string()),
        forma_organizare: v.optional(v.string()),
        forma_juridica: v.optional(v.string()),
      }),
      inregistrare_scop_Tva: v.object({
        scpTVA: v.boolean(),
        perioade_TVA: v.object({
          data_inceput_ScpTVA: v.optional(v.string()),
          data_sfarsit_ScpTVA: v.optional(v.string()),
          data_anul_imp_ScpTVA: v.optional(v.string()),
          mesaj_ScpTVA: v.optional(v.string()),
        }),
      }),
      inregistrare_RTVAI: v.object({
        dataInceputTvaInc: v.optional(v.string()),
        dataSfarsitTvaInc: v.optional(v.string()),
        dataActualizareTvaInc: v.optional(v.string()),
        dataPublicareTvaInc: v.optional(v.string()),
        tipActTvaInc: v.optional(v.string()),
        statusTvaIncasare: v.boolean(),
      }),
      stare_inactiv: v.object({
        dataInactivare: v.optional(v.string()),
        dataReactivare: v.optional(v.string()),
        dataPublicare: v.optional(v.string()),
        dataRadiere: v.optional(v.string()),
        statusInactivi: v.boolean(),
      }),
      inregistrare_SplitTVA: v.object({
        dataInceputSplitTVA: v.optional(v.string()),
        dataAnulareSplitTVA: v.optional(v.string()),
        statusSplitTVA: v.boolean(),
      }),
      adresa_sediu_social: v.optional(
        v.object({
          sdenumire_Strada: v.optional(v.string()),
          snumar_Strada: v.optional(v.string()),
          sdenumire_Localitate: v.optional(v.string()),
          scod_Localitate: v.optional(v.string()),
          sdenumire_Judet: v.optional(v.string()),
          scod_Judet: v.optional(v.string()),
          scod_JudetAuto: v.optional(v.string()),
          stara: v.optional(v.string()),
          sdetalii_Adresa: v.optional(v.string()),
          scod_Postal: v.optional(v.string()),
        })
      ),
      adresa_domiciliu_fiscal: v.optional(
        v.object({
          ddenumire_Strada: v.optional(v.string()),
          dnumar_Strada: v.optional(v.string()),
          ddenumire_Localitate: v.optional(v.string()),
          dcod_Localitate: v.optional(v.string()),
          ddenumire_Judet: v.optional(v.string()),
          dcod_Judet: v.optional(v.string()),
          dcod_JudetAuto: v.optional(v.string()),
          dtara: v.optional(v.string()),
          ddetalii_Adresa: v.optional(v.string()),
          dcod_Postal: v.optional(v.string()),
        })
      ),
    })
  ),
  notFound: v.array(v.string()),
});

export const getCompanyData = query(cuiSchema, async (cui) => {
  try {
    const apiUrl =
      process.env.ANAF_API_URL ||
      "https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva";

    // Format the request body according to the new API specification
    const requestBody = [
      {
        cui: parseInt(cui),
        data: new Date().toISOString().split("T")[0], // YYYY-MM-DD format
      },
    ];

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(
        `Eroare la conectarea la API-ul ANAF: ${response.status}`
      );
    }

    const data = await response.json();

    // Validate response structure
    const validatedData = v.parse(anafResponseSchema, data);

    if (validatedData.found.length === 0) {
      throw new Error("CUI-ul nu a fost găsit în baza de date ANAF");
    }

    const company = validatedData.found[0];

    // Return structured company data based on the new API structure
    return {
      cui: company.date_generale.cui,
      denumire: company.date_generale.denumire,
      adresa: company.date_generale.adresa,
      nrRegCom: company.date_generale.nrRegCom,
      telefon: company.date_generale.telefon || "",
      fax: company.date_generale.fax || "",
      codPostal: company.date_generale.codPostal || "",
      cod_CAEN: company.date_generale.cod_CAEN,
      iban: company.date_generale.iban || "",
      statusRO_e_Factura: company.date_generale.statusRO_e_Factura || false,
      organFiscalCompetent: company.date_generale.organFiscalCompetent || "",
      forma_de_proprietate: company.date_generale.forma_de_proprietate || "",
      forma_organizare: company.date_generale.forma_organizare || "",
      forma_juridica: company.date_generale.forma_juridica || "",
      stare_inregistrare: company.date_generale.stare_inregistrare || "",
      data_inregistrare: company.date_generale.data_inregistrare || "",
      // TVA related data
      scpTVA: company.inregistrare_scop_Tva.scpTVA,
      data_inceput_ScpTVA:
        company.inregistrare_scop_Tva.perioade_TVA.data_inceput_ScpTVA || "",
      data_sfarsit_ScpTVA:
        company.inregistrare_scop_Tva.perioade_TVA.data_sfarsit_ScpTVA || "",
      data_anul_imp_ScpTVA:
        company.inregistrare_scop_Tva.perioade_TVA.data_anul_imp_ScpTVA || "",
      mesaj_ScpTVA:
        company.inregistrare_scop_Tva.perioade_TVA.mesaj_ScpTVA || "",
      // TVA la incasare
      statusTvaIncasare: company.inregistrare_RTVAI.statusTvaIncasare,
      dataInceputTvaInc: company.inregistrare_RTVAI.dataInceputTvaInc || "",
      dataSfarsitTvaInc: company.inregistrare_RTVAI.dataSfarsitTvaInc || "",
      dataActualizareTvaInc:
        company.inregistrare_RTVAI.dataActualizareTvaInc || "",
      dataPublicareTvaInc: company.inregistrare_RTVAI.dataPublicareTvaInc || "",
      tipActTvaInc: company.inregistrare_RTVAI.tipActTvaInc || "",
      // Status inactiv
      statusInactivi: company.stare_inactiv.statusInactivi,
      dataInactivare: company.stare_inactiv.dataInactivare || "",
      dataReactivare: company.stare_inactiv.dataReactivare || "",
      dataPublicare: company.stare_inactiv.dataPublicare || "",
      dataRadiere: company.stare_inactiv.dataRadiere || "",
      // Split TVA
      statusSplitTVA: company.inregistrare_SplitTVA.statusSplitTVA,
      dataInceputSplitTVA:
        company.inregistrare_SplitTVA.dataInceputSplitTVA || "",
      dataAnulareSplitTVA:
        company.inregistrare_SplitTVA.dataAnulareSplitTVA || "",
      // Addresses
      adresa_sediu_social: company.adresa_sediu_social || null,
      adresa_domiciliu_fiscal: company.adresa_domiciliu_fiscal || null,
      data: company.date_generale.data,
    };
  } catch (error) {
    console.error(error);
    if (error instanceof v.ValiError) {
      throw new Error("Datele primite de la ANAF nu sunt valide");
    }
    throw error;
  }
});
