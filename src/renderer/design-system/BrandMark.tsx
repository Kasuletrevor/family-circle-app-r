import kinKeepersLogo from '../assets/kin-keepers-logo.jpg'
import './BrandMark.css'

type BrandMarkProps = {
  compact?: boolean
}

export function BrandMark({ compact = false }: BrandMarkProps) {
  return (
    <div className={`brand-mark${compact ? ' brand-mark--compact' : ''}`}>
      <img
        className="brand-mark__logo"
        src={kinKeepersLogo}
        alt="Kin-Keepers"
      />
      {!compact && <span className="brand-mark__tagline">Private by design.</span>}
    </div>
  )
}
