-- =====================================================
-- PRICING CALCULATION FUNCTIONS
-- =====================================================
-- Functions to calculate pricing dynamically from flexible structure

-- Function: Get pricing plan for a bot type (with optional customer override)
CREATE OR REPLACE FUNCTION get_pricing_plan(
    p_bot_type TEXT,
    p_organization_id UUID DEFAULT NULL
)
RETURNS TABLE(
    plan_id UUID,
    bot_type TEXT,
    name TEXT,
    bot_rental_monthly DECIMAL,
    setup_fee DECIMAL,
    base_area_included_sqm INTEGER,
    price_per_sqm_after_base DECIMAL,
    description TEXT
) AS $$
BEGIN
    -- Check for customer override first
    IF p_organization_id IS NOT NULL THEN
        RETURN QUERY
        SELECT 
            pp.id as plan_id,
            pp.bot_type,
            pp.name,
            COALESCE(cpo.bot_rental_monthly, pp.bot_rental_monthly) as bot_rental_monthly,
            COALESCE(cpo.setup_fee, pp.setup_fee) as setup_fee,
            COALESCE(cpo.base_area_included_sqm, pp.base_area_included_sqm) as base_area_included_sqm,
            COALESCE(cpo.price_per_sqm_after_base, pp.price_per_sqm_after_base) as price_per_sqm_after_base,
            pp.description
        FROM pricing_plans pp
        LEFT JOIN customer_pricing_overrides cpo ON cpo.organization_id = p_organization_id
            AND cpo.bot_type = pp.bot_type
            AND cpo.is_active = true
            AND (cpo.effective_from IS NULL OR cpo.effective_from <= CURRENT_DATE)
            AND (cpo.effective_until IS NULL OR cpo.effective_until >= CURRENT_DATE)
        WHERE pp.bot_type = p_bot_type
            AND pp.is_active = true
            AND pp.is_default = true
        LIMIT 1;
    ELSE
        -- Return default pricing
        RETURN QUERY
        SELECT 
            pp.id as plan_id,
            pp.bot_type,
            pp.name,
            pp.bot_rental_monthly,
            pp.setup_fee,
            pp.base_area_included_sqm,
            pp.price_per_sqm_after_base,
            pp.description
        FROM pricing_plans pp
        WHERE pp.bot_type = p_bot_type
            AND pp.is_active = true
            AND pp.is_default = true
        LIMIT 1;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Function: Get line items for a pricing plan (with optional customer overrides)
CREATE OR REPLACE FUNCTION get_pricing_line_items(
    p_pricing_plan_id UUID,
    p_organization_id UUID DEFAULT NULL,
    p_include_optional BOOLEAN DEFAULT true
)
RETURNS TABLE(
    line_item_id UUID,
    item_type TEXT,
    name TEXT,
    description TEXT,
    price_per_unit DECIMAL,
    unit_type TEXT,
    is_optional BOOLEAN,
    is_recurring BOOLEAN,
    display_order INTEGER
) AS $$
BEGIN
    IF p_organization_id IS NOT NULL THEN
        -- Return with customer overrides
        RETURN QUERY
        SELECT 
            pli.id as line_item_id,
            pli.item_type,
            pli.name,
            pli.description,
            COALESCE(clio.price_per_unit, pli.price_per_unit) as price_per_unit,
            pli.unit_type,
            COALESCE(clio.is_optional, pli.is_optional) as is_optional,
            pli.is_recurring,
            pli.display_order
        FROM pricing_line_items pli
        LEFT JOIN customer_line_item_overrides clio ON clio.pricing_line_item_id = pli.id
            AND clio.organization_id = p_organization_id
            AND clio.is_active = true
            AND (clio.effective_from IS NULL OR clio.effective_from <= CURRENT_DATE)
            AND (clio.effective_until IS NULL OR clio.effective_until >= CURRENT_DATE)
        WHERE pli.pricing_plan_id = p_pricing_plan_id
            AND pli.is_active = true
            AND (p_include_optional = true OR pli.is_optional = false)
        ORDER BY pli.display_order, pli.name;
    ELSE
        -- Return default line items
        RETURN QUERY
        SELECT 
            pli.id as line_item_id,
            pli.item_type,
            pli.name,
            pli.description,
            pli.price_per_unit,
            pli.unit_type,
            pli.is_optional,
            pli.is_recurring,
            pli.display_order
        FROM pricing_line_items pli
        WHERE pli.pricing_plan_id = p_pricing_plan_id
            AND pli.is_active = true
            AND (p_include_optional = true OR pli.is_optional = false)
        ORDER BY pli.display_order, pli.name;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Function: Calculate total service cost
