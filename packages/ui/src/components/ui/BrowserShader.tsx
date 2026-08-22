import { useState, useEffect } from 'react'
import { Dithering } from '@paper-design/shaders-react'

const FALLBACK_COLOR = '#2D8CFF'

function rgbToHex(r: number, g: number, b: number): string {
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

function isGreyscale(r: number, g: number, b: number): boolean {
  return Math.max(r, g, b) - Math.min(r, g, b) < 15
}

function useAccentColor(): string {
  const [color, setColor] = useState(FALLBACK_COLOR)

  useEffect(() => {
    const updateAccent = () => {
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
      if (!accent || (typeof CSS !== 'undefined' && !CSS.supports('color', accent))) return

      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const context = canvas.getContext('2d')
      if (!context) return
      context.fillStyle = accent
      context.fillRect(0, 0, 1, 1)
      const pixel = context.getImageData(0, 0, 1, 1).data
      const r = pixel[0] ?? 0
      const g = pixel[1] ?? 0
      const b = pixel[2] ?? 0
      setColor(isGreyscale(r, g, b) ? FALLBACK_COLOR : rgbToHex(r, g, b))
    }

    updateAccent()
    window.addEventListener('craft-theme-change', updateAccent)
    return () => window.removeEventListener('craft-theme-change', updateAccent)
  }, [])

  return color
}

export interface BrowserShaderProps {
  className?: string
  rounded?: boolean
  borderRadius?: string
  maskImage: string
  opacity?: number

  // TurnCard+HDR shader params
  colorBack?: string
  colorFront?: string
  shape?: 'warp' | 'simplex' | 'dots' | 'wave' | 'ripple' | 'swirl' | 'sphere'
  type?: '2x2' | '4x4' | '8x8' | 'random'
  size?: number
  speed?: number
  scale?: number
  maxPixelCount?: number
  minPixelRatio?: number
}

export function BrowserShader({
  className,
  rounded = false,
  borderRadius = '8px',
  maskImage,
  opacity = 0.85,
  colorBack = 'rgba(0,0,0,0)',
  colorFront,
  shape = 'warp',
  type = '4x4',
  size = 2,
  speed = 0.55,
  scale = 0.78,
  maxPixelCount = 350000,
  minPixelRatio = 1,
}: BrowserShaderProps) {
  const accentColor = useAccentColor()
  const resolvedColor = colorFront ?? accentColor

  return (
    <div
      className={`${className ?? ''} ${rounded ? 'overflow-hidden' : ''}`.trim()}
      style={{
        opacity,
        borderRadius: rounded ? borderRadius : 0,
        WebkitMaskImage: maskImage,
        maskImage,
      }}
    >
      <Dithering
        width="100%"
        height="100%"
        colorBack={colorBack}
        colorFront={resolvedColor}
        shape={shape}
        type={type}
        size={size}
        speed={speed}
        scale={scale}
        maxPixelCount={maxPixelCount}
        minPixelRatio={minPixelRatio}
      />
    </div>
  )
}
