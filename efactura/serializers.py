from xml.etree import ElementTree as etree
from invoices.models import Invoice
from clients.models import Client, CompanyData
from company.models import Company, Data
from bank_accounts.models import BankAccount
from .utils import get_county_code
from typing import Dict


class EfacturaSerializer(object):
    def initialize(self) -> etree.Element:
        attributes = {
            "xmlns": "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
            "xmlns:cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
            "xmlns:cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
            "xmlns:ccts": "urn:un:unece:uncefact:documentation:2",
            "xmlns:udt": "urn:oasis:names:specification:ubl:schema:xsd:UnqualifiedDataTypes-2",
            "xmlns:qdt": "urn:oasis:names:specification:ubl:schema:xsd:QualifiedDataTypes-2",
        }
        invoice = etree.Element("Invoice", **attributes)
        etree.SubElement(invoice, "cbc:UBLVersionID").text = "2.1"
        etree.SubElement(invoice, "cbc:CustomizationID").text = (
            "urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1"
        )
        return invoice

    def serialize(self, invoice: Invoice) -> str:
        client: Client = invoice.client
        client_company_data: CompanyData = client.company
        client_bank_accounts: list[BankAccount] = client.bank_accounts.all()
        my_company: Company = invoice.company
        my_company_data: Data = invoice.company.data
        my_bank_accounts: list[BankAccount] = my_company.bank_accounts.all()
        tax_rate = invoice.settings.tax_rate

        invoice_element = self.initialize()
        etree.SubElement(invoice_element, "cbc:ID").text = invoice.number
        etree.SubElement(invoice_element, "cbc:IssueDate").text = (
            invoice.created_on.strftime("%Y-%m-%d")
        )
        etree.SubElement(invoice_element, "cbc:DueDate").text = (
            invoice.due_date.strftime("%Y-%m-%d")
        )
        etree.SubElement(invoice_element, "cbc:InvoiceTypeCode").text = "380"
        if not my_company_data.tax_id:
            etree.SubElement(invoice_element, "cbc:Note").text = (
                "Regim special de scutire pentru intreprinderile mici"
            )
        etree.SubElement(invoice_element, "cbc:DocumentCurrencyCode").text = (
            invoice.currency
        )
        if my_company_data.tax_id:
            etree.SubElement(invoice_element, "cbc:TaxCurrencyCode").text = (
                invoice.currency
            )

        # invoice_period = etree.SubElement(invoice_element, "cac:InvoicePeriod")
        # etree.SubElement(
        #     invoice_period, "cbc:EndDate"
        # ).text = invoice.due_date.strftime("%Y-%m-%d")
        # etree.SubElement(
        #     invoice_period, "cbc:IssueDate"
        # ).text = invoice.created_on.strftime("%Y-%m-%d")

        ##invoice type code

        """
        invoice_period = etree.SubElement(invoice, "cac:InvoicePeriod")
        etree.SubElement(invoice_element, "cbc:StartDate").text = "2022-06-01"
        etree.SubElement(invoice_element, "cbc:EndDate").text = "2022-06-30"
        """

        # Add accounting supplier party
        accounting_supplier_party = etree.SubElement(
            invoice_element, "cac:AccountingSupplierParty"
        )
        party = etree.SubElement(accounting_supplier_party, "cac:Party")
        party_name = etree.SubElement(party, "cac:PartyName")
        etree.SubElement(party_name, "cbc:Name").text = my_company.name
        postal_address = etree.SubElement(party, "cac:PostalAddress")
        etree.SubElement(postal_address, "cbc:StreetName").text = (
            my_company.address
        )
        etree.SubElement(postal_address, "cbc:CityName").text = my_company.city
        etree.SubElement(postal_address, "cbc:PostalZone").text = getattr(
            my_company, "postal_code", "None"
        )
        etree.SubElement(postal_address, "cbc:CountrySubentity").text = (
            f"RO-{get_county_code(my_company.county.lower())}"  # my_company.country
        )
        country = etree.SubElement(postal_address, "cac:Country")
        etree.SubElement(country, "cbc:IdentificationCode").text = "RO"
        if my_company_data.tax_id:
            party_tax_scheme = etree.SubElement(party, "cac:PartyTaxScheme")
            etree.SubElement(party_tax_scheme, "cbc:CompanyID").text = (
                f"{my_company_data.tax_id}"
            )
            tax_scheme = etree.SubElement(party_tax_scheme, "cac:TaxScheme")
            etree.SubElement(tax_scheme, "cbc:ID").text = "VAT"
        # party_tax_scheme = etree.SubElement(party, "cac:PartyTaxScheme")
        # etree.SubElement(
        #     party_tax_scheme, "cbc:CompanyID"
        # ).text = my_company_data.vat_id
        # tax_scheme = etree.SubElement(party_tax_scheme, "cac:TaxScheme")
        # if my_company_data.tax_id:
        #     etree.SubElement(tax_scheme, "cbc:ID").text = "VAT"
        legal_entity = etree.SubElement(party, "cac:PartyLegalEntity")
        etree.SubElement(legal_entity, "cbc:RegistrationName").text = (
            my_company.name
        )
        etree.SubElement(legal_entity, "cbc:CompanyID").text = (
            f"{my_company_data.vat_id}"
        )
        etree.SubElement(legal_entity, "cbc:CompanyLegalForm").text = (
            my_company.name
        )

        contact = etree.SubElement(party, "cac:Contact")
        etree.SubElement(contact, "cbc:ElectronicMail").text = my_company.email

        accounting_customer_party = etree.SubElement(
            invoice_element, "cac:AccountingCustomerParty"
        )
        party = etree.SubElement(accounting_customer_party, "cac:Party")
        party_name = etree.SubElement(party, "cac:PartyName")
        etree.SubElement(party_name, "cbc:Name").text = client.name
        postal_address = etree.SubElement(party, "cac:PostalAddress")
        etree.SubElement(postal_address, "cbc:StreetName").text = (
            client.address
        )
        etree.SubElement(postal_address, "cbc:CityName").text = client.city
        etree.SubElement(postal_address, "cbc:PostalZone").text = getattr(
            client, "postal_code", "None"
        )
        etree.SubElement(postal_address, "cbc:CountrySubentity").text = (
            f"RO-{get_county_code(client.county.lower())}"  # client.country
        )
        country = etree.SubElement(postal_address, "cac:Country")
        etree.SubElement(country, "cbc:IdentificationCode").text = "RO"

        legal_entity = etree.SubElement(party, "cac:PartyLegalEntity")
        etree.SubElement(legal_entity, "cbc:RegistrationName").text = (
            client.name
        )
        etree.SubElement(legal_entity, "cbc:CompanyID").text = (
            client_company_data.vat_id
        )
        contact = etree.SubElement(party, "cac:Contact")
        etree.SubElement(contact, "cbc:ElectronicMail").text = client.email

        # Add payment means
        payment_means = etree.SubElement(invoice_element, "cac:PaymentMeans")
        etree.SubElement(payment_means, "cbc:PaymentMeansCode").text = "ZZZ"

        payee_financial_account = etree.SubElement(
            payment_means, "cac:PayeeFinancialAccount"
        )
        etree.SubElement(payee_financial_account, "cbc:ID").text = (
            my_bank_accounts[0].iban
        )

        etree.SubElement(payee_financial_account, "cbc:Name").text = (
            my_bank_accounts[0].bank
        )

        tax_total = etree.SubElement(invoice_element, "cac:TaxTotal")
        etree.SubElement(tax_total, "cbc:TaxAmount", currencyID="RON").text = (
            str(round(float(invoice.tax), 2))
        )
        for line in invoice.items:
            tax_subtotal = etree.SubElement(tax_total, "cac:TaxSubtotal")
            etree.SubElement(
                tax_subtotal, "cbc:TaxableAmount", currencyID="RON"
            ).text = str(float(line["amount"] * line["quantity"]))
            etree.SubElement(
                tax_subtotal, "cbc:TaxAmount", currencyID="RON"
            ).text = str(
                round(
                    float(
                        (line["amount"] * line["quantity"] / 100) * tax_rate
                    ),
                    2,
                )
            )
            tax_category = etree.SubElement(tax_subtotal, "cac:TaxCategory")
            etree.SubElement(tax_category, "cbc:ID").text = (
                "S" if my_company_data.tax_id else "O"
            )
            if my_company_data.tax_id:
                etree.SubElement(tax_category, "cbc:Percent").text = str(
                    tax_rate
                )

            if not my_company_data.tax_id:
                etree.SubElement(
                    tax_category, "cbc:TaxExemptionReasonCode"
                ).text = "VATEX-EU-O"
                etree.SubElement(
                    tax_category, "cbc:TaxExemptionReason"
                ).text = "Regim special de scutire pentru intreprinderile mici"
            tax_scheme = etree.SubElement(tax_category, "cac:TaxScheme")
            etree.SubElement(tax_scheme, "cbc:ID").text = "VAT"

        legal_monetary_total = etree.SubElement(
            invoice_element, "cac:LegalMonetaryTotal"
        )
        etree.SubElement(
            legal_monetary_total, "cbc:LineExtensionAmount", currencyID="RON"
        ).text = str(round(float(invoice.sub_total), 2))
        etree.SubElement(
            legal_monetary_total, "cbc:TaxExclusiveAmount", currencyID="RON"
        ).text = str(round(float(invoice.sub_total), 2))
        etree.SubElement(
            legal_monetary_total, "cbc:TaxInclusiveAmount", currencyID="RON"
        ).text = str(round(float(invoice.total), 2))
        etree.SubElement(
            legal_monetary_total, "cbc:PayableAmount", currencyID="RON"
        ).text = str(round(float(invoice.total), 2))

        for index, line in enumerate(invoice.items):
            invoice_line = etree.SubElement(invoice_element, "cac:InvoiceLine")
            etree.SubElement(invoice_line, "cbc:ID").text = str(index + 1)
            etree.SubElement(
                invoice_line, "cbc:InvoicedQuantity", unitCode="XZZ"
            ).text = str(line["quantity"])
            etree.SubElement(
                invoice_line, "cbc:LineExtensionAmount", currencyID="RON"
            ).text = str(round(float(line["amount"] * line["quantity"]), 2))

            item = etree.SubElement(invoice_line, "cac:Item")
            etree.SubElement(item, "cbc:Name").text = line["name"]
            # sellers_item_identification = etree.SubElement(
            #     item, "cac:SellersItemIdentification"
            # )
            # etree.SubElement(
            #     sellers_item_identification, "cbc:ID"
            # ).text = getattr(line, "code", "1")
            # commodity_classification = etree.SubElement(
            #     item, "cac:CommodityClassification"
            # )
            # etree.SubElement(
            #     commodity_classification,
            #     "cbc:ItemClassificationCode",
            #     listID="STI",
            # ).text = getattr(line, "code", "1")
            classified_tax_category = etree.SubElement(
                item, "cac:ClassifiedTaxCategory"
            )
            etree.SubElement(classified_tax_category, "cbc:ID").text = (
                "S" if my_company_data.tax_id else "O"
            )
            if my_company_data.tax_id:
                etree.SubElement(
                    classified_tax_category, "cbc:Percent"
                ).text = str(tax_rate)
            tax_scheme = etree.SubElement(
                classified_tax_category, "cac:TaxScheme"
            )
            etree.SubElement(tax_scheme, "cbc:ID").text = "VAT"
            price = etree.SubElement(invoice_line, "cac:Price")
            etree.SubElement(
                price, "cbc:PriceAmount", currencyID="RON"
            ).text = str(round(float(line["amount"]), 2))
            etree.SubElement(
                price, "cbc:BaseQuantity", unitCode="XZZ"
            ).text = str(round(float(line["quantity"]), 2))

        return etree.tostring(
            invoice_element,
            xml_declaration=True,
            encoding="UTF-8",
        ).decode("utf-8")

    def deserialize(self, xml: str) -> Dict[str, str]:
        invoice = {}
        root = etree.fromstring(xml)
        ns = {
            "cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
        }
        invoice["number"] = root.find(".//cbc:ID", ns).text
        invoice["created_on"] = root.find(".//cbc:IssueDate", ns).text
        invoice["due_date"] = root.find(".//cbc:DueDate", ns).text
        invoice["currency"] = root.find(".//cbc:DocumentCurrencyCode", ns).text
        invoice["sub_total"] = root.find(".//cbc:LineExtensionAmount", ns).text
        invoice["name"] = root.find(".//cbc:Name", ns).text
        invoice["total"] = root.find(".//cbc:PayableAmount", ns).text
        invoice["vat_id"] = root.find(
            ##supplier party company id
            ".//cbc:CompanyID",
            ns,
        ).text

        return invoice
