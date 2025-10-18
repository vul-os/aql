import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { 
  Gift, 
  Copy, 
  CheckCircle, 
  Share2, 
  Users,
  TrendingUp,
  Loader2 
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-context';

export default function ReferralCodeManager({ organizationId }) {
  const [referralCode, setReferralCode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [stats, setStats] = useState({ totalReferrals: 0, qualifiedReferrals: 0 });
  const [customCode, setCustomCode] = useState('');
  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    loadReferralCode();
    loadReferralStats();
  }, [organizationId]);

  const loadReferralCode = async () => {
    try {
      const { data, error } = await supabase
        .from('referral_codes')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      setReferralCode(data);
    } catch (error) {
      console.error('Error loading referral code:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadReferralStats = async () => {
    try {
      const { data, error } = await supabase
        .from('referrals')
        .select('status')
        .eq('referrer_organization_id', organizationId);

      if (error) throw error;

      const totalReferrals = data?.length || 0;
      const qualifiedReferrals = data?.filter(r => 
        r.status === 'qualified' || r.status === 'rewarded'
      ).length || 0;

      setStats({ totalReferrals, qualifiedReferrals });
    } catch (error) {
      console.error('Error loading referral stats:', error);
    }
  };

  const createReferralCode = async () => {
    setCreating(true);
    try {
      const { data, error } = await supabase.rpc('create_referral_code', {
        p_organization_id: organizationId,
        p_created_by: user.id,
        p_custom_code: customCode || null
      });

      if (error) throw error;

      toast({
        title: "Referral code created!",
        description: "Share your code to earn rewards.",
      });

      loadReferralCode();
      setCustomCode('');
    } catch (error) {
      console.error('Error creating referral code:', error);
      toast({
        title: "Error creating referral code",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast({
      title: "Copied!",
        description: "Referral code copied to clipboard.",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const shareReferralLink = () => {
    const baseUrl = window.location.origin;
    const referralUrl = `${baseUrl}/auth/register?ref=${referralCode.code}`;
    
    if (navigator.share) {
      navigator.share({
        title: 'Join BotKorp',
        text: `Use my referral code ${referralCode.code} and get 1 month free!`,
        url: referralUrl,
      });
    } else {
      copyToClipboard(referralUrl);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-12 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  if (!referralCode) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-primary" />
            <CardTitle>Referral Program</CardTitle>
          </div>
          <CardDescription>
            Earn rewards by referring friends and colleagues
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <Gift className="h-4 w-4" />
            <AlertDescription>
              <strong>Earn 1 month free</strong> for each friend you refer! They get 1 month free too.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label>Custom Code (Optional)</Label>
            <Input
              placeholder="YOURNAME (6-12 characters)"
              value={customCode}
              onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
              maxLength={12}
            />
            <p className="text-xs text-muted-foreground">
              Leave blank for auto-generated code, or choose your own
            </p>
          </div>

          <Button 
            onClick={createReferralCode} 
            disabled={creating}
            className="w-full"
          >
            {creating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Gift className="mr-2 h-4 w-4" />
                Create Referral Code
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const baseUrl = window.location.origin;
  const referralUrl = `${baseUrl}/auth/register?ref=${referralCode.code}`;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-primary" />
            <CardTitle>Your Referral Code</CardTitle>
          </div>
          <Badge variant="secondary">{referralCode.times_used} uses</Badge>
        </div>
        <CardDescription>
          Share your code and earn rewards when friends sign up
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Referral Code Display */}
        <div className="p-6 border-2 border-primary rounded-lg bg-primary/5">
          <div className="text-center space-y-3">
            <p className="text-sm text-muted-foreground">Your Referral Code</p>
            <p className="text-4xl font-bold text-primary tracking-wider">
              {referralCode.code}
            </p>
            <div className="flex gap-2 justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(referralCode.code)}
              >
                {copied ? (
                  <>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="mr-2 h-4 w-4" />
                    Copy Code
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={shareReferralLink}
              >
                <Share2 className="mr-2 h-4 w-4" />
                Share Link
              </Button>
            </div>
          </div>
        </div>

        {/* Referral Link */}
        <div className="space-y-2">
          <Label>Referral Link</Label>
          <div className="flex gap-2">
            <Input
              value={referralUrl}
              readOnly
              className="font-mono text-sm"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => copyToClipboard(referralUrl)}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 border rounded-lg">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Users className="h-4 w-4" />
              <span className="text-sm">Total Referrals</span>
            </div>
            <p className="text-2xl font-bold">{stats.totalReferrals}</p>
          </div>
          <div className="p-4 border rounded-lg">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <TrendingUp className="h-4 w-4" />
              <span className="text-sm">Qualified</span>
            </div>
            <p className="text-2xl font-bold text-green-600">{stats.qualifiedReferrals}</p>
          </div>
        </div>

        {/* How it Works */}
        <Alert>
          <Gift className="h-4 w-4" />
          <AlertDescription>
            <p className="font-semibold mb-2">How It Works:</p>
            <ol className="text-sm space-y-1 list-decimal list-inside">
              <li>Share your referral code with friends</li>
              <li>They sign up and pay their first deposit</li>
              <li>You both get <strong>1 month free</strong>!</li>
            </ol>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

