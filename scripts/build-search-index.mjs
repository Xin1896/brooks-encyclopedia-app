#!/usr/bin/env node
import { cpus } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'

const repoRoot = resolve(new URL('..', import.meta.url).pathname)
const defaultImageRoot = '/Users/jimmy/Brooks/brooks_images_rendered'

function parseArgs() {
  const args = process.argv.slice(2)
  const out = {
    imageRoot: process.env.BROOKS_RENDERED_IMAGE_ROOT || defaultImageRoot,
    dataFile: join(repoRoot, 'public/data.json'),
    outFile: join(repoRoot, 'public/search-index.json'),
    concurrency: Math.max(1, Math.min(8, Math.floor(cpus().length / 2))),
    limit: 0,
    part: '',
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--image-root') out.imageRoot = args[++i]
    else if (arg === '--data') out.dataFile = args[++i]
    else if (arg === '--out') out.outFile = args[++i]
    else if (arg === '--concurrency') out.concurrency = Number(args[++i])
    else if (arg === '--limit') out.limit = Number(args[++i])
    else if (arg === '--part') out.part = args[++i]
    else throw new Error(`Unknown argument: ${arg}`)
  }

  return out
}

function padSlide(n) {
  return String(n).padStart(4, '0')
}

function runTesseract(imagePath) {
  return new Promise(resolvePromise => {
    const child = spawn('tesseract', [imagePath, 'stdout', '-l', 'eng', '--psm', '11'], {
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
    child.on('error', error => {
      resolvePromise({ text: '', error: error.message })
    })
    child.on('close', code => {
      if (code === 0) resolvePromise({ text: stdout, error: '' })
      else resolvePromise({ text: stdout, error: stderr.trim() || `tesseract exited ${code}` })
    })
  })
}

function normalizeText(text) {
  return text
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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

async function main() {
  const args = parseArgs()
  const data = JSON.parse(await readFile(args.dataFile, 'utf8'))
  const imageRoot = resolve(args.imageRoot)
  const parts = data.parts.filter(part => !args.part || part.dir === args.part || String(part.part) === args.part)
  const items = []

  for (const part of parts) {
    for (let slideNumber = 1; slideNumber <= part.total_slides; slideNumber += 1) {
      const fileName = `slide_${padSlide(slideNumber)}.png`
      const imagePath = join(imageRoot, part.dir, fileName)
      items.push({
        part: part.part,
        dir: part.dir,
        letters: part.letters,
        slideNumber,
        src: `${data.cdn_base}/${part.dir}/slide_${padSlide(slideNumber)}.webp`,
        imagePath,
      })
    }
  }

  const workItems = args.limit > 0 ? items.slice(0, args.limit) : items
  const started = Date.now()
  let completed = 0
  let failed = 0

  const entries = await mapWithConcurrency(workItems, args.concurrency, async item => {
    let text = ''
    let error = ''

    if (!existsSync(item.imagePath)) {
      error = 'missing-file'
    } else {
      const result = await runTesseract(item.imagePath)
      text = normalizeText(result.text)
      error = result.error
    }

    if (error) failed += 1
    completed += 1

    if (completed % 100 === 0 || completed === workItems.length) {
      const elapsed = (Date.now() - started) / 1000
      const rate = completed / Math.max(1, elapsed)
      const remaining = (workItems.length - completed) / Math.max(0.1, rate)
      process.stdout.write(`\rOCR ${completed}/${workItems.length} ${rate.toFixed(1)}/s ETA ${Math.ceil(remaining)}s failed=${failed}`)
    }

    return {
      part: item.part,
      dir: item.dir,
      letters: item.letters,
      slideNumber: item.slideNumber,
      src: item.src,
      text,
      error,
    }
  })

  process.stdout.write('\n')

  const output = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceImageRoot: imageRoot,
    totalSlides: workItems.length,
    failed,
    entries,
  }

  await mkdir(dirname(resolve(args.outFile)), { recursive: true })
  await writeFile(args.outFile, `${JSON.stringify(output)}\n`, 'utf8')
  console.log(`Wrote ${args.outFile}`)
  console.log(JSON.stringify({ totalSlides: workItems.length, failed }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
