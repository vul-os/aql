import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Calculator, CheckCircle, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export default function PriceCalculator({ 
  serviceType = 'garden', 
  onPriceChange, 
  totalArea = null, 
  gardenCount = null 
}) {
  const [area, setArea] = useState('');
  const [frequency, setFrequency] = useState('bi-weekly');
  const [loading, setLoading] = useState(false);
  const [pricing, setPricing] = useState({
    monthly: 0,
    setupFee: 0,
    tier: '',
    description: ''
  });

  // Use totalArea prop if provided, otherwise use local state
  const effectiveArea = totalArea !== null ? totalArea : area;
  const effectiveGardenCount = gardenCount !== null ? gardenCount : 1;

  useEffect(() => {
    calculatePricing();
  }, [effectiveArea, frequency, serviceType, totalArea, gardenCount]);

  const calculatePricing = async () => {
    if (!effectiveArea || parseFloat(effectiveArea) <= 0) {
      const emptyPricing = { monthly: 0, setupFee: 0, tier: '', description: '' };
      setPricing(emptyPricing);
      if (onPriceChange) onPriceChange(emptyPricing);
      return;
    }

    setLoading(true);
    try {
      const areaSqm = parseFloat(effectiveArea);
      
      // Map service type to bot_type
      const botType = serviceType === 'garden' ? 'mow_bot' : 
                      serviceType === 'pool' ? 'pool_bot' : 
                      serviceType === 'security' ? 'security_bot' : 
                      'mow_bot';
      
      // Call the pricing calculation function
      const { data, error } = await supabase.rpc('calculate_total_pricing', {
        p_bot_type: botType,
        p_total_area_sqm: areaSqm,
        p_garden_count: effectiveGardenCount
      });

      if (error) {
        console.error('Error fetching pricing:', error);
        throw error;
      }

      if (data) {
        // Apply frequency multiplier to monthly rate
        const frequencyMultiplier = {
          'bi-weekly': 1.8,    // More frequent = higher cost
          'monthly': 1.0       // Base rate
        };

        const baseMonthly = parseFloat(data.monthly);
        const adjustedMonthly = Math.round(baseMonthly * (frequencyMultiplier[frequency] || 1));

        const newPricing = {
          monthly: adjustedMonthly,
          setupFee: parseFloat(data.setupFee),
          tier: data.tier || '',
          description: data.description || ''
        };

        setPricing(newPricing);
        if (onPriceChange) onPriceChange(newPricing);
      }
    } catch (error) {
      console.error('Error calculating pricing:', error);
      // Fallback to zero pricing on error
      const fallbackPricing = { monthly: 0, setupFee: 0, tier: '', description: '' };
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
        {!loading && pricing.monthly > 0 && (
          <div className="pt-4 border-t space-y-4">
            {/* Tier Badge */}
            {pricing.tier && (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="capitalize">
                  {pricing.tier} Tier
                </Badge>
                {pricing.description && (
                  <span className="text-sm text-muted-foreground">{pricing.description}</span>
                )}
              </div>
            )}
            
            <div className="space-y-3">
              {/* Monthly Billing Only */}
              <div className="p-6 border-2 border-primary rounded-lg bg-primary/5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="font-semibold text-lg">Monthly Billing</p>
                    <p className="text-sm text-muted-foreground">{getFrequencyLabel(frequency)}</p>
                  </div>
                  <Badge variant="default">Standard Plan</Badge>
                </div>
                <div className="flex items-baseline gap-2 mb-4">
                  <p className="text-3xl font-bold">R{pricing.monthly}</p>
                  <span className="text-sm text-muted-foreground">/month</span>
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    Billed monthly
                  </p>
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    Cancel anytime
                  </p>
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    No long-term commitment
                  </p>
                </div>
              </div>
            </div>

            {/* Setup Fee */}
            <div className="pt-2 border-t">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  One-time setup fee
                  {gardenCount > 1 && ` (${gardenCount} gardens)`}
                </span>
                <span className="font-semibold">R{pricing.setupFee}</span>
              </div>
              {gardenCount > 1 && (
                <p className="text-xs text-muted-foreground mt-1">
                  R450 for first garden + R200 per additional garden
                </p>
              )}
            </div>

            {/* Included Features */}
            <div className="pt-2 space-y-2">
              <p className="text-sm font-medium">Included:</p>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <span>Bot installation & setup</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <span>Real-time monitoring dashboard</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <span>Regular maintenance & support</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <span>Flexible scheduling options</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

