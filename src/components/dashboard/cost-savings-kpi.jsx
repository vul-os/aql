import React from 'react';
import CompactKPICard from './compact-kpi-card';
import { DollarSign } from 'lucide-react';

/**
 * Cost Savings KPI - Shows ROI and value proposition
 */
export default function CostSavingsKPI({ 
  monthlySavings = 0,
  comparisonText = 'vs traditional service',
  trend,
  onClick 
}) {
  // Format currency
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  return (
    <CompactKPICard
      image="/images/3d-wallet.png"
      label="Cost Saved"
      value={formatCurrency(monthlySavings)}
      subtitle={comparisonText}
      trend={trend}
      color="green"
      onClick={onClick}
    />
  );
}

