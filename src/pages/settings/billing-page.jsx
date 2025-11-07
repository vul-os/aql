import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  FiCreditCard,
  FiPlus,
  FiTrash2,
  FiCheck,
  FiAlertCircle,
  FiLoader,
  FiStar,
  FiCalendar,
  FiDollarSign,
  FiTrendingUp,
  FiDownload,
  FiEye,
  FiFileText,
  FiArrowDown,
  FiArrowUp,
  FiActivity,
  FiCheckCircle,
  FiXCircle,
  FiClock,
  FiBarChart2,
  FiPieChart,
  FiZap,
  FiShield,
  FiTrendingDown,
  FiFilter,
  FiSearch,
  FiMoreVertical,
  FiRefreshCw
} from 'react-icons/fi';
import { MdReceipt, MdAccountBalanceWallet, MdSmartToy } from 'react-icons/md';
import { FaCcVisa, FaCcMastercard, FaCreditCard } from 'react-icons/fa';
import { supabase } from '@/lib/supabase';
import { usePaymentAuthorizations, usePaystack, formatCardNumber, formatExpiryDate, getCardIcon, isCardExpired } from '@/hooks/use-paystack';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';

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
  const [activeTab, setActiveTab] = useState('overview');
  const [transactionFilter, setTransactionFilter] = useState('all');

  useEffect(() => {
    if (organization?.id) {
      loadSubscriptions();
      loadInvoices();
      loadTransactions();
    }
  }, [organization?.id]);

  // Calculate total monthly from subscriptions
  const subscriptionsByLocation = useMemo(() => {
    return subscriptions.reduce((acc, sub) => {
      if (!acc[sub.location_id]) {
        acc[sub.location_id] = {
          location_name: sub.location_name,
          bot_rental_total: 0,
          service_fee: 0,
          agreements: []
        };
      }
      acc[sub.location_id].bot_rental_total += parseFloat(sub.bot_rental || 0);
      if (parseFloat(sub.service_fee || 0) > 0) {
        acc[sub.location_id].service_fee = parseFloat(sub.service_fee);
      }
      acc[sub.location_id].agreements.push(sub);
      return acc;
    }, {});
  }, [subscriptions]);

  const totalMonthly = useMemo(() => {
    return Object.values(subscriptionsByLocation).reduce((sum, location) => {
      return sum + location.bot_rental_total + location.service_fee;
    }, 0);
  }, [subscriptionsByLocation]);

  // Analytics calculations
  const analytics = useMemo(() => {
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    
    // Calculate spending this month
    const thisMonthInvoices = invoices.filter(inv => {
      const invDate = new Date(inv.issue_date);
      return invDate.getMonth() === thisMonth && invDate.getFullYear() === thisYear;
    });
    const thisMonthSpending = thisMonthInvoices.reduce((sum, inv) => sum + parseFloat(inv.total_amount || 0), 0);
    
    // Calculate last month spending
    const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
    const lastMonthYear = thisMonth === 0 ? thisYear - 1 : thisYear;
    const lastMonthInvoices = invoices.filter(inv => {
      const invDate = new Date(inv.issue_date);
      return invDate.getMonth() === lastMonth && invDate.getFullYear() === lastMonthYear;
    });
    const lastMonthSpending = lastMonthInvoices.reduce((sum, inv) => sum + parseFloat(inv.total_amount || 0), 0);
    
    // Calculate trend
    const spendingChange = lastMonthSpending > 0 
      ? ((thisMonthSpending - lastMonthSpending) / lastMonthSpending) * 100 
      : 0;
    
    // Transaction success rate
    const successfulTransactions = transactions.filter(t => t.status === 'success').length;
    const successRate = transactions.length > 0 
      ? (successfulTransactions / transactions.length) * 100 
      : 100;
    
    // Total spent (all time)
    const totalSpent = invoices
      .filter(inv => inv.status === 'paid')
      .reduce((sum, inv) => sum + parseFloat(inv.total_amount || 0), 0);
    
    // Pending payments
    const pendingAmount = invoices
      .filter(inv => inv.status === 'sent' || inv.status === 'overdue')
      .reduce((sum, inv) => sum + parseFloat(inv.total_amount || 0), 0);
    
    // Average monthly (based on historical data or current monthly if no history)
    const paidInvoicesCount = invoices.filter(inv => inv.status === 'paid').length;
    const avgMonthly = paidInvoicesCount > 0 ? totalSpent / paidInvoicesCount : totalMonthly;
    
    return {
      thisMonthSpending,
      lastMonthSpending,
      spendingChange,
      successRate,
      totalSpent,
      pendingAmount,
      avgMonthly,
      totalTransactions: transactions.length,
      successfulTransactions,
      failedTransactions: transactions.filter(t => t.status === 'failed').length,
    };
  }, [invoices, transactions, totalMonthly]);

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
        return 'bg-[#10B981]/10 text-[#10B981] dark:bg-[#10B981]/20 dark:text-[#10B981]';
      case 'sent':
      case 'pending':
        return 'bg-[#F59E0B]/10 text-[#F59E0B] dark:bg-[#F59E0B]/20 dark:text-[#F59E0B]';
      case 'overdue':
      case 'failed':
        return 'bg-[#EF4444]/10 text-[#EF4444] dark:bg-[#EF4444]/20 dark:text-[#EF4444]';
      case 'draft':
        return 'bg-[#B0B3B8]/10 text-[#B0B3B8] dark:bg-[#B0B3B8]/20 dark:text-[#B0B3B8]';
      default:
        return 'bg-[#B0B3B8]/10 text-[#B0B3B8] dark:bg-[#B0B3B8]/20 dark:text-[#B0B3B8]';
    }
  };

  const getTransactionIcon = (status) => {
    switch (status) {
      case 'success':
        return <FiCheckCircle className="h-5 w-5 text-[#10B981]" />;
      case 'failed':
        return <FiXCircle className="h-5 w-5 text-[#EF4444]" />;
      case 'pending':
        return <FiClock className="h-5 w-5 text-[#F59E0B]" />;
      default:
        return <FiActivity className="h-5 w-5 text-[#B0B3B8]" />;
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

  const nextBillingDate = subscriptions[0]?.next_billing_date;

  // Filtered transactions
  const filteredTransactions = useMemo(() => {
    if (transactionFilter === 'all') return transactions;
    return transactions.filter(t => t.status === transactionFilter);
  }, [transactions, transactionFilter]);

  return (
    <div className="p-3 space-y-3 max-w-[1600px] mx-auto">
      {/* Header - Soft UI */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 animate-in fade-in slide-in-from-top-3 duration-500">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">Billing & Payments</h1>
          <p className="text-xs text-muted-foreground mt-1 font-medium">
            Comprehensive financial overview & management
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => {
              loadSubscriptions();
              loadInvoices();
              loadTransactions();
            }}
            className="h-9 px-4 rounded-xl border-0 bg-gradient-to-br from-slate-100 to-white dark:from-slate-800 dark:to-slate-700 shadow-[4px_4px_12px_rgba(0,0,0,0.1),-4px_-4px_12px_rgba(255,255,255,0.9)] dark:shadow-[4px_4px_12px_rgba(0,0,0,0.3),-4px_-4px_12px_rgba(255,255,255,0.05)] hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.1),inset_-2px_-2px_6px_rgba(255,255,255,0.9)] dark:hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.3),inset_-2px_-2px_6px_rgba(255,255,255,0.05)] transition-all duration-300 active:scale-95"
          >
            <FiRefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Analytics Stats Grid - Soft UI */}
      {(invoices.length > 0 || transactions.length > 0) && (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 animate-in fade-in slide-in-from-bottom-3 duration-500 delay-100">
          {/* Monthly Bill Card */}
          <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 group rounded-3xl">
            <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-1.5 pt-3.5">
              <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Monthly Bill</CardTitle>
              <img src="/images/monthly-bill.png" alt="Monthly Bill" className="h-10 w-10 object-contain group-hover:scale-110 transition-all duration-500" />
            </CardHeader>
            <CardContent className="relative pb-3.5">
              <div className="text-3xl font-bold tabular-nums bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">R{totalMonthly.toFixed(2)}</div>
              {nextBillingDate && (
                <p className="text-[11px] text-muted-foreground font-semibold mt-1 flex items-center gap-1">
                  <FiCalendar className="h-3 w-3" />
                  Next: {new Date(nextBillingDate).toLocaleDateString('en-ZA', { month: 'short', day: 'numeric' })}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Total Spent Card */}
          <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 group rounded-3xl">
            <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-1.5 pt-3.5">
              <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total Spent</CardTitle>
              <img src="/images/pie-chart_7745797.png" alt="Total Spent" className="h-10 w-10 object-contain group-hover:scale-110 transition-all duration-500" />
            </CardHeader>
            <CardContent className="relative pb-3.5">
              <div className="text-3xl font-bold tabular-nums bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">R{analytics.totalSpent.toFixed(2)}</div>
              <p className="text-[11px] text-muted-foreground font-semibold mt-1">All-time payments</p>
            </CardContent>
          </Card>

          {/* Payment Success Rate Card */}
          <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 group rounded-3xl">
            <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-1.5 pt-3.5">
              <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Success Rate</CardTitle>
              <img src="/images/success-rate.png" alt="Success Rate" className="h-10 w-10 object-contain group-hover:scale-110 transition-all duration-500" />
            </CardHeader>
            <CardContent className="relative pb-3.5">
              <div className="text-3xl font-bold tabular-nums bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">{analytics.successRate.toFixed(1)}%</div>
              <p className="text-[11px] text-muted-foreground font-semibold mt-1">
                {analytics.successfulTransactions}/{analytics.totalTransactions} successful
              </p>
            </CardContent>
          </Card>

          {/* Spending Trend Card */}
          <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 group rounded-3xl">
            <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-1.5 pt-3.5">
              <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Monthly Trend</CardTitle>
              <img src="/images/trend.png" alt="Monthly Trend" className="h-10 w-10 object-contain group-hover:scale-110 transition-all duration-500" />
            </CardHeader>
            <CardContent className="relative pb-3.5">
              <div className={`text-3xl font-bold tabular-nums ${analytics.spendingChange >= 0 ? 'text-[#F59E0B]' : 'text-[#10B981]'}`}>
                {analytics.spendingChange >= 0 ? '+' : ''}{analytics.spendingChange.toFixed(1)}%
              </div>
              <p className="text-[11px] text-muted-foreground font-semibold mt-1">vs last month</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Quick Actions & Status Bar - Soft UI */}
      {(subscriptions.length > 0 || authorizations.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 animate-in fade-in slide-in-from-bottom-3 duration-500 delay-200">
          {authorizations.length > 0 && (
            <Card className="border-0 bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300">
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <img src="/images/active-icon.png" alt="Active" className="h-8 w-8 object-contain" />
                    <div>
                      <p className="text-xs text-muted-foreground font-medium">Auto-billing</p>
                      <p className="text-sm font-bold">Active</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {subscriptions.length > 0 && (
            <Card className="border-0 bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300">
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <img src="/images/3d-bot.png" alt="Active Bots" className="h-8 w-8 object-contain" />
                    <div>
                      <p className="text-xs text-muted-foreground font-medium">Active Bots</p>
                      <p className="text-sm font-bold">{subscriptions.length} Bot{subscriptions.length !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {authorizations.length > 0 && (
            <Card className="border-0 bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300">
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <img src="/images/card.png" alt="Payment Methods" className="h-8 w-8 object-contain" />
                    <div>
                      <p className="text-xs text-muted-foreground font-medium">Payment Methods</p>
                      <p className="text-sm font-bold">{authorizations.length} Card{authorizations.length !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Main Tabbed Content - Soft UI */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-3 animate-in fade-in slide-in-from-bottom-3 duration-500 delay-200">
        <TabsList className="grid w-full grid-cols-4 h-14 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 p-2 rounded-3xl shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] border-0 animate-in fade-in zoom-in-95 duration-300">
          <TabsTrigger 
            value="overview" 
            className="rounded-2xl data-[state=active]:bg-gradient-to-br data-[state=active]:from-botkorp-orange data-[state=active]:to-botkorp-orange/90 data-[state=active]:text-white data-[state=active]:shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] transition-all duration-300 text-xs font-bold hover:bg-botkorp-orange/5"
          >
            <FiBarChart2 className="h-3.5 w-3.5 mr-1.5" />
            Overview
          </TabsTrigger>
          <TabsTrigger 
            value="subscriptions" 
            className="rounded-2xl data-[state=active]:bg-gradient-to-br data-[state=active]:from-botkorp-orange data-[state=active]:to-botkorp-orange/90 data-[state=active]:text-white data-[state=active]:shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] transition-all duration-300 text-xs font-bold hover:bg-botkorp-orange/5"
          >
            <MdReceipt className="h-3.5 w-3.5 mr-1.5" />
            Subscriptions
          </TabsTrigger>
          <TabsTrigger 
            value="payments" 
            className="rounded-2xl data-[state=active]:bg-gradient-to-br data-[state=active]:from-botkorp-orange data-[state=active]:to-botkorp-orange/90 data-[state=active]:text-white data-[state=active]:shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] transition-all duration-300 text-xs font-bold hover:bg-botkorp-orange/5"
          >
            <FiCreditCard className="h-3.5 w-3.5 mr-1.5" />
            Payment Methods
          </TabsTrigger>
          <TabsTrigger 
            value="history" 
            className="rounded-2xl data-[state=active]:bg-gradient-to-br data-[state=active]:from-botkorp-orange data-[state=active]:to-botkorp-orange/90 data-[state=active]:text-white data-[state=active]:shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] transition-all duration-300 text-xs font-bold hover:bg-botkorp-orange/5"
          >
            <FiActivity className="h-3.5 w-3.5 mr-1.5" />
            History
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-3 mt-3">
          {/* Current Monthly Bill - Always show if there are subscriptions */}
          {subscriptions.length > 0 && (
            <Card className="bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 border-0 animate-in fade-in slide-in-from-bottom-3 duration-500">
              <CardHeader className="pb-3 pt-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <img src="/images/bill.png" alt="Current Billing" className="h-9 w-9 object-contain" />
                    <div>
                      <CardTitle className="text-base font-bold">Current Billing</CardTitle>
                      <CardDescription className="text-[11px] font-medium">Your active subscriptions and monthly cost</CardDescription>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4 pb-5">
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-gradient-to-r from-botkorp-orange/5 to-botkorp-orange/10 rounded-xl border border-botkorp-orange/20">
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Monthly Total</p>
                      <p className="text-3xl font-bold text-botkorp-orange">R{totalMonthly.toFixed(2)}</p>
                      <p className="text-xs text-muted-foreground mt-2">
                        {subscriptions.length} bot{subscriptions.length !== 1 ? 's' : ''} across {Object.keys(subscriptionsByLocation).length} location{Object.keys(subscriptionsByLocation).length !== 1 ? 's' : ''}
                      </p>
                    </div>
                    {nextBillingDate && (
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground mb-1">Next Billing</p>
                        <p className="text-sm font-semibold">
                          {new Date(nextBillingDate).toLocaleDateString('en-ZA', { 
                            month: 'short', 
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Spending Insights - Only show when there's invoice data */}
          {invoices.length > 0 && (
            <Card className="bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 border-0 animate-in fade-in slide-in-from-bottom-3 duration-500 delay-100">
              <CardHeader className="pb-3 pt-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <img src="/images/pie-chart.png" alt="Spending Insights" className="h-9 w-9 object-contain" />
                    <div>
                      <CardTitle className="text-base font-bold">Spending Insights</CardTitle>
                      <CardDescription className="text-[11px] font-medium">Your financial activity overview</CardDescription>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4 pb-5">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">This Month</p>
                    <p className="text-2xl font-bold">R{analytics.thisMonthSpending.toFixed(2)}</p>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-botkorp-orange to-botkorp-orange/70 transition-all duration-500"
                        style={{ width: `${Math.min((analytics.thisMonthSpending / (analytics.avgMonthly || 1)) * 100, 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {analytics.avgMonthly > 0 
                        ? `${((analytics.thisMonthSpending / analytics.avgMonthly) * 100).toFixed(0)}% of avg` 
                        : 'First month'}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Last Month</p>
                    <p className="text-2xl font-bold">R{analytics.lastMonthSpending.toFixed(2)}</p>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-[#4F5D75] to-[#6B7A94] transition-all duration-500"
                        style={{ width: `${Math.min((analytics.lastMonthSpending / (analytics.avgMonthly || 1)) * 100, 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">Previous period</p>
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Average Monthly</p>
                    <p className="text-2xl font-bold">R{analytics.avgMonthly.toFixed(2)}</p>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-[#B0B3B8] to-[#D0D2D5] w-full" />
                    </div>
                    <p className="text-xs text-muted-foreground">Historical average</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Empty State for Overview when no data */}
          {subscriptions.length === 0 && invoices.length === 0 && transactions.length === 0 && (
            <Card className="bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] animate-in fade-in slide-in-from-bottom-4 duration-500 border-0">
              <CardContent className="text-center py-16">
                <div className="h-24 w-24 rounded-3xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 mx-auto mb-6 flex items-center justify-center shadow-[0_8px_30px_rgb(255,107,53,0.15)] animate-in zoom-in-50 duration-500 delay-100">
                  <MdAccountBalanceWallet className="h-12 w-12 text-botkorp-orange" />
                </div>
                <h3 className="text-2xl font-bold mb-3 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-200">Welcome to Billing</h3>
                <p className="text-muted-foreground max-w-md mx-auto mb-6 text-sm leading-relaxed animate-in fade-in slide-in-from-bottom-2 duration-500 delay-300">
                  Get started by adding a payment method to enable automatic billing for your bot subscriptions
                </p>
                <Button 
                  onClick={handleAddCard}
                  disabled={processing}
                  className="h-11 px-6 font-semibold bg-gradient-to-br from-botkorp-orange to-botkorp-orange/90 shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] hover:shadow-[6px_6px_16px_rgba(0,0,0,0.25),-3px_-3px_10px_rgba(255,255,255,0.15)] active:scale-95 transition-all duration-300 rounded-2xl border-0 text-white animate-in fade-in zoom-in-50 duration-500 delay-400"
                >
                  {processing ? (
                    <>
                      <FiLoader className="h-4 w-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <FiPlus className="h-4 w-4 mr-2" />
                      Add Payment Method
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Recent Activity - Only show if there's data */}
          {(transactions.length > 0 || subscriptions.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Recent Transactions */}
              {transactions.length > 0 && (
                <Card className="bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 border-0 animate-in fade-in slide-in-from-bottom-3 duration-500 delay-200">
                  <CardHeader className="pb-3 pt-5">
                    <div className="flex items-center gap-3">
                      <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-[#4F5D75]/15 to-[#4F5D75]/5 flex items-center justify-center shadow-[0_4px_20px_rgb(79,93,117,0.15)]">
                        <FiActivity className="h-5 w-5 text-[#4F5D75]" />
                      </div>
                      <CardTitle className="text-base font-bold">Recent Transactions</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-4 pb-5">
                    <div className="space-y-3">
                      {transactions.slice(0, 5).map((transaction) => (
                        <div key={transaction.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 transition-colors">
                          <div className="flex items-center gap-2">
                            {getTransactionIcon(transaction.status)}
                            <div>
                              <p className="text-sm font-medium">{transaction.invoice?.invoice_number || 'Payment'}</p>
                              <p className="text-xs text-muted-foreground">
                                {new Date(transaction.created_at).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                          <p className="text-sm font-bold">R{parseFloat(transaction.amount).toFixed(2)}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Upcoming Payments */}
              {subscriptions.length > 0 && (
                <Card className="bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 border-0 animate-in fade-in slide-in-from-bottom-3 duration-500 delay-200">
                  <CardHeader className="pb-3 pt-5">
                    <div className="flex items-center gap-3">
                      <img src="/images/calendar.png" alt="Upcoming Payments" className="h-9 w-9 object-contain" />
                      <CardTitle className="text-base font-bold">Upcoming Payments</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-4 pb-5">
                    <div className="space-y-3">
                      {nextBillingDate && (
                        <div className="p-3 rounded-lg bg-botkorp-orange/5 border border-botkorp-orange/20">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium">Next Billing</p>
                              <p className="text-xs text-muted-foreground">
                                {new Date(nextBillingDate).toLocaleDateString('en-ZA', { 
                                  weekday: 'long',
                                  year: 'numeric', 
                                  month: 'long', 
                                  day: 'numeric' 
                                })}
                              </p>
                            </div>
                            <p className="text-lg font-bold text-botkorp-orange">R{totalMonthly.toFixed(2)}</p>
                          </div>
                        </div>
                      )}
                      {analytics.pendingAmount > 0 && (
                        <div className="p-3 rounded-lg bg-[#F59E0B]/5 border border-[#F59E0B]/20">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium">Pending Invoices</p>
                              <p className="text-xs text-muted-foreground">Requires payment</p>
                            </div>
                            <p className="text-lg font-bold text-[#F59E0B]">R{analytics.pendingAmount.toFixed(2)}</p>
                          </div>
                        </div>
                      )}
                      {!nextBillingDate && analytics.pendingAmount === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-8">No upcoming payments</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>

        {/* Subscriptions Tab */}
        <TabsContent value="subscriptions" className="space-y-3 mt-3">
          {subscriptions.length > 0 ? (
            <Card className="bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 border-0 animate-in fade-in slide-in-from-bottom-3 duration-500">
              <CardHeader className="pb-3 pt-5">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
                      <MdReceipt className="h-5 w-5 text-botkorp-orange" />
                    </div>
                    <div>
                      <CardTitle className="text-base font-bold">Active Subscriptions</CardTitle>
                      <CardDescription className="text-[11px] font-medium">
                        Bot services by location • {Object.keys(subscriptionsByLocation).length} location{Object.keys(subscriptionsByLocation).length !== 1 ? 's' : ''}
                      </CardDescription>
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-xs h-6 px-3 bg-botkorp-orange/10 text-botkorp-orange border-0 font-semibold rounded-full">
                    {subscriptions.length} Bot{subscriptions.length !== 1 ? 's' : ''}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-4 pb-5">
                <div>
            <div className="space-y-4">
              {Object.entries(subscriptionsByLocation).map(([locationId, locationData], locationIndex) => (
                <div key={locationId} className={locationIndex > 0 ? 'pt-4 border-t' : ''}>
                  {/* Location Header */}
                  <div className="mb-2.5">
                    <h3 className="font-semibold text-sm text-primary">{locationData.location_name}</h3>
                    <p className="text-[10px] text-muted-foreground">
                      {locationData.agreements.length} bot{locationData.agreements.length !== 1 ? 's' : ''} at this location
                    </p>
                  </div>

                  {/* Bot Rentals */}
                  {locationData.agreements.map((sub, index) => (
                    <div key={sub.id}>
                      <div className="flex items-center justify-between py-2.5 px-3 bg-background/40 rounded-lg">
                        <div className="flex items-center gap-2.5">
                          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.1)]">
                            <MdSmartToy className="h-4 w-4 text-botkorp-orange" />
                          </div>
                          <div>
                            <p className="font-semibold text-xs">
                              {sub.bot?.name || 'Bot Rental'}
                            </p>
                            <p className="text-[10px] text-muted-foreground/60">
                              R150/month per bot
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-base">R{parseFloat(sub.bot_rental).toFixed(2)}</p>
                        </div>
                      </div>
                      {index < locationData.agreements.length - 1 && <div className="h-1.5" />}
                    </div>
                  ))}

                  {/* Service Fee (once per location) */}
                  {locationData.service_fee > 0 && (
                    <div className="mt-1.5">
                      <div className="flex items-center justify-between py-2.5 px-3 bg-[#10B981]/5 rounded-lg border border-[#10B981]/10">
                        <div>
                          <p className="font-semibold text-xs">Monthly Service Fee</p>
                          <p className="text-[10px] text-muted-foreground/60">
                            Per location - includes edge trimming, battery swaps, bot servicing
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-base">R{locationData.service_fee.toFixed(2)}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Location Subtotal */}
                  <div className="mt-3 pt-3 border-t flex items-center justify-between px-2">
                    <p className="font-bold text-sm">Location Subtotal</p>
                    <p className="text-xl font-bold text-botkorp-orange">
                      R{(locationData.bot_rental_total + locationData.service_fee).toFixed(2)}
                    </p>
                  </div>
                </div>
              ))}
              
              {/* Grand Total */}
              <div className="mt-4 pt-4 border-t-2 bg-botkorp-orange/5 rounded-xl p-3.5">
                <div className="flex items-center justify-between">
                  <p className="text-base font-bold">Total Monthly</p>
                  <p className="text-3xl font-bold text-botkorp-orange">R{totalMonthly.toFixed(2)}</p>
                </div>
                <p className="text-[10px] text-muted-foreground/70 mt-1.5">
                  {subscriptions.length} bot{subscriptions.length !== 1 ? 's' : ''} across {Object.keys(subscriptionsByLocation).length} location{Object.keys(subscriptionsByLocation).length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] animate-in fade-in slide-in-from-bottom-4 duration-500 border-0">
              <CardContent className="text-center py-16">
                <div className="h-20 w-20 rounded-3xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 mx-auto mb-6 flex items-center justify-center shadow-[0_8px_30px_rgb(255,107,53,0.15)] animate-in zoom-in-50 duration-500 delay-100">
                  <MdReceipt className="h-10 w-10 text-botkorp-orange animate-pulse" />
                </div>
                <h3 className="text-xl font-bold mb-2 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-200">No active subscriptions</h3>
                <p className="text-muted-foreground max-w-sm mx-auto text-sm leading-relaxed animate-in fade-in slide-in-from-bottom-2 duration-500 delay-300">
                  You don't have any active bot subscriptions yet
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Payment Methods Tab */}
        <TabsContent value="payments" className="space-y-3 mt-3">
          <Card className="bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 border-0 animate-in fade-in slide-in-from-bottom-3 duration-500">
            <CardHeader className="pb-3 pt-5">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
                    <FiCreditCard className="h-5 w-5 text-botkorp-orange" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold">Payment Methods</CardTitle>
                    <CardDescription className="text-[11px] font-medium">Manage your saved cards for auto-billing</CardDescription>
                  </div>
                </div>
                <Button 
                  onClick={handleAddCard} 
                  disabled={processing}
                  className="h-9 px-4 text-xs font-semibold bg-gradient-to-br from-botkorp-orange to-botkorp-orange/90 shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] hover:shadow-[6px_6px_16px_rgba(0,0,0,0.25),-3px_-3px_10px_rgba(255,255,255,0.15)] active:scale-95 transition-all duration-300 rounded-2xl border-0 text-white"
                >
                  {processing ? (
                    <>
                      <FiLoader className="h-4 w-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <FiPlus className="h-4 w-4 mr-2" />
                      Add Card
                    </>
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-4 pb-5">
              <div>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <FiLoader className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : authorizations.length === 0 ? (
            <div className="text-center py-16">
              <div className="h-20 w-20 rounded-3xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 mx-auto mb-6 flex items-center justify-center shadow-[0_8px_30px_rgb(255,107,53,0.15)] animate-in zoom-in-50 duration-500 delay-100">
                <FiCreditCard className="h-10 w-10 text-botkorp-orange" />
              </div>
              <h3 className="text-xl font-bold mb-2 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-200">No payment methods</h3>
              <p className="text-muted-foreground/70 mb-6 max-w-sm mx-auto text-sm leading-relaxed animate-in fade-in slide-in-from-bottom-2 duration-500 delay-300">
                Add a card to enable automatic billing for your subscriptions
              </p>
              <Button 
                onClick={handleAddCard} 
                disabled={processing}
                className="h-11 px-6 font-semibold bg-gradient-to-br from-botkorp-orange to-botkorp-orange/90 shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] hover:shadow-[6px_6px_16px_rgba(0,0,0,0.25),-3px_-3px_10px_rgba(255,255,255,0.15)] active:scale-95 transition-all duration-300 rounded-2xl border-0 text-white animate-in fade-in zoom-in-50 duration-500 delay-400"
              >
                <FiPlus className="h-4 w-4 mr-2" />
                Add Your First Card
              </Button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {authorizations.map((auth) => {
                const expired = isCardExpired(auth.exp_month, auth.exp_year);
                
                return (
                  <div
                    key={auth.id}
                    className={`group relative p-3.5 rounded-xl transition-all ${
                      auth.is_default 
                        ? 'bg-botkorp-orange/5 shadow-[0_4px_20px_rgb(255,107,53,0.12)]' 
                        : 'bg-background/60 shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[0_4px_20px_rgb(0,0,0,0.08)]'
                    } ${expired ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <div className="flex items-center gap-3">
                        {/* Card Visual */}
                        <div className={`h-12 w-20 rounded-lg flex items-center justify-center shadow-lg ${
                          auth.is_default ? 'bg-gradient-to-br from-botkorp-orange to-botkorp-orange/70' : 'bg-gradient-to-br from-gray-700 to-gray-900'
                        } text-white`}>
                          <FiCreditCard className="h-6 w-6" />
                        </div>
                        
                        <div>
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <p className="text-sm font-semibold">
                              {formatCardNumber(auth.last4)}
                            </p>
                            {auth.is_default && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-botkorp-orange/15 text-botkorp-orange text-[9px] font-semibold">
                                <FiStar className="h-2.5 w-2.5 fill-current" />
                                Default
                              </span>
                            )}
                            {expired && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-[#EF4444]/15 text-[#EF4444] text-[9px] font-semibold">
                                Expired
                              </span>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
                            <span>{getCardIcon(auth.card_type)}</span>
                            <span className="flex items-center gap-0.5">
                              <FiCalendar className="h-2.5 w-2.5" />
                              {formatExpiryDate(auth.exp_month, auth.exp_year)}
                            </span>
                            {auth.bank && <span>• {auth.bank}</span>}
                          </div>
                          {auth.last_used_at && (
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              Last used {new Date(auth.last_used_at).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {!auth.is_default && !expired && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSetDefault(auth.id)}
                            disabled={settingDefaultId === auth.id}
                            className="h-8 px-3 text-xs rounded-xl border-0 bg-gradient-to-br from-slate-100 to-white dark:from-slate-800 dark:to-slate-700 shadow-[4px_4px_12px_rgba(0,0,0,0.1),-4px_-4px_12px_rgba(255,255,255,0.9)] dark:shadow-[4px_4px_12px_rgba(0,0,0,0.3),-4px_-4px_12px_rgba(255,255,255,0.05)] hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.1),inset_-2px_-2px_6px_rgba(255,255,255,0.9)] dark:hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.3),inset_-2px_-2px_6px_rgba(255,255,255,0.05)] transition-all duration-300 active:scale-95"
                          >
                            {settingDefaultId === auth.id ? (
                              <FiLoader className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <>
                                <FiStar className="h-3.5 w-3.5 mr-1" />
                                Set Default
                              </>
                            )}
                          </Button>
                        )}
                        
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeletingId(auth.id)}
                          className="h-8 w-8 p-0 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all active:scale-95"
                        >
                          <FiTrash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {expired && (
                      <div className="mt-4 p-3 bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-xl">
                        <div className="flex items-start gap-2">
                          <FiAlertCircle className="h-4 w-4 text-[#EF4444] mt-0.5" />
                          <p className="text-sm text-[#EF4444]">
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
                  <Alert className="mt-6 border-[#4F5D75]/20 bg-[#4F5D75]/5">
                    <FiAlertCircle className="h-4 w-4 text-[#4F5D75]" />
                    <AlertDescription className="text-sm">
                      <strong className="font-semibold">Card Verification:</strong> When adding a new card, we charge R1 to verify it. 
                      This may be refunded by your bank or appear as a pending transaction.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history" className="space-y-3 mt-3">
          {/* Transactions Section */}
          <Card className="bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 border-0 animate-in fade-in slide-in-from-bottom-3 duration-500">
            <CardHeader className="pb-3 pt-5">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-[#4F5D75]/15 to-[#4F5D75]/5 flex items-center justify-center shadow-[0_4px_20px_rgb(79,93,117,0.15)]">
                    <FiActivity className="h-5 w-5 text-[#4F5D75]" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold">Transaction History</CardTitle>
                    <CardDescription className="text-[11px] font-medium">All payment attempts and their status</CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={transactionFilter}
                    onChange={(e) => setTransactionFilter(e.target.value)}
                    className="h-9 px-3 rounded-xl border-0 bg-background/60 shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] text-sm font-medium"
                  >
                    <option value="all">All Transactions</option>
                    <option value="success">Successful</option>
                    <option value="failed">Failed</option>
                    <option value="pending">Pending</option>
                  </select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4 pb-5">
              <div>
          {loadingTransactions ? (
            <div className="flex items-center justify-center py-12">
              <FiLoader className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className="text-center py-16">
              <div className="h-20 w-20 rounded-3xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 mx-auto mb-6 flex items-center justify-center shadow-[0_8px_30px_rgb(255,107,53,0.15)] animate-in zoom-in-50 duration-500 delay-100">
                <FiActivity className="h-10 w-10 text-botkorp-orange animate-pulse" />
              </div>
              <h3 className="text-xl font-bold mb-2 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-200">
                {transactionFilter === 'all' ? 'No transactions yet' : `No ${transactionFilter} transactions`}
              </h3>
              <p className="text-muted-foreground max-w-sm mx-auto text-sm leading-relaxed animate-in fade-in slide-in-from-bottom-2 duration-500 delay-300">
                {transactionFilter === 'all' 
                  ? 'Your payment transactions will appear here once they are processed'
                  : 'No transactions found with this status'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTransactions.slice(0, 20).map((transaction, index) => (
                <div 
                  key={transaction.id}
                  className="flex items-center justify-between p-4 bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[0_4px_20px_rgb(0,0,0,0.08)] transition-all duration-300 rounded-xl animate-in fade-in slide-in-from-bottom-2"
                  style={{ animationDelay: `${index * 30}ms`, animationDuration: '400ms' }}
                >
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-xl bg-muted/50 flex items-center justify-center border border-border/30">
                      {getTransactionIcon(transaction.status)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm">
                          {transaction.invoice?.invoice_number || 'Payment Attempt'}
                        </p>
                        <Badge className={`text-xs ${getStatusColor(transaction.status)}`}>
                          {transaction.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                        <FiCalendar className="h-3 w-3" />
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
                            <span className="font-mono text-[10px]">{transaction.payment_reference}</span>
                          </>
                        )}
                      </div>
                      {transaction.error_message && transaction.status === 'failed' && (
                        <Alert className="mt-2 p-2 border-[#EF4444]/20 bg-[#EF4444]/5">
                          <AlertDescription className="text-xs text-[#EF4444]">
                            {transaction.error_message}
                          </AlertDescription>
                        </Alert>
                      )}
                      {transaction.attempt_number > 1 && (
                        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                          <FiRefreshCw className="h-3 w-3" />
                          Attempt #{transaction.attempt_number}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-bold">R{parseFloat(transaction.amount).toFixed(2)}</p>
                    {transaction.status === 'success' && transaction.processed_at && (
                      <p className="text-xs text-[#10B981] flex items-center gap-1 justify-end mt-1">
                        <FiCheckCircle className="h-3 w-3" />
                        Processed {new Date(transaction.processed_at).toLocaleDateString()}
                      </p>
                    )}
                    {transaction.status === 'pending' && transaction.next_retry_at && (
                      <p className="text-xs text-[#F59E0B] flex items-center gap-1 justify-end mt-1">
                        <FiClock className="h-3 w-3" />
                        Retry: {new Date(transaction.next_retry_at).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
              </div>
            </CardContent>
          </Card>

          {/* Invoices Section */}
          <Card className="bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 border-0 animate-in fade-in slide-in-from-bottom-3 duration-500 delay-100">
            <CardHeader className="pb-3 pt-5">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
                    <FiFileText className="h-5 w-5 text-botkorp-orange" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold">Invoices</CardTitle>
                    <CardDescription className="text-[11px] font-medium">View, download and manage your invoices</CardDescription>
                  </div>
                </div>
                {invoices.length > 0 && (
                  <Badge variant="secondary" className="text-xs h-6 px-3 bg-botkorp-orange/10 text-botkorp-orange border-0 font-semibold rounded-full">
                    {invoices.length} Invoice{invoices.length !== 1 ? 's' : ''}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-4 pb-5">
              <div>
          {loadingInvoices ? (
            <div className="flex items-center justify-center py-12">
              <FiLoader className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : invoices.length === 0 ? (
            <div className="text-center py-16">
              <div className="h-20 w-20 rounded-3xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 mx-auto mb-6 flex items-center justify-center shadow-[0_8px_30px_rgb(255,107,53,0.15)] animate-in zoom-in-50 duration-500 delay-100">
                <FiFileText className="h-10 w-10 text-botkorp-orange animate-pulse" />
              </div>
              <h3 className="text-xl font-bold mb-2 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-200">No invoices yet</h3>
              <p className="text-muted-foreground/70 max-w-sm mx-auto text-sm leading-relaxed animate-in fade-in slide-in-from-bottom-2 duration-500 delay-300">
                Your invoices will appear here once they are generated
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {invoices.map((invoice, index) => (
                <div 
                  key={invoice.id}
                  className="flex items-center justify-between p-4 bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[0_4px_20px_rgb(0,0,0,0.08)] transition-all duration-300 rounded-xl animate-in fade-in slide-in-from-bottom-2"
                  style={{ animationDelay: `${index * 30}ms`, animationDuration: '400ms' }}
                >
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center border border-botkorp-orange/20">
                      <MdReceipt className="h-6 w-6 text-botkorp-orange" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm">{invoice.invoice_number}</p>
                        <Badge className={`text-xs ${getStatusColor(invoice.status)}`}>
                          {invoice.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                        <FiCalendar className="h-3 w-3" />
                        <span>{new Date(invoice.issue_date).toLocaleDateString('en-ZA', { 
                          year: 'numeric', 
                          month: 'short', 
                          day: 'numeric' 
                        })}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="text-right">
                      <p className="text-xl font-bold">R{parseFloat(invoice.total_amount).toFixed(2)}</p>
                      {invoice.status === 'paid' && invoice.paid_date && (
                        <p className="text-xs text-[#10B981] flex items-center gap-1 justify-end mt-1">
                          <FiCheckCircle className="h-3 w-3" />
                          Paid {new Date(invoice.paid_date).toLocaleDateString()}
                        </p>
                      )}
                      {invoice.status !== 'paid' && invoice.due_date && (
                        <p className="text-xs text-[#F59E0B] flex items-center gap-1 justify-end mt-1">
                          <FiClock className="h-3 w-3" />
                          Due {new Date(invoice.due_date).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    {invoice.invoice_pdf_url ? (
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedInvoicePdf({ url: invoice.invoice_pdf_url, number: invoice.invoice_number })}
                          className="h-9 px-3 rounded-xl border-0 bg-gradient-to-br from-slate-100 to-white dark:from-slate-800 dark:to-slate-700 shadow-[4px_4px_12px_rgba(0,0,0,0.1),-4px_-4px_12px_rgba(255,255,255,0.9)] dark:shadow-[4px_4px_12px_rgba(0,0,0,0.3),-4px_-4px_12px_rgba(255,255,255,0.05)] hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.1),inset_-2px_-2px_6px_rgba(255,255,255,0.9)] dark:hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.3),inset_-2px_-2px_6px_rgba(255,255,255,0.05)] transition-all duration-300 active:scale-95"
                        >
                          <FiEye className="h-4 w-4 mr-2" />
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
                          className="h-9 px-3 rounded-xl border-0 bg-gradient-to-br from-botkorp-orange to-botkorp-orange/90 shadow-[4px_4px_12px_rgba(0,0,0,0.2),-2px_-2px_8px_rgba(255,255,255,0.1)] hover:shadow-[6px_6px_16px_rgba(0,0,0,0.25),-3px_-3px_10px_rgba(255,255,255,0.15)] active:scale-95 transition-all duration-300 text-white"
                        >
                          <FiDownload className="h-4 w-4 mr-2" />
                          Download
                        </Button>
                      </div>
                    ) : (
                      <Badge variant="secondary" className="text-xs">
                        <FiLoader className="h-3 w-3 mr-1 animate-spin" />
                        Generating PDF...
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Invoice PDF Viewer Dialog - Soft UI */}
      <Dialog open={!!selectedInvoicePdf} onOpenChange={() => setSelectedInvoicePdf(null)}>
        <DialogContent className="max-w-5xl h-[90vh] rounded-3xl bg-gradient-to-br from-background to-muted/20 shadow-[0_8px_30px_rgb(0,0,0,0.12)]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-xl font-bold">
              <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
                <FiFileText className="h-5 w-5 text-botkorp-orange" />
              </div>
              Invoice {selectedInvoicePdf?.number}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 w-full h-full">
            {selectedInvoicePdf?.url && (
              <iframe
                src={selectedInvoicePdf.url}
                className="w-full h-full rounded-2xl shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]"
                title="Invoice PDF"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog - Soft UI */}
      <AlertDialog open={!!deletingId} onOpenChange={() => setDeletingId(null)}>
        <AlertDialogContent className="rounded-3xl bg-gradient-to-br from-background to-muted/20 shadow-[0_8px_30px_rgb(0,0,0,0.12)] border-0">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl font-bold">Remove Payment Method?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>Are you sure you want to remove this card? This action cannot be undone.</p>
                {authorizations.find(a => a.id === deletingId)?.is_default && (
                  <div className="mt-3 p-4 bg-[#EF4444]/10 border-0 rounded-xl shadow-[inset_0_2px_8px_rgba(239,68,68,0.1)]">
                    <p className="font-semibold text-sm text-[#EF4444]">
                      ⚠️ Warning: This is your default payment method.
                    </p>
                    <p className="text-sm mt-2 text-[#EF4444]/80">
                      You'll need to set a new default card for automatic billing.
                    </p>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="rounded-xl border-0 bg-gradient-to-br from-slate-100 to-white dark:from-slate-800 dark:to-slate-700 shadow-[4px_4px_12px_rgba(0,0,0,0.1),-4px_-4px_12px_rgba(255,255,255,0.9)] dark:shadow-[4px_4px_12px_rgba(0,0,0,0.3),-4px_-4px_12px_rgba(255,255,255,0.05)] hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.1),inset_-2px_-2px_6px_rgba(255,255,255,0.9)] dark:hover:shadow-[inset_2px_2px_6px_rgba(0,0,0,0.3),inset_-2px_-2px_6px_rgba(255,255,255,0.05)] transition-all duration-300 active:scale-95">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleDeleteCard(deletingId)}
              className="bg-gradient-to-br from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 rounded-xl shadow-[4px_4px_12px_rgba(220,38,38,0.3),-2px_-2px_8px_rgba(255,255,255,0.1)] hover:shadow-[6px_6px_16px_rgba(220,38,38,0.4),-3px_-3px_10px_rgba(255,255,255,0.15)] transition-all duration-300 active:scale-95 border-0"
            >
              Remove Card
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

