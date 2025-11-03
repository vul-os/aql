import React, { useState, useEffect } from 'react';
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  TrendingUp,
  Download,
  Eye,
  FileText,
  ArrowDown,
  ArrowUp,
  Activity,
  CheckCircle,
  XCircle,
  Clock
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { usePaymentAuthorizations, usePaystack, formatCardNumber, formatExpiryDate, getCardIcon, isCardExpired } from '@/hooks/use-paystack';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';
import PageHeader from '@/components/ui/page-header';

export default function BillingPage() {
  const { user, selectedOrg, selectedLocation } = useAuth();
  const organization = selectedOrg ? {
    id: selectedOrg.organization_id,
    name: selectedOrg.organization_name,
    subscription_tier: selectedOrg.subscription_tier,
    role: selectedOrg.member_role
  } : null;
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
  const [invoices, setInvoices] = useState([]);
  const [loadingInvoices, setLoadingInvoices] = useState(true);
  const [showAllSubscriptions, setShowAllSubscriptions] = useState(false);
  const [selectedInvoicePdf, setSelectedInvoicePdf] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loadingTransactions, setLoadingTransactions] = useState(true);

  useEffect(() => {
    if (organization?.id) {
      loadSubscriptions();
      loadInvoices();
      loadTransactions();
    }
  }, [organization?.id]);

  const loadSubscriptions = async () => {
    if (!organization?.id) return;
    
    try {
      setLoadingSubscriptions(true);
      const { data, error } = await supabase
        .from('rental_agreements')
        .select(`
          *,
          location:locations(id, name, address, city)
        `)
        .eq('organization_id', organization.id)
        .eq('status', 'active')
        .order('location_id', { ascending: true })
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Map rental agreements to subscription format for display
      // Group by location to properly show service fees
      const mappedData = (data || []).map(agreement => ({
        id: agreement.id,
        location_id: agreement.location_id,
        location_name: agreement.location?.name || 'Unknown Location',
        name: `Bot Rental${agreement.bot_type ? ` - ${agreement.bot_type.replace('_', ' ')}` : ''}`,
        bot_rental: agreement.bot_rental_total,
        service_fee: agreement.service_total,
        amount: agreement.monthly_total,
        next_billing_date: agreement.next_billing_date,
        bot: { name: `${agreement.bot_type} Service`, bot_type: agreement.bot_type },
        status: 'active'
      }));
      
      setSubscriptions(mappedData);
    } catch (error) {
      console.error('Error loading subscriptions:', error);
    } finally {
      setLoadingSubscriptions(false);
    }
  };

  const loadInvoices = async () => {
    if (!organization?.id) return;
    
    try {
      setLoadingInvoices(true);
      const { data, error } = await supabase
        .from('invoices')
        .select('*')
        .eq('organization_id', organization.id)
        .order('issue_date', { ascending: false });

      if (error) throw error;
      setInvoices(data || []);
    } catch (error) {
      console.error('Error loading invoices:', error);
    } finally {
      setLoadingInvoices(false);
    }
  };

  const loadTransactions = async () => {
    if (!organization?.id) return;
    
    try {
      setLoadingTransactions(true);
      const { data, error } = await supabase
        .from('payment_attempts')
        .select(`
          *,
          invoice:invoices(invoice_number, total_amount)
        `)
        .eq('organization_id', organization.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setTransactions(data || []);
    } catch (error) {
      console.error('Error loading transactions:', error);
    } finally {
      setLoadingTransactions(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'paid':
      case 'success':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
      case 'sent':
      case 'pending':
        return 'bg-secondary/10 text-secondary dark:bg-secondary/20 dark:text-secondary';
      case 'overdue':
      case 'failed':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';
      case 'draft':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
    }
  };

  const getTransactionIcon = (status) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-600" />;
      case 'pending':
        return <Clock className="h-5 w-5 text-yellow-600" />;
      default:
        return <Activity className="h-5 w-5 text-gray-600" />;
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

  // Calculate total by grouping by location to avoid double-counting service fees
  const subscriptionsByLocation = subscriptions.reduce((acc, sub) => {
    if (!acc[sub.location_id]) {
      acc[sub.location_id] = {
        location_name: sub.location_name,
        bot_rental_total: 0,
        service_fee: 0, // Service fee is per location
        agreements: []
      };
    }
    acc[sub.location_id].bot_rental_total += parseFloat(sub.bot_rental || 0);
    // Only count service fee once per location (from first agreement with service_fee > 0)
    if (parseFloat(sub.service_fee || 0) > 0) {
      acc[sub.location_id].service_fee = parseFloat(sub.service_fee);
    }
    acc[sub.location_id].agreements.push(sub);
    return acc;
  }, {});

  const totalMonthly = Object.values(subscriptionsByLocation).reduce((sum, location) => {
    return sum + location.bot_rental_total + location.service_fee;
  }, 0);
  
  const nextBillingDate = subscriptions[0]?.next_billing_date;

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <div className="bg-gradient-to-br from-background via-background to-muted/20 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <PageHeader
          title="Billing & Payments"
          subtitle="Manage subscriptions, payment methods, and billing details"
          icon={<CreditCard />}
        />
      </div>

      {/* Monthly Overview - Hero Card with Soft UI */}
      <div className="bg-gradient-to-br from-botkorp-orange/5 via-background to-muted/10 rounded-3xl p-8 shadow-[0_8px_30px_rgb(255,107,53,0.08)]">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-8">
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Your Monthly Bill</p>
            <div className="flex items-baseline gap-3">
              <span className="text-5xl md:text-6xl font-bold bg-gradient-to-r from-botkorp-orange to-botkorp-orange/70 bg-clip-text text-transparent">
                R{totalMonthly.toFixed(2)}
              </span>
              <span className="text-xl text-muted-foreground/60">/month</span>
            </div>
            {nextBillingDate && (
              <div className="inline-flex items-center gap-2 px-3 py-2 bg-background/60 backdrop-blur-sm rounded-xl shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                <Calendar className="h-4 w-4 text-botkorp-orange" />
                <span className="text-sm font-medium">
                  Next billing: {new Date(nextBillingDate).toLocaleDateString('en-ZA', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })}
                </span>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 px-4 py-2.5 bg-green-500/10 rounded-xl">
              <TrendingUp className="h-5 w-5 text-green-600" />
              <span className="text-sm font-medium">Auto-billing enabled</span>
            </div>
            <div className="flex items-center gap-3 px-4 py-2.5 bg-botkorp-orange/10 rounded-xl">
              <Check className="h-5 w-5 text-botkorp-orange" />
              <span className="text-sm font-medium">{subscriptions.length} active subscription{subscriptions.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Subscriptions Grouped by Location - Soft UI */}
      {subscriptions.length > 0 && (
        <div className="bg-gradient-to-br from-background to-muted/20 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <div className="flex items-center gap-3 mb-6">
            <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
              <Receipt className="h-5 w-5 text-botkorp-orange" />
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold">Active Subscriptions</h3>
              <p className="text-sm text-muted-foreground/70">
                Your current bot services grouped by location
                {Object.keys(subscriptionsByLocation).length > 1 && ` • ${Object.keys(subscriptionsByLocation).length} locations`}
              </p>
            </div>
          </div>
          <div>
            <div className="space-y-6">
              {Object.entries(subscriptionsByLocation).map(([locationId, locationData], locationIndex) => (
                <div key={locationId} className={locationIndex > 0 ? 'pt-6 border-t' : ''}>
                  {/* Location Header */}
                  <div className="mb-3">
                    <h3 className="font-semibold text-lg text-primary">{locationData.location_name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {locationData.agreements.length} bot{locationData.agreements.length !== 1 ? 's' : ''} at this location
                    </p>
                  </div>

                  {/* Bot Rentals */}
                  {locationData.agreements.map((sub, index) => (
                    <div key={sub.id}>
                      <div className="flex items-center justify-between py-3.5 px-4 bg-background/40 rounded-xl">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.1)]">
                            <BotIcon className="h-5 w-5 text-botkorp-orange" />
                          </div>
                          <div>
                            <p className="font-semibold text-sm">
                              {sub.bot?.name || 'Bot Rental'}
                            </p>
                            <p className="text-xs text-muted-foreground/60">
                              R150/month per bot
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-lg">R{parseFloat(sub.bot_rental).toFixed(2)}</p>
                        </div>
                      </div>
                      {index < locationData.agreements.length - 1 && <div className="h-2" />}
                    </div>
                  ))}

                  {/* Service Fee (once per location) */}
                  {locationData.service_fee > 0 && (
                    <div className="mt-2">
                      <div className="flex items-center justify-between py-3.5 px-4 bg-green-500/5 rounded-xl border border-green-500/10">
                        <div>
                          <p className="font-semibold text-sm">Monthly Service Fee</p>
                          <p className="text-xs text-muted-foreground/60">
                            Per location - includes edge trimming, battery swaps, bot servicing
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-lg">R{locationData.service_fee.toFixed(2)}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Location Subtotal */}
                  <div className="mt-4 pt-4 border-t flex items-center justify-between px-2">
                    <p className="font-bold">Location Subtotal</p>
                    <p className="text-2xl font-bold text-botkorp-orange">
                      R{(locationData.bot_rental_total + locationData.service_fee).toFixed(2)}
                    </p>
                  </div>
                </div>
              ))}
              
              {/* Grand Total */}
              <div className="mt-6 pt-6 border-t-2 bg-botkorp-orange/5 rounded-2xl p-5">
                <div className="flex items-center justify-between">
                  <p className="text-lg font-bold">Total Monthly</p>
                  <p className="text-4xl font-bold text-botkorp-orange">R{totalMonthly.toFixed(2)}</p>
                </div>
                <p className="text-sm text-muted-foreground/70 mt-2">
                  {subscriptions.length} bot{subscriptions.length !== 1 ? 's' : ''} across {Object.keys(subscriptionsByLocation).length} location{Object.keys(subscriptionsByLocation).length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Payment Methods Section - Soft UI */}
      <div className="bg-gradient-to-br from-background to-muted/20 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
              <CreditCard className="h-5 w-5 text-botkorp-orange" />
            </div>
            <div>
              <h3 className="text-xl font-bold">Payment Methods</h3>
              <p className="text-sm text-muted-foreground/70">
                Manage your saved cards for automatic billing
              </p>
            </div>
          </div>
          <Button 
            onClick={handleAddCard} 
            disabled={processing}
            className="h-11 px-6 font-medium bg-botkorp-orange hover:bg-botkorp-orange/90 text-white rounded-xl shadow-[0_8px_30px_rgb(255,107,53,0.25)] hover:shadow-[0_8px_30px_rgb(255,107,53,0.35)] hover:-translate-y-0.5 transition-all"
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
        <div>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : authorizations.length === 0 ? (
            <div className="text-center py-16">
              <div className="h-20 w-20 rounded-3xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 mx-auto mb-6 flex items-center justify-center shadow-[0_8px_30px_rgb(255,107,53,0.15)]">
                <CreditCard className="h-10 w-10 text-botkorp-orange" />
              </div>
              <h3 className="text-xl font-bold mb-2">No payment methods</h3>
              <p className="text-muted-foreground/70 mb-6 max-w-sm mx-auto text-sm">
                Add a card to enable automatic billing for your subscriptions
              </p>
              <Button 
                onClick={handleAddCard} 
                disabled={processing}
                className="h-11 px-6 font-medium bg-botkorp-orange hover:bg-botkorp-orange/90 text-white rounded-xl shadow-[0_8px_30px_rgb(255,107,53,0.25)] hover:shadow-[0_8px_30px_rgb(255,107,53,0.35)] hover:-translate-y-0.5 transition-all"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Your First Card
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {authorizations.map((auth) => {
                const expired = isCardExpired(auth.exp_month, auth.exp_year);
                
                return (
                  <div
                    key={auth.id}
                    className={`group relative p-5 rounded-2xl transition-all ${
                      auth.is_default 
                        ? 'bg-botkorp-orange/5 shadow-[0_4px_20px_rgb(255,107,53,0.12)]' 
                        : 'bg-background/60 shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[0_4px_20px_rgb(0,0,0,0.08)]'
                    } ${expired ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-center justify-between flex-wrap gap-4">
                      <div className="flex items-center gap-4">
                        {/* Card Visual */}
                        <div className={`h-16 w-24 rounded-xl flex items-center justify-center shadow-lg ${
                          auth.is_default ? 'bg-gradient-to-br from-botkorp-orange to-botkorp-orange/70' : 'bg-gradient-to-br from-gray-700 to-gray-900'
                        } text-white`}>
                          <CreditCard className="h-8 w-8" />
                        </div>
                        
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <p className="text-lg font-semibold">
                              {formatCardNumber(auth.last4)}
                            </p>
                            {auth.is_default && (
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-botkorp-orange/15 text-botkorp-orange text-xs font-semibold">
                                <Star className="h-3 w-3 fill-current" />
                                Default
                              </span>
                            )}
                            {expired && (
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-red-500/15 text-red-600 text-xs font-semibold">
                                Expired
                              </span>
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
                            className="h-9 px-4 rounded-xl border-none bg-background/60 shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)]"
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
                          className="h-9 w-9 p-0 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {expired && (
                      <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5" />
                          <p className="text-sm text-red-600">
                            This card has expired. Please add a new card and remove this one.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Info Card */}
          {authorizations.length > 0 && (
            <div className="mt-6 p-4 bg-blue-500/5 border border-blue-500/10 rounded-xl">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5" />
                <div className="text-sm text-muted-foreground/80">
                  <strong className="text-foreground">Card Verification:</strong> When adding a new card, we charge R1 to verify it. 
                  This may be refunded by your bank or appear as a pending transaction.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Transactions Section - Soft UI */}
      <div className="bg-gradient-to-br from-background to-muted/20 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
            <Activity className="h-5 w-5 text-botkorp-orange" />
          </div>
          <div>
            <h3 className="text-xl font-bold">Transactions</h3>
            <p className="text-sm text-muted-foreground/70">
              Payment history and transaction details
            </p>
          </div>
        </div>
        <div>
          {loadingTransactions ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-16">
              <div className="h-20 w-20 rounded-3xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 mx-auto mb-6 flex items-center justify-center shadow-[0_8px_30px_rgb(255,107,53,0.15)]">
                <Activity className="h-10 w-10 text-botkorp-orange" />
              </div>
              <h3 className="text-xl font-bold mb-2">No transactions yet</h3>
              <p className="text-muted-foreground/70 max-w-sm mx-auto text-sm">
                Your payment transactions will appear here once they are processed
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {transactions.slice(0, 10).map((transaction) => (
                <div 
                  key={transaction.id}
                  className="flex items-center justify-between p-4 bg-background/60 backdrop-blur-sm rounded-2xl shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] transition-all"
                >
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-xl bg-muted/50 flex items-center justify-center">
                      {getTransactionIcon(transaction.status)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm">
                          {transaction.invoice?.invoice_number || 'Payment Attempt'}
                        </p>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium ${getStatusColor(transaction.status)}`}>
                          {transaction.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                        <span>{new Date(transaction.created_at).toLocaleDateString('en-ZA', { 
                          year: 'numeric', 
                          month: 'short', 
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}</span>
                        {transaction.payment_reference && (
                          <>
                            <span>•</span>
                            <span className="text-xs font-mono">{transaction.payment_reference}</span>
                          </>
                        )}
                      </div>
                      {transaction.error_message && transaction.status === 'failed' && (
                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                          {transaction.error_message}
                        </p>
                      )}
                      {transaction.attempt_number > 1 && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Attempt #{transaction.attempt_number}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold">R{parseFloat(transaction.amount).toFixed(2)}</p>
                    {transaction.status === 'success' && transaction.processed_at && (
                      <p className="text-xs text-green-600 dark:text-green-400">
                        Processed {new Date(transaction.processed_at).toLocaleDateString()}
                      </p>
                    )}
                    {transaction.status === 'pending' && transaction.next_retry_at && (
                      <p className="text-xs text-muted-foreground">
                        Retry: {new Date(transaction.next_retry_at).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Invoices Section - Soft UI */}
      <div className="bg-gradient-to-br from-background to-muted/20 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
            <Receipt className="h-5 w-5 text-botkorp-orange" />
          </div>
          <div>
            <h3 className="text-xl font-bold">Invoices</h3>
            <p className="text-sm text-muted-foreground/70">
              View and download your invoices
            </p>
          </div>
        </div>
        <div>
          {loadingInvoices ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : invoices.length === 0 ? (
            <div className="text-center py-16">
              <div className="h-20 w-20 rounded-3xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 mx-auto mb-6 flex items-center justify-center shadow-[0_8px_30px_rgb(255,107,53,0.15)]">
                <FileText className="h-10 w-10 text-botkorp-orange" />
              </div>
              <h3 className="text-xl font-bold mb-2">No invoices yet</h3>
              <p className="text-muted-foreground/70 max-w-sm mx-auto text-sm">
                Your invoices will appear here once they are generated
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {invoices.map((invoice) => (
                <div 
                  key={invoice.id}
                  className="flex items-center justify-between p-4 bg-background/60 backdrop-blur-sm rounded-2xl shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)] transition-all"
                >
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.1)]">
                      <FileText className="h-6 w-6 text-botkorp-orange" />
                    </div>
                    <div>
                      <p className="font-semibold">{invoice.invoice_number}</p>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>{new Date(invoice.issue_date).toLocaleDateString('en-ZA', { 
                          year: 'numeric', 
                          month: 'short', 
                          day: 'numeric' 
                        })}</span>
                        <span>•</span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium ${getStatusColor(invoice.status)}`}>
                          {invoice.status}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="text-right">
                      <p className="text-lg font-bold">R{parseFloat(invoice.total_amount).toFixed(2)}</p>
                      {invoice.status === 'paid' && invoice.paid_date && (
                        <p className="text-xs text-green-600">
                          Paid {new Date(invoice.paid_date).toLocaleDateString()}
                        </p>
                      )}
                      {invoice.status !== 'paid' && invoice.due_date && (
                        <p className="text-xs text-muted-foreground/60">
                          Due {new Date(invoice.due_date).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    {invoice.invoice_pdf_url && (
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedInvoicePdf({ url: invoice.invoice_pdf_url, number: invoice.invoice_number })}
                          className="h-9 px-3 rounded-xl border-none bg-background/60 shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)]"
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          View
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const a = document.createElement('a');
                            a.href = invoice.invoice_pdf_url;
                            a.download = `${invoice.invoice_number}.pdf`;
                            a.click();
                          }}
                          className="h-9 px-3 rounded-xl border-none bg-background/60 shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)]"
                        >
                          <Download className="h-4 w-4 mr-1" />
                          Download
                        </Button>
                      </div>
                    )}
                    {!invoice.invoice_pdf_url && (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-muted/50 text-xs font-medium text-muted-foreground">
                        Generating PDF...
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Invoice PDF Viewer Dialog - Soft UI */}
      <Dialog open={!!selectedInvoicePdf} onOpenChange={() => setSelectedInvoicePdf(null)}>
        <DialogContent className="max-w-5xl h-[90vh] rounded-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-xl">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
                <FileText className="h-5 w-5 text-botkorp-orange" />
              </div>
              Invoice {selectedInvoicePdf?.number}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 w-full h-full">
            {selectedInvoicePdf?.url && (
              <iframe
                src={selectedInvoicePdf.url}
                className="w-full h-full rounded-2xl border-2"
                title="Invoice PDF"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog - Soft UI */}
      <AlertDialog open={!!deletingId} onOpenChange={() => setDeletingId(null)}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl">Remove Payment Method?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground/80">
                <p>Are you sure you want to remove this card? This action cannot be undone.</p>
                {authorizations.find(a => a.id === deletingId)?.is_default && (
                  <div className="mt-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                    <p className="font-semibold text-sm text-red-600">
                      ⚠️ Warning: This is your default payment method.
                    </p>
                    <p className="text-sm mt-2 text-red-600/80">
                      You'll need to set a new default card for automatic billing.
                    </p>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="rounded-xl border-none bg-background/60 shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[inset_0_2px_8px_rgb(0,0,0,0.06)]">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleDeleteCard(deletingId)}
              className="bg-destructive hover:bg-destructive/90 rounded-xl shadow-lg"
            >
              Remove Card
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

