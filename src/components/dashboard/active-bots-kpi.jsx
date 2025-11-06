import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Bot, Battery, Wifi, AlertTriangle } from 'lucide-react';
import NumberTicker from '@/components/ui/number-ticker';

/**
 * Active Bots KPI Card
 * Shows operational bots with breakdown of status
 */
export function ActiveBotsKPI({ 
  operational = 0, 
  total = 0, 
  charging = 0, 
  offline = 0, 
  errors = 0 
}) {
  const operationalPercentage = total > 0 ? (operational / total) * 100 : 0;

  return (
    <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 group rounded-3xl">
      <CardContent className="relative p-6">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-botkorp-orange/20 to-botkorp-orange/10 dark:from-botkorp-orange/30 dark:to-botkorp-orange/20 flex items-center justify-center group-hover:scale-110 transition-all duration-500 shadow-[inset_2px_2px_5px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.7)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.1)]">
            <Bot className="h-5 w-5 text-botkorp-orange transition-all duration-500" />
          </div>
        </div>
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-4">
          Active Bots
        </p>

        {/* Main Numbers */}
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-5xl font-bold tabular-nums bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">
            <NumberTicker value={operational} />
          </span>
          <span className="text-2xl font-bold text-muted-foreground/70 tabular-nums">
            / {total}
          </span>
        </div>
        <Badge variant="outline" className="mb-4 text-xs border-0 bg-botkorp-orange/10 text-botkorp-orange font-semibold rounded-full">
          {Math.round(operationalPercentage)}% Online
        </Badge>

        {/* Progress Bar */}
        <div className="mb-4">
          <div className="h-2.5 bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700 rounded-full overflow-hidden shadow-[inset_2px_2px_4px_rgba(0,0,0,0.1)]">
            <div 
              className="h-full bg-gradient-to-r from-botkorp-orange to-botkorp-orange/90 transition-all duration-500 shadow-[0_0_10px_rgba(255,107,53,0.3)]"
              style={{ width: `${operationalPercentage}%` }}
            />
          </div>
        </div>

        {/* Breakdown */}
        <div className="grid grid-cols-3 gap-3 pt-4 border-t border-border/50">
          <div className="flex flex-col">
            <div className="flex items-center gap-1 mb-1">
              <Battery className="h-3.5 w-3.5 text-yellow-600" />
              <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider font-bold">
                Charging
              </p>
            </div>
            <p className="text-sm font-bold tabular-nums">{charging}</p>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1 mb-1">
              <Wifi className="h-3.5 w-3.5 text-gray-400" />
              <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider font-bold">
                Offline
              </p>
            </div>
            <p className="text-sm font-bold tabular-nums">{offline}</p>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1 mb-1">
              <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
              <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider font-bold">
                Errors
              </p>
            </div>
            <p className="text-sm font-bold tabular-nums">{errors}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

