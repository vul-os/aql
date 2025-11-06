import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Bot, 
  Activity, 
  Clock, 
  Zap 
} from 'lucide-react';

/**
 * Fleet Status Overview Widget
 * Shows bot status breakdown with categories
 */
export function FleetStatusWidget({ fleetData }) {
  const statusCategories = [
    {
      label: 'Active Now',
      count: fleetData?.active_now || 0,
      icon: Activity,
      color: 'text-green-600',
      bgColor: 'bg-green-50 dark:bg-green-900/20',
      dotColor: 'bg-green-500',
      showPulse: true,
      description: `${fleetData?.active_services || 0} service${(fleetData?.active_services || 0) !== 1 ? 's' : ''} running`
    },
    {
      label: 'Charging',
      count: fleetData?.charging || 0,
      icon: Zap,
      color: 'text-yellow-600',
      bgColor: 'bg-yellow-50 dark:bg-yellow-900/20',
      dotColor: 'bg-yellow-500',
      description: 'Recharging'
    },
    {
      label: 'Idle',
      count: fleetData?.idle || 0,
      icon: Clock,
      color: 'text-gray-600',
      bgColor: 'bg-gray-50 dark:bg-gray-900/20',
      dotColor: 'bg-gray-500',
      description: 'Ready for service'
    },
    {
      label: 'Needs Attention',
      count: fleetData?.needs_attention || 0,
      icon: Bot,
      color: 'text-red-600',
      bgColor: 'bg-red-50 dark:bg-red-900/20',
      dotColor: 'bg-red-500',
      description: 'Requires maintenance'
    }
  ];

  return (
    <Card className="border-0 bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300">
      <CardHeader className="pb-3 pt-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-botkorp-orange/15 to-botkorp-orange/5 flex items-center justify-center shadow-[0_4px_20px_rgb(255,107,53,0.15)]">
              <Bot className="h-5 w-5 text-botkorp-orange" />
            </div>
            <div>
              <CardTitle className="text-base font-bold">Fleet Status</CardTitle>
              <p className="text-[11px] text-muted-foreground/70 mt-0.5 font-medium">
                {fleetData?.total || 0} total bot{(fleetData?.total || 0) !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <Badge variant="outline" className="text-[10px] h-6 border-0 bg-botkorp-orange/10 text-botkorp-orange font-semibold px-3 rounded-full">
            {fleetData?.total || 0} Total
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5 pb-5">
        {statusCategories.map((category, idx) => {
          const Icon = category.icon;
          return (
            <div 
              key={category.label}
              className={`flex items-center justify-between p-4 rounded-xl ${category.bgColor} hover:shadow-[0_4px_20px_rgba(0,0,0,0.08)] transition-all duration-300 cursor-pointer group animate-in fade-in slide-in-from-right-2`}
              style={{ animationDelay: `${idx * 50}ms`, animationDuration: '300ms' }}
            >
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Icon className={`h-5 w-5 ${category.color} group-hover:scale-110 transition-transform duration-300`} />
                  {category.showPulse && category.count > 0 && (
                    <div className={`absolute -top-1 -right-1 h-2.5 w-2.5 ${category.dotColor} rounded-full`}>
                      <span className={`absolute inset-0 ${category.dotColor} rounded-full animate-ping`} />
                      <span className={`relative block h-2.5 w-2.5 ${category.dotColor} rounded-full`} />
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-sm font-bold">{category.label}</p>
                  {category.description && category.count > 0 && (
                    <p className="text-[11px] text-muted-foreground/70 font-medium">
                      {category.description}
                    </p>
                  )}
                </div>
              </div>
              <div className={`text-2xl font-bold tabular-nums ${category.color} group-hover:scale-110 transition-transform duration-300`}>
                {category.count}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

