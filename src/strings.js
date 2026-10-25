// All UI text in one place, so a later app build can swap language.
export const STRINGS = {
  sv: {
    title: 'Lidscape <em>{city}</em>',
    city: 'Stad',
    theme: 'Tema',
    themeNone: 'Inget tema',
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
}

export const t = STRINGS.sv
