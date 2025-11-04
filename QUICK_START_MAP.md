# 🗺️ Quick Start: Coverage Map Display

Get your coverage areas displaying on the landing page in 5 minutes!

## ⚡ 3-Step Setup

### 1️⃣ Get MapTiler API Key (2 min)

```bash
# 1. Visit https://cloud.maptiler.com/
# 2. Sign up (free - 100k map loads/month)
# 3. Copy your API key from the dashboard
```

### 2️⃣ Add API Key to Project (1 min)

Create a `.env` file in your project root:

```bash
# Create .env file
touch .env

# Add your MapTiler API key
echo "VITE_MAPTILER_API_KEY=your_actual_key_here" >> .env
```

**Or manually edit `.env`:**
```env
VITE_MAPTILER_API_KEY=pk.your_actual_key_here
```

### 3️⃣ Restart Dev Server (30 sec)

```bash
# Stop current server (Ctrl+C)
# Then restart:
npm run dev
```

**That's it!** 🎉 Open your landing page and scroll to "Where We Serve" section.

---

## 📊 Add Coverage Areas to Database

Your map needs coverage area data. Add some test areas:

### Option A: Using Supabase SQL Editor

1. Go to your Supabase dashboard
2. Click **SQL Editor**
3. Copy and paste from `seed/add_coverage_area_example.sql`
4. Run the query

### Option B: Quick Test Area

```sql
INSERT INTO coverage_areas (
    area_name, city, province, country,
    center_latitude, center_longitude,
    postal_codes, service_types, is_active
) VALUES (
    'Test Area', 'Durban', 'KwaZulu-Natal', 'South Africa',
    -29.8587, 31.0218,
    ARRAY['3629'], ARRAY['mow_bot'], true
);
```

---

## 🎨 What You Get

✅ **Interactive Map**
- Beautiful MapTiler streets map
- Clickable coverage areas
- Popups with area details
- Automatic zoom and centering

✅ **Coverage Display**
- Orange-colored shaded areas (matching your brand)
- Markers for point locations
- Legend explaining the map
- Statistics card showing area count

✅ **Professional Features**
- Zoom/pan controls
- Fullscreen mode
- Scale indicator
- Loading states
- Error handling

---

## 🛠️ Customization

### Change Map Style

Edit `src/components/services/coverage-map.jsx` line ~65:

```javascript
style: maptilersdk.MapStyle.STREETS, // Change to:
// SATELLITE - Satellite view
// OUTDOOR - Topographic
// TOPO - Contour maps
```

### Change Colors

Edit coverage area colors (line ~90):

```javascript
'fill-color': '#F97316',    // Your brand color
'fill-opacity': 0.3,        // Transparency
```

### Change Map Height

Edit `src/pages/landing/landing-page.jsx` line ~815:

```jsx
<CoverageMap 
  height="800px"  // Change from 600px
  // ...
/>
```

---

## 🎯 Creating Coverage Boundaries

Want shaded areas instead of just markers?

### Using geojson.io (Easiest)

1. Go to https://geojson.io
2. Click the **polygon tool** (top right)
3. Draw your coverage area by clicking points
4. Close the polygon by clicking the first point
5. Copy the GeoJSON from the right panel
6. Add to database:

```sql
UPDATE coverage_areas
SET boundary_geojson = '{ paste your GeoJSON here }'::jsonb
WHERE area_name = 'Your Area';
```

### Using Google Maps

1. Go to [Google My Maps](https://www.google.com/mymaps)
2. Create a new map
3. Draw shapes for your coverage areas
4. Export as KML
5. Convert KML to GeoJSON: https://mapbox.github.io/togeojson/
6. Add to database

---

## 📱 See It In Action

1. **Navigate** to `http://localhost:5173/`
2. **Scroll down** to "Where We Serve" section
3. **See the map** with your coverage areas
4. **Click areas** to see popups
5. **Zoom/pan** to explore

---

## 🚨 Troubleshooting

### Map not showing?

```bash
# 1. Check your API key
cat .env | grep MAPTILER

# 2. Restart dev server
npm run dev

# 3. Check browser console (F12)
# Look for errors
```

### Coverage areas not appearing?

```sql
-- Check if you have active coverage areas
SELECT area_name, city, is_active, center_latitude, center_longitude
FROM coverage_areas
WHERE is_active = true;
```

### Need help?

- 📖 Read: `MAPTILER_SETUP.md` for detailed setup
- 📖 Read: `src/components/services/README_COVERAGE_MAP.md` for component docs
- 📖 Check: MapTiler docs at https://docs.maptiler.com/

---

## 🎁 Free Tier Limits

MapTiler free tier includes:
- ✅ 100,000 map loads per month
- ✅ All map styles
- ✅ Commercial use
- ✅ Unlimited API keys

**More than enough for most websites!**

---

## 🚀 Next Steps

Once your map is working:

1. **Add your real coverage areas** using the SQL examples
2. **Customize colors** to match your brand
3. **Add more areas** as you expand
4. **Restrict API key** to your domain (in MapTiler dashboard)
5. **Monitor usage** in MapTiler dashboard

---

## 📚 Related Files

- `src/components/services/coverage-map.jsx` - The map component
- `src/pages/landing/landing-page.jsx` - Landing page with map
- `seed/add_coverage_area_example.sql` - Database examples
- `MAPTILER_SETUP.md` - Detailed setup guide

---

**Questions?** Check the documentation or open an issue! 🎉

