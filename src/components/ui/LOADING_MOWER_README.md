# 🤖 Loading Mower Components

Two custom loading animation components designed specifically for BotKorp!

## 📦 Components Available

### 1. `LoadingMower` (Detailed Version) ⭐ RECOMMENDED
**File:** `loading-mower.jsx`

**Features:**
- ✅ Animated mower moving left and right across the screen
- ✅ Grass blades swaying in the wind
- ✅ Spinning wheels and cutting blade
- ✅ Pulsing antenna/LED indicator
- ✅ Grass cutting particles
- ✅ Cut grass trail effect
- ✅ More visually interesting and engaging

**Best for:**
- Full-page loading screens
- Long-running operations (creating services, processing payments)
- Initial app load
- Anywhere you want to make waiting more enjoyable

**Usage:**
```jsx
import LoadingMower from '@/components/ui/loading-mower';

<LoadingMower 
  message="Loading your dashboard..." 
  size="lg" 
/>
```

---

### 2. `LoadingMowerSimple` (Minimal Version)
**File:** `loading-mower-simple.jsx`

**Features:**
- ✅ Stationary mower with bounce animation
- ✅ Spinning wheels
- ✅ Pulsing LED indicator
- ✅ Circular progress indicator
- ✅ Moving grass line animation
- ✅ Simpler, less distracting

**Best for:**
- Inline loading states
- Quick operations (< 3 seconds)
- Modal dialogs
- Component-level loading
- When you want something subtle

**Usage:**
```jsx
import LoadingMowerSimple from '@/components/ui/loading-mower-simple';

<LoadingMowerSimple 
  message="Processing..." 
  size="md" 
/>
```

---

## 🎨 Props

Both components accept the same props:

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `message` | `string` | `undefined` | Optional loading message to display |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Size of the animation |
| `className` | `string` | `''` | Additional CSS classes |

---

## 📐 Size Guide

| Size | Dimensions | Best Use Case |
|------|-----------|---------------|
| `sm` | 128px / 96px | Inline loading, small cards |
| `md` | 192px / 128px | Modal dialogs, normal loading |
| `lg` | 256px / 192px | Full-page loading screens |

---

## 💡 Examples

### Full Page Loading
```jsx
<div className="min-h-screen flex items-center justify-center bg-background">
  <LoadingMower message="Loading..." size="lg" />
</div>
```

### Modal Overlay
```jsx
{loading && (
  <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
    <Card className="p-8">
      <LoadingMower message="Creating service..." size="md" />
    </Card>
  </div>
)}
```

### Inline Loading
```jsx
<div className="my-4">
  <LoadingMowerSimple size="sm" />
</div>
```

### Card Loading
```jsx
<Card>
  <CardContent className="py-12">
    <LoadingMowerSimple 
      message="Fetching bot status..." 
      size="md" 
    />
  </CardContent>
</Card>
```

---

## 🎯 Which One Should I Use?

### Use `LoadingMower` (Detailed) when:
- ✅ Operation takes > 3 seconds
- ✅ Full page loading
- ✅ You want to entertain users while they wait
- ✅ Critical user flows (signup, payment, service creation)
- ✅ First impression matters

### Use `LoadingMowerSimple` (Minimal) when:
- ✅ Quick operations (< 3 seconds)
- ✅ Inline/component-level loading
- ✅ You need something subtle
- ✅ Mobile devices (lighter animation)
- ✅ Background operations

### Use neither (regular spinner) when:
- ✅ Very quick operations (< 1 second)
- ✅ Icon-only buttons
- ✅ Table row actions

---

## 🎨 Customization

### Change Colors

Edit the component files directly:

**Mower body:** Change `text-gray-800 dark:text-gray-200`
**Grass:** Change `text-green-600`, `text-green-500`, `text-green-400`
**LED:** Change `text-orange-500`
**Wheels:** Change `text-gray-600 dark:text-gray-400`

### Change Speed

Edit `src/index.css`:

```css
/* Slower mower movement */
.animate-mower-move {
  animation: mower-move 6s ease-in-out infinite; /* was 4s */
}

/* Faster wheel spin */
.animate-spin-wheel {
  animation: spin-wheel 0.2s linear infinite; /* was 0.3s */
}
```

