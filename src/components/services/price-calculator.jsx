import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Calculator, CheckCircle, Loader2, Bot, Wrench, Info } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export default function PriceCalculator({ 
  serviceType = 'garden', 
  onPriceChange, 
  totalArea = null, 
  gardenCount = null,
  servicesPerMonth = 1 
}) {
  const [area, setArea] = useState('');
  const [frequency, setFrequency] = useState('bi-weekly');
  const [loading, setLoading] = useState(false);
  const [pricing, setPricing] = useState({
    monthly_total: 0,
    bot_rental_total: 0,
    service_total: 0,
    bot_rental_per_bot: 0,
    service_price_per_visit: 0,
    setup_fee: 0,
    number_of_bots: 0,
    services_per_month: 0
  });

  // Use provided props or local state
  const effectiveGardenCount = gardenCount !== null ? gardenCount : 1;
  const effectiveServicesPerMonth = servicesPerMonth || 1;

  useEffect(() => {
    calculatePricing();
  }, [gardenCount, servicesPerMonth, serviceType]);

  const calculatePricing = async () => {
    if (effectiveGardenCount <= 0) {
      const emptyPricing = { 
        monthly_total: 0, 
        bot_rental_total: 0, 
        service_total: 0, 
        setup_fee: 0 
      };
      setPricing(emptyPricing);
      if (onPriceChange) onPriceChange(emptyPricing);
      return;
    }

    setLoading(true);
    try {
      // Map service type to bot_type
      const botType = serviceType === 'garden' ? 'mow_bot' : 
                      serviceType === 'pool' ? 'pool_bot' : 
                      serviceType === 'security' ? 'security_bot' : 
                      'mow_bot';
      
      // Call the NEW tier pricing function
      const { data, error } = await supabase.rpc('get_tier_pricing', {
        p_bot_type: botType,
        p_number_of_bots: effectiveGardenCount, // 1 bot per garden
        p_services_per_month: effectiveServicesPerMonth
      });

      if (error) {
        console.error('Error fetching pricing:', error);
        throw error;
      }

      if (data) {
        const newPricing = {
          monthly_total: parseFloat(data.monthly_total || 0),
          bot_rental_total: parseFloat(data.bot_rental_total || 0),
          service_total: parseFloat(data.service_total || 0),
          bot_rental_per_bot: parseFloat(data.bot_rental_per_bot || 150),
          service_price_per_visit: parseFloat(data.service_price_per_visit || 0),
          setup_fee: parseFloat(data.setup_fee || 0),
          number_of_bots: effectiveGardenCount,
          services_per_month: effectiveServicesPerMonth,
          tier_name: data.tier_name || '',
          pricing_type: data.pricing_type || 'calculated'
        };

        setPricing(newPricing);
        if (onPriceChange) onPriceChange(newPricing);
      }
    } catch (error) {
      console.error('Error calculating pricing:', error);
      // Fallback to zero pricing on error
      const fallbackPricing = { 
        monthly_total: 0, 
        bot_rental_total: 0, 
        service_total: 0, 
        setup_fee: 0 
      };
      setPricing(fallbackPricing);
      if (onPriceChange) onPriceChange(fallbackPricing);
    } finally {
      setLoading(false);
    }
  };

  const getFrequencyLabel = (freq) => {
    const labels = {
      'bi-weekly': 'Bi-Weekly (Every 2 Weeks)',
      'monthly': 'Monthly (Every 4 Weeks)'
    };
    return labels[freq] || freq;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Calculator className="h-5 w-5 text-primary" />
          <CardTitle>Price Calculator</CardTitle>
        </div>
        <CardDescription>
          Estimate your monthly service cost
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Area Input - only show if not controlled by parent */}
        {totalArea === null && (
          <div className="space-y-2">
            <Label htmlFor="area">
              {serviceType === 'garden' ? 'Total Garden Area (m²)' : 
               serviceType === 'pool' ? 'Pool Surface Area (m²)' : 
               'Coverage Area (m²)'}
            </Label>
            <Input
              id="area"
              type="number"
              placeholder="e.g., 250"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              min="0"
              step="10"
            />
          </div>
        )}

        {/* Show total area if provided from parent */}
        {totalArea !== null && (
          <div className="p-3 bg-muted rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total Area</span>
              <span className="font-bold text-lg">{Math.round(totalArea)} m²</span>
            </div>
            {gardenCount > 1 && (
              <div className="flex items-center justify-between mt-1">
                <span className="text-sm text-muted-foreground">Number of Gardens</span>
                <span className="font-semibold">{gardenCount}</span>
              </div>
            )}
          </div>
        )}

        {/* Frequency Selection */}
        {serviceType === 'garden' && (
          <div className="space-y-2">
            <Label htmlFor="frequency">Service Frequency</Label>
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger id="frequency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bi-weekly">Bi-Weekly (Every 2 Weeks)</SelectItem>
                <SelectItem value="monthly">Monthly (Every 4 Weeks)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}

        {/* Pricing Display */}
        {!loading && pricing.monthly_total > 0 && (
          <div className="pt-4 border-t space-y-4">
            {/* Tier Badge */}
            {pricing.tier_name && (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="capitalize">
                  {pricing.tier_name}
                </Badge>
                {pricing.pricing_type && (
                  <Badge variant="secondary" className="text-xs">
                    {pricing.pricing_type}
                  </Badge>
                )}
              </div>
            )}
            
            {/* Cost Breakdown */}
            <div className="space-y-3 bg-muted/50 p-4 rounded-lg">
              <p className="font-semibold text-sm">Monthly Cost Breakdown</p>
              
              {/* Bot Rental */}
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-muted-foreground" />
                  <span>Bot Rental ({pricing.number_of_bots} bot{pricing.number_of_bots > 1 ? 's' : ''})</span>
                </div>
                <span className="font-semibold">R{pricing.bot_rental_total?.toFixed(2) || '0.00'}</span>
              </div>
              <div className="pl-6 text-xs text-muted-foreground">
                R{pricing.bot_rental_per_bot}/bot/month
              </div>

              {/* Monthly Service Fee (Per Location) */}
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Wrench className="h-4 w-4 text-muted-foreground" />
                  <span>Monthly Service Fee</span>
                  <Badge variant="outline" className="text-xs">Per Location</Badge>
                </div>
                <span className="font-semibold">R{pricing.service_total?.toFixed(2) || '0.00'}</span>
              </div>
              <div className="pl-6 text-xs text-muted-foreground">
                Covers edge trimming, battery swaps & bot servicing for all bots at this location
              </div>

              {/* Total */}
              <div className="pt-3 border-t border-border">
                <div className="flex items-center justify-between">
                  <span className="font-bold">Monthly Total</span>
                  <span className="text-2xl font-bold text-primary">R{pricing.monthly_total?.toFixed(2) || '0.00'}</span>
                </div>
              </div>
            </div>

            {/* Setup Fee */}
            {pricing.setup_fee > 0 && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">
                      One-time Setup Fee ({pricing.number_of_bots} bot{pricing.number_of_bots > 1 ? 's' : ''})
                    </span>
                    <span className="font-semibold">R{pricing.setup_fee?.toFixed(2) || '0.00'}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Charged once during first month for installation
                  </p>
                </AlertDescription>
              </Alert>
            )}

            {/* Billing Info */}
            <div className="p-4 border-2 border-primary rounded-lg bg-primary/5">
              <div className="space-y-2">
                <p className="font-semibold flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  Flexible Monthly Billing
                </p>
                <p className="text-sm text-muted-foreground flex items-center gap-2 pl-6">
                  • Cancel anytime, no long-term contract
                </p>
                <p className="text-sm text-muted-foreground flex items-center gap-2 pl-6">
                  • Pause service during winter months
                </p>
                <p className="text-sm text-muted-foreground flex items-center gap-2 pl-6">
                  • Adjust schedule and services as needed
                </p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

