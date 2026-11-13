import { useEffect, useState } from 'react'
import { STRINGS, type Lang } from './i18n'
import { SHARE_FORMATS, canShareFiles, cardFile, downloadCard, type ShareFormat } from './share'

interface Props {
  lang: Lang
  /** Draws the card in the given format. */
  render(format: ShareFormat): Promise<Blob | null>
  onClose(): void
}

/** Pick a format, see the card, then pass it to another app or save it. */
export default function Share({ lang, render, onClose }: Props) {
  const t = STRINGS[lang].share
  const [format, setFormat] = useState<ShareFormat>('story')
  const [card, setCard] = useState<{ blob: Blob; url: string } | null>(null)

  useEffect(() => {
    let current = true
    let url = ''
    render(format).then((blob) => {
      if (!current || !blob) return
      url = URL.createObjectURL(blob)
      setCard({ blob, url })
    })
    return () => {
      current = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [format, render])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [onClose])

  const send = async () => {
    if (!card) return
    try {
      await navigator.share({ files: [cardFile(card.blob)], title: 'Been Map' })
    } catch {
      // the share sheet was dismissed; nothing to do
    }
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="share" role="dialog" aria-modal="true" aria-label={t.title}>
        <button className="share-close" onClick={onClose} aria-label={t.close}>
          ×
        </button>
        <h2>{t.title}</h2>
        <div className="switch" role="radiogroup" aria-label={t.format}>
          {SHARE_FORMATS.map((f) => (
            <button key={f} role="radio" aria-checked={format === f} onClick={() => setFormat(f)}>
              {t.formats[f]}
            </button>
          ))}
        </div>
        <div className="share-preview" data-format={format}>
          {card && <img src={card.url} alt={t.preview} />}
        </div>
        <div className="share-actions">
          {card && canShareFiles(card.blob) && (
            <button className="primary" onClick={send}>
              {t.send}
            </button>
          )}
          <button className={card && canShareFiles(card.blob) ? 'chip' : 'primary'} disabled={!card} onClick={() => card && downloadCard(card.blob)}>
            {t.save}
          </button>
        </div>
        <p className="share-note">{t.note}</p>
      </div>
    </div>
  )
}
