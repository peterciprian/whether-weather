# Whether Weather

Egyszerű, nagyon gyors időjárás-előrejelző webapp, amely egyszerre több ingyenes időjárás-API
előrejelzését mutatja egymás alatt, összevethetően. A tábla alján a források **várható értéke**
(medián) látható. Magyar és angol nyelvű.

- Nincs külső npm-csomag, csak Node.js (≥ 20) kell.
- Az API-kulcsok a szerveren maradnak, a látogatóknak nem kell regisztrálniuk.
- A látogató már az első bájtokkal adatot kap: a szerver a gyorsítótárban lévő előrejelzést
  rögtön a HTML-be ágyazza. A többi forrás folyamatosan érkezik, ahogy elkészül (NDJSON stream).

## Indítás

```powershell
copy .env.example .env   # API-kulcsok beírása (opcionális)
npm start                # http://localhost:3000
npm run dev              # automatikus újraindítás fájlváltozáskor
npm test
```

## Adatforrások

| Forrás | Kulcs (`.env`) | Ingyenes keret / megjegyzés |
|---|---|---|
| [Open-Meteo](https://open-meteo.com/) | – | 7+ nap, minden mező (CC BY 4.0) |
| [MET Norway / Yr](https://api.met.no/) | – (`CONTACT` kötelező) | ~9 nap; csapadékvalószínűség és lökés nem mindenhol, sugárzás nincs (CC BY 4.0) |
| [WeatherAPI.com](https://www.weatherapi.com/signup.aspx) | `WEATHERAPI_KEY` | 3 nap |
| [OpenWeather](https://home.openweathermap.org/users/sign_up) | `OPENWEATHER_KEY` | 5 nap / 3 órás lépés, sugárzás nincs |
| [Visual Crossing](https://www.visualcrossing.com/sign-up) | `VISUALCROSSING_KEY` | 1000 rekord/nap (lekérésenként 7 rekord) |
| [Meteosource](https://www.meteosource.com/client/sign-up) | `METEOSOURCE_KEY` | 7 nap, ingyenes csomagban kevesebb mező; backlink kötelező |
| [Tomorrow.io](https://app.tomorrow.io/signup) | `TOMORROW_KEY` | ~5 nap óránként, 500 hívás/nap |

Kulcs nélküli forrás nem jelenik meg a táblában; a lábléc felsorolja, melyik hiányzik.
A `PROVIDERS=open-meteo,met-norway,...` beállítással a források köre szűkíthető.
A `CONTACT` értéke (e-mail vagy URL) bekerül a User-Agent fejlécbe; a MET Norway ezt megköveteli.

## URL-paraméterek

| Paraméter | Jelentés | Példa |
|---|---|---|
| `q` | helynév | `?q=Szeged` |
| `lat`, `lon` | koordináták (a `q` ilyenkor csak a megjelenített név) | `?lat=47.5&lon=19.04` |
| `days` | napok száma, 1–7 (alapértelmezés: 3) | `&days=5` |
| `start` | kezdőnap eltolása, 0 = ma, 1 = holnap | `&start=1&days=1` |
| `lang` | `hu` vagy `en` | `&lang=en` |

Helyszín nélkül a böngésző helyadatát használja. Az utolsó ismert pozíció előrejelzése azonnal
megjelenik, majd frissül. Az első látogatáskor, amíg a helyadat-engedély kérdése nyitva van,
egy tartalék város jelenik meg az időzóna alapján (pl. Budapest), így a lap soha nem üres.
Ha nincs engedély, a lap jelzi az okát.

### Ha a helymeghatározás nem működik

- A böngésző csak **HTTPS**-en vagy `localhost`-on ad helyadatot. LAN-IP-n (`http://192.168…`) nem.
- Az engedélyt a címsor bal oldalán lévő ikonnal lehet megadni vagy visszaállítani.
- Windows: *Beállítások → Adatvédelem → Helyalapú szolgáltatások* legyen bekapcsolva, és az
  asztali alkalmazások is hozzáférhessenek.
- A helynév visszakeresése a Nominatimon (OpenStreetMap) **nem igényel API-kulcsot**, de a
  szolgáltatás felhasználási szabályai szerint kötelező egy azonosítható User-Agent fejléc.
  Ehhez állítsd be a `CONTACT` értékét a `.env`-ben. A szerver legfeljebb 1 kérést küld
  másodpercenként, és 30 napig gyorsítótárazza a válaszokat.

## Óránkénti bontás (ma és holnap)

A mai és a holnapi nap kártyáján összecsukható **Óránkénti bontás** szakasz van. A mai napon a
táblázat az aktuális órától indul. Felül egy diagram látható, fülekkel váltható nézetekkel:

- **Hőmérséklet**, **Szél**, **Felhőzet**, **Napsugárzás**: vékony színes vonal jelöli az egyes
  forrásokat, vastag vonal a mediánt. A szélnél szaggatott vonal mutatja a lökéseket.
- **Csapadék**: oszlopok mutatják a medián mm-t, szaggatott vonal a valószínűséget (0–100%).

Alatta óránként látható az égkép, a hőmérséklet, a csapadék esélye és mennyisége, a szél iránya,
erőssége és lökése, a felhőzet és a sugárzás (W/m²). Minden érték a források mediánja; a cellára
húzva az egérmutatót az egyes források értékei is látszanak. Az éjszakai órák háttere sötétebb.
A választott diagram és a nyitott/csukott állapot megmarad.

## Mértékegységek és a „Várható érték” sor

- Hőmérséklet: napi min/max (°C). Csapadék: napi összeg (mm), valószínűség: a nap legnagyobb értéke (%).
- Szél: a nap legerősebb tartós szele (km/h), uralkodó iránnyal (ahonnan fúj). Lökés: napi maximum (km/h).
- Napsugárzás: napi globálsugárzás összege (MJ/m²). Felhőzet: napi átlag (%).
- Ahol a forrás csak órás vagy 3 órás adatot ad, a napi értékeket a helyszín helyi ideje szerint
  számolja a szerver. A `*` jelölés azt mutatja, hogy a nap részleges, csak a hátralévő órák alapján.
- **Várható érték**: minden mutató a rendelkezésre álló források mediánja, alatta kisebb betűvel a
  források közötti tartomány. A szélirány súlyozatlan körkörös átlag; ha a források nagyon eltérnek,
  „változó” jelenik meg. Az égkép a leggyakoribb piktogram, holtverseny esetén az, amelyik a medián
  csapadék és felhőzet alapján adódik.
- A hiányzó adat „—”, nem 0, és nem számít bele a mediánba.

## Teljesítmény

- Egyetlen HTML-fájl beágyazott CSS-sel, JS-sel és SVG-ikonokkal (~14 KB brotlival), külső kérés nélkül.
- A szerver forrásonként és ~1 km-es rácscellánként gyorsítótáraz (stale-while-revalidate).
  A friss adat 15–60 percig érvényes; lejárt adatot legfeljebb 6 óráig ad vissza, közben a
  háttérben frissít. Az egyidejű azonos kérések egyetlen upstream hívásban egyesülnek.
- Ha egy helyszín adata már a gyorsítótárban van, a HTML beágyazva tartalmazza (≈10 ms válaszidő).
- A böngésző `localStorage`-ben is tárolja az utolsó 12 helyszínt (max. 24 óráig), így
  újranyitáskor azonnal rajzol, majd a háttérben frissít.
- Az időtáv váltása nem indít új lekérést.

## Szerkezet

```
server.js               HTTP-szerver, oldalösszeállítás, NDJSON stream, CSP
lib/forecast.js         források párhuzamos futtatása, időzóna, gyorsítótár
lib/aggregate.js        órás → napi összesítés helyi idő szerint
lib/providers/*.js      forrásonkénti URL-építés és normalizálás
lib/geo.js              helynévkeresés (Open-Meteo) és fordított geokódolás (Nominatim)
public/                 index.html, styles.css, app.js, i18n.js, consensus.js (a szerver összefűzi)
test/                   node:test egységtesztek
```

## Licenc és forrásmegjelölés

Az Open-Meteo és a MET Norway adatai CC BY 4.0 licencűek. A lábléc minden aktív forrást
hivatkozással megjelöl; a Meteosource ingyenes csomagja ezt kifejezetten előírja.
