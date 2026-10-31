import { CITIES } from '../src/cities/index.js'
import { THEMES } from '../src/themes/index.js'
import { VARIANTS } from '../src/variants/index.js'
import { local } from '../src/lang/index.js'

const options = (items) => items.map(({ id, name }) => ({
  id,
  en: local(name, 'en'),
  sv: local(name, 'sv'),
}))

process.stdout.write(JSON.stringify({
  cities: options(CITIES),
  themes: options(THEMES),
  variants: options(VARIANTS),
}))
