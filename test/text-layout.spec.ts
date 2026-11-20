import { DOMParser } from '@xmldom/xmldom'
import * as canvas from 'canvas'
import fetch from 'node-fetch'
import { Canvg, presets } from '../src'

const preset = presets.node({
  DOMParser,
  canvas,
  fetch
})
const WIDTH = 800
const HEIGHT = 400
const wrapSvg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${WIDTH}" height="${HEIGHT}">${body}</svg>`

interface IRenderResult {
  data: Uint8ClampedArray
  ctx: canvas.CanvasRenderingContext2D
  canvg: Canvg
}

async function render(svg: string): Promise<IRenderResult> {
  const c = preset.createCanvas(WIDTH, HEIGHT) as canvas.Canvas
  const ctx = c.getContext('2d')

  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  const canvg = Canvg.fromString(ctx, svg, preset)

  await canvg.render()

  return {
    data: ctx.getImageData(0, 0, WIDTH, HEIGHT).data,
    ctx,
    canvg
  }
}

/**
 * Columns that contain dark glyph pixels, grouped into contiguous runs.
 * @param data - Raw RGBA pixel data.
 * @param gap - Maximum column gap allowed inside one run.
 * @returns The contiguous ink column runs.
 */
function inkRuns(data: Uint8ClampedArray, gap = 3) {
  const columns: number[] = []

  for (let x = 0; x < WIDTH; x++) {
    let hit = false

    for (let y = 0; y < HEIGHT; y++) {
      const i = (y * WIDTH + x) * 4

      if (data[i + 3] > 20 && (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200)) {
        hit = true
        break
      }
    }

    if (hit) {
      columns.push(x)
    }
  }

  if (!columns.length) {
    return []
  }

  const runs: number[][] = []
  let start = columns[0]
  let previous = columns[0]

  for (let i = 1; i < columns.length; i++) {
    if (columns[i] - previous > gap) {
      runs.push([start, previous])
      start = columns[i]
    }

    previous = columns[i]
  }

  runs.push([start, previous])

  return runs
}

function inkBox(data: Uint8ClampedArray) {
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4

      if (data[i + 3] > 20 && (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200)) {
        x1 = Math.min(x1, x)
        x2 = Math.max(x2, x)
        y1 = Math.min(y1, y)
        y2 = Math.max(y2, y)
      }
    }
  }

  return [
    x1,
    y1,
    x2,
    y2
  ]
}

function inkRows(data: Uint8ClampedArray, x0: number, x1: number) {
  const rows: number[] = []

  for (let y = 0; y < HEIGHT; y++) {
    let hit = false

    for (let x = x0; x <= x1; x++) {
      const i = (y * WIDTH + x) * 4

      if (data[i + 3] > 20 && (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200)) {
        hit = true
        break
      }
    }

    if (hit) {
      rows.push(y)
    }
  }

  return [rows[0], rows[rows.length - 1]]
}

