import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Gift, Calendar, CheckCircle, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export default function ReferralRewards({ organizationId }) {
  const [rewards, setRewards] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRewards();
  }, [organizationId]);

  const loadRewards = async () => {
    try {
      const { data, error } = await supabase.rpc('get_available_referral_rewards', {
        p_organization_id: organizationId
      });

      if (error) throw error;
      setRewards(data || []);
    } catch (error) {
      console.error('Error loading rewards:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  if (rewards.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Referral Rewards</CardTitle>
          </div>
          <CardDescription>
            Your available rewards from referrals
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <Gift className="h-4 w-4" />
            <AlertDescription>
              No rewards available yet. Refer friends to earn free months!
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-primary" />
            <CardTitle>Your Rewards</CardTitle>
          </div>
          <Badge variant="secondary">{rewards.length} available</Badge>
        </div>
        <CardDescription>
          Rewards will be automatically applied to your next invoices
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rewards.map((reward) => (
          <div
            key={reward.reward_id}
            className="p-4 border rounded-lg bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
          >
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <span className="font-semibold">
                    {reward.free_months} Month{reward.free_months > 1 ? 's' : ''} Free
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {reward.reward_type === 'referrer_bonus' ? 'Referrer Bonus' : 'Welcome Bonus'}
                  </Badge>
                </div>
                {reward.valid_until && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    <span>Valid until {new Date(reward.valid_until).toLocaleDateString()}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}

        <Alert>
          <Gift className="h-4 w-4" />
          <AlertDescription className="text-xs">
            These rewards will be automatically applied to your upcoming invoices, reducing your monthly charges.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

