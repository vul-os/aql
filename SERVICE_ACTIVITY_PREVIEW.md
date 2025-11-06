# Service Activity Card Preview

## What You'll See

Once you've completed the setup steps, your dashboard's Service Activity Card will display a professional chart showing your service history.

## Visual Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Service Activity                                      Last 30 days          │
│ Area serviced over time                                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  500m²┤                    ●                                               │
│       │          ●              ●     ●                                     │
│  400m²┤     ●         ●                   ●                                │
│       │ ●                                     ●        ●                    │
│  300m²┤                                            ●       ●                │
│       │                                                        ●      ●     │
│  200m²┤                                                                     │
│       │     ─── Lawn Mowing  ─── Pool Cleaning                             │
│  100m²┤                                                                     │
│       │                                                                     │
│     0m²└────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────  │
│        Oct 7  Oct 12 Oct 17 Oct 22 Oct 27 Nov 1  Nov 6                    │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  Total Area          Avg/Day          Services                             │
│  15.2k m²            508 m²           48                                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Sample Data Generated

The populate_service_activity.py script generates realistic data:

### Lawn Mowing Services
- **Frequency**: 3 times per week on average
- **Area Range**: 150-500 m² per session
- **Duration**: 30-120 minutes
- **Time**: Random between 6 AM - 6 PM

### Pool Cleaning Services  
- **Frequency**: 2 times per week on average
- **Area Range**: 30-80 m² per session
- **Duration**: 30-120 minutes
- **Time**: Random between 6 AM - 6 PM

### Realistic Patterns
- ✓ Some days have no services (15% chance)
- ✓ Some days have multiple services
- ✓ Natural variation in areas covered
- ✓ Services distributed throughout the day

## Sample Data Output

When you run the script, you'll see output like:

```
======================================================================
🚀 Service Activity Data Population Script
======================================================================
✓ Found organization: Your Org (ea486a12-420d-4b97-a391-ff23269eff0e)
✓ Found location: Home (1b39759c-6ed8-452e-a246-d6e09410a7e0)
✓ Found 0 bot(s)

📊 Creating service activity data for the past 30 days...
  ✓ 2025-10-08: Lawn Mowing Service - 324 m² completed at 14:23
  ✓ 2025-10-08: Pool Cleaning Service - 52 m² completed at 09:45
  ✓ 2025-10-10: Lawn Mowing Service - 456 m² completed at 11:12
  ✓ 2025-10-10: Lawn Mowing Service - 198 m² completed at 15:33
  ✓ 2025-10-11: Pool Cleaning Service - 67 m² completed at 08:15
  ... (40+ more services)

======================================================================
✅ Created 48 service records
======================================================================

🔍 Testing service activity chart data query...

✓ Successfully retrieved 30 days of data

📈 Summary:
  Total Lawn Mowing Area: 8,456 m²
  Total Pool Cleaning Area: 1,230 m²
  Total Services: 48

📅 Sample days with activity:
  2025-10-08: Mowing=324 m², Pool=52 m², Services=2
  2025-10-10: Mowing=654 m², Pool=0 m², Services=2
  2025-10-11: Mowing=0 m², Pool=67 m², Services=1
  2025-10-13: Mowing=435 m², Pool=0 m², Services=1
  2025-10-15: Mowing=287 m², Pool=41 m², Services=2
  ... and 20 more days with activity

✨ Done! Your dashboard should now show service activity data.
   Refresh your dashboard to see the Service Activity Chart populated.
```

## Interactive Features

The actual chart in your dashboard will be interactive:

- 📊 **Hover over points** to see exact values and dates
- 🎨 **Color-coded lines**: Green for lawn mowing, Blue for pool cleaning
- 📈 **Smooth animations** when data loads
- 🔄 **Auto-refresh** every 60 seconds to show live data

## Quick Steps to See This

1. Open Supabase SQL Editor: https://supabase.com/dashboard/project/kyoowsarfopltjwmhksi/sql

2. Paste and run the contents of `add_service_tracking_columns.sql`

3. Run: `python3 seed/populate_service_activity.py`

4. Refresh your dashboard

That's it! You'll see a beautiful, data-rich Service Activity Chart.

