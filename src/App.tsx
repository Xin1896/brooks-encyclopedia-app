import { useState, useEffect, useCallback, useRef } from 'react'

// ===== TYPES =====

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

type View =
  | { type: 'home' }
  | { type: 'part'; partIndex: number }
  | { type: 'gallery'; partIndex: number; patternIndex: number }

// ===== ICONS =====

const IconBack = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 12H5M12 5l-7 7 7 7" />
  </svg>
)

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
    <circle cx="12" cy="12" r="5"/>
    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
  </svg>
)

const IconMoon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
)

// ===== HELPERS =====

function fuzzyMatchPattern(section: string, patterns: Pattern[]): Pattern | null {
  if (!patterns.length) return null
  const q = section.toLowerCase().trim()
  // Exact match
  const exact = patterns.find(p => p.name.toLowerCase().trim() === q)
  if (exact) return exact
  // Includes match
  const includes = patterns.find(p =>
    p.name.toLowerCase().includes(q) || q.includes(p.name.toLowerCase())
  )
  if (includes) return includes
  // Word overlap score
  const qWords = q.split(/\s+/).filter(w => w.length > 2)
  let best: Pattern | null = null
  let bestScore = 0
  for (const p of patterns) {
    const pName = p.name.toLowerCase()
    const score = qWords.filter(w => pName.includes(w)).length
    if (score > bestScore) {
      bestScore = score
      best = p
    }
  }
  if (bestScore > 0) return best
  return null
}

function getAbbrForPattern(pattern: Pattern, indexEntries: IndexEntry[]): string {
  const pName = pattern.name.toLowerCase()
  const entry = indexEntries.find(e => {
    const s = e.section.toLowerCase()
    return s === pName || s.includes(pName) || pName.includes(s)
  })
  return entry?.abbr ?? ''
}

function formatNum(n: number): string {
  return n.toLocaleString('en-US')
}

// ===== ALL INDEX ENTRIES (flat list from all parts) =====

interface FlatEntry extends IndexEntry {
  partLetters: string
  thumbnail: string
  patternIndex: number
  partIndex: number
}

function buildFlatEntries(parts: Part[]): FlatEntry[] {
  const result: FlatEntry[] = []
  for (let pi = 0; pi < parts.length; pi++) {
    const part = parts[pi]
    for (const entry of part.index_entries) {
      const matched = fuzzyMatchPattern(entry.section, part.patterns)
      const patternIndex = matched ? part.patterns.indexOf(matched) : 0
      result.push({
        ...entry,
        partLetters: part.letters,
        thumbnail: matched?.thumbnail ?? (part.patterns[0]?.thumbnail ?? ''),
        patternIndex,
        partIndex: pi,
      })
    }
  }
  return result
}

// ===== NAVBAR =====

interface NavbarProps {
  data: Data | null
  view: View
  onHome: () => void
  onBack: () => void
  theme: 'dark' | 'light'
  onToggleTheme: () => void
}

