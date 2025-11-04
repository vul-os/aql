# MapTiler Setup Guide

This guide will help you set up MapTiler for displaying coverage areas on your landing page.

## What is MapTiler?

MapTiler is a mapping service that provides beautiful, customizable maps for web applications. It offers:

- **Beautiful map styles**: Streets, Satellite, Outdoor, and more
- **Free tier**: 100,000 map loads per month for free
- **High performance**: Fast, reliable map rendering
- **Full control**: Customize colors, labels, and features

## Getting Your MapTiler API Key

### Step 1: Create a Free Account

1. Go to [MapTiler Cloud](https://cloud.maptiler.com/)
2. Click **"Sign up for free"**
3. Create an account using your email or Google/GitHub

### Step 2: Get Your API Key

1. After signing in, you'll be redirected to your dashboard
2. Click on **"API keys"** in the left sidebar
3. You'll see a default API key already created
4. Click **"Copy"** to copy your API key

### Step 3: Add API Key to Your Project

1. Create a `.env` file in your project root (if it doesn't exist):
   ```bash
   cp .env.example .env
   ```

2. Open `.env` and add your MapTiler API key:
   ```env
   VITE_MAPTILER_API_KEY=your_actual_api_key_here
   ```

3. Restart your development server:
   ```bash
   npm run dev
   ```

## Verifying It Works

1. Navigate to your landing page: `http://localhost:5173/`
2. Scroll down to the "Where We Serve" section
3. You should see an interactive map displaying your coverage areas

## Customizing the Map

You can customize the map in `src/components/services/coverage-map.jsx`:

### Change Map Style

```javascript
// In the Map initialization, change the style property:
style: maptilersdk.MapStyle.STREETS,  // Default
// Other options:
// maptilersdk.MapStyle.SATELLITE
// maptilersdk.MapStyle.OUTDOOR
// maptilersdk.MapStyle.WINTER
// maptilersdk.MapStyle.TOPO
```

### Change Colors

```javascript
// In the layer paint properties, change fill-color:
'fill-color': '#F97316',  // Your brand orange
'fill-opacity': 0.3,
```

### Adjust Map Height

In `landing-page.jsx`, change the height prop:
```jsx
<CoverageMap 
  height="800px"  // Change from default 600px
  // ... other props
/>
```

## Map Features

### Interactive Elements

- **Click on coverage areas**: Shows popup with area details
- **Hover over areas**: Changes cursor to pointer
- **Legend**: Shows what the colors mean
- **Statistics**: Displays total coverage area count
- **Navigation controls**: Zoom in/out, fullscreen
- **Scale control**: Shows map scale

### Coverage Area Display

The map automatically:
- Displays GeoJSON polygon boundaries if available
- Falls back to markers for point locations
- Centers and zooms to fit all coverage areas
- Color-codes areas in your brand colors

## Troubleshooting

### Map Not Loading

1. **Check API Key**: Make sure your `.env` file has the correct key
2. **Restart Dev Server**: Always restart after changing `.env`
3. **Check Console**: Open browser DevTools for error messages
4. **Verify Free Tier**: Ensure you haven't exceeded 100k monthly loads

### Coverage Areas Not Showing

1. **Check Database**: Verify coverage_areas table has data:
   ```sql
   SELECT id, area_name, center_latitude, center_longitude 
   FROM coverage_areas 
   WHERE is_active = true;
   ```

2. **Check Coordinates**: Ensure latitude/longitude are valid
3. **Check GeoJSON**: Verify boundary_geojson is valid GeoJSON

### Map Style Not Applying

1. **Import CSS**: Ensure `@maptiler/sdk/dist/maptiler-sdk.css` is imported
2. **Check Build**: Clear cache and rebuild: `rm -rf node_modules/.vite && npm run dev`

## API Key Security

### Important Notes

- ✅ **Safe for Frontend**: MapTiler API keys are designed for public use
- ✅ **Domain Restrictions**: You can restrict keys to specific domains
- ✅ **Usage Limits**: Free tier has 100k map loads/month
- ⚠️ **Don't Commit**: Never commit `.env` to git (it's in `.gitignore`)

### Restricting Your API Key (Recommended for Production)

1. Go to [MapTiler Cloud Dashboard](https://cloud.maptiler.com/)
2. Click on your API key
3. Under "HTTP referrer restrictions", add your domains:
   - `http://localhost:5173/*` (development)
   - `https://yourdomain.com/*` (production)
4. Save changes

## Free Tier Limits

MapTiler's free tier includes:
- **100,000 map loads per month**
- **Unlimited API keys**
- **All map styles**
- **Commercial use allowed**

If you need more, check [MapTiler Pricing](https://www.maptiler.com/cloud/pricing/).

## Alternative: Self-Hosting

For more control, you can self-host map tiles, but this requires:
- Tile server setup (e.g., TileServer GL)
- OSM data processing
- Storage and bandwidth
- Server infrastructure

For most use cases, MapTiler's free tier is perfect!

## Support

- **MapTiler Docs**: https://docs.maptiler.com/
- **API Reference**: https://docs.maptiler.com/sdk-js/
- **Examples**: https://docs.maptiler.com/sdk-js/examples/

---

**Need Help?** Open an issue or contact the development team.

