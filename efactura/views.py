from rest_framework.generics import RetrieveAPIView
from rest_framework.views import APIView
from .serializers import EfacturaSerializer
from invoices.models import Invoice
from rest_framework_xml.renderers import XMLRenderer
from rest_framework.response import Response
from django.http import HttpResponse
from company.models import Company
from .spv import (
    upload_to_spv,
    get_invoices_from_spv,
    get_invoice_from_spv,
    syncronize_expenses_with_spv,
    syncronize_invoices_sent_with_spv,
)


##create the view but the result is and xml
class EfacturaView(RetrieveAPIView):
    queryset = Invoice.objects.all()
    serializer_class = EfacturaSerializer
    lookup_field = "number"
    lookup_url_kwarg = "number"
    renderer_classes = [XMLRenderer]

    def get_serializer(self, *args, **kwargs):
        return EfacturaSerializer()

    ##override the serialization method
    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance)
        return Response(serializer.serialize(instance))


##create view for downloading the xml
class EfacturaDownloadView(RetrieveAPIView):
    queryset = Invoice.objects.all()
    serializer_class = EfacturaSerializer
    lookup_field = "number"
    lookup_url_kwarg = "number"

    def get_serializer(self, *args, **kwargs):
        return EfacturaSerializer()

    ##override the serialization method
    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance)
        response = HttpResponse(
            serializer.serialize(instance), content_type="text/xml"
        )
        response["Content-Disposition"] = (
            f"attachment; filename={instance.number}.xml"
        )
        return response


class UploadInvoiceToSPV(APIView):
    def post(self, request, *args, **kwargs):
        invoice_id = request.data.get("invoice_id")
        user_id = request.user.id
        try:
            data = upload_to_spv(invoice_id, user_id)
            return Response(data)
        except Exception as e:
            return Response({"error": [str(e)]}, status=400)


class GetInvoicesFromSPV(APIView):
    def get(self, request, *args, **kwargs):
        company = Company.objects.first()
        user_id = request.user.id
        # try:
        data = get_invoices_from_spv(company.data.vat_id, user_id)
        return Response(data)
        # except Exception as e:
        # return Response({"error": [str(e)]}, status=400)


class GetInvoiceFromSPV(APIView):
    def get(self, request, *args, **kwargs):
        invoice_id = request.query_params.get("invoice_id")
        user_id = request.user.id
        # try:
        data = get_invoice_from_spv(invoice_id, user_id)
        return Response(data)
        # except Exception as e:
        # return Response({"error": [str(e)]}, status=400)


class SyncronizeExpensesWithSPV(APIView):
    def post(self, request, *args, **kwargs):
        user_id = request.user.id
        company = Company.objects.first()
        # try:
        data = syncronize_expenses_with_spv(company.data.vat_id, user_id)
        return Response(
            {
                "message": "Expenses syncronized with SPV",
                "data": data,
            }
        )
        # except Exception as e:
        #     return Response({"error": [str(e)]}, status=400)


class SyncronizeSentInvoicesWithSPV(APIView):
    def get(self, request, *args, **kwargs):
        user_id = request.user.id
        company = Company.objects.first()
        # try:
        data = syncronize_invoices_sent_with_spv(company.data.vat_id, user_id)
        return Response(
            {
                "message": "Sent invoices syncronized with SPV",
                "data": data,
            }
        )
        # except Exception as e:
        #     return Response({"error": [str(e)]}, status=400)
