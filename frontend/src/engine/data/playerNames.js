// =============================================================================
// playerNames.js
// =============================================================================
// Nationality-aware name pools + selector for generated players.
//
// Players already carry a `country` (assigned in CampaignManager.generatePlayer
// and RookieGenerationService) but historically drew names from a single
// US/scrambled pool regardless of nationality. This module supplies:
//   - a Hispanic/Latino bucket that gets mixed into the DOMESTIC pool, and
//   - per-country international name pools matching the 18 origins in
//     RookieGenerationService.INTERNATIONAL_ORIGINS,
// plus pickNameForCountry(), the single selector both name paths use.
//
// IMPORTANT: this module imports nothing from CampaignManager — the domestic
// pools are passed into pickNameForCountry() as arguments. That keeps it out of
// the existing CampaignManager <-> RookieGenerationService import cycle.
//
// IP safety: names are common, culturally-plausible given names/surnames, and
// deliberately avoid the exact surnames of current/recent real NBA players
// (Doncic, Jokic, Antetokounmpo, Wembanyama, Sabonis, Gobert, Sengun, etc.),
// mirroring the guarantee the CampaignManager scrambler already provides.
// =============================================================================

// ---------------------------------------------------------------------------
// Domestic Hispanic / Latino bucket (mixed into the US pool by CampaignManager)
// ---------------------------------------------------------------------------

export const HISPANIC_FIRST_NAMES = [
  'Carlos', 'Luis', 'Miguel', 'Jose', 'Juan', 'Diego', 'Javier', 'Andres',
  'Mateo', 'Marco', 'Emilio', 'Rafael', 'Gabriel', 'Hector', 'Ricardo',
  'Fernando', 'Alejandro', 'Sergio', 'Ramon', 'Esteban', 'Cristian', 'Adrian',
  'Mauricio', 'Eduardo', 'Pablo', 'Joaquin', 'Salvador', 'Ramiro', 'Ignacio',
  'Manuel', 'Egnacio'
]

export const HISPANIC_LAST_NAMES = [
  'Garcia', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Perez',
  'Sanchez', 'Ramirez', 'Torres', 'Flores', 'Rivera', 'Gomez', 'Diaz', 'Reyes',
  'Morales', 'Cruz', 'Ortiz', 'Gutierrez', 'Chavez', 'Ramos', 'Vasquez',
  'Castillo', 'Jimenez', 'Moreno', 'Romero', 'Herrera', 'Medina', 'Vargas',
  'Delgado', 'Mendoza', 'Salazar', 'Guerrero', 'Cabrera', 'Diablo', 'Melbrelso',
  'Beniate'
] 

// ---------------------------------------------------------------------------
// Per-country international pools (keys MUST match INTERNATIONAL_ORIGINS country)
// ---------------------------------------------------------------------------

