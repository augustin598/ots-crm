from .serializers import EfacturaSerializer
from invoices.models import Invoice
from expenses.serializers import ExpenseSerializer
from expenses.models import Expense
from .oauth import get_spv_access_token
import requests
import zipfile
from providers.models import Provider, Company
from providers.serializers import ProviderSerializer
from datetime import datetime
from documents.models import File
from io import BytesIO
import xml


def check_for_error(data):
    ##error is like this
    # {'eroare': 'Nu exista mesaje in ultimele 30 zile', 'titlu': 'Lista Mesaje'}
    print(data)
    if "eroare" in data:
        raise Exception(data["eroare"])
    return data


def parse_spv_response(data):
    check_for_error(data)
    return data["mesaje"]


def get_company_from_spv(vat_id: str):
    date = datetime.now()
    current_date = date.strftime("%Y-%m-%d")

    payload = [{"cui": vat_id.replace("RO", ""), "data": current_date}]

    response = requests.post(
        "https://webservicesp.anaf.ro/PlatitorTvaRest/api/v8/ws/tva",
        json=payload,
    )

    data = response.json()

    if len(data["found"]) == 0:
        response = {"detail": "Not Found"}
    else:
        found_data = data["found"][0]
        parsed = {
            "name": found_data.get("date_generale").get("denumire"),
            "address": found_data.get("date_generale").get("adresa"),
            "country": "Romania",
            "vat_id": found_data.get("date_generale").get("cui"),
            "reg_no": found_data.get("date_generale").get("nrRegCom"),
            "phone": found_data.get("date_generale").get("telefon"),
            "status": not found_data.get("stare_inactiv").get(
                "statusInactivi", False
            ),
            "tax_id": (
                f"RO{found_data.get('date_generale').get('cui')}"
                if found_data.get("inregistrare_scop_Tva").get("scpTVA")
                else ""
            ),
            "county": found_data.get("adresa_sediu_social").get(
                "sdenumire_Judet"
            ),
            "city": found_data.get("adresa_sediu_social").get(
                "sdenumire_Localitate"
            ),
            "street": found_data.get("adresa_sediu_social").get(
                "sdenumire_Strada"
            ),
            "street_number": found_data.get("adresa_sediu_social").get(
                "snumar_Strada"
            ),
            "postal_code": found_data.get("adresa_sediu_social").get(
                "scod_Postal"
            ),
        }

        response = parsed
    return response


def upload_to_spv(invoice_id: int, user_id: int):
    invoice = Invoice.objects.get(id=invoice_id)
    serializer = EfacturaSerializer()
    data = serializer.serialize(invoice)
    is_external = invoice.client.is_external

    token = get_spv_access_token(user_id)
    response = requests.post(
        f"https://api.anaf.ro/prod/FCTEL/rest/upload?standard=UBL&cif={invoice.company.data.vat_id}{is_external and '&extern=DA' or ''}",
        data=data.encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/xml; charset=utf-8",
        },
    )
    response.raise_for_status()

    data = response.text
    data = xml.etree.ElementTree.fromstring(data)
    index_incarcare = data.attrib.get("index_incarcare")
    invoice.spv_id = index_incarcare
    invoice.save()
    return {"index_incarcare": index_incarcare}


def get_invoices_from_spv(vat_id: int, user_id: int, filter="P"):
    token = get_spv_access_token(user_id)
    response = requests.get(
        f"https://api.anaf.ro/prod/FCTEL/rest/listaMesajeFactura?zile=60&cif={vat_id}&filtru={filter}",
        headers={"Authorization": f"Bearer {token}"},
    )
    print(response)
    response.raise_for_status()

    data = response.json()
    return parse_spv_response(data)


def get_invoice_from_spv(invoice_id: int, user_id: int):
    token = get_spv_access_token(user_id)
    response = requests.get(
        f"https://api.anaf.ro/prod/FCTEL/rest/descarcare?id={invoice_id}",
        headers={"Authorization": f"Bearer {token}"},
    )

    ##the response contains a .zip file
    content = response.content
    ##decompress the zip file and return the .xml file
    xml_file = BytesIO(content)
    with zipfile.ZipFile(BytesIO(content)) as z:
        for filename in z.namelist():
            if filename.endswith(".xml") and not filename.startswith(
                "semnatura"
            ):
                content = z.read(filename)
                break

    return xml_file, content


