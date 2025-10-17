import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Calculator, Plus, Minus, Bot, Wrench, ArrowRight, Loader2, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { API } from '@/lib/config';

export default function SimplePriceCalculator() {
  const navigate = useNavigate();
  const [gardens, setGardens] = useState(1);
  const [servicesPerMonth, setServicesPerMonth] = useState(4);
  const [pricing, setPricing] = useState(null);
  const [loading, setLoading] = useState(true);

  // Fetch pricing from backend
  useEffect(() => {
    const fetchPricing = async () => {
      try {
        const response = await fetch(`${API.GET_PRICING}?bot_type=mow_bot`);
        const data = await response.json();
        if (data.success) {
          setPricing(data.pricing);
        } else {
          throw new Error(data.error || 'Failed to fetch pricing');
        }
      } catch (error) {
        console.error('Error fetching pricing:', error);
        // Don't set fallback - let it show error state
      } finally {
        setLoading(false);
      }
    };

    fetchPricing();
  }, []);

  if (loading) {
    return (
      <Card className="max-w-4xl mx-auto border-2 border-primary/20 shadow-2xl">
        <CardContent className="p-12 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  if (!pricing) {
    return (
      <Card className="max-w-4xl mx-auto border-2 border-red-300 shadow-2xl">
        <CardContent className="p-12 flex flex-col items-center justify-center space-y-4">
          <AlertTriangle className="h-16 w-16 text-red-500" />
          <div className="text-center space-y-2">
            <h3 className="text-xl font-bold text-red-600">Pricing Unavailable</h3>
            <p className="text-muted-foreground">
              Unable to load pricing information. Please contact support.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const BOT_RENTAL_PER_BOT = pricing.bot_rental_monthly;
  const SERVICE_PRICE_PER_VISIT = pricing.service_price_per_visit;
  const SETUP_FEE_PER_BOT = pricing.setup_fee;

  const botRentalTotal = gardens * BOT_RENTAL_PER_BOT;
  const serviceTotal = gardens * servicesPerMonth * SERVICE_PRICE_PER_VISIT;
  const monthlyTotal = botRentalTotal + serviceTotal;
  const setupFee = gardens * SETUP_FEE_PER_BOT;
  const firstMonthTotal = monthlyTotal + setupFee;

  const serviceOptions = [
    { value: 1, label: '1x/month', description: 'Light' },
    { value: 2, label: '2x/month', description: 'Standard' },
    { value: 4, label: '4x/month', description: 'Premium' },
    { value: 8, label: '8x/month', description: 'Max' },
  ];

  return (
    <Card className="max-w-4xl mx-auto border-2 border-primary/20 shadow-2xl">
      <CardHeader className="bg-gradient-to-br from-primary/5 via-secondary/5 to-primary/5 border-b">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <Calculator className="h-6 w-6 text-primary" />
          </div>
          <div>
            <CardTitle className="text-2xl md:text-3xl">Quick Price Estimate</CardTitle>
            <CardDescription className="text-base">
              Customize your bot service plan
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-6 md:p-8">
        <div className="grid md:grid-cols-2 gap-8">
          {/* Left: Configuration */}
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold text-lg mb-4">Configure Your Service</h3>
              
              {/* Number of Gardens */}
              <div className="space-y-3 mb-6">
                <Label className="text-base">Number of Gardens/Areas</Label>
                <div className="flex items-center gap-4">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={(e) => {
                      e.preventDefault();
                      setGardens(prev => Math.max(1, prev - 1));
                    }}
                    disabled={gardens <= 1}
                    className="h-12 w-12"
                    type="button"
                  >
                    <Minus className="h-5 w-5" />
                  </Button>
                  <div className="flex-1 text-center">
                    <div className="text-3xl font-bold text-primary">{gardens}</div>
                    <div className="text-sm text-muted-foreground">
                      {gardens === 1 ? 'garden' : 'gardens'}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={(e) => {
                      e.preventDefault();
                      setGardens(prev => Math.min(10, prev + 1));
                    }}
                    disabled={gardens >= 10}
                    className="h-12 w-12"
                    type="button"
                  >
                    <Plus className="h-5 w-5" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Each garden requires 1 bot. Maximum 10 gardens.
                </p>
              </div>

              {/* Services Per Month */}
              <div className="space-y-3">
                <Label className="text-base">Service Frequency</Label>
                <div className="grid grid-cols-2 gap-2">
                  {serviceOptions.map((option) => (
                    <Button
                      key={option.value}
                      variant={servicesPerMonth === option.value ? 'default' : 'outline'}
                      onClick={() => setServicesPerMonth(option.value)}
                      className="h-auto py-3 flex-col"
                    >
                      <div className="font-bold text-lg">{option.label}</div>
                      <div className="text-xs opacity-80">{option.description}</div>
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Includes edge trimming + bot battery swap per visit
                </p>
              </div>
            </div>
          </div>

          {/* Right: Pricing Summary */}
          <div className="space-y-4">
            <h3 className="font-semibold text-lg mb-4">Your Estimated Costs</h3>

            {/* Monthly Breakdown */}
            <div className="bg-muted/50 p-4 rounded-lg space-y-3">
              <p className="font-semibold text-sm text-muted-foreground">MONTHLY CHARGES</p>
              
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-muted-foreground" />
                  <span>Bot Rental ({gardens} bot{gardens > 1 ? 's' : ''})</span>
                </div>
                <span className="font-semibold">R{botRentalTotal.toFixed(2)}</span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Wrench className="h-4 w-4 text-muted-foreground" />
                  <span>Service Visits ({servicesPerMonth}x/month)</span>
                </div>
                <span className="font-semibold">R{serviceTotal.toFixed(2)}</span>
              </div>

              <div className="pt-3 border-t flex items-center justify-between">
                <span className="font-bold">Monthly Total</span>
                <span className="text-2xl font-bold text-primary">R{monthlyTotal.toFixed(2)}</span>
              </div>
            </div>

            {/* First Month */}
            <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-lg border border-amber-200 dark:border-amber-800">
              <p className="font-semibold text-sm text-amber-900 dark:text-amber-100 mb-2">
                FIRST MONTH
              </p>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-amber-900/80 dark:text-amber-100/80">Monthly charges</span>
                  <span>R{monthlyTotal.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-amber-900/80 dark:text-amber-100/80">Setup fee (one-time)</span>
                  <span>R{setupFee.toFixed(2)}</span>
                </div>
                <div className="pt-2 border-t border-amber-200 dark:border-amber-800 flex items-center justify-between font-bold">
                  <span>First Month Total</span>
                  <span className="text-lg">R{firstMonthTotal.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Key Benefits */}
            <div className="space-y-2 pt-2">
              <div className="flex items-start gap-2 text-sm">
                <div className="h-5 w-5 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <div className="h-2 w-2 rounded-full bg-green-600" />
                </div>
                <span className="text-muted-foreground">No long-term contract required</span>
              </div>
              <div className="flex items-start gap-2 text-sm">
                <div className="h-5 w-5 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <div className="h-2 w-2 rounded-full bg-green-600" />
                </div>
                <span className="text-muted-foreground">Cancel or pause anytime</span>
              </div>
              <div className="flex items-start gap-2 text-sm">
                <div className="h-5 w-5 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <div className="h-2 w-2 rounded-full bg-green-600" />
                </div>
                <span className="text-muted-foreground">R{SETUP_FEE_PER_BOT.toFixed(2)} setup fee per bot (one-time)</span>
              </div>
            </div>

            {/* CTA */}
            <Button 
              size="lg" 
              className="w-full mt-4"
              onClick={() => navigate('/auth/register')}
            >
              Get Started
              <ArrowRight className="h-5 w-5 ml-2" />
            </Button>
            <p className="text-xs text-center text-muted-foreground">
              Final pricing confirmed after property assessment
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

