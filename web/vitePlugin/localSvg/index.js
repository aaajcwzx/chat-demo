import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

// Registers the existing local icon IDs used by src/core/global.js.
// The previously referenced npm package is no longer published.
const svgFiles = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(directory, entry.name)
  return entry.isDirectory() ? svgFiles(full) : entry.name.endsWith('.svg') ? [full] : []
})
const escapeAttribute = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
export const localSvgIcons = () => {
  const moduleId = 'virtual:gva-local-svg-icons'
  const resolvedId = '\0' + moduleId
  let root = process.cwd()
  return {
    name: 'gva-local-svg-icons',
    configResolved(config) { root = config.root },
    resolveId(id) { if (id === moduleId) return resolvedId },
    load(id) {
      if (id !== resolvedId) return
      const systemRoot = path.join(root, 'src/assets/icons')
      const pluginRoot = path.join(root, 'src/plugin')
      const files = [...svgFiles(systemRoot), ...svgFiles(pluginRoot).filter(file => file.replaceAll('\\', '/').includes('/assets/icons/'))]
      const symbols = files.map(file => {
        const plugin = file.startsWith(pluginRoot + path.sep) ? path.relative(pluginRoot, file).split(path.sep)[0] + '-' : ''
        const name = plugin + path.basename(file, '.svg')
        const source = readFileSync(file, 'utf8')
        const match = source.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/i)
        if (!match) { throw new Error(`Invalid SVG icon: ${file}`) }
        const attributes = match[1].replace(/\s(?:id|xmlns(?::xlink)?|width|height)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
        let body = match[2]
        for (const [, id] of body.matchAll(/\bid="([^"]+)"/g)) {
          const scoped = `${name}-${id}`
          body = body.replaceAll(`id="${id}"`, `id="${scoped}"`).replaceAll(`url(#${id})`, `url(#${scoped})`).replaceAll(`href="#${id}"`, `href="#${scoped}"`)
        }
        return `<symbol id="${escapeAttribute(name)}"${attributes}>${body}</symbol>`
      }).join('')
      return `const sprite = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        sprite.setAttribute('aria-hidden', 'true');
        sprite.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
        sprite.innerHTML = ${JSON.stringify(symbols)};
        document.body.prepend(sprite);`
    }
  }
}
