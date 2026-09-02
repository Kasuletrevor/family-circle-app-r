import './BrandMark.css'

type BrandMarkProps = {
  compact?: boolean
}

export function BrandMark({ compact = false }: BrandMarkProps) {
  return (
    <div className={`brand-mark${compact ? ' brand-mark--compact' : ''}`}>
      <div className="brand-mark__logo-frame">
        <span className="brand-mark__fallback" aria-hidden="true">K</span>
        <img
          className="brand-mark__logo"
          src="/kin-cropped.jpg"
          alt="Kin-Keepers logo"
          onError={(event) => {
            event.currentTarget.style.display = 'none'
          }}
        />
      </div>
      <div className="brand-mark__copy">
        <strong>Kin-Keepers</strong>
        {!compact && <span>Private by design.</span>}
      </div>
    </div>
  )
}
