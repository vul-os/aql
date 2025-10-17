/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
  	extend: {
			// colors merged below in a single object
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
			colors: {
				// Core tokens mapped to CSS vars
				background: 'hsl(var(--background))',
				foreground: 'hsl(var(--foreground))',
				card: {
					DEFAULT: 'hsl(var(--card))',
					foreground: 'hsl(var(--card-foreground))'
				},
				popover: {
					DEFAULT: 'hsl(var(--popover))',
					foreground: 'hsl(var(--popover-foreground))'
				},
				primary: {
					DEFAULT: 'hsl(var(--primary))',
					foreground: 'hsl(var(--primary-foreground))'
				},
				secondary: {
					DEFAULT: 'hsl(var(--secondary))',
					foreground: 'hsl(var(--secondary-foreground))'
				},
				muted: {
					DEFAULT: 'hsl(var(--muted))',
					foreground: 'hsl(var(--muted-foreground))'
				},
				accent: {
					DEFAULT: 'hsl(var(--accent))',
					foreground: 'hsl(var(--accent-foreground))'
				},
				destructive: {
					DEFAULT: 'hsl(var(--destructive))',
					foreground: 'hsl(var(--destructive-foreground))'
				},
				border: 'hsl(var(--border))',
				input: 'hsl(var(--input))',
				ring: 'hsl(var(--ring))',
				chart: {
					'1': 'hsl(var(--chart-1))',
					'2': 'hsl(var(--chart-2))',
					'3': 'hsl(var(--chart-3))',
					'4': 'hsl(var(--chart-4))',
					'5': 'hsl(var(--chart-5))'
				},
				// Custom brand colors used in layout/sidebars
				// Fresh & Tech Color Scheme
				'botkorp-green-50': '#ecfdf5',
				'botkorp-green-500': '#10B981', // Emerald-500 - Primary
				'botkorp-green-600': '#059669', // Emerald-600 - Darker green
				'botkorp-blue-500': '#3B82F6', // Blue-500 - Secondary
				'botkorp-blue-600': '#2563EB', // Blue-600 - Darker blue
				'botkorp-slate-700': '#334155', // Slate-700
				'botkorp-slate-800': '#1E293B', // Slate-800
				'botkorp-slate-900': '#0F172A', // Slate-900 - Accent
				'accent-blue': '#3B82F6', // Secondary blue
				// Legacy aliases for backwards compatibility
				'botkorp-grey-700': '#334155',
				'botkorp-grey-800': '#1E293B',
				'botkorp-grey-900': '#0F172A'
			},
			boxShadow: {
				'glow': '0 0 20px rgba(59, 130, 246, 0.30)', // Blue glow
				'glow-lg': '0 0 40px rgba(16, 185, 129, 0.35)', // Green glow
				'glow-green': '0 0 30px rgba(16, 185, 129, 0.35)' // Green glow
			},
			keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
				},
				float: {
					'0%, 100%': { transform: 'translateY(0)' },
					'50%': { transform: 'translateY(-10px)' }
				},
				slideInRight: {
					'0%': { transform: 'translateX(100%)' },
					'100%': { transform: 'translateX(0)' }
				}
  		},
			animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
				'accordion-up': 'accordion-up 0.2s ease-out',
				'float': 'float 3s ease-in-out infinite',
				'slide-in-right': 'slideInRight 0.3s ease-out'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
}