function Navbar({ data, view, onHome, onBack, theme, onToggleTheme }: NavbarProps) {
  return (
    <nav className="navbar">
      <div className="navbar-logo" onClick={onHome} role="button" tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && onHome()}>
        <span className="navbar-logo-icon">📊</span>
        <span className="navbar-logo-title">Brooks PA</span>
        <span className="navbar-logo-sub">百科全书</span>
      </div>

      {view.type !== 'home' && (
        <>
          <div className="navbar-divider" />
          <button className="back-btn" onClick={onBack}>
            <IconBack />
            {view.type === 'gallery' ? '返回 Part' : '返回首页'}
          </button>
        </>
      )}

      <div className="navbar-divider" />

      {data && (
        <div className="navbar-stats">
          <span className="stat-chip">
            <strong>{formatNum(data.total_slides)}</strong> slides
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

// ===== HOME VIEW =====

interface HomeViewProps {
  data: Data
  onSelectPart: (partIndex: number) => void
  onSelectEntry: (partIndex: number, patternIndex: number) => void
}

function HomeView({ data, onSelectPart, onSelectEntry }: HomeViewProps) {
  const [filterPart, setFilterPart] = useState<number | null>(null)
  const flatEntries = buildFlatEntries(data.parts)
  const filtered = filterPart === null
    ? flatEntries
    : flatEntries.filter(e => e.part === filterPart)

  return (
    <div className="home-container fade-in">
      {/* Hero */}
      <section className="hero-section">
        <div className="hero-badge">📈 Brooks Trading Course</div>
        <h1 className="hero-title">Brooks Encyclopedia<br />of Chart Patterns</h1>
        <p className="hero-subtitle">
          完整的价格行为交易模式百科全书，包含图解幻灯片与详细注释
        </p>
        <div className="hero-stats">
          <div className="hero-stat">
            <span className="hero-stat-value">{formatNum(data.total_slides)}</span>
            <span className="hero-stat-label">Slides</span>
          </div>
          <div className="hero-stat">
            <span className="hero-stat-value">{data.total_patterns}</span>
            <span className="hero-stat-label">Patterns</span>
          </div>
          <div className="hero-stat">
            <span className="hero-stat-value">16</span>
            <span className="hero-stat-label">Parts</span>
          </div>
        </div>
      </section>

      {/* Bento Grid */}
      <div className="section-header">
        <h2 className="section-title">16 Parts</h2>
        <span className="section-count">{data.total_index_entries} entries</span>
      </div>
      <div className="bento-grid">
        {data.parts.map((part, idx) => {
          const thumbs = part.patterns.slice(0, 3).map(p => p.thumbnail)
          return (
            <div key={part.part} className="bento-card" onClick={() => onSelectPart(idx)}
              role="button" tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && onSelectPart(idx)}>
              <div className="bento-part-label">Part {part.part}</div>
              <div className="bento-letters">{part.letters}</div>
              <div className="bento-meta">
                {part.index_entries.length} entries · {formatNum(part.total_slides)} slides
              </div>
              {thumbs.length > 0 && (
                <div className="bento-thumb-strip">
                  {thumbs.map((src, i) => (
                    <img key={i} src={src} alt="" className="bento-thumb" loading="lazy" />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Full Index Table */}
      <section className="index-section">
        <div className="index-header">
          <div className="section-header" style={{ margin: 0 }}>
            <h2 className="section-title">完整索引 Contents</h2>
            <span className="section-count">{filtered.length} entries</span>
          </div>
        </div>

        {/* Part filter tabs */}
        <div className="part-filter-tabs">
          <button
            className={`filter-tab${filterPart === null ? ' active' : ''}`}
            onClick={() => setFilterPart(null)}
          >
            全部
          </button>
          {data.parts.map(part => (
            <button
              key={part.part}
              className={`filter-tab${filterPart === part.part ? ' active' : ''}`}
              onClick={() => setFilterPart(part.part)}
            >
              Part {part.part}
            </button>
          ))}
        </div>

        <div className="index-table-wrap">
          <table className="index-table">
            <thead>
              <tr>
                <th>Slide</th>
                <th>Part</th>
                <th>Section Name</th>
                <th>Abbreviation</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry, i) => (
                <tr
                  key={`${entry.part}-${i}`}
                  onClick={() => onSelectEntry(entry.partIndex, entry.patternIndex)}
                >
                  <td className="table-thumb-cell">
                    {entry.thumbnail && (
                      <img
                        src={entry.thumbnail}
                        alt=""
                        className="table-thumb"
                        loading="lazy"
                      />
                    )}
                  </td>
                  <td>
                    <span className="table-part-badge">{entry.part}</span>
                  </td>
                  <td className="table-section-name">{entry.section}</td>
                  <td>
                    {entry.abbr && entry.abbr !== entry.section && (
                      <span className="table-abbr">{entry.abbr}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

// ===== PART VIEW =====

interface PartViewProps {
  data: Data
  partIndex: number
  onSelectPattern: (patternIndex: number) => void
}

function PartView({ data, partIndex, onSelectPattern }: PartViewProps) {
  const part = data.parts[partIndex]

  return (
    <div className="part-container fade-in">
      <div className="part-header">
        <div className="part-header-top">
          <span className="part-number-badge">Part {part.part}</span>
          <h1 className="part-title">
            Part {part.part} — {part.letters.replace('–', ' to ')}
          </h1>
        </div>
        <div className="part-meta">
          <span className="part-meta-item">
            <strong>{part.patterns.length}</strong>&nbsp;patterns
          </span>
          <span style={{ color: 'var(--border)' }}>·</span>
          <span className="part-meta-item">
            <strong>{formatNum(part.total_slides)}</strong>&nbsp;slides
          </span>
          <span style={{ color: 'var(--border)' }}>·</span>
          <span className="part-meta-item">
            <strong>{part.index_entries.length}</strong>&nbsp;index entries
          </span>
        </div>
      </div>

      <div className="pattern-grid">
        {part.patterns.map((pattern, idx) => {
          const abbr = getAbbrForPattern(pattern, part.index_entries)
          return (
            <div
              key={pattern.slug}
              className="pattern-card"
              onClick={() => onSelectPattern(idx)}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && onSelectPattern(idx)}
            >
              <div className="pattern-card-thumb-wrap">
                <img
                  src={pattern.thumbnail}
                  alt={pattern.name}
                  className="pattern-card-thumb"
                  loading="lazy"
                />
                <span className="slide-count-badge">
                  {pattern.slide_count} slides
                </span>
              </div>
              <div className="pattern-card-body">
                <div className="pattern-card-name">{pattern.name}</div>
                {abbr && abbr !== pattern.name && (
                  <div className="pattern-card-abbr">{abbr}</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ===== GALLERY VIEW =====

interface GalleryViewProps {
  data: Data
  partIndex: number
  patternIndex: number
  onBackToPart: () => void
}

function GalleryView({ data, partIndex, patternIndex, onBackToPart }: GalleryViewProps) {
  const part = data.parts[partIndex]
  const pattern = part.patterns[patternIndex]
  const [current, setCurrent] = useState(0)
  const sidebarRef = useRef<HTMLDivElement>(null)
  const activeThumbnailRef = useRef<HTMLButtonElement>(null)
  const mainImgRef = useRef<HTMLImageElement>(null)

  const total = pattern.slides.length

  const goTo = useCallback((idx: number) => {
    if (idx < 0 || idx >= total) return
    setCurrent(idx)
  }, [total])

  // Scroll active thumbnail into view
  useEffect(() => {
    if (activeThumbnailRef.current && sidebarRef.current) {
      activeThumbnailRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      })
    }
  }, [current])

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'ArrowLeft') goTo(current - 1)
      else if (e.key === 'ArrowRight') goTo(current + 1)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [current, goTo])

  // Reset to slide 0 when pattern changes
  useEffect(() => {
    setCurrent(0)
  }, [patternIndex])

  const abbr = getAbbrForPattern(pattern, part.index_entries)

  return (
    <div className="gallery-layout fade-in">
      {/* Top bar */}
      <div className="gallery-topbar">
        <button className="back-btn" onClick={onBackToPart}>
          <IconBack />
          返回 Part {part.part}
        </button>
        <div className="gallery-pattern-name">
          {pattern.name}
          {abbr && abbr !== pattern.name && (
            <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--accent)', fontFamily: 'monospace' }}>
              {abbr}
            </span>
          )}
        </div>
        <div className="gallery-slide-counter">
          {current + 1} / {total}
        </div>
      </div>

      {/* Body */}
      <div className="gallery-body">
        {/* Sidebar */}
        <div className="gallery-sidebar" ref={sidebarRef}>
          {pattern.slides.map((slide, idx) => (
            <button
              key={idx}
              ref={idx === current ? activeThumbnailRef : undefined}
              className={`sidebar-thumb-btn${idx === current ? ' active' : ''}`}
              onClick={() => goTo(idx)}
              title={`Slide ${idx + 1}`}
            >
              <img
                src={slide}
                alt={`Slide ${idx + 1}`}
                className="sidebar-thumb-img"
                loading="lazy"
              />
              <span className="sidebar-thumb-num">{idx + 1}</span>
            </button>
          ))}
        </div>

        {/* Main viewer */}
        <div className="gallery-main">
          <button
            className="gallery-nav-btn prev"
            onClick={() => goTo(current - 1)}
            disabled={current === 0}
            aria-label="Previous slide"
          >
            <IconChevronLeft />
          </button>

          <img
            ref={mainImgRef}
            key={pattern.slides[current]}
            src={pattern.slides[current]}
            alt={`${pattern.name} — Slide ${current + 1}`}
            className="gallery-img"
          />

          <button
            className="gallery-nav-btn next"
            onClick={() => goTo(current + 1)}
            disabled={current === total - 1}
            aria-label="Next slide"
          >
            <IconChevronRight />
          </button>
        </div>
      </div>

      {/* Caption */}
      <div className="gallery-caption">
        <p className="caption-text">
          <strong>{pattern.name}</strong>
          {abbr && abbr !== pattern.name && ` · ${abbr}`}
          {' · '}Slide <strong>{current + 1}</strong> of <strong>{total}</strong>
          {' · '}Part {part.part}: {part.letters}
        </p>
      </div>
    </div>
  )
}

// ===== ROOT APP =====

export default function App() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>({ type: 'home' })
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('encyclopedia-theme') as 'dark' | 'light') ?? 'dark'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('encyclopedia-theme', theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme(t => t === 'dark' ? 'light' : 'dark')
  }, [])

  useEffect(() => {
    fetch('/data.json')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((d: Data) => setData(d))
      .catch(err => setError(String(err)))
  }, [])

  const goHome = useCallback(() => setView({ type: 'home' }), [])

  const goBack = useCallback(() => {
    if (view.type === 'gallery') {
      setView({ type: 'part', partIndex: view.partIndex })
    } else {
      setView({ type: 'home' })
    }
  }, [view])

  const goToPart = useCallback((partIndex: number) => {
    setView({ type: 'part', partIndex })
  }, [])

  const goToGallery = useCallback((partIndex: number, patternIndex: number) => {
    setView({ type: 'gallery', partIndex, patternIndex })
  }, [])

  // Loading / error states
  if (error) {
    return (
      <div className="loading-screen">
        <div style={{ color: 'var(--danger)', fontSize: 16 }}>
          Failed to load data: {error}
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <div>Loading encyclopedia…</div>
      </div>
    )
  }

  return (
    <>
      <Navbar data={data} view={view} onHome={goHome} onBack={goBack} theme={theme} onToggleTheme={toggleTheme} />

      {view.type === 'home' && (
        <HomeView
          data={data}
          onSelectPart={goToPart}
          onSelectEntry={(partIndex, patternIndex) => goToGallery(partIndex, patternIndex)}
        />
      )}

      {view.type === 'part' && (
        <PartView
          data={data}
          partIndex={view.partIndex}
          onSelectPattern={idx => goToGallery(view.partIndex, idx)}
        />
      )}

      {view.type === 'gallery' && (
        <GalleryView
          data={data}
          partIndex={view.partIndex}
          patternIndex={view.patternIndex}
          onBackToPart={() => setView({ type: 'part', partIndex: view.partIndex })}
        />
      )}
    </>
  )
}
