import { z } from 'zod';

export const LATIN_AMERICAN_COUNTRY_CODES = [
  'AR',
  'BO',
  'BR',
  'BZ',
  'CL',
  'CO',
  'CR',
  'CU',
  'DO',
  'EC',
  'SV',
  'GT',
  'GY',
  'HT',
  'HN',
  'MX',
  'NI',
  'PA',
  'PY',
  'PE',
  'SR',
  'UY',
  'VE',
] as const;

export const countryCodeSchema = z.enum(LATIN_AMERICAN_COUNTRY_CODES);
export type CountryCode = z.infer<typeof countryCodeSchema>;
