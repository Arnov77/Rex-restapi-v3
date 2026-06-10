import { z } from 'zod';

export const IpLookupQuery = z.object({
  ip: z
    .string()
    .min(1)
    .max(45)
    .describe('IPv4 atau IPv6 address yang ingin di-lookup'),
});

export type IpLookupQuery = z.infer<typeof IpLookupQuery>;

export const IpLookupResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    ip: z.string(),
    // Location
    country: z.string().nullable(),
    country_code: z.string().nullable(),
    region: z.string().nullable(),
    region_code: z.string().nullable(),
    city: z.string().nullable(),
    postal: z.string().nullable(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    timezone: z.string().nullable(),
    // Network
    asn: z.number().nullable(),
    isp: z.string().nullable(),
    org: z.string().nullable(),
  }),
});
