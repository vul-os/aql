import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, AlertCircle, Info, ArrowRight } from 'lucide-react';
import NumberTicker from '@/components/ui/number-ticker';

/**
 * Active Alerts KPI Card
 * Shows alert count by severity with quick view action
 */
export function ActiveAlertsKPI({ 
  total = 0,
  critical = 0, 
  warning = 0, 
  info = 0,
  onViewAll
}) {
  const getSeverityColor = () => {
    if (critical > 0) return 'from-red-500 to-red-600';
    if (warning > 0) return 'from-yellow-500 to-yellow-600';
    if (info > 0) return 'from-blue-500 to-blue-600';
    return 'from-gray-400 to-gray-500';
  };

  const getStatus = () => {
    if (total === 0) return 'All Clear';
    if (critical > 0) return 'Critical';
    if (warning > 0) return 'Warning';
    return 'Info';
  };

  return (
    <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 group rounded-3xl">
      <CardContent className="relative p-6">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <div className={`h-10 w-10 rounded-2xl bg-gradient-to-br ${critical > 0 ? 'from-red-500/20 to-red-500/10 dark:from-red-500/30 dark:to-red-500/20' : 'from-gray-400/15 to-gray-400/5'} flex items-center justify-center group-hover:scale-110 transition-all duration-500 shadow-[inset_2px_2px_5px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.7)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.1)]`}>
            <AlertTriangle className={`h-5 w-5 ${critical > 0 ? 'text-red-600' : 'text-gray-500'} transition-all duration-500`} />
          </div>
        </div>
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-4">
          Active Alerts
        </p>

        {/* Main Number */}
        <div className="flex items-baseline gap-2 mb-1">
          <span className={`text-5xl font-bold tabular-nums ${total > 0 ? (critical > 0 ? 'text-red-600' : warning > 0 ? 'text-yellow-600' : 'text-blue-600') : 'text-gray-400'}`}>
            <NumberTicker value={total} />
          </span>
        </div>
        <Badge 
          variant={total === 0 ? "outline" : critical > 0 ? "destructive" : "default"} 
          className="mb-4 text-xs border-0 font-semibold rounded-full"
        >
          {getStatus()}
        </Badge>

        {/* Breakdown */}
        <div className="grid grid-cols-3 gap-3 pt-4 border-t border-border/50">
          <div className="flex flex-col">
            <div className="flex items-center gap-1 mb-1">
              <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
              <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider font-bold">
                Critical
              </p>
            </div>
            <p className="text-sm font-bold tabular-nums">{critical}</p>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1 mb-1">
              <AlertCircle className="h-3.5 w-3.5 text-yellow-600" />
              <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider font-bold">
                Warning
              </p>
            </div>
            <p className="text-sm font-bold tabular-nums">{warning}</p>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1 mb-1">
              <Info className="h-3.5 w-3.5 text-blue-600" />
              <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider font-bold">
                Info
              </p>
            </div>
            <p className="text-sm font-bold tabular-nums">{info}</p>
          </div>
        </div>

        {/* View All Button */}
        {total > 0 && onViewAll && (
          <Button
            variant="outline"
            size="sm"
            onClick={onViewAll}
            className="w-full mt-4 text-xs h-9 font-semibold rounded-xl border-0 bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[0_4px_20px_rgb(220,38,38,0.25)] hover:bg-red-600 hover:text-white transition-all duration-300 active:scale-95"
          >
            View All Alerts
            <ArrowRight className="h-3 w-3 ml-1.5" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

