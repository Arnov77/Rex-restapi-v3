import { Reader } from '@maxmind/geoip2-node';
import { AppError } from '@shared/errors.js';
import { loadEnv } from '../../../config/env.js';

// Singleton readers — buka database sekali saja saat pertama request
let cityReader: Awaited<ReturnType<typeof Reader.open>> | null = null;
let asnReader: Awaited<ReturnType<typeof Reader.open>> | null = null;

async function getCityReader() {
  if (!cityReader) {
    const env = loadEnv();
    try {
      cityReader = await Reader.open(env.GEOIP_CITY_DB);
    } catch {
      throw new AppError(503, 'GEOIP_CITY_DB_NOT_FOUND', `GeoLite2-City database tidak ditemukan di: ${env.GEOIP_CITY_DB}`);
    }
  }
  return cityReader;
}

async function getAsnReader() {
  if (!asnReader) {
    const env = loadEnv();
    try {
      asnReader = await Reader.open(env.GEOIP_ASN_DB);
    } catch {
      throw new AppError(503, 'GEOIP_ASN_DB_NOT_FOUND', `GeoLite2-ASN database tidak ditemukan di: ${env.GEOIP_ASN_DB}`);
    }
  }
  return asnReader;
}

export interface IpLookupResult {
  ip: string;
  country: string | null;
  country_code: string | null;
  region: string | null;
  region_code: string | null;
  city: string | null;
  postal: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  asn: number | null;
  isp: string | null;
  org: string | null;
}

export async function lookupIp(ip: string): Promise<IpLookupResult> {
  const [city, asn] = await Promise.allSettled([
    getCityReader().then((r) => r.city(ip)),
    getAsnReader().then((r) => r.asn(ip)),
  ]);

  if (city.status === 'rejected' && asn.status === 'rejected') {
    throw new AppError(404, 'IP_NOT_FOUND', `IP ${ip} tidak ditemukan di database`);
  }

  const c = city.status === 'fulfilled' ? city.value : null;
  const a = asn.status === 'fulfilled' ? asn.value : null;

  return {
    ip,
    country: c?.country?.names?.en ?? null,
    country_code: c?.country?.isoCode ?? null,
    region: c?.subdivisions?.[0]?.names?.en ?? null,
    region_code: c?.subdivisions?.[0]?.isoCode ?? null,
    city: c?.city?.names?.en ?? null,
    postal: c?.postal?.code ?? null,
    latitude: c?.location?.latitude ?? null,
    longitude: c?.location?.longitude ?? null,
    timezone: c?.location?.timeZone ?? null,
    asn: a?.autonomousSystemNumber ?? null,
    isp: a?.autonomousSystemOrganization ?? null,
    org: a?.autonomousSystemOrganization ?? null,
  };
}
