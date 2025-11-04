# Coverage Map Component

An interactive map component for displaying Bot Korp service coverage areas using MapTiler.

## Features

✨ **Interactive Coverage Display**
- Displays coverage areas as shaded polygons on the map
- Clickable areas with detailed popups
- Automatic map centering and zoom fitting
- Hover effects and cursor changes

🎨 **Beautiful UI**
- Customizable map styles (Streets, Satellite, Outdoor, etc.)
- Brand-colored coverage areas (Bot Korp orange)
- Legend and statistics overlay
- Loading and error states

📱 **Responsive Design**
- Works on all screen sizes
- Touch-friendly controls
- Mobile-optimized popups

## Quick Start

### 1. Get MapTiler API Key

```bash
# Visit https://cloud.maptiler.com/ and sign up
# Copy your API key and add to .env file:
echo "VITE_MAPTILER_API_KEY=your_key_here" >> .env
```

### 2. Import and Use

```jsx
import CoverageMap from '@/components/services/coverage-map';

function MyPage() {
  const [coverageAreas, setCoverageAreas] = useState([]);

  useEffect(() => {
    // Load coverage areas from Supabase
    const loadAreas = async () => {
      const { data } = await supabase
        .from('coverage_areas')
        .select('*')
        .eq('is_active', true);
      setCoverageAreas(data);
    };
    loadAreas();
  }, []);

  return (
    <CoverageMap 
      coverageAreas={coverageAreas}
      apiKey={import.meta.env.VITE_MAPTILER_API_KEY}
      height="600px"
      showLegend={true}
      onAreaClick={(area) => console.log('Clicked:', area)}
    />
  );
}
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `coverageAreas` | Array | `[]` | Array of coverage area objects |
| `apiKey` | String | `'YOUR_MAPTILER_API_KEY'` | MapTiler API key |
| `height` | String | `'600px'` | Map container height |
| `showLegend` | Boolean | `true` | Show/hide map legend |
| `onAreaClick` | Function | `null` | Callback when area is clicked |

## Coverage Area Data Structure

The component expects coverage areas with this structure:

```javascript
{
  id: 'uuid',
  area_name: 'Westville',
  city: 'Durban',
  province: 'KwaZulu-Natal',
  center_latitude: -29.8587,
  center_longitude: 31.0218,
  boundary_geojson: {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[lng, lat], [lng, lat], ...]]
      }
    }]
  },
  service_types: ['mow_bot', 'pool_bot'],
  postal_codes: ['3629', '3630']
}
```

### Required Fields

- `id` - Unique identifier
- `center_latitude` - Center point latitude
- `center_longitude` - Center point longitude

### Optional Fields

- `boundary_geojson` - GeoJSON polygon for area boundaries
- `area_name` - Display name
- `city` - City name
- `province` - Province name
- `service_types` - Array of available services
- `postal_codes` - Array of postal codes

## Customization

### Map Styles

```jsx
// In coverage-map.jsx, change the style:
const mapInstance = new maptilersdk.Map({
  style: maptilersdk.MapStyle.STREETS, // Options:
  // STREETS - Default street map
  // SATELLITE - Satellite imagery
  // OUTDOOR - Topographic/hiking map
  // WINTER - Winter theme
  // TOPO - Topographic contours
});
```

### Colors

```jsx
// Change coverage area colors:
'fill-color': '#F97316',    // Your brand color
'fill-opacity': 0.3,        // Transparency (0-1)
'line-color': '#F97316',    // Border color
'line-width': 2             // Border width
```

### Marker Colors

```jsx
// For point markers (when no polygon):
new maptilersdk.Marker({ 
  color: '#F97316'  // Your brand color
})
```

## Map Controls

The map includes:
- **Navigation Controls**: Zoom in/out, rotate, compass
- **Fullscreen Control**: Expand map to fullscreen
- **Scale Control**: Shows distance scale
- **Custom Legend**: Coverage area explanation
- **Stats Card**: Total coverage area count

### Disabling Controls

```jsx
// In the Map initialization:
const mapInstance = new maptilersdk.Map({
  navigationControl: false,  // Disable zoom/rotate controls
  fullscreenControl: false,  // Disable fullscreen
  scaleControl: false,       // Disable scale
});
```

## Events

### Area Click

```jsx
<CoverageMap 
  onAreaClick={(area) => {
    // Handle area click
    console.log('Selected area:', area);
    // Navigate, show details, etc.
  }}
