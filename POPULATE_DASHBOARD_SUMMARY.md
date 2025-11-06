# Dashboard Service Activity - Setup Summary

## 🎯 Goal
Populate the Service Activity Card on your dashboard so you can see how it looks with real data.

## 📋 What I've Created

### 1. SQL Migration (`add_service_tracking_columns.sql`)
Adds required columns to the `services` table:
- `stage` - tracks service session state (pending, in_progress, completed, etc.)
- `area_sqm` - area serviced in square meters
- `started_at` - when service session started
- `completed_at` - when service session finished
- `organization_id` on bots table for better queries

### 2. Data Population Script (`seed/populate_service_activity.py`)
Generates 30 days of realistic service data:
- **Lawn mowing**: 150-500 m² per session, ~3x per week
- **Pool cleaning**: 30-80 m² per session, ~2x per week
- Random time distribution, natural gaps
- ~40-50 total service records across 30 days

### 3. Documentation
- `DASHBOARD_SERVICE_ACTIVITY_SETUP.md` - Complete setup guide
- `SERVICE_ACTIVITY_PREVIEW.md` - Visual preview of what you'll see

## ⚡ Quick Start (3 Steps)

### Step 1: Run the SQL Migration
```bash
# Open this URL in your browser:
https://supabase.com/dashboard/project/kyoowsarfopltjwmhksi/sql

# Copy and paste the contents of: add_service_tracking_columns.sql
# Click "Run" or press Ctrl+Enter
```

### Step 2: Generate Test Data
```bash
cd /home/exo/botkorp-mono
python3 seed/populate_service_activity.py
```

### Step 3: View Your Dashboard
```bash
# Refresh your dashboard in the browser
# Navigate to: /portal/dashboard
# Scroll to the Service Activity Card
```

## 📊 What You'll See

A beautiful line chart showing:
- **Green line**: Lawn mowing area over time
- **Blue line**: Pool cleaning area over time
- **Summary stats**: Total area (15k+ m²), average per day, total services
- **Interactive tooltips**: Hover to see exact values
- **Last 30 days**: Shows recent service activity trends

## 🔧 Troubleshooting

### "Column does not exist" error
→ Run the SQL migration first (Step 1)

### "No data available" in chart
→ Run the population script (Step 2)

### Chart not showing
→ Refresh your browser (Ctrl+F5)

## 📁 Files Created

```
/home/exo/botkorp-mono/
├── add_service_tracking_columns.sql          # SQL to add columns
├── DASHBOARD_SERVICE_ACTIVITY_SETUP.md       # Detailed guide
├── SERVICE_ACTIVITY_PREVIEW.md               # Visual preview
├── POPULATE_DASHBOARD_SUMMARY.md             # This file
└── seed/
    ├── populate_service_activity.py          # Main data generator
    ├── check_services_schema.py              # Schema checker
    └── apply_migration_direct.py             # Auto-migration attempt
```

## 🎨 Current Dashboard State

Your dashboard currently has:
- ✅ System Health Card
- ✅ Active Bots KPI
- ✅ Today's Coverage KPI  
- ✅ Active Alerts KPI
- ⚠️  Service Activity Chart (no data - needs setup)
- ✅ Fleet Status Widget
- ✅ Quick Actions

After completing the steps above, the Service Activity Chart will be fully populated with 30 days of realistic data.

## 🚀 Next Steps

1. **Run the SQL migration** (takes 5 seconds)
2. **Run the population script** (takes 10-30 seconds)
3. **Refresh and enjoy** your data-rich dashboard!

The Service Activity Card will then show beautiful trends and insights about your lawn care and pool cleaning services over time.

