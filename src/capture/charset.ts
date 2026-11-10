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

export function groupsWith(ligatures: readonly string[]): CharGroup[] {
  return [...BASE_GROUPS, { id: 'lig', label: 'Ligaturen', chars: [...ligatures] }];
}

/** Clean a user-entered ligature list: NFC, trimmed, 2–4 visible chars, no whitespace, unique. */
export function parseLigatures(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[\s,;]+/)) {
    const s = raw.normalize('NFC');
    const len = [...s].length;
    if (len < 2 || len > 4 || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out.slice(0, 40);
}

/** Human readable name for screen readers / headings. */
export function describeChar(c: string): string {
  if ([...c].length > 1) return `Ligatur „${c}“`;
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
