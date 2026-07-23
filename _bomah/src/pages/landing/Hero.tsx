import { Button } from '../../components/ui/Button'

export default function Hero() {
	return (
		<section className="relative min-h-[70vh] flex items-center justify-center bg-gradient-to-b from-primary to-black/80 text-white">
			<div className="absolute inset-0 bg-[url(/hero.jpg)] bg-cover bg-center opacity-20" />
			<div className="relative z-10 max-w-4xl mx-auto text-center px-6 py-16">
				<h1 className="font-display text-4xl md:text-6xl font-bold">Smart Garden & Pool Care, Perfected</h1>
				<p className="mt-4 text-lg md:text-xl text-white/80">AI-powered maintenance for South African homes</p>
				<div className="mt-8 flex items-center justify-center gap-4">
					<Button size="lg">Start Free Trial</Button>
					<Button size="lg" variant="secondary">Watch Demo</Button>
				</div>
				<p className="mt-6 text-white/70">500+ Happy Homes</p>
			</div>
		</section>
	)
} 