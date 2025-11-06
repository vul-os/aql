import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sprout, CheckCircle } from 'lucide-react';
import NumberTicker from '@/components/ui/number-ticker';

/**
 * Today's Coverage KPI Card
 * Shows area covered today with service completion count
 */
export function TodaysCoverageKPI({ 
  areaCovered = 0,
  targetArea = 0,
  servicesCompleted = 0,
  servicesScheduled = 0
}) {
  const coveragePercentage = targetArea > 0 ? (areaCovered / targetArea) * 100 : 0;
  const formattedArea = Math.round(areaCovered).toLocaleString();

  return (
    <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 group rounded-3xl">
      <CardContent className="relative p-6">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-green-500/20 to-green-500/10 dark:from-green-500/30 dark:to-green-500/20 flex items-center justify-center group-hover:scale-110 transition-all duration-500 shadow-[inset_2px_2px_5px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.7)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.1)]">
            <Sprout className="h-5 w-5 text-green-600 transition-all duration-500" />
          </div>
        </div>
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-4">
          Today's Coverage
        </p>

        {/* Main Numbers */}
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-4xl font-bold tabular-nums bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">
            <NumberTicker value={areaCovered} />
          </span>
          <span className="text-lg font-bold text-muted-foreground/70 tabular-nums">m²</span>
        </div>
        
        {targetArea > 0 && (
          <Badge variant="outline" className="mb-4 text-xs border-0 bg-green-500/10 text-green-600 font-semibold rounded-full">
            {Math.round(coveragePercentage)}% of target
          </Badge>
        )}

        {/* Progress Bar (if target exists) */}
        {targetArea > 0 && (
          <div className="mb-4">
            <div className="flex justify-between text-[11px] text-muted-foreground/70 mb-1.5 font-medium">
              <span>Progress</span>
              <span className="tabular-nums">{formattedArea} / {Math.round(targetArea).toLocaleString()} m²</span>
            </div>
            <div className="h-2.5 bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700 rounded-full overflow-hidden shadow-[inset_2px_2px_4px_rgba(0,0,0,0.1)]">
              <div 
                className="h-full bg-gradient-to-r from-green-500 to-green-600 transition-all duration-500 shadow-[0_0_10px_rgba(34,197,94,0.3)]"
                style={{ width: `${Math.min(100, coveragePercentage)}%` }}
              />
            </div>
          </div>
        )}

        {/* Services Info */}
        <div className="pt-4 border-t border-border/50">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <p className="text-sm">
              <span className="font-bold tabular-nums">{servicesCompleted}</span>
              <span className="text-muted-foreground/70 font-medium"> service{servicesCompleted !== 1 ? 's' : ''} completed</span>
            </p>
          </div>
          {servicesScheduled > 0 && (
            <p className="text-[11px] text-muted-foreground/70 mt-1 ml-6 font-medium">
              {servicesScheduled} scheduled for today
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

