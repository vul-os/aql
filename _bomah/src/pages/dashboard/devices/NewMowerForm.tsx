import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { Button } from '../../../components/ui/Button'

export default function NewMowerForm() {
	const [name, setName] = useState('')
	const [submitting, setSubmitting] = useState(false)
	const [message, setMessage] = useState<string | null>(null)

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault()
		setSubmitting(true)
		setMessage(null)
		try {
			const {
				data: { user },
				error: userErr,
			} = await supabase.auth.getUser()
			if (userErr || !user) throw userErr || new Error('Not signed in')
			// Find user's home
			const { data: homes } = await supabase
				.from('home_members')
				.select('home_id')
				.eq('user_id', user.id)
				.limit(1)
			const homeId = homes?.[0]?.home_id
			if (!homeId) throw new Error('No home found')
			// Create device
			const { data: device, error: devErr } = await supabase
				.from('devices')
				.insert({ home_id: homeId, name, metadata: {}, is_active: true })
				.select('*')
				.single()
			if (devErr) throw devErr
			// Create mower row
			const { error: mowerErr } = await supabase.from('mowers').insert({ device_id: device.id, schedule_enabled: false })
			if (mowerErr) throw mowerErr
			setMessage('Mower created')
			setName('')
		} catch (err: any) {
			setMessage(err.message || 'Error')
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<form onSubmit={onSubmit} className="space-y-3">
			<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mower name" className="w-full rounded border px-3 py-2" />
			<Button disabled={submitting}>{submitting ? 'Creating...' : 'Add Mower'}</Button>
			{message && <p className="text-sm text-neutral-600">{message}</p>}
		</form>
	)
} 