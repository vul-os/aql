import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { Button } from '../../../components/ui/Button'

type Member = { id: string; user_id: string; role: 'owner'|'admin'|'member'|'viewer' }

export default function TeamManagement() {
	const [members, setMembers] = useState<Member[]>([])
	const [email, setEmail] = useState('')
	const [role, setRole] = useState<Member['role']>('member')
	const [homeId, setHomeId] = useState<string>('')

	useEffect(() => {
		(async () => {
			const { data: { user } } = await supabase.auth.getUser()
			if (!user) return
			const { data: homes } = await supabase.from('home_members').select('home_id').eq('user_id', user.id).limit(1)
			const h = homes?.[0]?.home_id
			if (!h) return
			setHomeId(h)
			const { data } = await supabase.from('home_members').select('*').eq('home_id', h)
			setMembers((data as any) || [])
		})()
	}, [])

	async function invite() {
		// In production, send a real invite. Here we create a placeholder via auth admin APIs or a stub.
		if (!homeId) return
		await supabase.from('home_members').insert({ home_id: homeId, user_id: crypto.randomUUID(), role })
		const { data } = await supabase.from('home_members').select('*').eq('home_id', homeId)
		setMembers((data as any) || [])
		setEmail('')
	}

	async function remove(memberId: string) {
		await supabase.from('home_members').delete().eq('id', memberId)
		const { data } = await supabase.from('home_members').select('*').eq('home_id', homeId)
		setMembers((data as any) || [])
	}

	return (
		<div className="space-y-4">
			<div className="flex gap-2">
				<input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Invite by email" className="flex-1 rounded border px-3 py-2" />
				<select value={role} onChange={(e) => setRole(e.target.value as Member['role'])} className="rounded border px-3 py-2">
					<option value="admin">Admin</option>
					<option value="member">Member</option>
					<option value="viewer">Viewer</option>
				</select>
				<Button onClick={invite}>Invite</Button>
			</div>
			<ul className="divide-y rounded border bg-white">
				{members.map((m) => (
					<li key={m.id} className="flex items-center justify-between p-3 text-sm">
						<div className="flex items-center gap-2">
							<span className="font-medium">{m.user_id}</span>
							<span className="text-neutral-500">{m.role}</span>
						</div>
						<Button variant="outline" onClick={() => remove(m.id)}>Remove</Button>
					</li>
				))}
			</ul>
		</div>
	)
} 