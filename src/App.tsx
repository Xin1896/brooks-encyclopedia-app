import { useState, useEffect, useCallback, useMemo } from 'react'

interface IndexEntry {
  part: number
  section: string
  abbr: string
}

interface Pattern {
  name: string
  slug: string
  slide_count: number
  thumbnail: string
  slides: string[]
}

interface Part {
  part: number
  dir: string
  letters: string
  total_slides: number
  index_entries: IndexEntry[]
  patterns: Pattern[]
}

interface Data {
  cdn_base: string
  total_slides: number
  total_patterns: number
  total_index_entries: number
  parts: Part[]
}

interface SlideOrderSlide {
  src: string
  sourceSlide: number
  slideNumber: number
}

interface SlideOrderDiagnostics {
  unresolved: number[]
  missing: number[]
  duplicates: Record<string, number[]>
}

interface SlideOrderPart {
  part: number
  totalSlides: number
  slides: SlideOrderSlide[]
  diagnostics?: SlideOrderDiagnostics
}

interface SlideOrderData {
  parts: Record<string, SlideOrderPart>
}

interface FlatSlide {
  src: string
  index: number
  sourceSlide?: number
  actualSlideNumber?: number
  unresolved?: boolean
}

type SlidePositions = Record<string, number>

const ACTIVE_PART_KEY = 'brooks-reader-active-part'
const POSITIONS_KEY = 'brooks-reader-slide-positions'

const IconChevronLeft = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 18l-6-6 6-6" />
  </svg>
)

const IconChevronRight = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18l6-6-6-6" />
  </svg>
)

const IconSun = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5" />
    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
  </svg>
)

const IconMoon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
)

const IconExternal = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 3h7v7" />
    <path d="M10 14L21 3" />
    <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
  </svg>
)

function formatNum(n: number): string {
  return n.toLocaleString('en-US')
}

function loadStoredPart(): number {
  const raw = Number(localStorage.getItem(ACTIVE_PART_KEY))
  return Number.isInteger(raw) && raw >= 0 && raw < 16 ? raw : 0
}

