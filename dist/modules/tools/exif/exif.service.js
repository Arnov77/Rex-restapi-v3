import sharp from 'sharp';
import { assertPublicUrl } from '../../../shared/utils/ssrfGuard.js';
import { Internal } from '../../../shared/errors.js';
// ─── EXIF binary parser ───────────────────────────────────────────────────────
function readUint16(buf, offset, le) {
    return le ? buf.readUInt16LE(offset) : buf.readUInt16BE(offset);
}
function readUint32(buf, offset, le) {
    return le ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset);
}
function readRational(buf, offset, le) {
    const num = readUint32(buf, offset, le);
    const den = readUint32(buf, offset + 4, le);
    return den === 0 ? 0 : num / den;
}
function readString(buf, offset, len) {
    return buf.slice(offset, offset + len).toString('ascii').replace(/\0/g, '').trim();
}
function readIFD(buf, offset, le) {
    const result = {};
    if (offset + 2 > buf.length)
        return result;
    const count = readUint16(buf, offset, le);
    offset += 2;
    for (let i = 0; i < count; i++) {
        if (offset + 12 > buf.length)
            break;
        const tag = readUint16(buf, offset, le);
        const type = readUint16(buf, offset + 2, le);
        const num = readUint32(buf, offset + 4, le);
        const valOff = offset + 8;
        let value;
        try {
            if (type === 2) {
                const strOffset = num > 4 ? readUint32(buf, valOff, le) : valOff;
                value = readString(buf, strOffset, num);
            }
            else if (type === 3) {
                value = readUint16(buf, valOff, le);
            }
            else if (type === 4) {
                value = readUint32(buf, valOff, le);
            }
            else if (type === 5) {
                const ratOff = readUint32(buf, valOff, le);
                value = num === 1
                    ? readRational(buf, ratOff, le)
                    : Array.from({ length: num }, (_, j) => readRational(buf, ratOff + j * 8, le));
            }
            else if (type === 1) {
                value = buf[valOff];
            }
        }
        catch { /* skip malformed tag */ }
        if (value !== undefined)
            result[String(tag)] = value;
        offset += 12;
    }
    return result;
}
function parseExifBuffer(exifBuf) {
    try {
        if (exifBuf.toString('ascii', 0, 4) !== 'Exif')
            return null;
        const tiff = exifBuf.slice(6);
        const header = tiff.toString('ascii', 0, 2);
        if (header !== 'II' && header !== 'MM')
            return null;
        const le = header === 'II';
        const ifdOffset = readUint32(tiff, 4, le);
        const ifd0 = readIFD(tiff, ifdOffset, le);
        const exif = {};
        if (ifd0['271'])
            exif.make = String(ifd0['271']);
        if (ifd0['272'])
            exif.model = String(ifd0['272']);
        if (ifd0['305'])
            exif.software = String(ifd0['305']);
        if (ifd0['315'])
            exif.artist = String(ifd0['315']);
        if (ifd0['274'])
            exif.orientation = Number(ifd0['274']);
        if (ifd0['282'])
            exif.xResolution = Number(ifd0['282']);
        if (ifd0['283'])
            exif.yResolution = Number(ifd0['283']);
        if (ifd0['296'])
            exif.resolutionUnit = Number(ifd0['296']) === 2 ? 'inch' : 'cm';
        if (ifd0['33432'])
            exif.copyright = String(ifd0['33432']);
        if (ifd0['270'])
            exif.imageDescription = String(ifd0['270']);
        // EXIF sub-IFD
        if (ifd0['34665']) {
            const sub = readIFD(tiff, Number(ifd0['34665']), le);
            if (sub['36867'])
                exif.dateTimeOriginal = String(sub['36867']);
            if (sub['36868'])
                exif.dateTimeDigitized = String(sub['36868']);
            if (sub['33434'])
                exif.exposureTime = `1/${Math.round(1 / Number(sub['33434']))}`;
            if (sub['33437'])
                exif.fNumber = Math.round(Number(sub['33437']) * 10) / 10;
            if (sub['34855'])
                exif.iso = Number(sub['34855']);
            if (sub['37386'])
                exif.focalLength = Math.round(Number(sub['37386']) * 10) / 10;
            if (sub['41989'])
                exif.focalLengthIn35mm = Number(sub['41989']);
            if (sub['37385'])
                exif.flash = Number(sub['37385']) & 1 ? 'fired' : 'did not fire';
            if (sub['41986'])
                exif.exposureMode = Number(sub['41986']) === 0 ? 'auto' : 'manual';
            if (sub['41987'])
                exif.whiteBalance = Number(sub['41987']) === 0 ? 'auto' : 'manual';
            if (sub['37383']) {
                const m = Number(sub['37383']);
                exif.meteringMode = ['unknown', 'average', 'center', 'spot', 'multi-spot', 'pattern', 'partial'][m] ?? 'unknown';
            }
            if (sub['42036'])
                exif.lens = String(sub['42036']);
        }
        // GPS sub-IFD
        if (ifd0['34853']) {
            const gps = readIFD(tiff, Number(ifd0['34853']), le);
            const g = {};
            if (gps['2'] && Array.isArray(gps['2'])) {
                const [deg, min, sec] = gps['2'];
                let lat = (deg ?? 0) + (min ?? 0) / 60 + (sec ?? 0) / 3600;
                if (gps['1'] === 'S')
                    lat = -lat;
                g.latitude = Math.round(lat * 1e7) / 1e7;
            }
            if (gps['4'] && Array.isArray(gps['4'])) {
                const [deg, min, sec] = gps['4'];
                let lon = (deg ?? 0) + (min ?? 0) / 60 + (sec ?? 0) / 3600;
                if (gps['3'] === 'W')
                    lon = -lon;
                g.longitude = Math.round(lon * 1e7) / 1e7;
            }
            if (gps['6']) {
                const alt = Number(gps['6']);
                g.altitude = Number(gps['5']) === 1 ? -alt : alt;
            }
            if (Object.keys(g).length)
                exif.gps = g;
        }
        return Object.keys(exif).length ? exif : null;
    }
    catch {
        return null;
    }
}
// ─── Reverse geocoding via Nominatim ─────────────────────────────────────────
async function reverseGeocode(lat, lon) {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`;
        const res = await fetch(url, {
            headers: { 'User-Agent': 'rex-api-exif/1.0' },
        });
        if (!res.ok)
            return null;
        const data = await res.json();
        return data.display_name ?? null;
    }
    catch {
        return null;
    }
}
// ─── Core extract ─────────────────────────────────────────────────────────────
export async function extractFromBuffer(input, resolveLocation = false) {
    const image = sharp(input);
    const meta = await image.metadata();
    let exif = null;
    if (meta.exif) {
        exif = parseExifBuffer(meta.exif);
    }
    // Reverse geocode GPS if requested
    if (resolveLocation && exif?.gps?.latitude != null && exif?.gps?.longitude != null) {
        const location = await reverseGeocode(exif.gps.latitude, exif.gps.longitude);
        if (location)
            exif.gps.location = location;
    }
    return {
        format: meta.format,
        width: meta.width,
        height: meta.height,
        channels: meta.channels,
        colorspace: meta.space,
        hasAlpha: meta.hasAlpha,
        density: meta.density,
        isProgressive: meta.isProgressive,
        size: input.length,
        exif,
    };
}
export async function extractFromUrl(opts) {
    await assertPublicUrl(opts.image);
    const res = await fetch(opts.image);
    if (!res.ok)
        throw Internal(`Failed to fetch image: ${res.statusText}`);
    const input = Buffer.from(await res.arrayBuffer());
    return extractFromBuffer(input);
}
export const exifService = { extractFromBuffer, extractFromUrl };
//# sourceMappingURL=exif.service.js.map