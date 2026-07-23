import { Link } from '@tanstack/react-router'
import { Button } from '../ui/Button'

export default function Navbar() {
	return (
		<header className="sticky top-0 z-20 w-full backdrop-blur supports-[backdrop-filter]:bg-white/60 bg-white/80 border-b">
			<div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
				<Link to="/" className="flex items-center gap-2">
					<div className="h-8 w-8 rounded bg-primary" />
					<span className="font-display text-xl">Bomah</span>
				</Link>
				<nav className="hidden md:flex items-center gap-6 text-sm">
					<Link to="/" className="hover:text-primary">Home</Link>
					<Link to="/pricing" className="hover:text-primary">Pricing</Link>
					<Link to="/dashboard" className="hover:text-primary">Dashboard</Link>
				</nav>
				<div className="flex items-center gap-3">
					<Link to="/auth"><Button variant="outline">Login</Button></Link>
					<Link to="/auth"><Button>Start Free Trial</Button></Link>
				</div>
			</div>
		</header>
	)
} 