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
				// Custom brand colors - Modern Tech Color Scheme
				'botkorp-black': '#121212', // Matte black - Primary
				'botkorp-black-light': '#1a1a1a', // Slightly lighter black
				'botkorp-orange': '#FF6B35', // Bright tangerine - Accent
				'botkorp-orange-dark': '#E85A2A', // Darker orange for hover
				'botkorp-slate-blue': '#4F5D75', // Slate blue-gray - Supporting
				'botkorp-silver': '#B0B3B8', // Cool silver - Supporting
				'botkorp-silver-light': '#D0D2D5', // Lighter silver
				// Legacy aliases for backwards compatibility (mapped to new colors)
				'botkorp-grey-700': '#4F5D75',
				'botkorp-grey-800': '#1a1a1a',
				'botkorp-grey-900': '#121212'
			},
			boxShadow: {
				'glow': '0 0 20px rgba(255, 107, 53, 0.30)', // Orange glow
				'glow-lg': '0 0 40px rgba(255, 107, 53, 0.35)', // Orange glow large
				'glow-orange': '0 0 30px rgba(255, 107, 53, 0.35)' // Orange glow
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
