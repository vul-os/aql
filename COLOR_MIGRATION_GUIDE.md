# Color Migration Guide

## Completed Updates ✅

### Core Theme Files
- ✅ `tailwind.config.js` - Updated to new palette
- ✅ `src/index.css` - CSS variables for light/dark mode
- ✅ `src/colours.txt` - Documentation updated
- ✅ `src/theme.js` - New centralized theme config

### Layout Components
- ✅ `src/components/layout/portal-layout.jsx` - Light sidebar in light mode, dark in dark mode
- ✅ Sidebar navigation uses accent (tangerine) for active items
- ✅ All borders and backgrounds use semantic colors

### Pages
- ✅ Landing Page - Updated to use new palette
- ✅ Dashboard Page - Updated chart colors and indicators

## Remaining Color Replacements

### Semantic Colors (Keep as-is)
These colors serve specific semantic purposes and should remain:
- **Green** (#10B981) - Success states, confirmation indicators
- **Red** (#EF4444) - Errors, critical alerts  
- **Yellow/Amber** (#F59E0B) - Warnings, pending states

### Quick Reference Guide

**Replace these patterns:**

| Old Color | New Color | Usage |
|-----------|-----------|-------|
| `bg-blue-[n00]` | `bg-accent` or `bg-secondary` | Accents and CTAs |
| `text-blue-[n00]` | `text-accent` or `text-secondary` | Accent text |
| `border-blue-[n00]` | `border-accent` or `border-secondary` | Accent borders |
| Bright colors in charts | Use COLORS array | Already updated in dashboard |

**Use these instead:**

```jsx
// For primary actions/highlights
className="bg-accent text-accent-foreground"

// For secondary elements  
className="bg-secondary text-secondary-foreground"

// For neutral/muted elements
className="bg-muted text-muted-foreground"

// For borders
className="border-border"

// For subtle backgrounds
className="bg-accent/10" // 10% opacity
```

## Files with Minor Color References

These files have a few hardcoded colors that can be updated individually:

1. `src/pages/settings/settings-page.jsx` - Blue info boxes
2. `src/pages/admin/approvals-page.jsx` - Status indicators  
3. `src/pages/services/*.jsx` - Service type badges

## Recommended Approach

### Option 1: Gradual Migration (Recommended)
Update colors as you work on each page. Most components already use CSS variables and will automatically use the new colors.

### Option 2: Batch Update
Search and replace in specific files:
```bash
# Example for blue to accent
find src/pages -name "*.jsx" -exec sed -i 's/bg-blue-600/bg-accent/g' {} \;
find src/pages -name "*.jsx" -exec sed -i 's/text-blue-600/text-accent/g' {} \;
```

## Current Color Usage

### Light Mode
- Background: White
- Foreground: Matte Black (#121212)
- Primary: Matte Black  
- Accent: Bright Tangerine (#FF6B35)
- Secondary: Slate Blue-Gray (#4F5D75)

### Dark Mode  
- Background: Matte Black (#121212)
- Foreground: White
- Primary: Bright Tangerine (#FF6B35)
- Accent: Bright Tangerine
- Secondary: Slate Blue-Gray (#4F5D75)

## Testing Checklist

- ✅ Light mode sidebar shows light background
- ✅ Dark mode sidebar shows dark background
- ✅ Active navigation items use tangerine orange
- ✅ Dashboard uses new color palette
- ✅ Charts use updated colors
- ⏳ Services pages reviewed
- ⏳ Members page reviewed  
- ⏳ Settings page reviewed
- ⏳ Admin pages reviewed

## Notes

- Most UI components (buttons, cards, inputs) automatically inherit the new colors through CSS variables
- Auth pages already use semantic color classes and don't need updates
- The theme provider handles dark mode switching automatically
- Badge components can be customized per-use case if needed

## Support

If you encounter any color inconsistencies:
1. Check if the component uses CSS variables (preferred)
2. Reference `src/theme.js` for color utilities
3. Use semantic classes (primary, accent, secondary) instead of hardcoded colors
4. For custom colors, add them to `tailwind.config.js`

---

Last Updated: October 17, 2025

