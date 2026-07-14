import { useState, useRef } from 'react'
import { findCardByName } from '../api/mtg'

const PREVIEW_W = 244
const PREVIEW_H = 340

// name(lower) -> imageUrl | null, so repeat hovers never refetch
const imageCache = new Map()

// A card name that shows the card image in a floating preview on hover.
// Uses the provided imageUrl when known (cards already in the deck), or
// resolves the name via Scryfall on first hover.
export default function CardName({ name, imageUrl }) {
  const [preview, setPreview] = useState(null)
  const hoverToken = useRef(0)

  async function show(e) {
    const token = ++hoverToken.current
    const rect = e.currentTarget.getBoundingClientRect()
    const fitsLeft = rect.left - PREVIEW_W - 16 >= 8
    const left = fitsLeft
      ? rect.left - PREVIEW_W - 16
      : Math.min(rect.right + 16, window.innerWidth - PREVIEW_W - 8)
    const top = Math.max(8, Math.min(rect.top + rect.height / 2 - PREVIEW_H / 2, window.innerHeight - PREVIEW_H - 8))

    let url = imageUrl
    if (!url) {
      const key = name.toLowerCase()
      if (imageCache.has(key)) {
        url = imageCache.get(key)
      } else {
        try {
          url = (await findCardByName(name))?.imageUrl ?? null
        } catch {
          url = null
        }
        imageCache.set(key, url)
      }
    }
    // Bail if the mouse already left while we were fetching
    if (!url || hoverToken.current !== token) return
    setPreview({ left, top, url })
  }

  function hide() {
    hoverToken.current++
    setPreview(null)
  }

  return (
    <span className="card-name-hover" onMouseEnter={show} onMouseLeave={hide}>
      {name}
      {preview && (
        <img
          className="card-hover-preview"
          src={preview.url}
          alt={name}
          style={{ left: preview.left, top: preview.top }}
        />
      )}
    </span>
  )
}
