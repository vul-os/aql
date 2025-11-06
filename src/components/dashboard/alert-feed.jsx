import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  AlertTriangle, 
  AlertCircle, 
  Info, 
  Bot, 
  MapPin,
  Clock,
  X,
  Eye
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

/**
 * Alert Card Component
 * Individual alert item with actions
 */
function AlertCard({ alert, onDismiss, onView }) {
  const getSeverityConfig = (severity) => {
    const configs = {
      critical: {
        icon: AlertTriangle,
        bgColor: 'bg-red-50 dark:bg-red-900/20',
        borderColor: 'border-l-red-500',
        iconColor: 'text-red-600',
        badge: 'destructive'
      },
      error: {
        icon: AlertCircle,
        bgColor: 'bg-orange-50 dark:bg-orange-900/20',
        borderColor: 'border-l-orange-500',
        iconColor: 'text-orange-600',
        badge: 'destructive'
      },
      warning: {
        icon: AlertTriangle,
        bgColor: 'bg-yellow-50 dark:bg-yellow-900/20',
        borderColor: 'border-l-yellow-500',
        iconColor: 'text-yellow-600',
        badge: 'default'
      },
      info: {
        icon: Info,
        bgColor: 'bg-blue-50 dark:bg-blue-900/20',
        borderColor: 'border-l-blue-500',
        iconColor: 'text-blue-600',
        badge: 'secondary'
      }
    };
    return configs[severity] || configs.info;
  };

  const config = getSeverityConfig(alert.severity);
  const Icon = config.icon;

  return (
    <div className={`border-l-4 ${config.borderColor} ${config.bgColor} rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_20px_rgba(0,0,0,0.08)] transition-all duration-300 p-4`}>
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="flex-shrink-0 mt-0.5">
          <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-white/80 to-white/40 dark:from-slate-800/80 dark:to-slate-700/40 flex items-center justify-center shadow-sm">
            <Icon className={`h-5 w-5 ${config.iconColor}`} />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-bold text-sm">{alert.title}</h4>
              <Badge variant={config.badge} className="text-[10px] h-5 border-0 font-semibold rounded-full">
                {alert.severity.toUpperCase()}
              </Badge>
            </div>
            {onDismiss && (
              <button
                onClick={() => onDismiss(alert.id)}
                className="flex-shrink-0 h-6 w-6 rounded-lg bg-background/60 hover:bg-red-100 dark:hover:bg-red-900/20 flex items-center justify-center text-muted-foreground hover:text-red-600 transition-all duration-300 active:scale-95"
                aria-label="Dismiss alert"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Description */}
          <p className="text-sm text-muted-foreground/70 mb-3 font-medium">
            {alert.description}
          </p>

          {/* Metadata */}
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground/70 mb-3 font-medium">
            {alert.bot_name && (
              <div className="flex items-center gap-1">
                <Bot className="h-3 w-3" />
                <span className="font-bold">{alert.bot_name}</span>
              </div>
            )}
            {alert.location_name && (
              <div className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                <span>{alert.location_name}</span>
              </div>
            )}
            {alert.created_at && (
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                <span>{formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}</span>
              </div>
            )}
          </div>

          {/* Actions */}
          {onView && (
            <div className="flex gap-2">
              <Button 
                size="sm" 
                onClick={() => onView(alert)}
                className="h-8 text-xs font-semibold rounded-lg bg-background/60 hover:bg-botkorp-orange hover:text-white transition-all duration-300 active:scale-95"
              >
                <Eye className="h-3 w-3 mr-1" />
                View Details
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Alert Feed Component
 * Displays list of active alerts
 */
export function AlertFeed({ alerts = [], onDismiss, onView, onViewAll, maxVisible = 5 }) {
  const visibleAlerts = alerts.slice(0, maxVisible);
  const hasMore = alerts.length > maxVisible;

  if (alerts.length === 0) {
    return null;
  }

  return (
    <Card className="border-0 bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300">
      <CardHeader className="pb-3 pt-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-red-500/15 to-red-500/5 flex items-center justify-center shadow-[0_4px_20px_rgb(239,68,68,0.15)]">
              <AlertTriangle className="h-5 w-5 text-red-500" />
            </div>
            <div>
              <CardTitle className="text-base font-bold">Active Alerts</CardTitle>
              <p className="text-[11px] text-muted-foreground/70 mt-0.5 font-medium">
                {alerts.length} alert{alerts.length !== 1 ? 's' : ''} require attention
              </p>
            </div>
          </div>
          {hasMore && onViewAll && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onViewAll}
              className="text-xs h-9 font-semibold rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 transition-all duration-300 active:scale-95"
            >
              View All ({alerts.length})
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pb-5">
        {visibleAlerts.map((alert, idx) => (
          <div 
            key={alert.id}
            className="animate-in fade-in slide-in-from-bottom-2"
            style={{ animationDelay: `${idx * 50}ms`, animationDuration: '300ms' }}
          >
            <AlertCard
              alert={alert}
              onDismiss={onDismiss}
              onView={onView}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

