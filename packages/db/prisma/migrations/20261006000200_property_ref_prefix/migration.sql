-- Booking references are unique per tenant and start each property's sequence at 1, so two
-- properties of one tenant must not share a reference prefix (BR-19).
CREATE UNIQUE INDEX "property_tenant_id_booking_ref_prefix_key" ON "property"("tenant_id", "booking_ref_prefix");
