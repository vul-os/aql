-- =====================================================
-- Auto-Generate Invoice PDF Trigger
-- =====================================================
-- Automatically generates PDF and sends email when invoice is created
-- Works with PDF service at /api/send-invoice-email

-- Trigger function to generate invoice PDF
CREATE OR REPLACE FUNCTION trigger_generate_invoice_pdf()
RETURNS TRIGGER AS $$
DECLARE
    v_pdf_service_url TEXT;
    v_request_id BIGINT;
    v_payload JSONB;
BEGIN
    -- Only process if invoice is newly created or status changed to 'sent' and PDF not yet generated
    IF (TG_OP = 'INSERT' AND NEW.status = 'sent' AND NEW.invoice_pdf_url IS NULL) OR
       (TG_OP = 'UPDATE' AND NEW.status = 'sent' AND OLD.status != 'sent' AND NEW.invoice_pdf_url IS NULL) THEN
        
        -- Hardcoded PDF service URL (Cloud Run backend)
        v_pdf_service_url := 'https://botkorp-backend-695066639923.europe-west1.run.app';
        
        -- Build payload
        v_payload := jsonb_build_object(
            'invoice_id', NEW.id::text,
            'invoice_number', NEW.invoice_number
        );
        
        RAISE NOTICE 'Triggering async PDF generation for invoice %: POST %/api/send-invoice-email', 
                     NEW.invoice_number, v_pdf_service_url;
        
        -- Make ASYNC HTTP POST using pg_net (doesn't block transaction)
        -- This allows the transaction to commit BEFORE the HTTP call is made
        BEGIN
            SELECT net.http_post(
                url := v_pdf_service_url || '/api/send-invoice-email',
                headers := '{"Content-Type": "application/json"}'::jsonb,
                body := v_payload
            ) INTO v_request_id;
            
            RAISE NOTICE 'OK Async PDF generation request queued for invoice % (request_id: %)', 
                         NEW.invoice_number, v_request_id;
            
        EXCEPTION
            WHEN OTHERS THEN
                RAISE WARNING 'ERROR Failed to queue PDF generation for invoice %: %', 
                              NEW.invoice_number, SQLERRM;
        END;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on invoices table
DROP TRIGGER IF EXISTS auto_generate_invoice_pdf_trigger ON invoices;

-- Use AFTER COMMIT to avoid calling the API for rolled-back transactions
-- This prevents calling the backend for invoices that get deleted/rolled back
CREATE CONSTRAINT TRIGGER auto_generate_invoice_pdf_trigger
    AFTER INSERT OR UPDATE OF status ON invoices
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION trigger_generate_invoice_pdf();

-- Grant permissions
GRANT EXECUTE ON FUNCTION trigger_generate_invoice_pdf TO postgres;

-- Comments
COMMENT ON FUNCTION trigger_generate_invoice_pdf IS 'Automatically triggers PDF generation and email when invoice is created with status=sent';
COMMENT ON TRIGGER auto_generate_invoice_pdf_trigger ON invoices IS 'Triggers PDF generation for new invoices';

-- Success message
DO $$
BEGIN
    RAISE NOTICE '=== AUTO INVOICE PDF GENERATION TRIGGER CREATED ===';
    RAISE NOTICE 'Features:';
    RAISE NOTICE '  - Automatically generates PDF when invoice status = sent';
    RAISE NOTICE '  - Uses ASYNC HTTP calls (pg_net) - does not block transaction';
    RAISE NOTICE '  - Transaction commits BEFORE HTTP call (invoice visible in DB)';
    RAISE NOTICE '  - PDF service generates PDF and emails customer';
    RAISE NOTICE '';
    RAISE NOTICE 'PDF Service URL: https://botkorp-backend-695066639923.europe-west1.run.app';
    RAISE NOTICE '';
    RAISE NOTICE 'Flow:';
    RAISE NOTICE '  1. Invoice created with status=sent';
    RAISE NOTICE '  2. Database trigger queues async HTTP POST to PDF service';
    RAISE NOTICE '  3. Transaction commits (invoice now visible in database)';
    RAISE NOTICE '  4. pg_net sends HTTP POST to backend';
    RAISE NOTICE '  5. PDF service:';
    RAISE NOTICE '     - Fetches invoice from database (now visible)';
    RAISE NOTICE '     - Generates PDF from invoice data';
    RAISE NOTICE '     - Uploads to Supabase Storage';
    RAISE NOTICE '     - Updates invoice.invoice_pdf_url';
    RAISE NOTICE '     - Emails PDF to customer';
    RAISE NOTICE '';
    RAISE NOTICE 'Testing:';
    RAISE NOTICE '  -- Create test invoice:';
    RAISE NOTICE '  SELECT create_deposit_invoice(''<rental_agreement_id>'');';
    RAISE NOTICE '';
    RAISE NOTICE 'Check async request status:';
    RAISE NOTICE '  SELECT * FROM net.http_request_queue ORDER BY created_at DESC LIMIT 10;';
END $$;

