// Maps each provider's condition codes to the app's canonical pictograms:
// clear, partly, cloudy, fog, drizzle, rain, sleet, snow, thunder.

export function wmoIcon(c) {
  if (typeof c !== 'number') return null;
  if (c <= 1) return 'clear';
  if (c === 2) return 'partly';
  if (c === 3) return 'cloudy';
  if (c === 45 || c === 48) return 'fog';
  if ([56, 57, 66, 67].includes(c)) return 'sleet';
  if (c >= 51 && c <= 55) return 'drizzle';
  if ((c >= 61 && c <= 65) || (c >= 80 && c <= 82)) return 'rain';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
  if (c >= 95) return 'thunder';
  return null;
}

export function metIcon(symbol) {
  if (!symbol) return null;
  const s = symbol.replace(/_(day|night|polartwilight)$/, '');
  if (s.includes('thunder')) return 'thunder';
  if (s.includes('sleet')) return 'sleet';
  if (s.includes('snow')) return 'snow';
  if (s.includes('rain')) return 'rain';
  if (s === 'fog') return 'fog';
  if (s === 'clearsky' || s === 'fair') return 'clear';
  if (s === 'partlycloudy') return 'partly';
  if (s === 'cloudy') return 'cloudy';
  return null;
}

const WEATHERAPI = {
  1000: 'clear', 1003: 'partly', 1006: 'cloudy', 1009: 'cloudy', 1030: 'fog', 1135: 'fog', 1147: 'fog',
  1063: 'rain', 1066: 'snow', 1069: 'sleet', 1072: 'sleet', 1087: 'thunder', 1114: 'snow', 1117: 'snow',
  1150: 'drizzle', 1153: 'drizzle', 1168: 'sleet', 1171: 'sleet', 1180: 'rain', 1183: 'rain', 1186: 'rain',
  1189: 'rain', 1192: 'rain', 1195: 'rain', 1198: 'sleet', 1201: 'sleet', 1204: 'sleet', 1207: 'sleet',
  1210: 'snow', 1213: 'snow', 1216: 'snow', 1219: 'snow', 1222: 'snow', 1225: 'snow', 1237: 'sleet',
  1240: 'rain', 1243: 'rain', 1246: 'rain', 1249: 'sleet', 1252: 'sleet', 1255: 'snow', 1258: 'snow',
  1261: 'sleet', 1264: 'sleet', 1273: 'thunder', 1276: 'thunder', 1279: 'thunder', 1282: 'thunder',
};
export function weatherapiIcon(code) {
  return WEATHERAPI[code] ?? null;
}

export function openweatherIcon(id) {
  if (typeof id !== 'number') return null;
  if (id >= 200 && id < 300) return 'thunder';
  if (id >= 300 && id < 400) return 'drizzle';
  if (id === 511) return 'sleet';
  if (id >= 500 && id < 600) return 'rain';
  if (id >= 611 && id <= 616) return 'sleet';
  if (id >= 600 && id < 700) return 'snow';
  if (id >= 700 && id < 800) return 'fog';
  if (id === 800) return 'clear';
  if (id === 801 || id === 802) return 'partly';
  if (id === 803 || id === 804) return 'cloudy';
  return null;
}

export function visualCrossingIcon(name) {
  if (!name) return null;
  if (name.includes('thunder')) return 'thunder';
  if (name.includes('sleet') || name.includes('hail')) return 'sleet';
  if (name.includes('snow')) return 'snow';
  if (name.includes('rain') || name.includes('showers')) return 'rain';
  if (name.includes('fog')) return 'fog';
  if (name.startsWith('partly') || name === 'wind') return 'partly';
  if (name === 'cloudy') return 'cloudy';
  if (name.startsWith('clear')) return 'clear';
  return null;
}

const METEOSOURCE = {
  2: 'clear', 3: 'clear', 26: 'clear', 27: 'clear', 4: 'partly', 28: 'partly',
  5: 'cloudy', 6: 'cloudy', 7: 'cloudy', 8: 'cloudy', 29: 'cloudy', 30: 'cloudy', 31: 'cloudy',
  9: 'fog', 10: 'rain', 11: 'rain', 12: 'rain', 13: 'rain', 32: 'rain',
  14: 'thunder', 15: 'thunder', 33: 'thunder', 16: 'snow', 17: 'snow', 18: 'snow', 19: 'snow', 34: 'snow',
  20: 'sleet', 21: 'sleet', 22: 'sleet', 23: 'sleet', 24: 'sleet', 25: 'sleet', 35: 'sleet', 36: 'sleet',
};
export function meteosourceIcon(num, weather) {
  if (METEOSOURCE[num]) return METEOSOURCE[num];
  const w = String(weather || '');
  if (/tstorm|thunder/.test(w)) return 'thunder';
  if (/freez|hail|rain_and_snow/.test(w)) return 'sleet';
  if (w.includes('snow')) return 'snow';
  if (/rain|shower/.test(w)) return 'rain';
  if (w.includes('fog')) return 'fog';
  if (/overcast|cloudy/.test(w)) return w.startsWith('partly') ? 'partly' : 'cloudy';
  if (/sunny|clear/.test(w)) return w.startsWith('partly') ? 'partly' : 'clear';
  return null;
}

const TOMORROW = {
  1000: 'clear', 1100: 'clear', 1101: 'partly', 1102: 'cloudy', 1001: 'cloudy', 2000: 'fog', 2100: 'fog',
  4000: 'drizzle', 4001: 'rain', 4200: 'rain', 4201: 'rain', 5000: 'snow', 5001: 'snow', 5100: 'snow',
  5101: 'snow', 6000: 'sleet', 6001: 'sleet', 6200: 'sleet', 6201: 'sleet', 7000: 'sleet', 7101: 'sleet',
  7102: 'sleet', 8000: 'thunder',
};
export function tomorrowIcon(code) {
  if (typeof code !== 'number') return null;
  if (code >= 10000) code = Math.floor(code / 10);
  if (TOMORROW[code]) return TOMORROW[code];
  const lead = Math.floor(code / 1000);
  return { 1: 'cloudy', 2: 'fog', 4: 'rain', 5: 'snow', 6: 'sleet', 7: 'sleet', 8: 'thunder' }[lead] ?? null;
}
