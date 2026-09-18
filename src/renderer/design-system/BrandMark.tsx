import './BrandMark.css'

type BrandMarkProps = {
  compact?: boolean
}

export function BrandMark({ compact = false }: BrandMarkProps) {
  return (
    <div className={`brand-mark${compact ? ' brand-mark--compact' : ''}`}>
      <div className="brand-mark__logo-frame">
        <img
          className="brand-mark__logo"
          src="./kin-cropped.jpg"
          alt="Kin-Keepers logo"
        />
      </div>
      <div className="brand-mark__copy">
        <strong className="brand-mark__name">Kin-Keepers</strong>
        {!compact && <span>Private by design.</span>}
      </div>
    </div>
  )
}
