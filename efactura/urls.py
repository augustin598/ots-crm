from django.urls import re_path, path
from .views import (
    EfacturaView,
    EfacturaDownloadView,
    SyncronizeExpensesWithSPV,
    UploadInvoiceToSPV,
    GetInvoiceFromSPV,
    GetInvoicesFromSPV,
    SyncronizeSentInvoicesWithSPV,
)

urlpatterns = [
    path(
        "<str:number>.xml",
        EfacturaView.as_view(),
        name="efactura-download",
    ),
    path(
        "<str:number>",
        EfacturaDownloadView.as_view(),
        name="efactura",
    ),
    path(
        "spv/syncronize",
        SyncronizeExpensesWithSPV.as_view(),
        name="syncronize-expenses-with-spv",
    ),
    path(
        "spv/syncronize/sent",
        SyncronizeSentInvoicesWithSPV.as_view(),
        name="syncronize-sent-invoices-with-spv",
    ),
    path(
        "spv/upload",
        UploadInvoiceToSPV.as_view(),
        name="upload-invoice-to-spv",
    ),
    path(
        "spv/invoice",
        GetInvoiceFromSPV.as_view(),
        name="get-invoice-from-spv",
    ),
    path(
        "spv/invoices",
        GetInvoicesFromSPV.as_view(),
        name="get-invoices-from-spv",
    ),
]
