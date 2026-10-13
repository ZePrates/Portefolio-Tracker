import { exposureCountry, exposureSector, mergeDisplaySlices } from './exposure-display';
import type { Slice } from './exposure-types';

/** Fixed semantic chart tokens, shared by sector bars and charts in either theme. */
const SECTOR_COLORS: Record<string, string> = {
  Tecnologia: 'var(--color-chart-3)', Financeiro: 'var(--color-chart-1)', Saúde: 'var(--color-chart-2)',
  Indústria: 'var(--color-chart-7)', 'Consumo cíclico': 'var(--color-chart-5)',
  'Consumo não cíclico': 'var(--color-success)', Comunicações: 'var(--color-chart-4)',
  Materiais: 'var(--color-chart-6)', Energia: 'var(--color-warning)', Utilities: 'var(--color-info)',
  Imobiliário: 'var(--color-sector-real-estate)', 'Liquidez e derivados': 'var(--color-chart-8)',
};
export const sectorColor = (sector: string) => SECTOR_COLORS[exposureSector(sector)] ?? 'var(--color-chart-8)';

const GROUPS: Array<[string, string, string]> = [
  ['Estados Unidos', 'United States|US|USA|United States of America', 'US'],
  ['Canadá', 'Canada', 'CA'], ['Reino Unido', 'United Kingdom|UK|Great Britain', 'GB'],
  ['Japão', 'Japan', 'JP'], ['Pacífico desenvolvido', 'Australia', 'AU'],
  ['Pacífico desenvolvido', 'Hong Kong', 'HK'], ['Pacífico desenvolvido', 'Singapore', 'SG'],
  ['Pacífico desenvolvido', 'New Zealand', 'NZ'],
  ...[['Portugal','PT'],['Spain','ES'],['France','FR'],['Germany','DE'],['Italy','IT'],['Netherlands','NL'],['Belgium','BE'],['Ireland','IE'],['Luxembourg','LU'],['Austria','AT'],['Switzerland','CH'],['Sweden','SE'],['Norway','NO'],['Denmark','DK'],['Finland','FI'],['Poland','PL'],['Czech Republic|Czechia','CZ'],['Hungary','HU'],['Greece','GR']].map(([name, code]): [string,string,string] => ['Europa (excl. Reino Unido)', name ?? '', code ?? '']),
  ...[['China','CN'],['Taiwan','TW'],['India','IN'],['South Korea|Korea|Korea (South)|Korea, Republic of','KR'],['Brazil','BR'],['Mexico','MX'],['Indonesia','ID'],['Malaysia','MY'],['Thailand','TH'],['Philippines','PH'],['Vietnam','VN'],['South Africa','ZA'],['Turkey','TR'],['United Arab Emirates','AE'],['Saudi Arabia','SA'],['Qatar','QA'],['Egypt','EG'],['Chile','CL'],['Argentina','AR'],['Colombia','CO'],['Peru','PE']].map(([name, code]): [string,string,string] => ['Mercados emergentes', name ?? '', code ?? '']),
];
const countries = new Map<string, { region: string; flag: string }>();
const key = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
for (const [region, names, code] of GROUPS) {
  const flag = [...code].map(c => String.fromCodePoint(127397 + c.charCodeAt(0))).join('');
  for (const name of names.split('|')) {
    const value = { region, flag };
    countries.set(key(name), value);
    countries.set(key(exposureCountry(name)), value);
    countries.set(key(code), value);
  }
}
export const countryRegion = (country: string) => countries.get(key(country))?.region ?? 'Outros';
export const countryFlag = (country: string) => countries.get(key(country))?.flag ?? '';
export const countryLabel = (country: string) => {
  for (const [, names, code] of GROUPS) if (key(code) === key(country)) return exposureCountry(names.split('|')[0] ?? country);
  return exposureCountry(country);
};
export const regionSlices = (slices: Slice[]) => mergeDisplaySlices(slices, countryRegion);
