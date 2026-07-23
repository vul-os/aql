import { Button } from '../../components/ui/Button'
import { formatCurrency } from '../../lib/paystack'

const plans = [
	{ name: 'Basic', price: 9900, features: ['1 mower', 'Weather monitoring'], cta: 'Choose Basic' },
	{ name: 'Premium', price: 19900, features: ['3 mowers', 'Pool maintenance'], cta: 'Choose Premium', highlighted: true },
	{ name: 'Enterprise', price: 39900, features: ['Unlimited', 'Priority support'], cta: 'Contact Sales' },
]

export default function Pricing() {
	return (
		<section className="py-20 bg-neutral-50">
			<div className="max-w-6xl mx-auto px-6 text-center">
				<h2 className="font-display text-3xl md:text-4xl font-bold">Simple pricing for every home</h2>
				<p className="mt-3 text-neutral-600">Transparent monthly plans in South African Rand</p>
				<div className="mt-10 grid md:grid-cols-3 gap-6">
					{plans.map((p) => (
						<div key={p.name} className={`rounded-2xl border bg-white p-8 text-left ${p.highlighted ? 'border-primary shadow-lg' : ''}`}>
							<h3 className="text-xl font-semibold">{p.name}</h3>
							<p className="mt-2 text-3xl font-bold">{formatCurrency(p.price)}<span className="text-sm font-normal text-neutral-500">/mo</span></p>
							<ul className="mt-4 space-y-2 text-sm text-neutral-700">
								{p.features.map((f) => <li key={f}>• {f}</li>)}
							</ul>
							<Button className="mt-6 w-full">{p.cta}</Button>
						</div>
					))}
				</div>
			</div>
		</section>
	)
} 