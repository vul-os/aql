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

      {/* Subscriptions Grouped by Location */}
      {subscriptions.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-2xl">Active Subscriptions</CardTitle>
                <CardDescription>
                  Your current bot services grouped by location
                  {Object.keys(subscriptionsByLocation).length > 1 && ` • ${Object.keys(subscriptionsByLocation).length} locations`}
                </CardDescription>
              </div>
              <Receipt className="h-6 w-6 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
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
                      <div className="flex items-center justify-between py-3 pl-4">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                            <BotIcon className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium">
                              {sub.bot?.name || 'Bot Rental'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              R150/month per bot
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-bold">R{parseFloat(sub.bot_rental).toFixed(2)}</p>
                        </div>
                      </div>
                      {index < locationData.agreements.length - 1 && <Separator className="ml-4" />}
                    </div>
                  ))}

                  {/* Service Fee (once per location) */}
                  {locationData.service_fee > 0 && (
                    <>
                      <Separator className="ml-4 my-2" />
                      <div className="flex items-center justify-between py-3 pl-4 bg-accent/5 rounded-lg">
                        <div>
                          <p className="font-medium">Monthly Service Fee</p>
                          <p className="text-xs text-muted-foreground">
                            Per location - includes edge trimming, battery swaps, bot servicing
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold">R{locationData.service_fee.toFixed(2)}</p>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Location Subtotal */}
                  <div className="mt-3 pt-3 border-t flex items-center justify-between pl-4">
                    <p className="font-semibold">Location Subtotal</p>
                    <p className="text-xl font-bold text-primary">
                      R{(locationData.bot_rental_total + locationData.service_fee).toFixed(2)}
                    </p>
                  </div>
                </div>
              ))}
              
              {/* Grand Total */}
              <div className="pt-4 border-t-2">
                <div className="flex items-center justify-between">
                  <p className="text-lg font-semibold">Total Monthly</p>
                  <p className="text-3xl font-bold text-primary">R{totalMonthly.toFixed(2)}</p>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {subscriptions.length} bot{subscriptions.length !== 1 ? 's' : ''} across {Object.keys(subscriptionsByLocation).length} location{Object.keys(subscriptionsByLocation).length !== 1 ? 's' : ''}
                </p>
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
            <Alert className="mt-6 bg-accent/5 dark:bg-accent/10 border-accent/20 dark:border-accent/30">
              <AlertCircle className="h-4 w-4 text-accent" />
              <AlertDescription className="text-sm">
                <strong>Card Verification:</strong> When adding a new card, we charge R1 to verify it. 
                This may be refunded by your bank or appear as a pending transaction.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Transactions Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl flex items-center gap-2">
                <Activity className="h-6 w-6" />
                Transactions
              </CardTitle>
              <CardDescription>
                Payment history and transaction details
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loadingTransactions ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-16">
              <div className="h-20 w-20 rounded-full bg-muted mx-auto mb-6 flex items-center justify-center">
                <Activity className="h-10 w-10 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-semibold mb-2">No transactions yet</h3>
              <p className="text-muted-foreground max-w-sm mx-auto">
                Your payment transactions will appear here once they are processed
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {transactions.slice(0, 10).map((transaction) => (
                <div 
                  key={transaction.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center">
                      {getTransactionIcon(transaction.status)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">
                          {transaction.invoice?.invoice_number || 'Payment Attempt'}
                        </p>
                        <Badge className={getStatusColor(transaction.status)}>
                          {transaction.status}
                        </Badge>
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
        </CardContent>
      </Card>

      {/* Invoices Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl flex items-center gap-2">
                <Receipt className="h-6 w-6" />
                Invoices
              </CardTitle>
              <CardDescription>
                View and download your invoices
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loadingInvoices ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : invoices.length === 0 ? (
            <div className="text-center py-16">
              <div className="h-20 w-20 rounded-full bg-muted mx-auto mb-6 flex items-center justify-center">
                <FileText className="h-10 w-10 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-semibold mb-2">No invoices yet</h3>
              <p className="text-muted-foreground max-w-sm mx-auto">
                Your invoices will appear here once they are generated
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {invoices.map((invoice) => (
                <div 
                  key={invoice.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                      <FileText className="h-6 w-6 text-primary" />
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
                        <Badge className={getStatusColor(invoice.status)}>
                          {invoice.status}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-lg font-bold">R{parseFloat(invoice.total_amount).toFixed(2)}</p>
                      {invoice.status === 'paid' && invoice.paid_date && (
                        <p className="text-xs text-muted-foreground">
                          Paid {new Date(invoice.paid_date).toLocaleDateString()}
                        </p>
                      )}
                      {invoice.status !== 'paid' && invoice.due_date && (
                        <p className="text-xs text-muted-foreground">
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
                        >
                          <Download className="h-4 w-4 mr-1" />
                          Download
                        </Button>
                      </div>
                    )}
                    {!invoice.invoice_pdf_url && (
                      <Badge variant="outline">Generating PDF...</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Invoice PDF Viewer Dialog */}
      <Dialog open={!!selectedInvoicePdf} onOpenChange={() => setSelectedInvoicePdf(null)}>
        <DialogContent className="max-w-5xl h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Invoice {selectedInvoicePdf?.number}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 w-full h-full">
            {selectedInvoicePdf?.url && (
              <iframe
                src={selectedInvoicePdf.url}
                className="w-full h-full rounded-lg border"
                title="Invoice PDF"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletingId} onOpenChange={() => setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Payment Method?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>Are you sure you want to remove this card? This action cannot be undone.</p>
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
              </div>
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