function loadStoredPositions(): SlidePositions {
  try {
    const parsed = JSON.parse(localStorage.getItem(POSITIONS_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function extractSortKey(src: string): [number, number] {
  const m = src.match(/Part_0*(\d+)[^/]*\/slide_0*(\d+)\./i)
  if (!m) return [9999, 9999]
  return [parseInt(m[1], 10), parseInt(m[2], 10)]
}

function flattenPartSlides(part: Part, slideOrder: SlideOrderData | null): FlatSlide[] {
  const orderedPart = slideOrder?.parts?.[part.dir]
  if (orderedPart) {
    return orderedPart.slides.map(slide => ({
      src: slide.src,
      index: slide.slideNumber,
      sourceSlide: slide.sourceSlide,
      actualSlideNumber: slide.slideNumber,
    }))
  }

  const seen = new Set<string>()
  const out: { src: string }[] = []
  for (const p of part.patterns) {
    for (const src of p.slides) {
      if (seen.has(src)) continue
      seen.add(src)
      out.push({ src })
    }
  }
  out.sort((a, b) => {
    const [pa, sa] = extractSortKey(a.src)
    const [pb, sb] = extractSortKey(b.src)
    return pa - pb || sa - sb
  })
  return out.map((s, i) => ({
    src: s.src,
    index: i + 1,
    sourceSlide: i + 1,
  }))
}

function findSlideIndex(slides: FlatSlide[], slideNumber: number): number {
  if (!slides.length) return 0
  const exact = slides.findIndex(s => s.index === slideNumber)
  if (exact >= 0) return exact
  const next = slides.findIndex(s => s.index > slideNumber)
  return next >= 0 ? next : slides.length - 1
}

interface NavbarProps {
  data: Data | null
  slideCount: number | null
  theme: 'dark' | 'light'
  onToggleTheme: () => void
}

function Navbar({ data, slideCount, theme, onToggleTheme }: NavbarProps) {
  return (
    <nav className="navbar">
      <div className="navbar-logo">
        <span className="navbar-logo-title">Brooks PA</span>
        <span className="navbar-logo-sub">百科全书</span>
      </div>

      {data && (
        <div className="navbar-stats">
          <span className="stat-chip">
            <strong>{formatNum(slideCount ?? data.total_slides)}</strong> slides
          </span>
          <span className="stat-chip">
            <strong>{data.total_patterns}</strong> patterns
          </span>
          <span className="stat-chip">
            <strong>16</strong> parts
          </span>
        </div>
      )}

      <div className="navbar-spacer" />

      <button className="theme-toggle-btn" onClick={onToggleTheme} title="切换主题">
        {theme === 'dark' ? <IconSun /> : <IconMoon />}
        {theme === 'dark' ? '亮色' : '暗色'}
      </button>
    </nav>
  )
}

interface PartSidebarProps {
  data: Data
  slideOrder: SlideOrderData | null
  activePartIndex: number
  positions: SlidePositions
  onSelectPart: (partIndex: number) => void
}

function PartSidebar({ data, slideOrder, activePartIndex, positions, onSelectPart }: PartSidebarProps) {
  return (
    <aside className="part-sidebar" aria-label="Parts">
      <div className="sidebar-heading">
        <span className="sidebar-kicker">Library</span>
        <h1>16 Parts</h1>
      </div>

      <div className="part-list">
        {data.parts.map((part, idx) => {
          const partSlideCount = slideOrder?.parts?.[part.dir]?.slides.length ?? part.total_slides
          const remembered = positions[part.dir]
          const active = idx === activePartIndex

          return (
            <button
              key={part.dir}
              className={`part-list-item${active ? ' active' : ''}`}
              onClick={() => onSelectPart(idx)}
              type="button"
            >
              <span className="part-list-num">{String(part.part).padStart(2, '0')}</span>
              <span className="part-list-copy">
                <span className="part-list-title">{part.letters}</span>
                <span className="part-list-meta">
                  {formatNum(partSlideCount)} slides
                  {remembered ? ` · #${remembered}` : ''}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}

interface ReaderViewProps {
  part: Part
  slides: FlatSlide[]
  currentSlideIndex: number
  onSlideIndexChange: (index: number) => void
  onOpenSource: () => void
}

function ReaderView({
  part,
  slides,
  currentSlideIndex,
  onSlideIndexChange,
  onOpenSource,
}: ReaderViewProps) {
  const current = slides[currentSlideIndex]
  const canPrev = currentSlideIndex > 0
  const canNext = currentSlideIndex < slides.length - 1

  return (
    <main className="reader-main">
      <section className="reader-toolbar">
        <div className="reader-title-group">
          <span className="reader-part-badge">Part {part.part}</span>
          <div>
            <h2>{part.letters.replace('–', ' to ')}</h2>
            <p>
              {formatNum(currentSlideIndex + 1)} / {formatNum(slides.length)}
              {current ? ` · Slide ${current.index}` : ''}
            </p>
          </div>
        </div>

        <div className="reader-actions">
          <button
            className="icon-btn"
            onClick={() => onSlideIndexChange(currentSlideIndex - 1)}
            disabled={!canPrev}
            type="button"
            aria-label="Previous slide"
            title="上一页"
          >
            <IconChevronLeft />
          </button>

          <button
            className="icon-btn"
            onClick={() => onSlideIndexChange(currentSlideIndex + 1)}
            disabled={!canNext}
            type="button"
            aria-label="Next slide"
            title="下一页"
          >
            <IconChevronRight />
          </button>

          <button
            className="icon-btn source-btn"
            onClick={onOpenSource}
            disabled={!current}
            type="button"
            aria-label="Open source image"
            title="打开原图"
          >
            <IconExternal />
          </button>
        </div>
      </section>

      <section className="reader-stage">
        {current ? (
          <img
            key={current.src}
            className="reader-img"
            src={current.src}
            alt={`Part ${part.part} Slide ${current.index}`}
          />
        ) : (
          <div className="empty-stage">No slides available</div>
        )}
      </section>

    </main>
  )
}

export default function App() {
  const [data, setData] = useState<Data | null>(null)
  const [slideOrder, setSlideOrder] = useState<SlideOrderData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activePartIndex, setActivePartIndex] = useState(loadStoredPart)
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0)
  const [positions, setPositions] = useState<SlidePositions>(loadStoredPositions)
  const [restoredPartDir, setRestoredPartDir] = useState<string | null>(null)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('encyclopedia-theme') as 'dark' | 'light') ?? 'dark'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('encyclopedia-theme', theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme(t => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadData() {
      try {
        const dataResponse = await fetch('/data.json')
        if (!dataResponse.ok) throw new Error(`HTTP ${dataResponse.status}`)
        const nextData: Data = await dataResponse.json()

        let nextSlideOrder: SlideOrderData | null = null
        try {
          const orderResponse = await fetch('/slide-order.json')
          if (orderResponse.ok) nextSlideOrder = await orderResponse.json()
        } catch {
          nextSlideOrder = null
        }

        if (!cancelled) {
          setSlideOrder(nextSlideOrder)
          setData(nextData)
        }
      } catch (err) {
        if (!cancelled) setError(String(err))
      }
    }

    loadData()

    return () => {
      cancelled = true
    }
  }, [])

  const activePart = data?.parts[activePartIndex] ?? null
  const slides = useMemo(() => {
    if (!activePart) return []
    return flattenPartSlides(activePart, slideOrder)
  }, [activePart, slideOrder])
  const currentSlide = slides[currentSlideIndex]
  const displayedSlideCount = slideOrder
    ? Object.values(slideOrder.parts).reduce((sum, part) => sum + part.slides.length, 0)
    : data?.total_slides ?? null

  useEffect(() => {
    localStorage.setItem(ACTIVE_PART_KEY, String(activePartIndex))
  }, [activePartIndex])

  useEffect(() => {
    if (!activePart || !slides.length) return
    const remembered = positions[activePart.dir]
    setCurrentSlideIndex(remembered ? findSlideIndex(slides, remembered) : 0)
    setRestoredPartDir(activePart.dir)
  }, [activePart, positions, slides])

  useEffect(() => {
    if (!activePart || !currentSlide || restoredPartDir !== activePart.dir) return

    setPositions(prev => {
      if (prev[activePart.dir] === currentSlide.index) return prev
      const next = { ...prev, [activePart.dir]: currentSlide.index }
      localStorage.setItem(POSITIONS_KEY, JSON.stringify(next))
      return next
    })
  }, [activePart, currentSlide, restoredPartDir])

  const setSafeSlideIndex = useCallback((index: number) => {
    setCurrentSlideIndex(Math.max(0, Math.min(slides.length - 1, index)))
  }, [slides.length])

  const selectPart = useCallback((partIndex: number) => {
    setRestoredPartDir(null)
    setActivePartIndex(partIndex)
  }, [])

  const openSource = useCallback(() => {
    if (currentSlide) window.open(currentSlide.src, '_blank', 'noopener,noreferrer')
  }, [currentSlide])

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return
      if (event.key === 'ArrowLeft') setSafeSlideIndex(currentSlideIndex - 1)
      else if (event.key === 'ArrowRight') setSafeSlideIndex(currentSlideIndex + 1)
      else if (event.key === 'Home') setSafeSlideIndex(0)
      else if (event.key === 'End') setSafeSlideIndex(slides.length - 1)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentSlideIndex, setSafeSlideIndex, slides.length])

  if (error) {
    return (
      <div className="loading-screen">
        <div style={{ color: 'var(--danger)', fontSize: 16 }}>
          Failed to load data: {error}
        </div>
      </div>
    )
  }

  if (!data || !activePart) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <div>Loading encyclopedia...</div>
      </div>
    )
  }

  return (
    <>
      <Navbar
        data={data}
        slideCount={displayedSlideCount}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <div className="reader-shell">
        <PartSidebar
          data={data}
          slideOrder={slideOrder}
          activePartIndex={activePartIndex}
          positions={positions}
          onSelectPart={selectPart}
        />

        <ReaderView
          part={activePart}
          slides={slides}
          currentSlideIndex={currentSlideIndex}
          onSlideIndexChange={setSafeSlideIndex}
          onOpenSource={openSource}
        />
      </div>
    </>
  )
}
