import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: Array<string | undefined | null | false>) {
	return twMerge(clsx(inputs))
}

export function toSAST(date: Date | string | number): Date {
	const d = new Date(date)
	// SAST is UTC+2 without DST
	const utc = d.getTime() + d.getTimezoneOffset() * 60000
	return new Date(utc + 2 * 60 * 60000)
} 