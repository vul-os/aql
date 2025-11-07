import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

/**
 * Compact KPI Card - Elegant and space-efficient metric display
 * Perfect for 5-column grid layout
 */
export default function CompactKPICard({
  icon: Icon,
  label,
  value,
  subtitle,
  trend, // { value: number, direction: 'up' | 'down' | 'neutral' }
  color = 'orange', // orange, blue, green, purple, red
  onClick
}) {
  const colorConfig = {
    orange: {
      iconBg: 'bg-botkorp-orange/10',
      iconColor: 'text-botkorp-orange',
      trendUpColor: 'text-emerald-600',
      trendDownColor: 'text-red-600'
    },
    blue: {
      iconBg: 'bg-blue-500/10',
      iconColor: 'text-blue-600',
      trendUpColor: 'text-emerald-600',
      trendDownColor: 'text-red-600'
    },
    green: {
      iconBg: 'bg-emerald-500/10',
      iconColor: 'text-emerald-600',
      trendUpColor: 'text-emerald-600',
      trendDownColor: 'text-red-600'
    },
    purple: {
      iconBg: 'bg-purple-500/10',
      iconColor: 'text-purple-600',
      trendUpColor: 'text-emerald-600',
      trendDownColor: 'text-red-600'
    },
    red: {
      iconBg: 'bg-red-500/10',
      iconColor: 'text-red-600',
      trendUpColor: 'text-emerald-600',
      trendDownColor: 'text-red-600'
    }
  };

  const config = colorConfig[color] || colorConfig.orange;

  const getTrendIcon = () => {
    if (!trend) return null;
    if (trend.direction === 'up') return TrendingUp;
    if (trend.direction === 'down') return TrendingDown;
    return Minus;
  };

  const TrendIcon = getTrendIcon();

  return (
    <Card 
      className={`border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 rounded-3xl ${onClick ? 'cursor-pointer group' : ''}`}
      onClick={onClick}
    >
      <CardContent className="p-4 relative">
        {/* Icon & Trend */}
        <div className="flex items-start justify-between mb-3">
          <div className={`h-10 w-10 rounded-2xl ${config.iconBg} flex items-center justify-center shadow-[inset_2px_2px_5px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.7)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.1)] ${onClick ? 'group-hover:scale-110 transition-all duration-500' : ''}`}>
            <Icon className={`h-5 w-5 ${config.iconColor}`} />
          </div>
          {trend && TrendIcon && (
            <div className={`flex items-center gap-1 ${
              trend.direction === 'up' ? config.trendUpColor : 
              trend.direction === 'down' ? config.trendDownColor : 
              'text-muted-foreground/60'
            }`}>
              <TrendIcon className="h-3.5 w-3.5" />
              <span className="text-xs font-semibold">{Math.abs(trend.value)}%</span>
            </div>
          )}
        </div>

        {/* Value */}
        <div className="mb-2">
          <div className="text-2xl font-bold tabular-nums bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent mb-0.5">
            {value}
          </div>
          <div className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider">
            {label}
          </div>
        </div>

        {/* Subtitle */}
        {subtitle && (
          <p className="text-xs text-muted-foreground/70 font-medium line-clamp-1">
            {subtitle}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

