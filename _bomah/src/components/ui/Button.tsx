import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'
import type { ButtonHTMLAttributes } from 'react'
import { forwardRef } from 'react'

const buttonVariants = cva(
	'inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none',
	{
		variants: {
			variant: {
				default: 'bg-primary text-white hover:bg-primary/90',
				secondary: 'bg-secondary text-white hover:bg-secondary/90',
				ghost: 'bg-transparent hover:bg-white/10 text-white',
				outline: 'border border-white/20 text-white hover:bg-white/10',
			},
			size: {
				sm: 'h-9 px-3 text-sm',
				md: 'h-10 px-4',
				lg: 'h-12 px-6 text-base',
			},
		},
		defaultVariants: {
			variant: 'default',
			size: 'md',
		},
	}
)

export interface ButtonProps
	extends ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, variant, size, ...props }, ref) => {
		return (
			<button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
		)
	}
)

Button.displayName = 'Button' 