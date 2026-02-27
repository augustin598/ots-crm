#!/bin/bash
# Script to download all Keez API documentation pages as markdown
# Usage: cd documentatiekeez && bash download-keez-docs.sh

BASE_URL="https://app.keez.ro/help/api"
OUTPUT_DIR="$(dirname "$0")"

# List of all documentation pages (unique .html files from content.html)
PAGES=(
  "index.html"
  "content.html"
  "general.html"
  "api_usage_info.html"
  "auth.html"
  "item.html"
  "item_categories.html"
  "item_lists.html"
  "item_list.html"
  "item_create.html"
  "item_replace.html"
  "item_patch.html"
  "invoice.html"
  "invoice_lists.html"
  "invoice_list.html"
  "invoice_create.html"
  "invoice_update.html"
  "invoice_delete.html"
  "invoice_validate.html"
  "invoice_submit_efactura.html"
  "invoice_cancel.html"
  "invoice_deliver_by_email.html"
  "invoice_download_pdf.html"
  "data_models.html"
  "data_models_auth.html"
  "data_models_item.html"
  "data_models_invoice_list.html"
  "data_models_invoice_header.html"
  "data_models_invoice_details.html"
  "data_models_partner.html"
  "data_models_legal_partner.html"
  "data_models_nonlegal_partner.html"
  "data_models_storno.html"
  "data_models_error.html"
  "data_measure_unit.html"
  "data_payment_type.html"
  "examples.html"
  "example_RON_RON.html"
  "example_EUR_EUR.html"
  "example_EUR_RON.html"
  "example_RON_RON_w_discount_details_percent.html"
  "example_RON_RON_w_discount_details_value.html"
  "example_RON_RON_w_discount_header_percent.html"
  "example_RON_RON_w_discount_header_value_gross.html"
  "example_RON_RON_w_discount_header_value_net.html"
  "example_storno.html"
)

echo "Downloading ${#PAGES[@]} Keez API documentation pages..."
echo "Output directory: $OUTPUT_DIR"
echo ""

downloaded=0
failed=0

for page in "${PAGES[@]}"; do
  url="${BASE_URL}/${page}"
  output_file="${OUTPUT_DIR}/${page}"

  echo -n "Downloading ${page}... "

  if curl -s -f -o "$output_file" "$url"; then
    echo "OK"
    ((downloaded++))
  else
    echo "FAILED"
    ((failed++))
  fi
done

echo ""
echo "Done! Downloaded: $downloaded, Failed: $failed"
echo "Files saved to: $OUTPUT_DIR"