export const INTERNATIONAL_NAMES = {
  France: {
    first: ['Lucas', 'Hugo', 'Theo', 'Nathan', 'Mathis', 'Enzo', 'Antoine', 'Romain', 'Maxime', 'Clement', 'Bastien', 'Florian', 'Guillaume', 'Adrien', 'Loic', 'Quentin', 'Yannick', 'Sebastien', 'Cedric', 'Damien'],
    last: ['Lefebvre', 'Moreau', 'Laurent', 'Girard', 'Bonnet', 'Dupont', 'Lambert', 'Fontaine', 'Rousseau', 'Vincent', 'Mercier', 'Boyer', 'Renaud', 'Marchand', 'Dumas', 'Perrin', 'Leclerc', 'Faure', 'Guerin', 'Chevalier'],
  },
  Spain: {
    first: ['Sergio', 'Alvaro', 'Pablo', 'Javier', 'Adrian', 'Marcos', 'Daniel', 'Hugo', 'Mario', 'Ruben', 'Iker', 'Alejandro', 'Raul', 'Victor', 'Jorge', 'Carlos', 'Nacho', 'Borja', 'Unai', 'Aitor'],
    last: ['Fernandez', 'Munoz', 'Alonso', 'Gil', 'Vega', 'Castro', 'Ortega', 'Rubio', 'Marin', 'Soto', 'Iglesias', 'Santos', 'Carrasco', 'Calderon', 'Navarro', 'Pena', 'Campos', 'Vidal', 'Bravo', 'Cano'],
  },
  Australia: {
    first: ['Jack', 'Cooper', 'Riley', 'Ryan', 'Lachlan', 'Hayden', 'Blake', 'Mason', 'Tyson', 'Brodie', 'Angus', 'Declan', 'Hunter', 'Bailey', 'Flynn', 'Jarrah', 'Kyle', 'Ben', 'Sam', 'Lewis'],
    last: ['Mitchell', 'Thompson', 'Walker', 'Harrison', 'Bennett', 'Fraser', 'Hayes', 'Sheppard', 'Mason', 'Cameron', 'Dawson', 'Gibson', 'Hartley', 'Whitfield', 'Donnelly', 'Marsh', 'Beckett', 'Lawson', 'Pearce', 'Crawford'],
  },
  Serbia: {
    first: ['Nikola', 'Stefan', 'Marko', 'Aleksa', 'Vukasin', 'Lazar', 'Filip', 'Uros', 'Milos', 'Ognjen', 'Dusan', 'Petar', 'Bogdan', 'Veljko', 'Strahinja', 'Andrej', 'Vladimir', 'Nemanja', 'Mihailo', 'Luka'],
    last: ['Stankovic', 'Ilic', 'Pavlovic', 'Nikolic', 'Markovic', 'Jovanovic', 'Todorovic', 'Ristic', 'Lukic', 'Simic', 'Kovacevic', 'Milosevic', 'Radovanovic', 'Stojanovic', 'Vasic', 'Maksimovic', 'Babic', 'Zaric', 'Krstic', 'Tomic'],
  },
  Canada: {
    first: ['Liam', 'Noah', 'Owen', 'Ethan', 'Carter', 'Logan', 'Mason', 'Nathan', 'Tristan', 'Xavier', 'Felix', 'Olivier', 'Gabriel', 'Cole', 'Reid', 'Dominic', 'Marc', 'Andre', 'Devon', 'Jaden'],
    last: ['Tremblay', 'Roy', 'Cote', 'Bouchard', 'Gagnon', 'Bergeron', 'Fortin', 'Caron', 'MacDonald', 'Patel', 'Chan', 'OBrien', 'Sinclair', 'Hughes', 'Lapointe', 'Beaulieu', 'Forbes', 'Larsen', 'Whitfield', 'Aubin'],
  },
  Germany: {
    first: ['Lukas', 'Felix', 'Maximilian', 'Jonas', 'Leon', 'Niklas', 'Tim', 'Moritz', 'Julian', 'Florian', 'Tobias', 'David', 'Philipp', 'Hannes', 'Lennart', 'Jannik', 'Sebastian', 'Marvin', 'Erik', 'Fabian'],
    last: ['Mueller', 'Fischer', 'Weber', 'Becker', 'Hoffmann', 'Schulz', 'Koch', 'Richter', 'Klein', 'Wolf', 'Neumann', 'Braun', 'Werner', 'Lehmann', 'Krause', 'Zimmermann', 'Hartmann', 'Vogel', 'Frank', 'Brandt'],
  },
  Greece: {
    first: ['Giannis', 'Dimitris', 'Kostas', 'Nikos', 'Vasilis', 'Yannis', 'Stavros', 'Andreas', 'Christos', 'Alexandros', 'Petros', 'Thanasis', 'Manolis', 'Spyros', 'Lefteris', 'Apostolos', 'Fotis', 'Michalis', 'Georgios', 'Panagiotis'],
    last: ['Papadopoulos', 'Nikolaidis', 'Georgiou', 'Vlachos', 'Pappas', 'Antoniou', 'Makris', 'Dimitriou', 'Christou', 'Anagnostou', 'Samaras', 'Karras', 'Fotopoulos', 'Stamatis', 'Vasilakis', 'Spanos', 'Drosos', 'Mavros', 'Galanis', 'Raptis'],
  },
  Nigeria: {
    first: ['Emeka', 'Chidi', 'Obinna', 'Tunde', 'Femi', 'Kelechi', 'Ikenna', 'Chinedu', 'Uche', 'Olu', 'Ebuka', 'Nnamdi', 'Segun', 'Bayo', 'Ifeanyi', 'Kunle', 'Dapo', 'Chukwu', 'Ade', 'Tobe'],
    last: ['Okafor', 'Adeyemi', 'Eze', 'Obi', 'Nwankwo', 'Okonkwo', 'Balogun', 'Adeyinka', 'Chukwu', 'Olawale', 'Nwosu', 'Igwe', 'Onuoha', 'Afolabi', 'Okoye', 'Uzoma', 'Ogun', 'Adewale', 'Ezeh', 'Maduka'],
  },
  Japan: {
    first: ['Yuki', 'Haruto', 'Sota', 'Ren', 'Kaito', 'Riku', 'Yuto', 'Daiki', 'Sora', 'Takumi', 'Hayato', 'Kenta', 'Ryota', 'Shota', 'Kazuki', 'Yamato', 'Naoki', 'Tatsuya', 'Koki', 'Hinata'],
    last: ['Tanaka', 'Suzuki', 'Takahashi', 'Ishikawa', 'Ito', 'Yamamoto', 'Nakamura', 'Kobayashi', 'Kato', 'Yoshida', 'Yamada', 'Sasaki', 'Matsumoto', 'Inoue', 'Kimura', 'Hayashi', 'Shimizu', 'Mori', 'Abe', 'Okada'],
  },
  Brazil: {
    first: ['Gabriel', 'Lucas', 'Matheus', 'Rafael', 'Bruno', 'Felipe', 'Joao', 'Pedro', 'Thiago', 'Vinicius', 'Caio', 'Leonardo', 'Gustavo', 'Diego', 'Andre', 'Rodrigo', 'Marcelo', 'Davi', 'Igor', 'Murilo'],
    last: ['Silva', 'Santos', 'Oliveira', 'Souza', 'Costa', 'Pereira', 'Almeida', 'Ferreira', 'Ribeiro', 'Carvalho', 'Gomes', 'Martins', 'Araujo', 'Barbosa', 'Rocha', 'Cardoso', 'Teixeira', 'Moraes', 'Pinto', 'Correia'],
  },
  Turkey: {
    first: ['Mehmet', 'Emre', 'Burak', 'Can', 'Kerem', 'Ahmet', 'Mustafa', 'Yusuf', 'Ozan', 'Baris', 'Onur', 'Tolga', 'Berk', 'Hakan', 'Cem', 'Furkan', 'Deniz', 'Serkan', 'Murat', 'Eren'],
    last: ['Yilmaz', 'Demir', 'Celik', 'Kaya', 'Aydin', 'Sahin', 'Yildirim', 'Ozturk', 'Arslan', 'Dogan', 'Kilic', 'Aslan', 'Cetin', 'Yalcin', 'Polat', 'Erdogan', 'Kurt', 'Ozdemir', 'Bulut', 'Tekin'],
  },
  Slovenia: {
    first: ['Luka', 'Jan', 'Nik', 'Matej', 'Ziga', 'Rok', 'Anze', 'Tilen', 'Gregor', 'Klemen', 'Miha', 'Bostjan', 'Vid', 'Jaka', 'Aljaz', 'Domen', 'Blaz', 'Urban', 'Tadej', 'Gasper'],
    last: ['Novak', 'Horvat', 'Krajnc', 'Zupan', 'Kovac', 'Mlakar', 'Vidmar', 'Golob', 'Bizjak', 'Kos', 'Hribar', 'Zupancic', 'Korosec', 'Pirc', 'Rozman', 'Kralj', 'Jereb', 'Bregar', 'Zorko', 'Pintar'],
  },
  Croatia: {
    first: ['Ivan', 'Marko', 'Luka', 'Ante', 'Josip', 'Mateo', 'Petar', 'Toni', 'Filip', 'Dario', 'Karlo', 'Roko', 'Bruno', 'Domagoj', 'Mislav', 'Tin', 'Borna', 'Fran', 'Leon', 'Vedran'],
    last: ['Horvat', 'Kovac', 'Babic', 'Maric', 'Juric', 'Novak', 'Knezevic', 'Vukovic', 'Matic', 'Petrovic', 'Tomic', 'Blazevic', 'Grgic', 'Pavic', 'Lovric', 'Bilic', 'Kovacevic', 'Soldo', 'Vidovic', 'Galic'],
  },
  Lithuania: {
    first: ['Tomas', 'Lukas', 'Mantas', 'Rokas', 'Dovydas', 'Arnas', 'Ignas', 'Domantas', 'Paulius', 'Marius', 'Tadas', 'Gytis', 'Deividas', 'Edvinas', 'Jonas', 'Kasparas', 'Augustas', 'Nojus', 'Matas', 'Vytautas'],
    last: ['Kazlauskas', 'Petrauskas', 'Jankauskas', 'Stankevicius', 'Vasiliauskas', 'Butkus', 'Urbonas', 'Zukauskas', 'Balciunas', 'Adomaitis', 'Navickas', 'Paulauskas', 'Rimkus', 'Dapkus', 'Mikalauskas', 'Sakalauskas', 'Gudaitis', 'Maciulis', 'Kavaliauskas', 'Bagdonas'],
  },
  Cameroon: {
    first: ['Joel', 'Pascal', 'Landry', 'Yannick', 'Aristide', 'Christian', 'Stephane', 'Boris', 'Junior', 'Cedric', 'Fabrice', 'Herve', 'Ulrich', 'Bertrand', 'Armel', 'Gaston', 'Donald', 'Roland', 'Serge', 'Patrick'],
    last: ['Mbarga', 'Ngono', 'Etoa', 'Nkemba', 'Fotso', 'Tchana', 'Ngassa', 'Bidias', 'Manga', 'Essomba', 'Atangana', 'Ondoa', 'Mvondo', 'Nguema', 'Tchami', 'Bayiha', 'Owona', 'Kamga', 'Ndongo', 'Fokou'],
  },
  Senegal: {
    first: ['Ousmane', 'Cheikh', 'Mamadou', 'Ibrahima', 'Pape', 'Moussa', 'Abdou', 'Babacar', 'Lamine', 'Modou', 'Serigne', 'Aliou', 'Idrissa', 'Khadim', 'Assane', 'Saliou', 'Malick', 'Demba', 'Souleymane', 'Fallou'],
    last: ['Diallo', 'Faye', 'Sow', 'Ba', 'Cisse', 'Gueye', 'Seck', 'Diatta', 'Fall', 'Diouf', 'Mbaye', 'Sy', 'Toure', 'Camara', 'Sane', 'Kane', 'Thiam', 'Wade', 'Sall', 'Ndour'],
  },
  Italy: {
    first: ['Marco', 'Luca', 'Matteo', 'Andrea', 'Davide', 'Simone', 'Lorenzo', 'Francesco', 'Alessandro', 'Riccardo', 'Stefano', 'Federico', 'Giacomo', 'Tommaso', 'Nicolo', 'Filippo', 'Pietro', 'Gabriele', 'Diego', 'Emanuele'],
    last: ['Rossi', 'Russo', 'Ferrari', 'Esposito', 'Bianchi', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Bruno', 'Gallo', 'Conti', 'De Luca', 'Costa', 'Giordano', 'Mancini', 'Rizzo', 'Lombardi', 'Moretti'],
  },
  Israel: {
    first: ['Noam', 'Itai', 'Yonatan', 'Eitan', 'Amit', 'Omri', 'Tomer', 'Guy', 'Roi', 'Yarden', 'Liron', 'Idan', 'Nadav', 'Ori', 'Shai', 'Ariel', 'Gilad', 'Doron', 'Elad', 'Tal'],
    last: ['Cohen', 'Levi', 'Mizrahi', 'Peretz', 'Biton', 'Avraham', 'Friedman', 'Shapira', 'Katz', 'Barak', 'Gold', 'Segal', 'Aviv', 'Dahan', 'Harel', 'Yosef', 'Klein', 'Tal', 'Bar', 'Adler'],
  },
}

function _pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

/**
 * Pick a unique {firstName, lastName} appropriate to a player's country.
 *
 * International countries present in INTERNATIONAL_NAMES draw from their own
 * pool; everyone else (incl. 'United States') draws from the passed-in domestic
 * pools (CampaignManager's FIRST_NAMES/LAST_NAMES, which now include the
 * Hispanic bucket). Owns collision avoidance + a "Jr." fallback, and adds the
 * chosen full name to `usedNames` so callers don't double-track.
 *
 * @param {object} params
 * @param {string} [params.country]
 * @param {Set<string>} [params.usedNames] - mutated with the chosen full name
 * @param {Array<string>} params.domesticFirst
 * @param {Array<string>} params.domesticLast
 * @param {number} [params.maxAttempts]
 * @returns {{ firstName: string, lastName: string }}
 */
export function pickNameForCountry({
  country,
  usedNames,
  domesticFirst = [],
  domesticLast = [],
  maxAttempts = 200,
}) {
  const intl = country && country !== 'United States' ? INTERNATIONAL_NAMES[country] : null
  const firstPool = intl && intl.first.length ? intl.first : domesticFirst
  const lastPool = intl && intl.last.length ? intl.last : domesticLast

  // Defensive: never crash a campaign create over an empty pool.
  if (!firstPool.length || !lastPool.length) {
    return { firstName: 'Alex', lastName: 'Jordan' }
  }

  let firstName, lastName, fullName, attempts = 0
  do {
    firstName = _pick(firstPool)
    lastName = _pick(lastPool)
    fullName = `${firstName} ${lastName}`
    attempts++
  } while (usedNames && usedNames.has(fullName) && attempts < maxAttempts)

  if (usedNames && usedNames.has(fullName)) {
    lastName = `${lastName} Jr.`
    fullName = `${firstName} ${lastName}`
  }
  if (usedNames) usedNames.add(fullName)

  return { firstName, lastName }
}
