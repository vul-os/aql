import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { 
  CreditCard, 
  Plus, 
  Trash2, 
  Check, 
  AlertCircle, 
  Loader2,
  Star,
  Calendar,
  DollarSign,
  Bot as BotIcon,
  Receipt,
  TrendingUp
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { usePaymentAuthorizations, usePaystack, formatCardNumber, formatExpiryDate, getCardIcon, isCardExpired } from '@/hooks/use-paystack';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';
import PageHeader from '@/components/ui/page-header';

export default function BillingPage() {
  const { organization } = useOutletContext();
  const { user } = useAuth();
  const { toast } = useToast();
  const { authorizations, loading, refreshAuthorizations } = usePaymentAuthorizations();
  const { 
    addPaymentMethod, 
    deleteAuthorization, 
    setDefaultAuthorization,
    processing 
  } = usePaystack();

  const [deletingId, setDeletingId] = useState(null);
  const [settingDefaultId, setSettingDefaultId] = useState(null);
  const [subscriptions, setSubscriptions] = useState([]);
  const [loadingSubscriptions, setLoadingSubscriptions] = useState(true);

  useEffect(() => {
    if (organization?.id) {
      loadSubscriptions();
    }
  }, [organization]);

  const loadSubscriptions = async () => {
    if (!organization?.id) return;
    
    try {
      setLoadingSubscriptions(true);
      const { data, error } = await supabase
        .from('subscriptions')
        .select(`
          *,
          bot:bots(name, bot_type, identifier),
          pricing:bot_pricing(tier)
        `)
        .eq('organization_id', organization.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setSubscriptions(data || []);
    } catch (error) {
      console.error('Error loading subscriptions:', error);
    } finally {
      setLoadingSubscriptions(false);
    }
  };

  const handleAddCard = async () => {
    if (!user?.email || !organization?.id) {
      toast({
        title: "Error",
        description: "Missing user or organization information",
        variant: "destructive"
      });
      return;
    }

    try {
      await addPaymentMethod(user.email, organization.id);
      toast({
        title: "Redirecting to Paystack",
        description: "You'll be charged R1 to verify your card",
      });
    } catch (error) {
      console.error('Error adding card:', error);
      toast({
        title: "Failed to add card",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const handleDeleteCard = async (authId) => {
    try {
      const success = await deleteAuthorization(authId);
      
      if (success) {
        toast({
          title: "Card removed",
          description: "Payment method has been removed successfully",
        });
        refreshAuthorizations();
      } else {
        throw new Error('Failed to delete authorization');
      }
    } catch (error) {
      console.error('Error deleting card:', error);
      toast({
        title: "Failed to remove card",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setDeletingId(null);
    }
  };

  const handleSetDefault = async (authId) => {
    setSettingDefaultId(authId);
    try {
      await setDefaultAuthorization(authId);
      toast({
        title: "Default card updated",
        description: "This card will be used for automatic payments",
      });
      refreshAuthorizations();
    } catch (error) {
      console.error('Error setting default:', error);
      toast({
        title: "Failed to set default",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setSettingDefaultId(null);
    }
  };

  const totalMonthly = subscriptions.reduce((sum, sub) => sum + parseFloat(sub.amount), 0);
  const nextBillingDate = subscriptions[0]?.next_billing_date;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      <PageHeader
        title="Billing & Payments"
        subtitle="Manage subscriptions, payment methods, and billing details"
        icon={<CreditCard className="h-6 w-6 text-primary" />}
      />

      {/* Monthly Overview - Hero Card */}
      <Card className="border-2 bg-gradient-to-br from-primary/5 via-background to-background">
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground uppercase tracking-wide">Your Monthly Bill</p>
              <div className="flex items-baseline gap-3">
                <span className="text-5xl font-bold">R{totalMonthly.toFixed(2)}</span>
                <span className="text-lg text-muted-foreground">/month</span>
              </div>
              {nextBillingDate && (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Next billing: {new Date(nextBillingDate).toLocaleDateString('en-ZA', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <TrendingUp className="h-4 w-4 text-green-600" />
                <span>Auto-billing enabled</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Check className="h-4 w-4 text-green-600" />
                <span>{subscriptions.length} active subscription{subscriptions.length !== 1 ? 's' : ''}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Subscriptions */}
      {subscriptions.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-2xl">Active Subscriptions</CardTitle>
                <CardDescription>Your current bot services and monthly charges</CardDescription>
              </div>
              <Receipt className="h-6 w-6 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {subscriptions.map((sub, index) => (
                <div key={sub.id}>
                  <div className="flex items-center justify-between py-4">
                    <div className="flex items-center gap-4">
                      <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                        <BotIcon className="h-6 w-6 text-primary" />
                      </div>
                      <div>
                        <p className="font-semibold text-lg">
                          {sub.bot?.name || 'Bot Service'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {sub.bot?.bot_type?.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                          {sub.bot?.identifier && ` • ${sub.bot.identifier}`}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold">R{parseFloat(sub.amount).toFixed(2)}</p>
                      <p className="text-sm text-muted-foreground">per month</p>
                    </div>
                  </div>
                  {index < subscriptions.length - 1 && <Separator />}
                </div>
              ))}
              
              {/* Total */}
              <div className="pt-4 border-t-2">
                <div className="flex items-center justify-between">
                  <p className="text-lg font-semibold">Total Monthly</p>
                  <p className="text-3xl font-bold text-primary">R{totalMonthly.toFixed(2)}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Payment Methods Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl">Payment Methods</CardTitle>
              <CardDescription>
                Manage your saved cards for automatic billing
              </CardDescription>
            </div>
            <Button 
              onClick={handleAddCard} 
              disabled={processing}
              size="lg"
            >
              {processing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Card
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : authorizations.length === 0 ? (
            <div className="text-center py-16">
              <div className="h-20 w-20 rounded-full bg-muted mx-auto mb-6 flex items-center justify-center">
                <CreditCard className="h-10 w-10 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-semibold mb-2">No payment methods</h3>
              <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
                Add a card to enable automatic billing for your subscriptions
              </p>
              <Button onClick={handleAddCard} disabled={processing} size="lg">
                <Plus className="h-4 w-4 mr-2" />
                Add Your First Card
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {authorizations.map((auth) => {
                const expired = isCardExpired(auth.exp_month, auth.exp_year);
                
                return (
                  <div
                    key={auth.id}
                    className={`group relative p-6 border-2 rounded-xl transition-all ${
                      auth.is_default 
                        ? 'border-primary bg-primary/5 shadow-sm' 
                        : 'border-border hover:border-primary/50'
                    } ${expired ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-5">
                        {/* Card Visual */}
                        <div className={`h-16 w-24 rounded-lg flex items-center justify-center ${
                          auth.is_default ? 'bg-gradient-to-br from-primary to-primary/60' : 'bg-gradient-to-br from-gray-700 to-gray-900'
                        } text-white shadow-lg`}>
                          <CreditCard className="h-8 w-8" />
                        </div>
                        
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <p className="text-lg font-semibold">
                              {formatCardNumber(auth.last4)}
                            </p>
                            {auth.is_default && (
                              <Badge className="gap-1">
                                <Star className="h-3 w-3 fill-current" />
                                Default
                              </Badge>
                            )}
                            {expired && (
                              <Badge variant="destructive">Expired</Badge>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <span>{getCardIcon(auth.card_type)}</span>
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {formatExpiryDate(auth.exp_month, auth.exp_year)}
                            </span>
                            {auth.bank && <span>• {auth.bank}</span>}
                          </div>
                          {auth.last_used_at && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Last used {new Date(auth.last_used_at).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {!auth.is_default && !expired && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSetDefault(auth.id)}
                            disabled={settingDefaultId === auth.id}
                          >
                            {settingDefaultId === auth.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <Star className="h-4 w-4 mr-1" />
                                Set Default
                              </>
                            )}
                          </Button>
                        )}
                        
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeletingId(auth.id)}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {expired && (
                      <Alert className="mt-4" variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription className="text-sm">
                          This card has expired. Please add a new card and remove this one.
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Info Card */}
          {authorizations.length > 0 && (
            <Alert className="mt-6 bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
              <AlertCircle className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-sm">
                <strong>Card Verification:</strong> When adding a new card, we charge R1 to verify it. 
                This may be refunded by your bank or appear as a pending transaction.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletingId} onOpenChange={() => setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Payment Method?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove this card? This action cannot be undone.
              {authorizations.find(a => a.id === deletingId)?.is_default && (
                <div className="mt-3 p-3 bg-destructive/10 border border-destructive/20 rounded">
                  <p className="font-semibold text-sm text-destructive">
                    ⚠️ Warning: This is your default payment method.
                  </p>
                  <p className="text-sm mt-1">
                    You'll need to set a new default card for automatic billing.
                  </p>
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleDeleteCard(deletingId)}
              className="bg-destructive hover:bg-destructive/90"
            >
              Remove Card
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