describe('text layout', () => {
  if (process.platform !== 'linux') {
    it('runs only on linux', () => {})
    return
  }

  it('applies the x coordinate list per glyph', async () => {
    const { data } = await render(wrapSvg('<text x="50 150 250" y="150" font-size="40" fill="#000">abc</text>'))
    const runs = inkRuns(data)

    expect(runs).toHaveLength(3)
    // Each glyph starts near its own absolute x (plus the glyph side bearing).
    expect(runs[0][0]).toBeGreaterThanOrEqual(50)
    expect(runs[0][0]).toBeLessThan(75)
    expect(runs[1][0]).toBeGreaterThanOrEqual(150)
    expect(runs[1][0]).toBeLessThan(175)
    expect(runs[2][0]).toBeGreaterThanOrEqual(250)
    expect(runs[2][0]).toBeLessThan(275)
    // Glyphs must not share the first coordinate.
    expect(runs[1][0] - runs[0][0]).toBeGreaterThan(75)
    expect(runs[2][0] - runs[1][0]).toBeGreaterThan(75)
  })

  it('applies the y coordinate list per glyph', async () => {
    const { data } = await render(wrapSvg('<text x="50" y="60 140 220" font-size="40" fill="#000">abc</text>'))
    const runs = inkRuns(data)
    const tops = runs.map(([x0, x1]) => inkRows(data, x0, x1)[0])

    expect(tops).toHaveLength(3)
    expect(tops[1] - tops[0]).toBeGreaterThan(50)
    expect(tops[2] - tops[1]).toBeGreaterThan(50)
  })

  it('applies the dy coordinate list per glyph', async () => {
    const { data } = await render(wrapSvg('<text x="50" y="160" font-size="40" fill="#000" dy="0 40 -20">abc</text>'))
    const runs = inkRuns(data)
    const tops = runs.map(([x0, x1]) => inkRows(data, x0, x1)[0])

    expect(tops).toHaveLength(3)
    expect(tops[1]).toBeGreaterThan(tops[0])
    expect(tops[2]).toBeLessThan(tops[1])
  })

  it('reallocates textLength with spacing', async () => {
    const natural = inkBox((await render(wrapSvg('<text x="50" y="150" font-size="40" fill="#000">abcdef</text>'))).data)
    const spaced = inkBox((await render(wrapSvg('<text x="50" y="150" font-size="40" fill="#000" textLength="300">abcdef</text>'))).data)
    const naturalWidth = natural[2] - natural[0]
    const spacedWidth = spaced[2] - spaced[0]

    expect(naturalWidth).toBeLessThan(200)
    expect(spacedWidth).toBeGreaterThan(250)
    expect(Math.abs(spacedWidth - 300)).toBeLessThanOrEqual(4)
  })

  it('reallocates textLength with spacingAndGlyphs', async () => {
    const natural = inkBox((await render(wrapSvg('<text x="50" y="150" font-size="40" fill="#000">abcdef</text>'))).data)
    const scaled = inkBox((await render(wrapSvg('<text x="50" y="150" font-size="40" fill="#000" textLength="300" lengthAdjust="spacingAndGlyphs">abcdef</text>'))).data)
    const naturalWidth = natural[2] - natural[0]
    const scaledWidth = scaled[2] - scaled[0]

    expect(naturalWidth).toBeLessThan(200)
    expect(scaledWidth).toBeGreaterThan(250)
    expect(Math.abs(scaledWidth - 300)).toBeLessThanOrEqual(6)
  })

  it('honors letter-spacing on text', async () => {
    const plain = inkBox((await render(wrapSvg('<text x="50" y="150" font-size="40" fill="#000">abc</text>'))).data)
    const spaced = inkBox((await render(wrapSvg('<text x="50" y="150" font-size="40" fill="#000" letter-spacing="10">abc</text>'))).data)
    const delta = (spaced[2] - spaced[0]) - (plain[2] - plain[0])

    // Two gaps between three glyphs, each 10px.
    expect(delta).toBeGreaterThanOrEqual(18)
    expect(delta).toBeLessThanOrEqual(22)
  })

  it('honors letter-spacing on textPath', async () => {
    const defs = '<defs><path id="p" d="M 20 100 L 700 100"/></defs>'
    const plain = inkBox((await render(wrapSvg(`${defs}<text font-size="40" fill="#000" letter-spacing="0"><textPath xlink:href="#p">abcdef</textPath></text>`))).data)
    const spaced = inkBox((await render(wrapSvg(`${defs}<text font-size="40" fill="#000" letter-spacing="12"><textPath xlink:href="#p">abcdef</textPath></text>`))).data)
    const delta = (spaced[2] - spaced[0]) - (plain[2] - plain[0])

    // Five gaps between six glyphs, each 12px.
    expect(delta).toBeGreaterThanOrEqual(56)
    expect(delta).toBeLessThanOrEqual(64)
  })

  it('resolves 1em font-size independently for every use instance', async () => {
    const { data } = await render(wrapSvg(
      '<defs><text id="t" font-size="1em" fill="#000">ABC</text></defs>'
      + '<use xlink:href="#t" x="30" y="60" font-size="10px"/>'
      + '<use xlink:href="#t" x="30" y="200" font-size="40px"/>'
    ))
    const box = (top: number, bottom: number) => {
      let x1 = Infinity
      let y1 = Infinity
      let x2 = -Infinity
      let y2 = -Infinity

      for (let y = top; y < bottom; y++) {
        for (let x = 0; x < WIDTH; x++) {
          const i = (y * WIDTH + x) * 4

          if (data[i + 3] > 20 && (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200)) {
            x1 = Math.min(x1, x)
            x2 = Math.max(x2, x)
            y1 = Math.min(y1, y)
            y2 = Math.max(y2, y)
          }
        }
      }

      return [
        x1,
        y1,
        x2,
        y2
      ]
    }
    const small = box(0, 150)
    const large = box(150, HEIGHT)
    const smallHeight = small[3] - small[1]
    const largeHeight = large[3] - large[1]

    expect(smallHeight).toBeLessThan(16)
    expect(largeHeight).toBeGreaterThan(28)
    expect(largeHeight / smallHeight).toBeGreaterThan(3)
  })

  it('remeasures after the font-size style changes', async () => {
    const c = preset.createCanvas(WIDTH, HEIGHT) as canvas.Canvas
    const ctx = c.getContext('2d')
    const canvg = Canvg.fromString(
      ctx,
      wrapSvg('<text x="400" y="150" font-size="10" text-anchor="middle" fill="#000"><tspan>ABC</tspan></text>'),
      preset
    )

    await canvg.render()

    const before = inkBox(ctx.getImageData(0, 0, WIDTH, HEIGHT).data)

    canvg.document.documentElement.children[0]
      .getStyle('font-size', true, true)
      .setValue('40')

    await canvg.render()

    const after = inkBox(ctx.getImageData(0, 0, WIDTH, HEIGHT).data)

    expect((after[3] - after[1]) / (before[3] - before[1])).toBeGreaterThan(3)
  })

  it('remeasures textPath after the font-size style changes', async () => {
    const c = preset.createCanvas(WIDTH, HEIGHT) as canvas.Canvas
    const ctx = c.getContext('2d')
    const canvg = Canvg.fromString(
      ctx,
      wrapSvg(
        '<defs><path id="tp" d="M 20 200 L 700 200"/></defs>'
        + '<text font-size="20" fill="#000"><textPath xlink:href="#tp">abcdef</textPath></text>'
      ),
      preset
    )

    await canvg.render()

    const before = inkBox(ctx.getImageData(0, 0, WIDTH, HEIGHT).data)
    const text = canvg.document.documentElement.children[1]

    text.getStyle('font-size', true, true).setValue('60')

    await canvg.render()

    const after = inkBox(ctx.getImageData(0, 0, WIDTH, HEIGHT).data)

    expect((after[3] - after[1]) / (before[3] - before[1])).toBeGreaterThan(2)
  })

  it('remeasures after the font-family style changes', async () => {
    const c = preset.createCanvas(WIDTH, HEIGHT) as canvas.Canvas
    const ctx = c.getContext('2d')
    const canvg = Canvg.fromString(
      ctx,
      wrapSvg('<text x="50" y="150" font-size="40" fill="#000" font-family="monospace">ABC</text>'),
      preset
    )

    await canvg.render()

    const before = inkBox(ctx.getImageData(0, 0, WIDTH, HEIGHT).data)

    canvg.document.documentElement.children[0]
      .getStyle('font-family', true, true)
      .setValue('serif')

    await canvg.render()

    const after = inkBox(ctx.getImageData(0, 0, WIDTH, HEIGHT).data)

    expect(JSON.stringify(before)).not.toBe(JSON.stringify(after))
  })
})