/>
```

### Map Events

Add custom event handlers in the component:

```jsx
mapInstance.on('load', () => {
  // Map loaded
});

mapInstance.on('click', layerId, (e) => {
  // Area clicked
});

mapInstance.on('mouseenter', layerId, () => {
  // Mouse entered area
});

mapInstance.on('mouseleave', layerId, () => {
  // Mouse left area
});
```

## Popups

### Default Popup

Shows area name, city, province, and service types.

### Custom Popup

```jsx
// In coverage-map.jsx, modify the popup HTML:
new maptilersdk.Popup()
  .setLngLat(e.lngLat)
  .setHTML(`
    <div class="p-4">
      <h3 class="font-bold">${area.area_name}</h3>
      <p>${area.city}, ${area.province}</p>
      <!-- Add your custom content -->
      <button onclick="handleClick('${area.id}')">
        Get Service
      </button>
    </div>
  `)
  .addTo(mapInstance);
```

## Performance

### Optimization Tips

1. **Limit coverage areas**: Load only active areas
2. **Simplify polygons**: Use simplified GeoJSON for large areas
3. **Lazy loading**: Load map only when visible
4. **Debounce events**: Throttle frequent events

### Loading Strategy

```jsx
// Lazy load the map component
const CoverageMap = lazy(() => import('@/components/services/coverage-map'));

function MyPage() {
  return (
    <Suspense fallback={<MapSkeleton />}>
      <CoverageMap />
    </Suspense>
  );
}
```

## Troubleshooting

### Map Not Showing

1. Check API key in `.env`
2. Restart dev server after changing `.env`
3. Check browser console for errors
4. Verify MapTiler SDK is installed: `npm list @maptiler/sdk`

### Coverage Areas Not Displaying

1. Verify data structure matches expected format
2. Check coordinates are valid (latitude: -90 to 90, longitude: -180 to 180)
3. Ensure `is_active` is `true` in database
4. Validate GeoJSON using [geojson.io](http://geojson.io)

### Styling Issues

1. Ensure CSS is imported: `import '@maptiler/sdk/dist/maptiler-sdk.css'`
2. Check Tailwind classes are available
3. Clear build cache: `rm -rf node_modules/.vite`

## Examples

### Basic Usage

```jsx
<CoverageMap 
  coverageAreas={areas}
  apiKey={process.env.VITE_MAPTILER_API_KEY}
/>
```

### Custom Height and No Legend

```jsx
<CoverageMap 
  coverageAreas={areas}
  apiKey={process.env.VITE_MAPTILER_API_KEY}
  height="800px"
  showLegend={false}
/>
```

### With Click Handler

```jsx
<CoverageMap 
  coverageAreas={areas}
  apiKey={process.env.VITE_MAPTILER_API_KEY}
  onAreaClick={(area) => {
    navigate(`/coverage/${area.id}`);
  }}
/>
```

## Related Components

- `bot-map.jsx` - Displays bot location tracking
- `service-locations-map.jsx` - Shows service locations
- `location-wizard.jsx` - Location selection wizard

## Resources

- [MapTiler Docs](https://docs.maptiler.com/)
- [MapTiler SDK](https://docs.maptiler.com/sdk-js/)
- [GeoJSON Spec](https://geojson.org/)
- [Coverage Areas Schema](../../supabase/migrations/20251019210906_coverage_and_pricing.sql)

---

**Questions?** Check the [main setup guide](../../../MAPTILER_SETUP.md) or open an issue.

