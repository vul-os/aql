export default function Features() {
	const features = [
		{
			title: 'Smart Mower Management',
			desc: 'Real-time tracking and scheduling for your lawn mowers.',
		},
		{ title: 'Pool Water Quality Monitoring', desc: 'Live pH, chlorine and temperature.' },
		{ title: 'Weather-Based Automation', desc: 'Rain detection and seasonal adjustments.' },
		{ title: 'Professional Maintenance', desc: 'Certified technicians, guaranteed service.' },
	]
	return (
		<section className="py-16 bg-white">
			<div className="max-w-6xl mx-auto px-6 grid md:grid-cols-2 lg:grid-cols-4 gap-6">
				{features.map((f) => (
					<div key={f.title} className="rounded-xl border bg-white p-6 shadow-sm">
						<h3 className="font-semibold">{f.title}</h3>
						<p className="mt-2 text-sm text-neutral-600">{f.desc}</p>
					</div>
				))}
			</div>
		</section>
	)
} 