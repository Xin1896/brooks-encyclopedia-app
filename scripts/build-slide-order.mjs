#!/usr/bin/env node
import { cpus, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'

const repoRoot = resolve(new URL('..', import.meta.url).pathname)
const defaultImageRoot = '/Users/jimmy/Library/CloudStorage/GoogleDrive-chenjingtt5@gmail.com/My Drive/Brooks/brooks_images'

function parseArgs() {
  const args = process.argv.slice(2)
  const out = {
    source: process.env.BROOKS_ORDER_SOURCE || 'remote',
    imageRoot: process.env.BROOKS_IMAGE_ROOT || defaultImageRoot,
    dataFile: join(repoRoot, 'public/data.json'),
    outFile: join(repoRoot, 'public/slide-order.json'),
    concurrency: Math.max(1, Math.min(8, Math.floor(cpus().length / 2))),
    part: '',
    limit: 0,
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--source') out.source = args[++i]
    else if (arg === '--image-root') out.imageRoot = args[++i]
    else if (arg === '--data') out.dataFile = args[++i]
    else if (arg === '--out') out.outFile = args[++i]
    else if (arg === '--concurrency') out.concurrency = Number(args[++i])
    else if (arg === '--part') out.part = args[++i]
    else if (arg === '--limit') out.limit = Number(args[++i])
    else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!['local', 'remote', 'identity'].includes(out.source)) {
    throw new Error('--source must be "local", "remote", or "identity"')
  }

  return out
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) resolvePromise(stdout.trim())
      else reject(new Error(`${command} exited ${code}: ${stderr.trim()}`))
    })
  })
}

function padSlide(n) {
  return String(n).padStart(4, '0')
}

function sourceSlideFromName(fileName) {
  const match = fileName.match(/^slide_(\d+)\.png$/)
  return match ? Number(match[1]) : null
}

function parseSlideText(text) {
  const clean = text.replace(/\s+/g, ' ').trim()
  const slideMatch = clean.match(/\bS(?:l|I|1)?ide\D{0,12}(\d{1,4})\b/i)
  if (slideMatch) return { value: Number(slideMatch[1]), text: clean }
  return { value: null, text: clean }
}

function parsePagerText(text) {
  const clean = text.replace(/\s+/g, ' ').trim()
  const pagerMatch = clean.match(/\b(\d{1,4})\s*(?:of|0f|Of|OF)\s*(\d{1,4})\b/)
  if (pagerMatch) return { value: Number(pagerMatch[1]), total: Number(pagerMatch[2]), text: clean }
  return { value: null, total: null, text: clean }
}

async function ocrCrop(inputPath, tmpRoot, id, cropFilter, parser, method) {
  const cropName = `${id}-${method}.png`
  const cropPath = join(tmpRoot, cropName)
  await run('ffmpeg', [
    '-nostdin',
    '-loglevel',
    'error',
    '-y',
    '-i',
    inputPath,
    '-vf',
    cropFilter,
    cropName,
  ], { cwd: tmpRoot })

  const text = await run('tesseract', [cropName, 'stdout', '--psm', '7'], { cwd: tmpRoot })
  await rm(cropPath, { force: true })
  return { ...parser(text), method }
}

async function readSlideNumber(item, tmpRoot) {
  const id = `${item.dir}-${padSlide(item.sourceSlide)}`
  const pager = await ocrCrop(
    item.path,
    tmpRoot,
    id,
    'crop=220:70:1525:965,scale=880:280',
    parsePagerText,
    'pager',
  )
  if (pager.value != null) return pager

  const footer = await ocrCrop(
    item.path,
    tmpRoot,
    id,
    'crop=220:55:1660:905,scale=880:220',
    parseSlideText,
    'footer',
  )
  if (footer.value != null) return footer

  return {
    value: null,
    method: 'unresolved',
    text: `${pager.text} | ${footer.text}`.trim(),
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length)
  let next = 0

  async function worker() {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await mapper(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker))
  return results
}

function summarizePart(part, slides, totalSlides) {
  const byNumber = new Map()
  const unresolved = []
  for (const slide of slides) {
    if (slide.slideNumber == null) {
      unresolved.push(slide.sourceSlide)
      continue
    }
    if (!byNumber.has(slide.slideNumber)) byNumber.set(slide.slideNumber, [])
    byNumber.get(slide.slideNumber).push(slide.sourceSlide)
  }

  const missing = []
  for (let i = 1; i <= totalSlides; i += 1) {
    if (!byNumber.has(i)) missing.push(i)
  }

  const duplicates = {}
  for (const [slideNumber, sources] of byNumber.entries()) {
    if (sources.length > 1) duplicates[slideNumber] = sources
  }

  return {
    part: part.part,
    dir: part.dir,
    totalSlides,
    valid: slides.length - unresolved.length,
    uniqueSlides: byNumber.size,
    unresolved,
    missing,
    duplicates,
  }
}