CREATE OR REPLACE FUNCTION calculate_service_cost(
    p_bot_type TEXT,
    p_number_of_bots INTEGER,
    p_services_per_month INTEGER,
    p_area_sqm DECIMAL DEFAULT 0,
    p_organization_id UUID DEFAULT NULL,
    p_optional_items UUID[] DEFAULT ARRAY[]::UUID[]
)
RETURNS TABLE(
    bot_rental_total DECIMAL,
    line_items_total DECIMAL,
    area_surcharge DECIMAL,
    monthly_subtotal DECIMAL,
    setup_fee_total DECIMAL,
    pricing_breakdown JSONB
) AS $$
DECLARE
    v_plan RECORD;
    v_line_item RECORD;
    v_line_items_total DECIMAL := 0;
    v_area_surcharge DECIMAL := 0;
    v_line_items_array JSONB := '[]'::JSONB;
BEGIN
    -- Get pricing plan
    SELECT * INTO v_plan
    FROM get_pricing_plan(p_bot_type, p_organization_id);
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No pricing plan found for bot type: %', p_bot_type;
    END IF;
    
    -- Calculate line items total
    FOR v_line_item IN 
        SELECT * FROM get_pricing_line_items(v_plan.plan_id, p_organization_id, true)
    LOOP
        -- Include if it's required OR if it's in the optional items array
        IF NOT v_line_item.is_optional OR v_line_item.line_item_id = ANY(p_optional_items) THEN
            v_line_items_total := v_line_items_total + (v_line_item.price_per_unit * p_services_per_month);
            
            -- Add to breakdown array
            v_line_items_array := v_line_items_array || jsonb_build_object(
                'item_type', v_line_item.item_type,
                'name', v_line_item.name,
                'price_per_unit', v_line_item.price_per_unit,
                'quantity', p_services_per_month,
                'total', v_line_item.price_per_unit * p_services_per_month,
                'is_optional', v_line_item.is_optional
            );
        END IF;
    END LOOP;
    
    -- Calculate area surcharge
    IF p_area_sqm > v_plan.base_area_included_sqm THEN
        v_area_surcharge := (p_area_sqm - v_plan.base_area_included_sqm) * v_plan.price_per_sqm_after_base;
    END IF;
    
    RETURN QUERY
    SELECT 
        (v_plan.bot_rental_monthly * p_number_of_bots)::DECIMAL as bot_rental_total,
        v_line_items_total::DECIMAL as line_items_total,
        v_area_surcharge::DECIMAL as area_surcharge,
        (v_plan.bot_rental_monthly * p_number_of_bots + v_line_items_total + v_area_surcharge)::DECIMAL as monthly_subtotal,
        (v_plan.setup_fee * p_number_of_bots)::DECIMAL as setup_fee_total,
        jsonb_build_object(
            'bot_type', p_bot_type,
            'number_of_bots', p_number_of_bots,
            'services_per_month', p_services_per_month,
            'area_sqm', p_area_sqm,
            'plan', jsonb_build_object(
                'name', v_plan.name,
                'bot_rental_monthly', v_plan.bot_rental_monthly,
                'setup_fee', v_plan.setup_fee
            ),
            'breakdown', jsonb_build_object(
                'bot_rental', v_plan.bot_rental_monthly * p_number_of_bots,
                'line_items', v_line_items_array,
                'line_items_total', v_line_items_total,
                'area_surcharge', jsonb_build_object(
                    'base_included', v_plan.base_area_included_sqm,
                    'actual_area', p_area_sqm,
                    'overage', GREATEST(0, p_area_sqm - v_plan.base_area_included_sqm),
                    'rate_per_sqm', v_plan.price_per_sqm_after_base,
                    'charge', v_area_surcharge
                ),
                'monthly_total', v_plan.bot_rental_monthly * p_number_of_bots + v_line_items_total + v_area_surcharge,
                'setup_fee', v_plan.setup_fee * p_number_of_bots
            )
        ) as pricing_breakdown;
