const testimonials = [
	{ name: 'Sipho M.', location: 'Johannesburg', quote: 'Our mower just works. Bomah keeps the lawn perfect.' },
	{ name: 'Anika V.', location: 'Cape Town', quote: 'Pool is always crystal clear. Love the alerts.' },
	{ name: 'Thabo K.', location: 'Durban', quote: 'Super professional maintenance team.' },
]

export default function Testimonials() {
	return (
		<section className="py-20 bg-white">
			<div className="max-w-6xl mx-auto px-6">
				<h2 className="font-display text-3xl md:text-4xl font-bold text-center">Trusted by South African homeowners</h2>
				<div className="mt-10 grid md:grid-cols-3 gap-6">
					{testimonials.map((t) => (
						<figure key={t.name} className="rounded-2xl border bg-white p-6 shadow-sm">
							<blockquote className="text-neutral-700">“{t.quote}”</blockquote>
							<figcaption className="mt-4 text-sm text-neutral-500">{t.name} — {t.location}</figcaption>
						</figure>
					))}
				</div>
			</div>
		</section>
	)
} 