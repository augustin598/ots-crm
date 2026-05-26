CREATE UNIQUE INDEX hosting_inquiry_tenant_order_idx
  ON hosting_inquiry(tenant_id, order_number);
