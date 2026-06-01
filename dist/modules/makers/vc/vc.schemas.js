import { z } from 'zod';
/**
 * VC (Voice Changer)
 * Applies audio effects using FFmpeg.
 */
export const VcQuery = z.object({
    audio: z.string().url().max(2048),
    effect: z.enum([
        'chipmunk',
        'underwater',
        'bass',
        'earrape',
        'slow',
        'fast',
        'reverb',
        'robot',
        'alien',
        'autotune',
    ]).describe('Audio effect to apply'),
    format: z.enum(['mp3', 'ogg', 'wav']).default('mp3'),
});
//# sourceMappingURL=vc.schemas.js.map