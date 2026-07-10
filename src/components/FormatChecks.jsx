function isBasicLand(card) {
  return card.types?.includes('Basic')
}

// Live deck-legality checklist. Checks only what it can know: cards saved
// before color identity / legality data existed are skipped, never flagged.
export default function FormatChecks({ format, main, commander }) {
  const total = main.reduce((n, c) => n + c.count, 0)
  const checks = []

  if (format === 'commander') {
    checks.push({
      ok: !!commander,
      label: commander
        ? `Commander: ${commander.name}`
        : 'No commander — crown (♛) a legendary creature in your list',
    })

    checks.push({ ok: total === 100, label: `${total}/100 cards (commander included)` })

    const dupes = main.filter((c) => c.count > 1 && !isBasicLand(c))
    checks.push({
      ok: !dupes.length,
      label: dupes.length
        ? `Singleton broken (max 1 copy except basic lands): ${dupes.map((c) => c.name).join(', ')}`
        : 'Singleton — one copy of each card (basic lands excepted)',
    })

    if (commander?.colorIdentity) {
      const identity = new Set(commander.colorIdentity)
      const outside = main.filter(
        (c) => c.colorIdentity && !c.colorIdentity.every((x) => identity.has(x)),
      )
      const identityLabel = commander.colorIdentity.join('') || 'colorless'
      checks.push({
        ok: !outside.length,
        label: outside.length
          ? `Outside ${identityLabel} color identity: ${outside.map((c) => c.name).join(', ')}`
          : `All cards fit the commander's color identity (${identityLabel})`,
      })
    }

    const illegal = main.filter((c) => c.commanderLegal === false)
    checks.push({
      ok: !illegal.length,
      label: illegal.length
        ? `Not legal in Commander: ${illegal.map((c) => c.name).join(', ')}`
        : 'All cards legal in Commander',
    })
  } else {
    checks.push({ ok: total >= 60, label: `${total}/60 cards minimum` })
    const overFour = main.filter((c) => c.count > 4 && !c.types?.includes('Land') && !isBasicLand(c))
    checks.push({
      ok: !overFour.length,
      label: overFour.length
        ? `More than 4 copies: ${overFour.map((c) => c.name).join(', ')}`
        : 'Max 4 copies of each card (basic lands excepted)',
    })
  }

  return (
    <ul className="format-checks">
      {checks.map((c, i) => (
        <li key={i} className={c.ok ? 'check-ok' : 'check-fail'}>
          <span className="check-icon">{c.ok ? '✓' : '✗'}</span> {c.label}
        </li>
      ))}
    </ul>
  )
}
