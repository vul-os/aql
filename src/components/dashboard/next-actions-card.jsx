import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  AlertTriangle, 
  AlertCircle, 
  ArrowRight,
  Sparkles
} from 'lucide-react';

/**
 * Next Actions Card - Shows prioritized actions or "All Clear" status
 * Helps users understand what needs attention immediately
 */
export default function NextActionsCard({ actions = [], onActionClick }) {
  // If no actions, show "All Clear" state
  if (!actions || actions.length === 0) {
    return (
      <Card className="border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 rounded-3xl overflow-hidden">
        <CardContent className="p-5 relative">
          <div className="flex items-start gap-3 mb-4">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-emerald-500/10 dark:from-emerald-500/30 dark:to-emerald-500/20 flex items-center justify-center flex-shrink-0 shadow-[inset_2px_2px_5px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.7)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.1)]">
              <img src="/images/3d-mark.png" alt="All Clear" className="h-6 w-6 object-contain" />
            </div>
            <div>
              <h3 className="text-sm font-bold mb-1">All Clear</h3>
              <p className="text-xs text-muted-foreground/70 font-medium">
                No action items at the moment
              </p>
            </div>
          </div>
          <div className="text-center py-6">
            <Sparkles className="h-8 w-8 text-emerald-500/40 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground/60 font-medium">
              Everything is running smoothly
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getSeverityConfig = (severity) => {
    switch (severity) {
      case 'critical':
        return {
          icon: AlertTriangle,
          badgeClass: 'bg-red-500/10 text-red-700 dark:text-red-400 border-0',
          iconBg: 'bg-red-500/10',
          iconColor: 'text-red-600'
        };
      case 'high':
        return {
          icon: AlertCircle,
          badgeClass: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-0',
          iconBg: 'bg-amber-500/10',
          iconColor: 'text-amber-600'
        };
      default:
        return {
          icon: AlertCircle,
          badgeClass: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-0',
          iconBg: 'bg-blue-500/10',
          iconColor: 'text-blue-600'
        };
    }
  };

  return (
    <Card className="border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 rounded-3xl">
      <CardContent className="p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-botkorp-orange/20 to-botkorp-orange/10 dark:from-botkorp-orange/30 dark:to-botkorp-orange/20 flex items-center justify-center shadow-[inset_2px_2px_5px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.7)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.1)]">
            <AlertCircle className="h-5 w-5 text-botkorp-orange" />
          </div>
          <div>
            <h3 className="text-sm font-bold">Action Items</h3>
            <p className="text-xs text-muted-foreground/70 font-medium">
              {actions.length} {actions.length === 1 ? 'item' : 'items'} need attention
            </p>
          </div>
        </div>

        <div className="space-y-2.5">
          {actions.slice(0, 3).map((action, idx) => {
            const config = getSeverityConfig(action.severity);
            const Icon = config.icon;
            
            return (
              <div
                key={action.id || idx}
                className="group p-3 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[0_4px_20px_rgb(255,107,53,0.15)] transition-all duration-300 cursor-pointer active:scale-98"
                onClick={() => onActionClick && onActionClick(action)}
              >
                <div className="flex items-start gap-3">
                  <div className={`h-8 w-8 rounded-lg ${config.iconBg} flex items-center justify-center flex-shrink-0`}>
                    <Icon className={`h-4 w-4 ${config.iconColor}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-xs font-semibold text-foreground/90 line-clamp-1">
                        {action.title}
                      </p>
                      <Badge className={`${config.badgeClass} text-[10px] px-1.5 py-0 h-5 flex-shrink-0`}>
                        {action.severity}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground/70 font-medium line-clamp-1">
                      {action.description}
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-botkorp-orange transition-colors flex-shrink-0" />
                </div>
              </div>
            );
          })}
        </div>

        {actions.length > 3 && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full mt-3 text-xs font-semibold text-botkorp-orange hover:text-botkorp-orange hover:bg-botkorp-orange/10"
          >
            View all {actions.length} items
            <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

