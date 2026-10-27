# World map data

The map keeps its data in `src/map-data.js`. The page makes no map request at run time.

- Land outlines come from [Natural Earth 1:110m land](https://www.naturalearthdata.com/downloads/110m-physical-vectors/110m-land/). Coordinates were rounded to two decimal places. Natural Earth permits use of its vector data in any project.
- Capital points and names start with [Natural Earth 1:10m populated places](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-populated-places/), version 5.1.2. Coordinates were rounded to three decimal places.
- The set of countries follows the [UN list of 193 member states](https://www.un.org/about-us/member-states). Vatican City, Kosovo, Somaliland and Taiwan are excluded from the Natural Earth capital records because they are not UN member states. Nauru is added because Natural Earth has no national capital point for it.
- Where Natural Earth has several capital records for one member state, the map selects one: Pretoria (South Africa), Yamoussoukro (Côte d'Ivoire), Sucre (Bolivia) and Naypyidaw (Myanmar).
- The map uses Natural Earth's alternate or regional capital records for [Gitega](https://www.cia.gov/the-world-factbook/static/a21a09da0fd1011f853d7157ddec76c8/BY_Burundi_atlas.pdf), Dodoma, Porto-Novo and Sri Jayawardenepura Kotte. Their coordinates come from the same Natural Earth dataset.
- Equatorial Guinea's capital changed to [Ciudad de la Paz in January 2026](https://www.guineaecuatorialpress.com/index.php/noticias/el_presidente_de_la_republica_proclama_la_ciudad_de_la_paz_como_capital_de_la_republica_de_guinea_ecuatorial_con_la_firma_de_un_decreto_ley). Its point uses [GeoNames coordinates](https://www.geonames.org/12226438).
- Nauru has no official capital. The map uses Yaren District, the government seat, at the coordinates in a [UN Environment Programme report](https://open.unep.org/docs/gef/PIR/FY2023/10267_ISLANDSPacific_PIR2023.pdf).
- The map labels the same Natural Earth points Astana and Ngerulmud, the current capital names for Kazakhstan and Palau.

These dots mark places that could receive a Lidscape city. They do not mark borders or express a position about disputed territory.
