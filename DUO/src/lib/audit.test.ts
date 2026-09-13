import { describe, expect, test } from 'bun:test'
import { describeAudit } from './audit'

const row = (action: string, detail: unknown = null) => ({
  action,
  ref_code: 'YQ3HWJDM',
  detail,
})

describe('describeAudit', () => {
  test('names the person on a share action', () => {
    expect(describeAudit(row('share.paid', { person: 'Budi' }))).toBe('Budi ditandai lunas')
    expect(describeAudit(row('share.unpaid', { person: 'Budi' }))).toBe('Budi dibatalkan lunasnya')
  })

  test('the bill actions need no detail', () => {
    expect(describeAudit(row('bill.deleted'))).toBe('Tagihan dihapus')
    expect(describeAudit(row('bill.restored'))).toBe('Tagihan dikembalikan')
  })

  test('an amount change reads as a before and after', () => {
    const line = describeAudit(row('bill.amount_changed', { field: 'total', from: 75900, to: 80000 }))
    expect(line).toContain('total')
    expect(line).toContain('75.900')
    expect(line).toContain('80.000')
  })

  /*
   * The cases that would otherwise reach the screen as "undefined" or "NaN".
   * Each of these is a row that exists and says something happened, which is
   * still worth showing — hiding it because a field is missing would make the
   * log lie by omission.
   */
  test('a missing person does not render as undefined', () => {
    const line = describeAudit(row('share.paid', null))
    expect(line).not.toContain('undefined')
    expect(line).toBe('Seseorang ditandai lunas')
  })

  test('a missing amount does not render as NaN', () => {
    const line = describeAudit(row('bill.amount_changed', { field: 'total' }))
    expect(line).not.toContain('NaN')
    expect(line).not.toContain('undefined')
  })

  test('detail that is not an object at all is survivable', () => {
    // jsonb accepts a bare string or number, and nothing stops one being
    // written. Reading a property off it would throw inside the template.
    for (const detail of ['text', 42, [], true]) {
      expect(() => describeAudit(row('share.paid', detail))).not.toThrow()
    }
  })

  test('an action with no case is shown, not swallowed', () => {
    // A new action that forgets this file should look like a gap on the screen
    // rather than be absent from it.
    expect(describeAudit(row('bill.something_new'))).toBe('bill.something_new')
  })
})