async function main() {
  const args = parseArgs()
  const data = JSON.parse(await readFile(args.dataFile, 'utf8'))

  const parts = data.parts.filter(part => !args.part || part.dir === args.part || String(part.part) === args.part)

  if (args.source === 'identity') {
    const outputParts = {}
    const summary = {
      expected: 0,
      valid: 0,
      uniqueSlides: 0,
      unresolved: 0,
      missing: 0,
      duplicateGroups: 0,
    }

    for (const part of parts) {
      const slides = []
      for (let slideNumber = 1; slideNumber <= part.total_slides; slideNumber += 1) {
        slides.push({
          src: `${data.cdn_base}/${part.dir}/slide_${padSlide(slideNumber)}.webp`,
          sourceSlide: slideNumber,
          slideNumber,
          method: 'identity',
        })
      }

      summary.expected += part.total_slides
      summary.valid += part.total_slides
      summary.uniqueSlides += part.total_slides

      outputParts[part.dir] = {
        part: part.part,
        totalSlides: part.total_slides,
        slides,
        diagnostics: {
          valid: part.total_slides,
          uniqueSlides: part.total_slides,
          unresolved: [],
          missing: [],
          duplicates: {},
        },
      }
    }

    const output = {
      version: 1,
      generatedAt: new Date().toISOString(),
      cdnBase: data.cdn_base,
      summary,
      parts: outputParts,
    }

    await writeFile(args.outFile, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
    console.log(`Wrote ${args.outFile}`)
    console.log(JSON.stringify(summary, null, 2))
    return
  }

  const tmpRoot = await mkdtemp(join(tmpdir(), 'brooks-slide-ocr-'))
  const items = []

  for (const part of parts) {
    if (args.source === 'remote') {
      for (let sourceSlide = 1; sourceSlide <= part.total_slides; sourceSlide += 1) {
        const src = `${data.cdn_base}/${part.dir}/slide_${padSlide(sourceSlide)}.webp`
        items.push({
          part: part.part,
          dir: part.dir,
          totalSlides: part.total_slides,
          sourceSlide,
          path: src,
          src,
          isRemote: true,
        })
      }
      continue
    }

    const dirPath = join(args.imageRoot, part.dir)
    if (!existsSync(dirPath)) continue
    const files = (await readdir(dirPath))
      .filter(file => /^slide_\d+\.png$/.test(file))
      .sort()

    for (const file of files) {
      const sourceSlide = sourceSlideFromName(file)
      if (sourceSlide == null) continue
      const src = `${data.cdn_base}/${part.dir}/slide_${padSlide(sourceSlide)}.webp`
      items.push({
        part: part.part,
        dir: part.dir,
        totalSlides: part.total_slides,
        sourceSlide,
        path: join(dirPath, file),
        src,
        isRemote: false,
      })
    }
  }

  const workItems = args.limit > 0 ? items.slice(0, args.limit) : items
  const started = Date.now()
  let completed = 0

  try {
    const entries = await mapWithConcurrency(workItems, args.concurrency, async item => {
      if (!item.isRemote && !existsSync(item.path)) {
        return { ...item, slideNumber: null, method: 'missing-file', ocrText: '' }
      }

      try {
        const ocr = await readSlideNumber(item, tmpRoot)
        const entry = {
          src: item.src,
          sourceSlide: item.sourceSlide,
          slideNumber: ocr.value,
          method: ocr.method,
          ocrText: ocr.text,
        }
        return { ...item, ...entry }
      } catch (error) {
        return {
          ...item,
          slideNumber: null,
          method: 'ocr-error',
          ocrText: error instanceof Error ? error.message : String(error),
        }
      } finally {
        completed += 1
        if (completed % 100 === 0 || completed === workItems.length) {
          const elapsed = (Date.now() - started) / 1000
          const rate = completed / Math.max(1, elapsed)
          const remaining = (workItems.length - completed) / Math.max(0.1, rate)
          process.stdout.write(`\rOCR ${completed}/${workItems.length} ${rate.toFixed(1)}/s ETA ${Math.ceil(remaining)}s`)
        }
      }
    })

    process.stdout.write('\n')

    const byPart = new Map()
    for (const entry of entries) {
      if (!byPart.has(entry.dir)) byPart.set(entry.dir, [])
      byPart.get(entry.dir).push(entry)
    }

    const outputParts = {}
    const summary = {
      expected: workItems.length,
      valid: 0,
      uniqueSlides: 0,
      unresolved: 0,
      missing: 0,
      duplicateGroups: 0,
    }

    for (const part of parts) {
      const rawSlides = byPart.get(part.dir) || []
      const primaryByNumber = new Map()
      const sortedRaw = [...rawSlides].sort((a, b) => {
        const slideA = a.slideNumber ?? Number.MAX_SAFE_INTEGER
        const slideB = b.slideNumber ?? Number.MAX_SAFE_INTEGER
        return slideA - slideB || a.sourceSlide - b.sourceSlide
      })

      for (const slide of sortedRaw) {
        if (slide.slideNumber == null) continue
        if (!primaryByNumber.has(slide.slideNumber)) {
          primaryByNumber.set(slide.slideNumber, slide)
        }
      }

      const slides = [...primaryByNumber.values()].map(slide => ({
        src: slide.src,
        sourceSlide: slide.sourceSlide,
        slideNumber: slide.slideNumber,
        method: slide.method,
      }))

      const partSummary = summarizePart(part, rawSlides, part.total_slides)
      summary.valid += partSummary.valid
      summary.uniqueSlides += partSummary.uniqueSlides
      summary.unresolved += partSummary.unresolved.length
      summary.missing += partSummary.missing.length
      summary.duplicateGroups += Object.keys(partSummary.duplicates).length

      outputParts[part.dir] = {
        part: part.part,
        totalSlides: part.total_slides,
        slides,
        diagnostics: {
          valid: partSummary.valid,
          uniqueSlides: partSummary.uniqueSlides,
          unresolved: partSummary.unresolved,
          missing: partSummary.missing,
          duplicates: partSummary.duplicates,
        },
      }
    }

    const output = {
      version: 1,
      generatedAt: new Date().toISOString(),
      cdnBase: data.cdn_base,
      summary,
      parts: outputParts,
    }

    await writeFile(args.outFile, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
    console.log(`Wrote ${args.outFile}`)
    console.log(JSON.stringify(summary, null, 2))
  } finally {
    await rm(tmpRoot, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