def syncronize_expenses_with_spv(vat_id: str, user_id: int):
    invoices = get_invoices_from_spv(vat_id, user_id)
    efactura_serializer = EfacturaSerializer()
    data = []
    ids = [invoice["id"] for invoice in invoices]
    synced_expenses = Expense.objects.filter(spv_id__in=ids)
    synced_ids = [expense.spv_id for expense in synced_expenses]
    for invoice in invoices:
        if invoice["id"] not in synced_ids:
            file, result = get_invoice_from_spv(invoice["id"], user_id)
            data.append(
                (
                    {
                        **efactura_serializer.deserialize(result),
                        "id": invoice["id"],
                    },
                    file,
                )
            )

    for entry in data:
        invoice, file = entry
        provider = Provider.objects.filter(
            company__vat_id=invoice["vat_id"].replace("RO", "")
        ).first()
        if provider:
            invoice["provider"] = provider.id
        else:
            company_from_spv = get_company_from_spv(invoice["vat_id"])
            parsed_provider = {
                "name": company_from_spv.get("name"),
                "address": company_from_spv.get("address"),
                "phone": company_from_spv.get("phone"),
                "email": company_from_spv.get("email"),
                "company": {
                    "vat_id": company_from_spv.get("vat_id"),
                    "tax_id": company_from_spv.get("tax_id"),
                    "reg_no": company_from_spv.get("reg_no"),
                },
            }
            provider_serializer = ProviderSerializer(data=parsed_provider)
            provider_serializer.is_valid(raise_exception=True)
            provider = provider_serializer.save()
            invoice["provider"] = provider.id
        new_file = File()
        new_file.file.save(f"{invoice['number']}.zip", file)
        new_file.name = f"{invoice['number']}.zip"
        new_file.file_type = "application/zip"
        new_file.save()
        expense = {
            "name": invoice["name"],
            "amount": invoice["total"],
            "currency": invoice["currency"],
            "date": invoice["created_on"],
            "provider": invoice["provider"],
            "invoice": new_file.id,
            "category": None,
            "spv_id": invoice["id"],
        }
        expense_serializer = ExpenseSerializer(data=expense)

        expense_serializer.is_valid(raise_exception=True)
        expense_serializer.save()


def syncronize_invoices_sent_with_spv(vat_id: str, user_id: int):
    invoices = get_invoices_from_spv(vat_id, user_id, "T")
    efactura_serializer = EfacturaSerializer()
    data = []
    ids = [invoice["id"] for invoice in invoices]
    synced_invoices = Invoice.objects.filter(spv_id__in=ids)
    synced_ids = [invoice.spv_id for invoice in synced_invoices]
    for invoice in invoices:
        if invoice["id"] not in synced_ids:
            file, result = get_invoice_from_spv(invoice["id"], user_id)
            data.append(
                (
                    {
                        **efactura_serializer.deserialize(result),
                        "id": invoice["id"],
                    },
                    file,
                )
            )

    for entry in data:
        invoice, file = entry
        provider = Provider.objects.filter(
            company__vat_id=invoice["vat_id"].replace("RO", "")
        ).first()
        if provider:
            invoice["provider"] = provider.id
        else:
            company_from_spv = get_company_from_spv(invoice["vat_id"])
            parsed_provider = {
                "name": company_from_spv.get("name"),
                "address": company_from_spv.get("address"),
                "phone": company_from_spv.get("phone"),
                "email": company_from_spv.get("email"),
                "company": {
                    "vat_id": company_from_spv.get("vat_id"),
                    "tax_id": company_from_spv.get("tax_id"),
                    "reg_no": company_from_spv.get("reg_no"),
                },
            }
            provider_serializer = ProviderSerializer(data=parsed_provider)
            provider_serializer.is_valid(raise_exception=True)
            provider = provider_serializer.save()

        invoice_from_db = Invoice.objects.filter(
            number=invoice["number"]
        ).first()
        if invoice_from_db:
            invoice_from_db.spv_id = invoice["id"]
            invoice_from_db.save()

    return data
