# Quick Start: Populate Service Activity Card

## TL;DR - 3 Steps, 2 Minutes

### Step 1: Run SQL (30 seconds)
1. Open: https://supabase.com/dashboard/project/kyoowsarfopltjwmhksi/sql
2. Paste contents of `add_service_tracking_columns.sql`
3. Click "Run" (or Ctrl+Enter)

### Step 2: Generate Data (30 seconds)
```bash
cd /home/exo/botkorp-mono
python3 seed/populate_service_activity.py
```

### Step 3: View Dashboard (refresh browser)
Navigate to `/portal/dashboard` and see your Service Activity Chart populated!

---

## What Gets Added

### To Database:
- 4 new columns on `services` table (stage, area_sqm, started_at, completed_at)
- 1 new column on `bots` table (organization_id)
- Performance indexes
- Fixed dashboard function to match schema

### Test Data Generated:
- **30 days** of service history
- **~40-50 service records**:
  - Lawn mowing: 150-500 m² per session
  - Pool cleaning: 30-80 m² per session
- **Realistic patterns**: Random times, natural gaps, varied activity

---

## Expected Output

After Step 2, you'll see:

```
✓ Found organization: aaaa
✓ Found location: Home
✓ Found 0 bot(s)

📊 Creating service activity data for the past 30 days...
  ✓ 2025-10-08: Lawn Mowing Service - 324 m² completed at 14:23
  ✓ 2025-10-08: Pool Cleaning Service - 52 m² completed at 09:45
  ... (40+ more)

✅ Created 48 service records

📈 Summary:
  Total Lawn Mowing Area: 8,456 m²
  Total Pool Cleaning Area: 1,230 m²
  Total Services: 48
```

After Step 3, you'll see in dashboard:

**Service Activity Card** with:
- 📈 Beautiful line chart (green = lawn, blue = pool)
- 📊 30 days of data
- 📋 Summary: Total area, Avg/day, Services count
- 🎯 Interactive tooltips on hover

---

## Files Reference

| File | Purpose |
|------|---------|
| `add_service_tracking_columns.sql` | SQL to run in Supabase |
| `seed/populate_service_activity.py` | Data generator |
| `POPULATE_DASHBOARD_SUMMARY.md` | Full documentation |
| `SERVICE_ACTIVITY_PREVIEW.md` | Visual preview |

---

## Troubleshooting

**"column does not exist"** → Run Step 1 first  
**"No data available"** → Run Step 2  
**Chart not showing** → Hard refresh (Ctrl+F5)  
**Different org/location** → Script uses first org/location found

---

That's it! Your Service Activity Card will be fully populated and looking great! 🎉