END;
$$ LANGUAGE plpgsql;

-- Function: Get full pricing details (for display purposes)
CREATE OR REPLACE FUNCTION get_full_pricing(
    p_bot_type TEXT,
    p_organization_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_plan RECORD;
    v_line_items JSONB;
BEGIN
    -- Get pricing plan
    SELECT * INTO v_plan
    FROM get_pricing_plan(p_bot_type, p_organization_id);
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'No pricing plan found');
    END IF;
    
    -- Get line items as JSONB array
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', line_item_id,
            'item_type', item_type,
            'name', name,
            'description', description,
            'price_per_unit', price_per_unit,
            'unit_type', unit_type,
            'is_optional', is_optional,
            'is_recurring', is_recurring
        ) ORDER BY display_order
    ) INTO v_line_items
    FROM get_pricing_line_items(v_plan.plan_id, p_organization_id, true);
    
    RETURN jsonb_build_object(
        'plan_id', v_plan.plan_id,
        'bot_type', v_plan.bot_type,
        'name', v_plan.name,
        'description', v_plan.description,
        'bot_rental_monthly', v_plan.bot_rental_monthly,
        'setup_fee', v_plan.setup_fee,
        'area_pricing', jsonb_build_object(
            'base_area_included_sqm', v_plan.base_area_included_sqm,
            'price_per_sqm_after_base', v_plan.price_per_sqm_after_base
        ),
        'line_items', COALESCE(v_line_items, '[]'::JSONB)
    );
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_pricing_plan(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_pricing_line_items(UUID, UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_service_cost(TEXT, INTEGER, INTEGER, DECIMAL, UUID, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION get_full_pricing(TEXT, UUID) TO authenticated;

-- Comments
COMMENT ON FUNCTION get_pricing_plan IS 'Get pricing plan for a bot type with optional customer overrides';
COMMENT ON FUNCTION get_pricing_line_items IS 'Get line items for a pricing plan with optional customer overrides';
COMMENT ON FUNCTION calculate_service_cost IS 'Calculate total cost with all line items, area surcharge, and setup fees';
COMMENT ON FUNCTION get_full_pricing IS 'Get complete pricing details including plan and line items as JSONB';

-- Success message
DO $$
BEGIN
    RAISE NOTICE '=== PRICING CALCULATION FUNCTIONS CREATED ===';
    RAISE NOTICE '';
    RAISE NOTICE 'Functions:';
    RAISE NOTICE '  - get_pricing_plan(bot_type, org_id)';
    RAISE NOTICE '  - get_pricing_line_items(plan_id, org_id, include_optional)';
    RAISE NOTICE '  - calculate_service_cost(bot_type, num_bots, services_per_month, area_sqm, org_id, optional_items)';
    RAISE NOTICE '  - get_full_pricing(bot_type, org_id)';
    RAISE NOTICE '';
    RAISE NOTICE 'Examples:';
    RAISE NOTICE '  SELECT * FROM get_full_pricing(''mow_bot'');';
    RAISE NOTICE '  SELECT * FROM calculate_service_cost(''mow_bot'', 2, 4, 150);';
    RAISE NOTICE '  -- With customer overrides:';
    RAISE NOTICE '  SELECT * FROM get_full_pricing(''mow_bot'', ''org-uuid'');';
END $$;

