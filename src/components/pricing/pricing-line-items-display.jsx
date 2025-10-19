import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Check, Loader2, Info } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export default function PricingLineItemsDisplay({ 
  botType = 'mow_bot', 
  organizationId = null,
  servicesPerMonth = 4 
}) {
  const [pricing, setPricing] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPricing();
  }, [botType, organizationId]);

  const loadPricing = async () => {
    try {
      const { data, error } = await supabase.rpc('get_full_pricing', {
        p_bot_type: botType,
        p_organization_id: organizationId
      });

      if (error) throw error;
      setPricing(data);
    } catch (error) {
      console.error('Error loading pricing:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!pricing || pricing.error) {
    return (
      <Card className="border-destructive">
        <CardContent className="pt-6">
          <p className="text-destructive">Unable to load pricing information</p>
        </CardContent>
      </Card>
    );
  }

  const requiredItems = pricing.line_items?.filter(item => !item.is_optional) || [];
  const optionalItems = pricing.line_items?.filter(item => item.is_optional) || [];

  // Calculate totals - service fee is monthly, not per visit
  const requiredTotal = requiredItems.reduce((sum, item) => 
    sum + parseFloat(item.price_per_unit), 0
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="capitalize">{pricing.name}</CardTitle>
        <CardDescription>{pricing.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Base Rental */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold">Bot Rental (monthly)</span>
            <span className="text-lg font-bold">R{parseFloat(pricing.bot_rental_monthly).toFixed(2)}</span>
          </div>
          <Separator />
        </div>

        {/* Required Line Items */}
        {requiredItems.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h4 className="font-semibold text-sm">Monthly Service Fee</h4>
              <Badge variant="secondary" className="text-xs">Required</Badge>
              <Badge variant="outline" className="text-xs">Per Location</Badge>
            </div>
            <div className="space-y-2">
              {requiredItems.map((item) => (
                <div key={item.id} className="flex items-start justify-between text-sm pl-4">
                  <div className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-green-600 mt-0.5" />
                    <div>
                      <p className="font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">{item.description}</p>
                      <p className="text-xs text-muted-foreground mt-1 italic">
                        Charged once per location, covers all bots at that location
                      </p>
                    </div>
                  </div>
                  <span className="font-semibold">R{parseFloat(item.price_per_unit).toFixed(2)}/month</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Optional Line Items */}
        {optionalItems.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h4 className="font-semibold text-sm">Optional Add-ons</h4>
              <Badge variant="outline" className="text-xs">Optional</Badge>
            </div>
            <div className="space-y-2">
              {optionalItems.map((item) => (
                <div key={item.id} className="flex items-start justify-between text-sm pl-4">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  </div>
                  <span className="font-semibold">+R{parseFloat(item.price_per_unit).toFixed(2)}/{item.unit_type}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Setup Fee */}
        {pricing.setup_fee > 0 && (
          <div className="space-y-2">
            <Separator />
            <div className="flex items-center justify-between text-sm">
              <div>
                <span className="font-semibold">One-time Setup Fee</span>
                <p className="text-xs text-muted-foreground">Charged only on first month</p>
              </div>
              <span className="font-bold">R{parseFloat(pricing.setup_fee).toFixed(2)}</span>
            </div>
          </div>
        )}

        {/* Area Pricing */}
        {pricing.area_pricing && pricing.area_pricing.base_area_included_sqm > 0 && (
          <div className="space-y-2">
            <Separator />
            <div className="text-sm">
              <p className="font-semibold mb-1">Area-based Pricing</p>
              <p className="text-muted-foreground text-xs">
                First {pricing.area_pricing.base_area_included_sqm}m² included, 
                then R{parseFloat(pricing.area_pricing.price_per_sqm_after_base).toFixed(2)}/m²
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

