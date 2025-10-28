# Magic UI Components Documentation

This project now includes beautiful animated components inspired by Magic UI to enhance the user interface with modern animations and interactions.

## 🎨 Installed Components

### 1. **NumberTicker** 
`/src/components/ui/number-ticker.jsx`

Animated number counter with smooth spring animations.

**Usage:**
```jsx
import NumberTicker from '@/components/ui/number-ticker';

<NumberTicker value={42} />
<NumberTicker value={1000} delay={0.5} decimalPlaces={2} />
```

**Props:**
- `value` (number): The target number to animate to
- `direction` ('up' | 'down'): Animation direction (default: 'up')
- `delay` (number): Delay before animation starts in seconds
- `className` (string): Additional CSS classes
- `decimalPlaces` (number): Number of decimal places to show

**Where it's used:**
- Dashboard stat cards for bot counts, service counts, etc.

---

### 2. **ShimmerButton**
`/src/components/ui/shimmer-button.jsx`

Eye-catching button with animated shimmer effect.

**Usage:**
```jsx
import { ShimmerButton } from '@/components/ui/shimmer-button';

<ShimmerButton
  onClick={handleClick}
  shimmerColor="#ffffff"
  background="linear-gradient(135deg, #FF6B35, #4F5D75)"
>
  Click Me
</ShimmerButton>
```

**Props:**
- `shimmerColor` (string): Color of shimmer effect (default: '#ffffff')
- `shimmerSize` (string): Size of shimmer
- `borderRadius` (string): Border radius
- `shimmerDuration` (string): Duration of animation
- `background` (string): Button background (supports gradients)

**Where it's used:**
- Primary CTAs on dashboard (Add Location, Add Service buttons)
- Welcome screen actions

---

### 3. **BorderBeam**
`/src/components/ui/border-beam.jsx`

Animated glowing border that travels around card edges.

**Usage:**
```jsx
import { BorderBeam } from '@/components/ui/border-beam';

<Card className="relative">
  <BorderBeam 
    size={250} 
    duration={12} 
    colorFrom="#FF6B35" 
    colorTo="#4F5D75" 
  />
  {/* Card content */}
</Card>
```

**Props:**
- `size` (number): Size of the beam (default: 200)
- `duration` (number): Animation duration in seconds
- `colorFrom` (string): Starting gradient color
- `colorTo` (string): Ending gradient color
- `borderWidth` (number): Width of the border
- `delay` (number): Animation delay

**Where it's used:**
- Important stat cards on dashboard
- Alert cards
- Chart cards
- Setup progress card

---

### 4. **Particles**
`/src/components/ui/animated-background.jsx`

Animated particle background with mouse interaction.

**Usage:**
```jsx
import { Particles } from '@/components/ui/animated-background';

<div className="relative">
  <Particles
    className="absolute inset-0 -z-10"
    quantity={50}
    ease={80}
    color="#FF6B35"
    refresh={false}
  />
  {/* Your content */}
</div>
```

**Props:**
- `quantity` (number): Number of particles (default: 50)
- `staticity` (number): How static particles are
- `ease` (number): Easing of mouse attraction
- `color` (string): Particle color in hex
- `vx`, `vy` (number): Velocity on x and y axis

**Where it's used:**
- Dashboard background
- Welcome screens
- Empty state backgrounds

---

### 5. **AnimatedCardHover**
`/src/components/ui/animated-card-hover.jsx`

Card wrapper that adds smooth hover animations and spotlight effect.

**Usage:**
```jsx
import { AnimatedCardHover } from '@/components/ui/animated-card-hover';

<AnimatedCardHover>
  <Card>
    {/* Card content */}
  </Card>
</AnimatedCardHover>
```

**Where it's used:**
- All stat cards
- Chart cards
- Alert cards
- Service cards

---

### 6. **GradientText**
`/src/components/ui/gradient-text.jsx`

Text with animated gradient effect.

**Usage:**
```jsx
import { GradientText } from '@/components/ui/gradient-text';

<h1>
  <GradientText animate>Welcome to Bot Korp</GradientText>
</h1>

<GradientText 
  from="from-green-600" 
  via="via-blue-600" 
  to="to-purple-600"
  animate
>
  Custom Gradient
</GradientText>
```

**Props:**
- `from` (string): Starting gradient color (Tailwind class)
- `via` (string): Middle gradient color
- `to` (string): Ending gradient color
- `animate` (boolean): Enable shine animation

**Where it's used:**
- Dashboard greeting
- Welcome screen headings
- Empty state titles

---

### 7. **AnimatedGridPattern**
`/src/components/ui/animated-grid-pattern.jsx`

Animated grid background with pulsing squares.

**Usage:**
```jsx
import { AnimatedGridPattern } from '@/components/ui/animated-grid-pattern';

<div className="relative">
  <AnimatedGridPattern
    width={40}
    height={40}
    numSquares={50}
    maxOpacity={0.3}
    duration={4}
  />
</div>
```

---

### 8. **ShineBorder**
`/src/components/ui/shine-border.jsx`

Container with animated shining border effect.

**Usage:**
```jsx
import { ShineBorder } from '@/components/ui/shine-border';

<ShineBorder
  borderRadius={8}
  borderWidth={2}
  duration={14}
  color="#FF6B35"
>
  Your content here
</ShineBorder>
```

---

## 🎭 Animation Keyframes

The following CSS animations have been added to `tailwind.config.js`:

- `border-beam`: Animates border beam around card edges
- `shimmer-slide`: Creates sliding shimmer effect
- `spin-around`: Rotating animation for shimmer button
- `shine`: Text shine animation

## 🎨 Brand Colors

The dashboard uses these brand colors for animations:

- **Primary Orange**: `#FF6B35` - Main accent color
- **Slate Blue**: `#4F5D75` - Supporting color
- **Green**: `#10b981` - Success/growth states
- **Blue**: `#3b82f6` - Analytics/data

## 💡 Best Practices

1. **Performance**: Particle effects should use `opacity` to control visibility and reduce CPU usage
2. **Accessibility**: Ensure animations don't interfere with screen readers
3. **Motion**: Respect `prefers-reduced-motion` for users who prefer less animation
4. **Loading**: Use `NumberTicker` for any numeric values that change
5. **CTAs**: Use `ShimmerButton` for primary actions to draw attention

## 🚀 Future Enhancements

Consider adding:
- Marquee component for announcements
- Ripple effect for interactive elements
- Animated beam for connecting related elements
- Typewriter effect for dynamic text
- Morphing shapes for loading states

## 📚 Resources

- Animations inspired by [Magic UI](https://magicui.design)
- Built with [Framer Motion](https://www.framer.com/motion/)
- Styled with [Tailwind CSS](https://tailwindcss.com)

---

**Note**: All components are optimized for performance and work seamlessly with the existing shadcn/ui components.

