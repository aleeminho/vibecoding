import { describe, expect, test } from 'bun:test'
import { destinationError, normaliseAccountNumber } from './destination'

describe('normaliseAccountNumber', () => {
  test('keeps digits only', () => {
    expect(normaliseAccountNumber('123-456.789 0')).toBe('1234567890')
    expect(normaliseAccountNumber('0812 3456 7890')).toBe('081234567890')
  })

  test('an empty string stays empty', () => {
    expect(normaliseAccountNumber('')).toBe('')
    expect(normaliseAccountNumber('---')).toBe('')
  })
})

describe('destinationError', () => {
  test('a complete destination passes', () => {
    expect(destinationError('BCA', '1234567890', 'Alee')).toBeNull()
  })

  test('each field is required, in reading order', () => {
    expect(destinationError('', '1234567890', 'Alee')).toBe('Bank atau e-wallet belum diisi.')
    expect(destinationError('BCA', '1234567890', '')).toBe('Nama penerima belum diisi.')
    expect(destinationError('BCA', '12', 'Alee')).toBe('Nomor tujuan minimal 6 angka.')
  })

  test('separators do not count toward the digits', () => {
    expect(destinationError('BCA', '1-2-3-4-5', 'Alee')).toBe('Nomor tujuan minimal 6 angka.')
    expect(destinationError('BCA', '123456', 'Alee')).toBeNull()
  })
})
