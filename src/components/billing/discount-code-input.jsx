import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Tag, CheckCircle, X Circle, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';

export default function DiscountCodeInput({ 
  userId, 
  organizationId, 
  botType = 'mow_bot',
  numberOfBots = 1,
  servicesPerMonth = 4,
  onDiscountApplied 
}) {
  const [code, setCode] = useState('');
  const [validating, setValidating] = useState(false);
  const [appliedDiscount, setAppliedDiscount] = useState(null);
  const { toast } = useToast();

  const validateDiscount = async () => {
    if (!code.trim()) return;

    setValidating(true);
    try {
      const { data, error } = await supabase.rpc('validate_discount', {
        p_discount_code: code.toUpperCase(),
        p_user_id: userId,
        p_organization_id: organizationId,
        p_bot_type: botType,
        p_number_of_bots: numberOfBots,
        p_services_per_month: servicesPerMonth
      });

      if (error) throw error;

      if (data && data.length > 0) {
        const discount = data[0];
        
        if (discount.is_valid) {
          setAppliedDiscount(discount);
          if (onDiscountApplied) {
            onDiscountApplied(discount);
          }
          toast({
            title: "Discount applied!",
            description: discount.message || "Your discount has been successfully applied.",
          });
        } else {
          toast({
            title: "Invalid discount code",
            description: discount.message || "This discount code cannot be applied.",
            variant: "destructive",
          });
        }
      }
    } catch (error) {
      console.error('Error validating discount:', error);
      toast({
        title: "Error",
        description: "Failed to validate discount code.",
        variant: "destructive",
      });
    } finally {
      setValidating(false);
    }
  };

  const removeDiscount = () => {
    setAppliedDiscount(null);
    setCode('');
    if (onDiscountApplied) {
      onDiscountApplied(null);
    }
  };

  if (appliedDiscount) {
    return (
      <Card className="border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20">
        <CardContent className="pt-6">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <span className="font-semibold">Discount Applied</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Code: <strong>{code.toUpperCase()}</strong>
              </p>
              {appliedDiscount.discount_type === 'percentage' && (
                <p className="text-sm">
                  <strong>{appliedDiscount.discount_value}%</strong> off
                </p>
              )}
              {appliedDiscount.discount_type === 'fixed_amount' && (
                <p className="text-sm">
                  <strong>R{appliedDiscount.discount_value}</strong> off
                </p>
              )}
              {appliedDiscount.free_months > 0 && (
                <p className="text-sm">
                  <strong>{appliedDiscount.free_months} month{appliedDiscount.free_months > 1 ? 's' : ''}</strong> free
                </p>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={removeDiscount}
            >
              <XCircle className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Tag className="h-5 w-5 text-primary" />
          <CardTitle>Discount Code</CardTitle>
        </div>
        <CardDescription>
          Have a promo code? Enter it here
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <div className="flex-1 space-y-2">
            <Label htmlFor="discount-code">Code</Label>
            <Input
              id="discount-code"
              placeholder="ENTER CODE"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  validateDiscount();
                }
              }}
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={validateDiscount}
              disabled={!code.trim() || validating}
            >
              {validating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Apply'
              )}
            </Button>
          </div>
        </div>

        <Alert>
          <Tag className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Discounts can include percentage off, fixed amount off, or free months.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

