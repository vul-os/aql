import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Smartphone, Monitor, Tablet, Trash2, AlertCircle, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';

export default function PushSubscriptionDevices({ userId }) {
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const { toast } = useToast();

  useEffect(() => {
    if (userId) {
      loadSubscriptions();
    }
  }, [userId]);

  const loadSubscriptions = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('push_subscriptions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setSubscriptions(data || []);
    } catch (error) {
      console.error('Error loading subscriptions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSubscription = async (subscriptionId) => {
    try {
      setDeletingId(subscriptionId);
      
      const { error } = await supabase
        .from('push_subscriptions')
        .update({ is_active: false })
        .eq('id', subscriptionId)
        .eq('user_id', userId);

      if (error) throw error;

      toast({
        title: 'Device Removed',
        description: 'Push notifications disabled for this device',
      });

      loadSubscriptions();
    } catch (error) {
      console.error('Error deleting subscription:', error);
      toast({
        title: 'Error',
        description: 'Failed to remove device',
        variant: 'destructive'
      });
    } finally {
      setDeletingId(null);
    }
  };

  const getDeviceIcon = (device) => {
    const os = device.os?.toLowerCase() || '';
    const browser = device.browser?.toLowerCase() || '';
    
    if (os.includes('android') || os.includes('ios')) {
      return <Smartphone className="h-5 w-5" />;
    } else if (os.includes('ipad') || browser.includes('tablet')) {
      return <Tablet className="h-5 w-5" />;
    }
    return <Monitor className="h-5 w-5" />;
  };

  const getDeviceLabel = (device) => {
    const os = device.os || 'Unknown OS';
    const browser = device.browser || 'Unknown Browser';
    return `${browser} on ${os}`;
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="h-5 w-5" />
          Active Devices
        </CardTitle>
        <CardDescription>
          Manage which devices receive push notifications
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {subscriptions.length === 0 ? (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              No devices registered for push notifications yet.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {subscriptions.map((sub) => (
              <div
                key={sub.id}
                className="flex items-center justify-between p-4 border rounded-lg"
              >
                <div className="flex items-center gap-3">
                  {getDeviceIcon(sub)}
                  <div>
                    <p className="font-medium">{getDeviceLabel(sub)}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                      <span>Added {formatDistanceToNow(new Date(sub.created_at), { addSuffix: true })}</span>
                      {sub.is_active ? (
                        <Badge variant="outline" className="text-xs">Active</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">Disabled</Badge>
                      )}
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDeleteSubscription(sub.id)}
                  disabled={deletingId === sub.id}
                >
                  {deletingId === sub.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}


