import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import NumberTicker from '@/components/ui/number-ticker';
import { TrendingUp, TrendingDown, Activity } from 'lucide-react';

/**
 * System Health Score Card
 * Shows overall system health score (0-100) with breakdown
 */
export function SystemHealthCard({ score = 0, trend = 0, breakdown = {} }) {
  const getHealthColor = (score) => {
    if (score >= 90) return 'text-green-600 dark:text-green-500';
    if (score >= 70) return 'text-yellow-600 dark:text-yellow-500';
    return 'text-red-600 dark:text-red-500';
  };

  const getHealthBg = (score) => {
    if (score >= 90) return 'bg-green-50 dark:bg-green-900/20';
    if (score >= 70) return 'bg-yellow-50 dark:bg-yellow-900/20';
    return 'bg-red-50 dark:bg-red-900/20';
  };

  const getHealthLabel = (score) => {
    if (score >= 90) return 'Excellent';
    if (score >= 70) return 'Good';
    if (score >= 50) return 'Fair';
    return 'Needs Attention';
  };

  return (
    <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 group rounded-3xl">
      <CardContent className="relative p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-blue-500/20 to-blue-500/10 dark:from-blue-500/30 dark:to-blue-500/20 flex items-center justify-center group-hover:scale-110 transition-all duration-500 shadow-[inset_2px_2px_5px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.7)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.1)]">
                <Activity className="h-5 w-5 text-blue-600 transition-all duration-500" />
              </div>
            </div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              System Health
            </p>
          </div>
          {trend !== 0 && (
            <div className={`px-3 py-1.5 rounded-full ${getHealthBg(score)} shadow-sm`}>
              <div className="flex items-center gap-1">
                {trend >= 0 ? (
                  <TrendingUp className="h-3.5 w-3.5 text-green-600" />
                ) : (
                  <TrendingDown className="h-3.5 w-3.5 text-red-600" />
                )}
                <span className={`text-xs font-semibold ${trend >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {Math.abs(trend)}%
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Main Score */}
        <div className="flex items-baseline gap-2 mb-1">
          <span className={`text-5xl font-bold tabular-nums ${getHealthColor(score)}`}>
            <NumberTicker value={Math.round(score)} />
          </span>
          <span className="text-2xl font-bold text-muted-foreground/70">/ 100</span>
        </div>
        <Badge variant="outline" className="mb-4 text-xs border-0 bg-muted/50 font-semibold rounded-full">
          {getHealthLabel(score)}
        </Badge>

        {/* Breakdown */}
        {breakdown && Object.keys(breakdown).length > 0 && (
          <div className="grid grid-cols-3 gap-3 pt-4 border-t border-border/50">
            <div>
              <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider mb-1 font-bold">
                Uptime
              </p>
              <p className="text-sm font-bold tabular-nums">
                {breakdown.uptime_percentage || 0}%
              </p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider mb-1 font-bold">
                Completion
              </p>
              <p className="text-sm font-bold tabular-nums">
                {breakdown.completion_rate || 0}%
              </p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider mb-1 font-bold">
                Efficiency
              </p>
              <p className="text-sm font-bold tabular-nums">
                {breakdown.efficiency || 0}%
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

