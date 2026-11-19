import { DOMParser } from '@xmldom/xmldom'
import * as canvas from 'canvas'
import fetch from 'node-fetch'
import { Canvg, presets } from '../src'

const preset = presets.node({
  DOMParser,
  canvas,
  fetch
})

type Pixel = [number, number, number, number]

async function paintSvg(svg: string, width: number, height: number) {
  const c = preset.createCanvas(width, height) as canvas.Canvas
  const ctx = c.getContext('2d')
  const v = Canvg.fromString(ctx, svg, preset)

  await v.render()

  return (x: number, y: number): Pixel => Array.from(ctx.getImageData(x, y, 1, 1).data) as Pixel
}

function expectRed(pixel: Pixel) {
  const [
    r,
    g,
    b,
    a
  ] = pixel

  expect(a).toBeGreaterThan(200)
  expect(r).toBeGreaterThan(200)
  expect(g).toBeLessThan(80)
  expect(b).toBeLessThan(80)
}

function expectGreen(pixel: Pixel) {
  const [
    r,
    g,
    b,
    a
  ] = pixel

  expect(a).toBeGreaterThan(200)
  expect(r).toBeLessThan(80)
  expect(g).toBeGreaterThan(100)
  expect(b).toBeLessThan(80)
}

function expectBlank(pixel: Pixel) {
  expect(pixel[3]).toBeLessThan(10)
}

describe('viewport and path parsing fixes', () => {
  it('1. resolves nested svg percentage x/y against the parent viewport', async () => {
    const pixel = await paintSvg(
      `<svg width="200" height="100" xmlns="http://www.w3.org/2000/svg">
        <svg x="50%" y="50%" width="100" height="50">
          <rect x="25" y="0" width="25" height="50" fill="rgb(255,0,0)"/>
        </svg>
      </svg>`,
      200,
      100
    )

    // nested svg origin must be (100, 50): 50% of the *parent* 200x100 viewport,
    // so the rect starts at (125, 50) — not at (75, 25)
    expectRed(pixel(130, 75))
    expectBlank(pixel(80, 30))
  })

  it('2. falls back to "xMidYMid meet" for invalid preserveAspectRatio', async () => {
    const svg = (par: string) => `<svg width="200" height="100" viewBox="0 0 100 100" preserveAspectRatio="${par}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="rgb(255,0,0)"/>
    </svg>`
    // garbage value
    let pixel = await paintSvg(svg('xMidYMidd meet'), 200, 100)

    // fallback xMidYMid meet centers the 100x100 viewBox in the 200x100 viewport
    expectRed(pixel(120, 50))
    expectBlank(pixel(10, 50))

    // wrong case
    pixel = await paintSvg(svg('XMIDYMID MEET'), 200, 100)
    expectRed(pixel(120, 50))
    expectBlank(pixel(10, 50))
  })

  it('3. applies marker preserveAspectRatio instead of dropping it', async () => {
    const pixel = await paintSvg(
      `<svg width="200" height="100" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="m" viewBox="0 0 10 10" markerWidth="20" markerHeight="10"
                  preserveAspectRatio="xMinYMin meet" markerUnits="userSpaceOnUse">
            <rect width="10" height="10" fill="rgb(255,0,0)"/>
          </marker>
        </defs>
        <line x1="50" y1="50" x2="150" y2="50" stroke="rgb(0,0,0)" marker-start="url(#m)"/>
      </svg>`,
      200,
      100
    )

    // xMinYMin: marker content sticks to the left of the 20x10 marker viewport;
    // a dropped pAR (default xMidYMid) would center it at x+5
    expectRed(pixel(52, 55))
    expectBlank(pixel(63, 55))
  })

  it('4. aligns marker viewBox even when refX/refY are present, shifting ref after the fit', async () => {
    const pixel = await paintSvg(
      `<svg width="200" height="100" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="m" viewBox="0 0 10 10" markerWidth="30" markerHeight="10"
                  refX="5" refY="5" markerUnits="userSpaceOnUse">
            <rect width="10" height="10" fill="rgb(255,0,0)"/>
          </marker>
        </defs>
        <line x1="100" y1="50" x2="150" y2="50" stroke="none" marker-start="url(#m)"/>
      </svg>`,
      200,
      100
    )

    // default pAR xMidYMid meet centers the 10-wide viewBox in the 30-wide viewport
    // (+10 x), then refX/refY shift it back (-5, -5): content lands at x+5..x+15
    expectRed(pixel(110, 52))
    expectBlank(pixel(97, 52))
  })

  it('5. drops the whole tail of path data after an invalid character', async () => {
    const pixel = await paintSvg(
      `<svg width="200" height="100" xmlns="http://www.w3.org/2000/svg">
        <path d="M 10 50 L 100 50 @&#10;L 190 50" stroke="rgb(255,0,0)" stroke-width="4" fill="none"/>
      </svg>`,
      200,
      100
    )

    // everything after "@" is invalid, even on the next line
    expectRed(pixel(50, 50))
    expectBlank(pixel(150, 50))
  })

  it('6. parses uppercase E exponents without throwing', async () => {
    const pixel = await paintSvg(
      `<svg width="200" height="100" xmlns="http://www.w3.org/2000/svg">
        <rect width="10" height="10" fill="rgb(0,128,0)"/>
        <path d="M 1E1 50 L 1.5E2 50" stroke="rgb(255,0,0)" stroke-width="4" fill="none"/>
      </svg>`,
      200,
      100
    )

    // line from (10, 50) to (150, 50); the sibling rect must render too
    expectRed(pixel(100, 50))
    expectGreen(pixel(5, 5))
  })

  it('7. falls back to the last complete command on trailing incomplete params', async () => {
    const pixel = await paintSvg(
      `<svg width="200" height="100" xmlns="http://www.w3.org/2000/svg">
        <rect width="10" height="10" fill="rgb(0,128,0)"/>
        <path d="M 10 50 L 100 50 150" stroke="rgb(255,0,0)" stroke-width="4" fill="none"/>
      </svg>`,
      200,
      100
    )

    // "L 100 50" is the last complete command, the dangling "150" is dropped;
    // rendering must not throw, so the sibling rect is drawn
    expectRed(pixel(50, 50))
    expectBlank(pixel(140, 50))
    expectGreen(pixel(5, 5))
  })

  it('8. reflects S/T control points only after matching curve commands', async () => {
    const pixel = await paintSvg(
      `<svg width="200" height="150" xmlns="http://www.w3.org/2000/svg">
        <path d="M 0 50 C 0 0 50 0 50 50 T 100 50" stroke="rgb(255,0,0)" stroke-width="3" fill="none"/>
        <path d="M 0 150 Q 50 150 50 100 S 100 50 100 100" stroke="rgb(255,0,0)" stroke-width="3" fill="none"/>
      </svg>`,
      200,
      150
    )

    // T after C: no reflection, control point is the current point
    // -> straight line at y=50 instead of a curve through (62.5, 75)
    expectRed(pixel(75, 50))
    expectBlank(pixel(63, 75))

    // S after Q: no reflection -> cubic passes through (75, 81.25),
    // not through (75, 62.5)
    expectRed(pixel(75, 81))
    expectBlank(pixel(75, 63))
  })
})
