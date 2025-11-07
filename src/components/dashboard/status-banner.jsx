import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle2, AlertTriangle, AlertCircle, Clock } from 'lucide-react';

/**
 * Prominent Status Banner - Executive Summary at a Glance
 * Shows overall system status with color-coded messaging
 */
export default function StatusBanner({ 
  status = 'operational', // operational, attention, critical, maintenance
  message,
  issueCount = 0,
  lastUpdated
}) {
  const statusConfig = {
    operational: {
      icon: CheckCircle2,
      bgGradient: 'from-emerald-500/10 via-emerald-500/5 to-transparent',
      borderColor: 'border-emerald-500/20',
      iconColor: 'text-emerald-500',
      iconBg: 'bg-emerald-500/10',
      textColor: 'text-emerald-900 dark:text-emerald-100',
      defaultMessage: 'All Systems Operational',
      description: 'Everything is running smoothly'
    },
    attention: {
      icon: AlertCircle,
      bgGradient: 'from-amber-500/10 via-amber-500/5 to-transparent',
      borderColor: 'border-amber-500/20',
      iconColor: 'text-amber-600',
      iconBg: 'bg-amber-500/10',
      textColor: 'text-amber-900 dark:text-amber-100',
      defaultMessage: `${issueCount} ${issueCount === 1 ? 'Issue' : 'Issues'} Need Attention`,
      description: 'Some items require your review'
    },
    critical: {
      icon: AlertTriangle,
      bgGradient: 'from-red-500/10 via-red-500/5 to-transparent',
      borderColor: 'border-red-500/20',
      iconColor: 'text-red-600',
      iconBg: 'bg-red-500/10',
      textColor: 'text-red-900 dark:text-red-100',
      defaultMessage: 'Critical Issues Detected',
      description: 'Immediate action required'
    },
    maintenance: {
      icon: Clock,
      bgGradient: 'from-blue-500/10 via-blue-500/5 to-transparent',
      borderColor: 'border-blue-500/20',
      iconColor: 'text-blue-600',
      iconBg: 'bg-blue-500/10',
      textColor: 'text-blue-900 dark:text-blue-100',
      defaultMessage: 'Scheduled Maintenance',
      description: 'System is operating in maintenance mode'
    }
  };

  const config = statusConfig[status] || statusConfig.operational;
  const Icon = config.icon;

  return (
    <Card className={`border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 rounded-3xl overflow-hidden relative`}>
      <CardContent className="p-4 relative">
        <div className="flex items-center gap-4">
          {/* Icon */}
          <div className={`h-12 w-12 rounded-2xl bg-gradient-to-br ${config.iconBg === 'bg-emerald-500/10' ? 'from-emerald-500/20 to-emerald-500/10 dark:from-emerald-500/30 dark:to-emerald-500/20' : config.iconBg === 'bg-amber-500/10' ? 'from-amber-500/20 to-amber-500/10 dark:from-amber-500/30 dark:to-amber-500/20' : config.iconBg === 'bg-red-500/10' ? 'from-red-500/20 to-red-500/10 dark:from-red-500/30 dark:to-red-500/20' : 'from-blue-500/20 to-blue-500/10 dark:from-blue-500/30 dark:to-blue-500/20'} flex items-center justify-center flex-shrink-0 shadow-[inset_2px_2px_5px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.7)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.1)]`}>
            <Icon className={`h-6 w-6 ${config.iconColor}`} />
          </div>
          
          {/* Content */}
          <div className="flex-1 min-w-0">
            <h2 className={`text-lg font-bold mb-0.5 bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent`}>
              {message || config.defaultMessage}
            </h2>
            <p className="text-xs text-muted-foreground/70 font-medium">
              {config.description}
            </p>
          </div>

          {/* Last Updated */}
          {lastUpdated && (
            <div className="text-right flex-shrink-0">
              <p className="text-xs text-muted-foreground/60 font-medium">
                Last updated
              </p>
              <p className="text-xs font-bold text-muted-foreground/80">
                {new Date(lastUpdated).toLocaleTimeString('en-US', { 
                  hour: '2-digit', 
                  minute: '2-digit' 
                })}
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

