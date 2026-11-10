/** Default character set for capture, grouped for the overview. */
export interface CharGroup {
  id: string;
  label: string;
  chars: string[];
}

const range = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let c = from.charCodeAt(0); c <= to.charCodeAt(0); c++) out.push(String.fromCharCode(c));
  return out;
};

export const VARIANTS = 3;

export const DEFAULT_LIGATURES: readonly string[] = ['ch', 'ck', 'sch', 'ei', 'ie', 'tt', 'll', 'ss', 'st'];

export const BASE_GROUPS: readonly CharGroup[] = [
  { id: 'lower', label: 'Kleinbuchstaben', chars: range('a', 'z') },
  { id: 'upper', label: 'Großbuchstaben', chars: range('A', 'Z') },
  { id: 'umlaut', label: 'Umlaute & ß', chars: ['ä', 'ö', 'ü', 'Ä', 'Ö', 'Ü', 'ß'] },
  { id: 'digits', label: 'Ziffern', chars: range('0', '9') },
  {
    id: 'punct',
    label: 'Satzzeichen',
    chars: ['.', ',', ';', ':', '!', '?', '-', '–', '(', ')', '"', "'", '„', '“', '/', '&', '@', '€', '%', '+', '='],
  },
];

const BASE_CHARS: ReadonlySet<string> = new Set(BASE_GROUPS.flatMap((g) => g.chars));

/** `ligatures` (setting) holds the user's own entries: single extra characters and ligatures of 2–4 characters. */
export function groupsWith(ligatures: readonly string[]): CharGroup[] {
  const extra = ligatures.filter((s) => [...s].length === 1 && !BASE_CHARS.has(s));
  const ligs = ligatures.filter((s) => [...s].length > 1);
  return [
    ...BASE_GROUPS,
    ...(extra.length ? [{ id: 'extra', label: 'Eigene Zeichen', chars: extra }] : []),
    { id: 'lig', label: 'Ligaturen', chars: ligs },
  ];
}

/** Clean a user-entered list of extra chars / ligatures: NFC, 1–4 visible chars, no whitespace, not in the base set, unique. */
export function parseLigatures(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[\s,;]+/)) {
    const s = raw.normalize('NFC');
    const len = [...s].length;
    if (len < 1 || len > 4 || seen.has(s) || BASE_CHARS.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out.slice(0, 40);
}

/** Human readable name for screen readers / headings. */
export function describeChar(c: string): string {
  if ([...c].length > 1) return `Ligatur „${c}“`;
  if (!BASE_CHARS.has(c)) return `Eigenes Zeichen ${c}`;
  if (/[a-zäöü]/.test(c)) return `Kleinbuchstabe ${c}`;
  if (c === 'ß') return 'Eszett ß';
  if (/[A-ZÄÖÜ]/.test(c)) return `Großbuchstabe ${c}`;
  if (/[0-9]/.test(c)) return `Ziffer ${c}`;
  const names: Record<string, string> = {
    '.': 'Punkt', ',': 'Komma', ';': 'Semikolon', ':': 'Doppelpunkt', '!': 'Ausrufezeichen',
    '?': 'Fragezeichen', '-': 'Bindestrich', '–': 'Gedankenstrich', '(': 'Klammer auf', ')': 'Klammer zu',
    '"': 'Anführungszeichen (gerade)', "'": 'Apostroph', '„': 'Anführungszeichen unten', '“': 'Anführungszeichen oben',
    '/': 'Schrägstrich', '&': 'Und-Zeichen', '@': 'At-Zeichen', '€': 'Euro', '%': 'Prozent', '+': 'Plus', '=': 'Gleich',
  };
  return names[c] ? `${names[c]} ${c}` : `Zeichen ${c}`;
}
