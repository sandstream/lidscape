// All UI text in one place. Swedish and English; the page picks one from
// ?lang=, then the viewer's last choice, then the browser or Mac language.
export const LANGS = { sv: 'Svenska', en: 'English' }

export const STRINGS = {
  sv: {
    title: 'Lidscape <em>{city}</em>',
    lang: 'Språk',
    city: 'Stad',
    theme: 'Tema',
    variant: 'Variant',
    variantNone: 'Ingen variant',
    lid: 'Lock',
    face: 'Ansikte',
    hand: 'Hand',
    progress: 'Öppna boken',
    cameraOn: 'Slå på kamera',
    cameraOff: 'Stäng av kamera',
    cameraLoading: 'Startar kamera …',
    cameraError: 'Kunde inte starta kameran',
    lightsOn: 'Tänd ljuset',
    lightsOff: 'Släck ljuset',
    hintManual: 'Scrolla eller dra i reglaget för att öppna boken.',
    hintLid: 'Locket styr boken. Öppna och stäng din MacBook.',
    hintHand: 'Öppen hand tänder, knuten hand släcker.',
    hintNoSensor: 'Den här Macen har ingen locksensor som Lidscape kan läsa. Scrolla eller dra i reglaget.',
    hintLowQuality: 'Lägre bildkvalitet, så att bilden går jämnt på den här datorn.',
    noCamera: 'Ingen kamera',
    noWebgl: 'Lidscape behöver WebGL 2, och den här webbläsaren eller datorn saknar det.',
  },
  en: {
    title: 'Lidscape <em>{city}</em>',
    lang: 'Language',
    city: 'City',
    theme: 'Theme',
    variant: 'Variant',
    variantNone: 'No variant',
    lid: 'Lid',
    face: 'Face',
    hand: 'Hand',
    progress: 'Open the book',
    cameraOn: 'Turn on camera',
    cameraOff: 'Turn off camera',
    cameraLoading: 'Starting camera …',
    cameraError: 'Could not start the camera',
    lightsOn: 'Lights on',
    lightsOff: 'Lights off',
    hintManual: 'Scroll or drag the slider to open the book.',
    hintLid: 'The lid moves the book. Open and close your MacBook.',
    hintHand: 'An open hand turns the lights on, a fist turns them off.',
    hintNoSensor: 'This Mac has no lid sensor that Lidscape can read. Scroll or drag the slider.',
    hintLowQuality: 'Lower picture quality, so that the picture runs smoothly on this computer.',
    noCamera: 'No camera',
    noWebgl: 'Lidscape needs WebGL 2, and this browser or computer does not have it.',
  },
}

// The first choice that is a known language; Swedish when nothing matches.
export function pickLang(...choices) {
  for (const c of choices) {
    const code = String(c ?? '').toLowerCase().slice(0, 2)
    if (code in LANGS) return code
  }
  return 'sv'
}

// Text in cities, themes and variants is a string (the same in every language)
// or { sv, en }. A missing language falls back to Swedish.
export function local(text, lang) {
  return typeof text === 'string' ? text : text?.[lang] ?? text?.sv ?? ''
}
