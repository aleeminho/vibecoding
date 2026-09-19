<script lang="ts">
  /**
   * Dev-only preview of the Review screen.
   *
   * The problem this solves: the Review screen is behind a login, a camera, an
   * API call and a network round trip. That is four things between a UI change
   * and seeing whether it helped, which in practice means the UI gets written
   * blind — which is exactly how the first version of it was built, and it
   * showed.
   *
   * This seeds the draft with a fixture and renders the real screen, so a
   * layout change can be looked at in seconds, at phone size, in a browser.
   *
   * Striped out of production by the `import.meta.env.DEV` guard in App.svelte.
   * The receipt in the fixture is a drawn placeholder, not a real photo — a
   * real receipt does not belong in a repo.
   */
  import { onMount } from 'svelte'
  import { draft } from '../lib/draft.svelte'
  import Review from './Review.svelte'

  /**
   * A receipt-shaped placeholder. The proportions matter more than the content:
   * a receipt is tall and narrow, and the screen has to look right with one.
   */
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="620" height="940">
    <rect width="620" height="940" fill="#f7f4ec"/>
    <g fill="#c9c3b4">
      <rect x="180" y="60" width="260" height="26" rx="4"/>
      <rect x="220" y="100" width="180" height="14" rx="4"/>
      <rect x="140" y="170" width="340" height="9" rx="3"/>
      <rect x="180" y="190" width="260" height="9" rx="3"/>
      <rect x="200" y="210" width="220" height="9" rx="3"/>
      <rect x="140" y="280" width="340" height="2"/>
    </g>
    <g fill="#8a8478">
      <rect x="150" y="310" width="150" height="12" rx="3"/>
      <rect x="150" y="350" width="120" height="12" rx="3"/>
      <rect x="150" y="390" width="180" height="12" rx="3"/>
      <rect x="150" y="430" width="100" height="12" rx="3"/>
      <rect x="150" y="470" width="140" height="12" rx="3"/>
      <rect x="150" y="510" width="130" height="12" rx="3"/>
      <rect x="150" y="550" width="160" height="12" rx="3"/>
    </g>
    <g fill="#6b665c">
      <rect x="420" y="310" width="70" height="11" rx="3"/>
      <rect x="420" y="350" width="70" height="11" rx="3"/>
      <rect x="420" y="390" width="70" height="11" rx="3"/>
      <rect x="420" y="430" width="70" height="11" rx="3"/>
      <rect x="420" y="470" width="70" height="11" rx="3"/>
      <rect x="420" y="510" width="70" height="11" rx="3"/>
      <rect x="420" y="550" width="70" height="11" rx="3"/>
    </g>
    <rect x="140" y="600" width="340" height="2" fill="#c9c3b4"/>
    <g fill="#4a463e">
      <rect x="380" y="640" width="110" height="12" rx="3"/>
      <rect x="380" y="672" width="110" height="12" rx="3"/>
      <rect x="380" y="704" width="110" height="12" rx="3"/>
      <rect x="300" y="760" width="190" height="20" rx="4"/>
    </g>
  </svg>`

  const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`

  onMount(() => {
    draft.start(
      {
        base64: '',
        dataUrl,
        width: 620,
        height: 940,
        bytes: 0,
      },
      {
        place: 'Lucky Cat Coffee & Kitchen',
        date: '2026-06-26',
        items: [
          { name: 'Long Black', qty: 1, line_total: 35000 },
          { name: 'Ice Caramel Latte', qty: 1, line_total: 45000 },
          { name: 'Lychee Tea', qty: 2, line_total: 80000 },
          { name: 'Peach Tea', qty: 3, line_total: 120000 },
          { name: 'Ice Latte', qty: 1, line_total: 45000 },
          { name: 'Japanese', qty: 1, line_total: 35000 },
          { name: 'Aqua Reflections Natural', qty: 1, line_total: 35000 },
        ],
        subtotal: 395000,
        discount: 0,
        tax: 41475,
        tax_inclusive: false,
        service_charge: 19750,
        rounding_adjustment: 0,
        total: 456225,
        // Non-null on purpose: the banner has to be judged too, and a fixture
        // that never shows it means it never gets looked at.
        confidence_notes: 'Angka service charge agak buram, kemungkinan 19.750.',
      },
    )

    // Four states, one URL apart. Each exists because it is a state that a
    // fixture which only shows the happy path never reveals:
    //
    //   #/preview          blocked by one unassigned item
    //   #/preview?done     everything assigned, result section visible
    //   #/preview?fresh    exactly as it looks the second after an upload:
    //                      no roster, nothing assigned, nothing wrong yet
    //   #/preview?crowd    eight people, so the wrapping and the long-list
    //                      behaviour get looked at too
    //
    // `fresh` is the one that matters most and was missing the longest: it is
    // the state the operator actually lands in, and it was never on screen
    // while the screen was being designed.
    const params = location.hash.split('?')[1] ?? ''

    if (params.includes('fresh')) return

    const crowd = params.includes('crowd')
    const people = crowd
      ? ['Budi', 'Sarah', 'Andi', 'Dewi', 'Rina', 'Tono', 'Maya', 'Gilang']
      : ['Budi', 'Sarah', 'Andi', 'Dewi']

    for (const person of people) draft.addPerson(person)

    draft.toggleAssignee(1, 'Budi')
    draft.toggleAssignee(2, 'Sarah')
    draft.toggleAssignee(3, 'Budi')
    draft.toggleAssignee(3, 'Sarah')
    draft.toggleAssignee(4, 'Andi')
    draft.toggleAssignee(4, 'Dewi')
    draft.toggleAssignee(5, 'Andi')
    draft.toggleAssignee(7, 'Budi')

    // Item 6 is left alone here ON PURPOSE. Unassigned is the state that blocks
    // the commit, and a fixture where everything is finished never shows it —
    // which is how the first version of this screen got designed without ever
    // looking at the state the operator actually lands in.
    //
    // It used to be assigned to Dewi above and then toggled OFF a few lines
    // down for `done`, which meant `#/preview` and `#/preview?done` showed each
    // other's state. Every screenshot of "done" was really a screenshot of
    // blocked, and the result section was never looked at at all.
    if (crowd) {
      draft.toggleAssignee(1, 'Rina')
      draft.toggleAssignee(2, 'Tono')
      draft.toggleAssignee(4, 'Maya')
      draft.toggleAssignee(4, 'Gilang')
      draft.toggleAssignee(5, 'Rina')
      draft.toggleAssignee(6, 'Tono')
      draft.toggleAssignee(7, 'Maya')
      draft.toggleAssignee(7, 'Gilang')
    } else if (params.includes('done')) {
      draft.toggleAssignee(6, 'Dewi')
    }
  })
</script>

<Review onDone={() => {}} />
