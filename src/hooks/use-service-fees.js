import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Hook to fetch and manage service fees from the database
 * @param {Object} options - Configuration options
 * @param {string} options.feeType - Filter by specific fee type (optional)
 * @param {string} options.botType - Filter by specific bot type (optional)
 * @param {boolean} options.includeInactive - Include inactive fees (default: false)
 * @returns {Object} { fees, loading, error, refreshFees }
 */
export function useServiceFees(options = {}) {
  const [fees, setFees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchFees = async () => {
    try {
      setLoading(true);
      setError(null);

      // Use the active_service_fees view for better performance
      let query = supabase
        .from('active_service_fees')
        .select('*')
        .order('fee_type')
        .order('amount');

      // Apply filters if provided
      if (options.feeType) {
        query = query.eq('fee_type', options.feeType);
      }

      if (options.botType) {
        query = query.or(`applies_to.eq.all,bot_type.eq.${options.botType}`);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      setFees(data || []);
    } catch (err) {
      console.error('Error fetching service fees:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFees();
  }, [options.feeType, options.botType]);

  return {
    fees,
    loading,
    error,
    refreshFees: fetchFees
  };
}

/**
 * Hook to get a specific service fee by type
 * @param {string} feeType - The fee type to fetch
 * @param {string} botType - Optional bot type filter
 * @returns {Object} { fee, loading, error }
 */
export function useServiceFee(feeType, botType = null) {
  const [fee, setFee] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!feeType) {
      setLoading(false);
      return;
    }

    const fetchFee = async () => {
      try {
        setLoading(true);
        setError(null);

        const { data, error: fetchError } = await supabase
          .rpc('get_service_fee', {
            p_fee_type: feeType,
            p_bot_type: botType
          });

        if (fetchError) throw fetchError;

        setFee(data && data.length > 0 ? data[0] : null);
      } catch (err) {
        console.error('Error fetching service fee:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchFee();
  }, [feeType, botType]);

  return { fee, loading, error };
}

/**
 * Helper function to format fee amount with currency
 * @param {number} amount - The amount to format
 * @param {string} currency - The currency code (default: ZAR)
 * @returns {string} Formatted amount
 */
export function formatFeeAmount(amount, currency = 'ZAR') {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: currency
  }).format(amount);
}

/**
 * Get all fees grouped by type
 * @param {Array} fees - Array of fee objects
 * @returns {Object} Fees grouped by fee_type
 */
export function groupFeesByType(fees) {
  return fees.reduce((acc, fee) => {
    if (!acc[fee.fee_type]) {
      acc[fee.fee_type] = [];
    }
    acc[fee.fee_type].push(fee);
    return acc;
  }, {});
}

/**
 * Calculate total fees from an array of fee objects
 * @param {Array} fees - Array of fee objects
 * @param {boolean} includeTax - Whether to include tax (default: true)
 * @returns {number} Total amount
 */
export function calculateTotalFees(fees, includeTax = true) {
  return fees.reduce((total, fee) => {
    const amount = includeTax ? fee.amount_with_tax : fee.amount;
    return total + parseFloat(amount || 0);
  }, 0);
}

