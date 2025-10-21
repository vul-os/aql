import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  DollarSign, 
  CheckCircle, 
  Clock, 
  AlertCircle,
  Loader2 
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

export default function DepositTracker({ organizationId, serviceId }) {
  const [deposits, setDeposits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totalPaid, setTotalPaid] = useState(0);
  const [totalPending, setTotalPending] = useState(0);

  useEffect(() => {
    loadDeposits();
  }, [organizationId, serviceId]);

  const loadDeposits = async () => {
    try {
      let query = supabase
        .from('deposits')
        .select('*, bots(name, bot_type)')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      if (serviceId) {
        query = query.eq('service_id', serviceId);
      }

      const { data, error } = await query;

      if (error) throw error;

      setDeposits(data || []);

      // Calculate totals
      const paid = data?.filter(d => d.payment_status === 'paid')
        .reduce((sum, d) => sum + parseFloat(d.deposit_amount), 0) || 0;
      const pending = data?.filter(d => d.payment_status === 'pending')
        .reduce((sum, d) => sum + parseFloat(d.deposit_amount), 0) || 0;

      setTotalPaid(paid);
      setTotalPending(pending);
    } catch (error) {
      console.error('Error loading deposits:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'paid':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'pending':
        return <Clock className="h-4 w-4 text-yellow-600" />;
      case 'refunded':
        return <AlertCircle className="h-4 w-4 text-blue-600" />;
      case 'forfeited':
        return <AlertCircle className="h-4 w-4 text-red-600" />;
      default:
        return <DollarSign className="h-4 w-4" />;
    }
  };

  const getStatusBadge = (status) => {
    const variants = {
      paid: 'default',
      pending: 'secondary',
      refunded: 'outline',
      forfeited: 'destructive',
    };
    return (
      <Badge variant={variants[status] || 'secondary'} className="capitalize">
        {status}
      </Badge>
    );
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            <CardTitle>Deposit Tracker</CardTitle>
          </div>
          <Badge variant="secondary">{deposits.length} deposit{deposits.length !== 1 ? 's' : ''}</Badge>
        </div>
        <CardDescription>
          Track deposits paid for your bot rentals
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 border rounded-lg bg-green-50 dark:bg-green-900/20">
            <p className="text-sm text-muted-foreground mb-1">Total Paid</p>
            <p className="text-2xl font-bold text-green-600">R{totalPaid.toFixed(2)}</p>
          </div>
          {totalPending > 0 && (
            <div className="p-4 border rounded-lg bg-yellow-50 dark:bg-yellow-900/20">
              <p className="text-sm text-muted-foreground mb-1">Pending</p>
              <p className="text-2xl font-bold text-yellow-600">R{totalPending.toFixed(2)}</p>
            </div>
          )}
        </div>

        {/* Deposit List */}
        {deposits.length > 0 ? (
          <div className="space-y-3">
            {deposits.map((deposit) => (
              <div
                key={deposit.id}
                className="p-4 border rounded-lg space-y-2"
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(deposit.payment_status)}
                      <span className="font-semibold">
                        {deposit.bots?.name || 'Bot'} - {deposit.bot_type}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground capitalize">
                      {deposit.deposit_type.replace('_', ' ')}
                    </p>
                  </div>
                  <div className="text-right space-y-1">
                    <p className="font-bold">R{parseFloat(deposit.deposit_amount).toFixed(2)}</p>
                    {getStatusBadge(deposit.payment_status)}
                  </div>
                </div>

                {deposit.paid_at && (
                  <div className="text-xs text-muted-foreground">
                    Paid: {new Date(deposit.paid_at).toLocaleDateString()}
                  </div>
                )}

                {deposit.payment_method && (
                  <div className="text-xs text-muted-foreground capitalize">
                    Method: {deposit.payment_method}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <Alert>
            <DollarSign className="h-4 w-4" />
            <AlertDescription>
              No deposits recorded yet. Deposits are required for each bot rental.
            </AlertDescription>
          </Alert>
        )}

        {/* Info */}
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            <strong>Important:</strong> Deposits are required for each bot and are typically non-refundable. They may be applied to damages or final invoices.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

