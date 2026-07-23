import Navbar from '../../components/layout/Navbar'
import Hero from './Hero'
import Features from './Features'
import Pricing from './Pricing'
import Testimonials from './Testimonials'

export default function LandingPage() {
	return (
		<div className="min-h-screen bg-neutral-50 text-neutral-900">
			<Navbar />
			<Hero />
			<Features />
			<Pricing />
			<Testimonials />
			<footer className="py-12 text-center text-sm text-neutral-500">© {new Date().getFullYear()} Bomah</footer>
		</div>
	)
} 