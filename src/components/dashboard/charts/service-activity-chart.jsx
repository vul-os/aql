import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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

/**
 * Custom Tooltip for Service Activity Chart
 */
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
        <p className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
          {format(new Date(label), 'MMM d, yyyy')}
        </p>
        {payload.map((entry, index) => (
          <div key={index} className="flex items-center gap-2 text-sm">
            <div 
              className="w-3 h-3 rounded-full" 
              style={{ backgroundColor: entry.color }} 
            />
            <span className="text-gray-600 dark:text-gray-300">
              {entry.name}:
            </span>
            <span className="font-semibold text-gray-900 dark:text-gray-100">
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
 * Shows area serviced over time with multiple service types
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

  return (
    <Card className="border-0 bg-gradient-to-br from-background to-muted/20 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300">
      <CardHeader className="pb-3 pt-5">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base font-bold">Service Activity</CardTitle>
            <CardDescription className="text-[11px] font-medium text-muted-foreground/70">
              Area serviced over time
            </CardDescription>
          </div>
          <div className="text-[10px] text-muted-foreground/70 font-bold uppercase tracking-wider bg-muted/50 px-3 py-1.5 rounded-full">
            Last {timeRange === '30d' ? '30 days' : timeRange}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pb-5">
        {chartData.length > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={280}>
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
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.3} vertical={false} />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={(date) => format(new Date(date), 'MMM d')}
                  tick={{ fill: '#9ca3af', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis 
                  tick={{ fill: '#9ca3af', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend 
                  wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }}
                  iconType="circle"
                />
                <Line 
                  type="monotone" 
                  dataKey="Lawn Mowing"
                  stroke="#10b981" 
                  strokeWidth={2.5}
                  fill="url(#mowingGradient)"
                  dot={false}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: 'white' }}
                />
                <Line 
                  type="monotone" 
                  dataKey="Pool Cleaning"
                  stroke="#3b82f6" 
                  strokeWidth={2.5}
                  fill="url(#poolGradient)"
                  dot={false}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: 'white' }}
                />
              </LineChart>
            </ResponsiveContainer>

            {/* Summary Stats */}
            <div className="grid grid-cols-3 gap-4 mt-6 pt-4 border-t border-border/50">
              <div>
                <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider mb-1 font-bold">
                  Total Area
                </p>
                <p className="text-sm font-bold tabular-nums">
                  {totalArea >= 1000 
                    ? `${(totalArea / 1000).toFixed(1)}k m²` 
                    : `${totalArea} m²`}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider mb-1 font-bold">
                  Avg/Day
                </p>
                <p className="text-sm font-bold tabular-nums">
                  {avgPerDay} m²
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider mb-1 font-bold">
                  Services
                </p>
                <p className="text-sm font-bold tabular-nums">
                  {totalServices}
                </p>
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-64 text-muted-foreground/70 text-sm font-medium">
            No service data available for this period
          </div>
        )}
      </CardContent>
    </Card>
  );
}