### Custom Message Style

```jsx
<LoadingMower 
  message={
    <div className="space-y-2">
      <h3 className="text-xl font-bold">Creating Service</h3>
      <p className="text-sm text-muted-foreground">Step 2 of 3</p>
    </div>
  }
  size="lg" 
/>
```

---

## 📱 Mobile Considerations

Both animations are fully responsive and work great on mobile. However, for very slow connections:

```jsx
// Optionally use simple version on mobile
const isMobile = window.innerWidth < 768;

{loading && (
  isMobile ? (
    <LoadingMowerSimple message="Loading..." />
  ) : (
    <LoadingMower message="Loading..." size="lg" />
  )
)}
```

---

## ♿ Accessibility

Both components are accessibility-friendly:
- ✅ Respects `prefers-reduced-motion`
- ✅ Can add ARIA labels if needed
- ✅ Color contrast compliant
- ✅ Works with screen readers (via message prop)

To add ARIA attributes:
```jsx
<div role="status" aria-live="polite">
  <LoadingMower message="Loading dashboard..." />
</div>
```

---

## 🧪 Testing

### Demo Page
Import the demo component to test both versions:
```jsx
import LoadingMowerDemo from '@/components/ui/loading-mower-demo';
```

### Quick Test
```jsx
// In any page
const [testing, setTesting] = useState(true);

{testing && <LoadingMower message="Test" size="lg" />}
```

---

## 📊 Performance

**Bundle Size Impact:**
- `LoadingMower`: ~3KB (gzipped)
- `LoadingMowerSimple`: ~2KB (gzipped)
- CSS animations: ~1KB (gzipped)

**Animation Performance:**
- ✅ GPU-accelerated (uses `transform` and `opacity`)
- ✅ No layout thrashing
- ✅ 60 FPS on modern devices
- ✅ Degrades gracefully on older devices

---

## 🔄 Migration from Old Spinners

### Before:
```jsx
<div className="animate-spin rounded-full h-32 w-32 border-b-2 border-green-600"></div>
```

### After:
```jsx
<LoadingMower size="lg" />
```

### Before (Loader2):
```jsx
<Loader2 className="h-16 w-16 animate-spin text-primary" />
```

### After:
```jsx
<LoadingMower size="md" message="Loading..." />
```

---

## ✅ Already Updated

These components have been updated to use the new loading animations:

- ✅ `src/components/auth/protected-route.jsx`
- ✅ `src/pages/services/add-service-page.jsx`

---

## 🎬 Animation Details

### LoadingMower (Detailed)
- **Mower movement:** 4s left-to-right cycle
- **Grass sway:** 2s per sway
- **Wheel rotation:** 0.3s per rotation
- **Blade spin:** 0.5s per rotation
- **LED pulse:** 2s pulse
- **Particles:** 1s lifetime

### LoadingMowerSimple (Minimal)
- **Bounce:** 1.5s up-down cycle
- **Wheel rotation:** 0.5s per rotation
- **Progress arc:** 3s per cycle
- **LED pulse:** Default pulse (2s)
- **Grass line:** 0.5s dash animation

---

## 🐛 Troubleshooting

### Animation not showing?
- Check that `src/index.css` has the custom animations
- Make sure component is imported correctly
- Verify Tailwind is processing the classes

### Animation too slow/fast?
- Edit the animation durations in `index.css`
- Adjust `ease-in-out` timing functions

### Colors not matching theme?
- Update the `text-*` classes in the component
- Ensure dark mode classes are correct

### Message not showing?
- Check that you're passing the `message` prop
- Verify message is not empty string

---

## 📝 Notes

- **Theme Support:** Both components work in light and dark mode automatically
- **Browser Support:** Works in all modern browsers (Chrome, Firefox, Safari, Edge)
- **IE11:** Uses SVG fallback (static, no animation)
- **File Size:** Minimal impact on bundle size
- **Dependencies:** None! Pure React + CSS

---

**Created for BotKorp** 🤖🌱


