/**
 * QR rendering for the login URL.
 *
 * The matrix comes from `qrcode-generator` (no transitive dependencies); this
 * module only turns it into a crisp SVG: one dark 1×1 module rectangle per dark
 * cell, an explicit white background, and a four-module quiet zone, which is
 * what scanners need on a themed surface.
 */

import qrcode from 'qrcode-generator'

/** Quiet zone around the matrix, in modules. */
const QUIET_ZONE = 4

/**
 * Render text as an SVG QR code.
 * @param {string} text - Content to encode (byte mode).
 * @param {{scale?: number}} [options] - `scale` is pixels per module.
 * @returns {string} A self-contained SVG document.
 * @throws When the content does not fit byte mode.
 */
export function qrSvg(text, options = {}) {
  const scale = Number.isInteger(options.scale) && options.scale > 0 ? options.scale : 4
  const code = qrcode(0, 'M')
  code.addData(text, 'Byte')
  code.make()
  const count = code.getModuleCount()
  const total = count + QUIET_ZONE * 2
  let path = ''
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (code.isDark(row, column)) path += `M${column + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`
    }
  }
  const size = total * scale
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${total} ${total}"`,
    ' shape-rendering="crispEdges" role="img" aria-label="Login URL QR code">',
    `<rect width="${total}" height="${total}" fill="#ffffff"/>`,
    `<path d="${path}" fill="#000000"/>`,
    '</svg>',
  ].join('')
}
