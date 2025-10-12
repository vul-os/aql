import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/auth-context';

/**
 * Hook to manage Paystack payment authorizations
 */
export function usePaymentAuthorizations() {
  const [authorizations, setAuthorizations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { user } = useAuth();

  const fetchAuthorizations = async () => {
    if (!user) {
      setAuthorizations([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .rpc('get_user_authorizations', {
          p_user_id: user.id
        });

      if (fetchError) throw fetchError;

      setAuthorizations(data || []);
    } catch (err) {
      console.error('Error fetching authorizations:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuthorizations();
  }, [user]);

  return {
    authorizations,
    loading,
    error,
    refreshAuthorizations: fetchAuthorizations
  };
}

/**
 * Hook to manage Paystack payments
 */
export function usePaystack() {
  const [processing, setProcessing] = useState(false);
  const { user } = useAuth();

  /**
   * Add a new payment method (charges R1 verification)
   */
  const addPaymentMethod = async (email, organizationId) => {
    if (!user) throw new Error('User not authenticated');

    setProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke('get-authorization', {
        body: {
          email,
          amount: 100, // R1.00 in kobo
          metadata: {
            organization_id: organizationId,
            user_id: user.id
          }
        }
      });

      if (error) throw error;

      // Redirect to Paystack payment page
      if (data?.data?.authorization_url) {
        window.location.href = data.data.authorization_url;
      }

      return data;
    } catch (err) {
      console.error('Error adding payment method:', err);
      throw err;
    } finally {
      setProcessing(false);
    }
  };

  /**
   * Charge an existing authorization
   */
  const chargeAuthorization = async (authorizationCode, amount, email, description = 'Payment', metadata = {}) => {
    if (!user) throw new Error('User not authenticated');

    setProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke('charge-authorization', {
        body: {
          authorization_code: authorizationCode,
          amount,
          email,
          description,
          metadata: {
            ...metadata,
            user_id: user.id
          }
        }
      });

      if (error) throw error;

      return data;
    } catch (err) {
      console.error('Error charging authorization:', err);
      throw err;
    } finally {
      setProcessing(false);
    }
  };

  /**
   * Delete a payment authorization
   */
  const deleteAuthorization = async (authorizationId) => {
    if (!user) throw new Error('User not authenticated');

    setProcessing(true);
    try {
      const { data, error } = await supabase.rpc('delete_payment_authorization', {
        p_authorization_id: authorizationId,
        p_user_id: user.id
      });

      if (error) throw error;

      return data;
    } catch (err) {
      console.error('Error deleting authorization:', err);
      throw err;
    } finally {
      setProcessing(false);
    }
  };

  /**
   * Set default payment method
   */
  const setDefaultAuthorization = async (authorizationId) => {
    if (!user) throw new Error('User not authenticated');

    setProcessing(true);
    try {
      const { data, error } = await supabase.rpc('set_default_authorization', {
        p_authorization_id: authorizationId,
        p_user_id: user.id
      });

      if (error) throw error;

      return data;
    } catch (err) {
      console.error('Error setting default authorization:', err);
      throw err;
    } finally {
      setProcessing(false);
    }
  };

  return {
    processing,
    addPaymentMethod,
    chargeAuthorization,
    deleteAuthorization,
    setDefaultAuthorization
  };
}

/**
 * Format card number with asterisks
 */
export function formatCardNumber(last4, cardType = '') {
  return `•••• •••• •••• ${last4}`;
}

/**
 * Get card icon/brand
 */
export function getCardIcon(cardType) {
  const type = cardType?.toLowerCase();
  if (type?.includes('visa')) return '💳 Visa';
  if (type?.includes('mastercard')) return '💳 Mastercard';
  if (type?.includes('verve')) return '💳 Verve';
  return '💳 Card';
}

/**
 * Check if card is expired
 */
export function isCardExpired(expMonth, expYear) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const year = parseInt(expYear);
  const month = parseInt(expMonth);

  if (year < currentYear) return true;
  if (year === currentYear && month < currentMonth) return true;

  return false;
}

/**
 * Format expiry date
 */
export function formatExpiryDate(expMonth, expYear) {
  return `${expMonth.padStart(2, '0')}/${expYear.slice(-2)}`;
}

/**
 * Check if amount is valid (minimum R1)
 */
export function isValidAmount(amount) {
  const num = parseFloat(amount);
  return !isNaN(num) && num >= 1;
}

/**
 * Convert Rands to Kobo (Paystack uses kobo)
 */
export function randsToKobo(rands) {
  return Math.round(parseFloat(rands) * 100);
}

/**
 * Convert Kobo to Rands
 */
export function koboToRands(kobo) {
  return parseFloat(kobo) / 100;
}

