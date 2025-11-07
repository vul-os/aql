import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer 
} from 'recharts';
import { format } from 'date-fns';
import { TrendingUp, TrendingDown, Minus, BarChart3 } from 'lucide-react';

/**
 * Custom Tooltip for Service Activity Chart
 */
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-background border border-border rounded-xl shadow-lg p-3">
        <p className="font-semibold text-xs mb-2">
          {format(new Date(label), 'MMM d, yyyy')}
        </p>
        {payload.map((entry, index) => (
          <div key={index} className="flex items-center gap-2 text-xs">
            <div 
              className="w-2.5 h-2.5 rounded-full" 
              style={{ backgroundColor: entry.color }} 
            />
            <span className="text-muted-foreground">
              {entry.name}:
            </span>
            <span className="font-semibold">
              {entry.value.toLocaleString()} m²
            </span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

/**
 * Service Activity Chart Component
 * Shows area serviced over time with multiple service types and comparison metrics
 */
export function ServiceActivityChart({ data = [], timeRange = '30d' }) {
  // Transform data for chart
  const chartData = data.map(item => ({
    date: item.date,
    'Lawn Mowing': item.mowing_area || 0,
    'Pool Cleaning': item.pool_cleaning_area || 0,
    servicesCount: item.services_count || 0
  }));

  // Calculate summary stats
  const totalArea = chartData.reduce((sum, item) => 
    sum + (item['Lawn Mowing'] || 0) + (item['Pool Cleaning'] || 0), 0
  );
  const avgPerDay = chartData.length > 0 ? Math.round(totalArea / chartData.length) : 0;
  const totalServices = chartData.reduce((sum, item) => sum + (item.servicesCount || 0), 0);

  // Calculate period-over-period comparison (current period vs previous period)
  const midpoint = Math.floor(chartData.length / 2);
  const firstHalfArea = chartData.slice(0, midpoint).reduce((sum, item) => 
    sum + (item['Lawn Mowing'] || 0) + (item['Pool Cleaning'] || 0), 0
  );
  const secondHalfArea = chartData.slice(midpoint).reduce((sum, item) => 
    sum + (item['Lawn Mowing'] || 0) + (item['Pool Cleaning'] || 0), 0
  );
  
  const periodComparison = firstHalfArea > 0 
    ? Math.round(((secondHalfArea - firstHalfArea) / firstHalfArea) * 100)
    : 0;

  const getTrendIcon = () => {
    if (periodComparison > 0) return TrendingUp;
    if (periodComparison < 0) return TrendingDown;
    return Minus;
  };

  const getTrendColor = () => {
    if (periodComparison > 0) return 'text-emerald-600';
    if (periodComparison < 0) return 'text-red-600';
    return 'text-muted-foreground/60';
  };

  const TrendIcon = getTrendIcon();

  return (
    <Card className="border-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 shadow-[8px_8px_16px_rgba(0,0,0,0.1),-8px_-8px_16px_rgba(255,255,255,0.9)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[12px_12px_24px_rgba(0,0,0,0.15),-12px_-12px_24px_rgba(255,255,255,1)] dark:hover:shadow-[12px_12px_24px_rgba(0,0,0,0.5),-12px_-12px_24px_rgba(255,255,255,0.08)] transition-all duration-500 rounded-3xl">
      <CardHeader className="pb-3 pt-5 px-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-purple-500/20 to-purple-500/10 dark:from-purple-500/30 dark:to-purple-500/20 flex items-center justify-center flex-shrink-0 shadow-[inset_2px_2px_5px_rgba(0,0,0,0.1),inset_-2px_-2px_5px_rgba(255,255,255,0.7)] dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.1)]">
              <BarChart3 className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold mb-1">Service Activity</CardTitle>
              <CardDescription className="text-xs text-muted-foreground/70 font-medium">
                Area serviced over {timeRange === '30d' ? '30 days' : timeRange}
              </CardDescription>
            </div>
          </div>
          {chartData.length > 0 && periodComparison !== 0 && (
            <Badge className={`flex items-center gap-1 ${
              periodComparison > 0 
                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-0'
                : 'bg-red-500/10 text-red-700 dark:text-red-400 border-0'
            } text-[10px] px-2 py-1`}>
              <TrendIcon className="h-3 w-3" />
              {Math.abs(periodComparison)}% vs prev period
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pb-5 px-5">
        {chartData.length > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart
                data={chartData}
                margin={{ top: 5, right: 10, left: -20, bottom: 5 }}
              >
                <defs>
                  <linearGradient id="mowingGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.3}/>
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.05}/>
                  </linearGradient>
                  <linearGradient id="poolGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3}/>
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.05}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" vertical={false} />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={(date) => format(new Date(date), 'MMM d')}
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis 
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend 
                  wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
                  iconType="circle"
                />
                <Line 
                  type="monotone" 
                  dataKey="Lawn Mowing"
                  stroke="#10b981" 
                  strokeWidth={2}
                  fill="url(#mowingGradient)"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: 'white' }}
                />
                <Line 
                  type="monotone" 
                  dataKey="Pool Cleaning"
                  stroke="#3b82f6" 
                  strokeWidth={2}
                  fill="url(#poolGradient)"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: 'white' }}
                />
              </LineChart>
            </ResponsiveContainer>

            {/* Summary Stats - Compact */}
            <div className="grid grid-cols-4 gap-3 mt-5 pt-4 border-t border-border/40">
              <div className="text-center p-3 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider mb-1 font-bold">
                  Total Area
                </p>
                <p className="text-base font-bold tabular-nums bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">
                  {totalArea >= 1000 
                    ? `${(totalArea / 1000).toFixed(1)}k`
                    : totalArea}
                </p>
                <p className="text-[10px] text-muted-foreground/60 font-medium">m²</p>
              </div>
              <div className="text-center p-3 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider mb-1 font-bold">
                  Avg/Day
                </p>
                <p className="text-base font-bold tabular-nums bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">
                  {avgPerDay}
                </p>
                <p className="text-[10px] text-muted-foreground/60 font-medium">m²</p>
              </div>
              <div className="text-center p-3 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider mb-1 font-bold">
                  Services
                </p>
                <p className="text-base font-bold tabular-nums bg-gradient-to-br from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">
                  {totalServices}
                </p>
                <p className="text-[10px] text-muted-foreground/60 font-medium">completed</p>
              </div>
              <div className="text-center p-3 rounded-xl bg-background/60 backdrop-blur-sm shadow-[inset_0_2px_8px_rgb(0,0,0,0.04)]">
                <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider mb-1 font-bold">
                  Trend
                </p>
                <div className={`flex items-center justify-center gap-1 ${getTrendColor()}`}>
                  <TrendIcon className="h-4 w-4" />
                  <p className="text-base font-bold tabular-nums">
                    {Math.abs(periodComparison)}%
                  </p>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-56 text-muted-foreground/60 text-xs">
            No service data available for this period
          </div>
        )}
      </CardContent>
    </Card>
  );
}

