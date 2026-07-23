import { describe, it, expect } from 'vitest'
import { formatCurrency } from '../lib/paystack'

describe('formatCurrency', () => {
	it('formats South African Rand correctly', () => {
		expect(formatCurrency(1500)).toBe('R 15.00')
	})
}) 