// Re-encoding raster uploads. Decoding and re-encoding throws away anything that is not pixels (EXIF/GPS metadata,
// trailing payloads, polyglot tricks) and caps the size. Node has no image codec, so this uses `sharp` (libvips),
// an optional dependency: the one native module the server needs. Without it, raster uploads are refused unless
// the operator sets media.reencode = false (documented as weaker in SECURITY.md).

const OUTPUT = {
  'image/jpeg': (img) => img.jpeg({ quality: 82, mozjpeg: true }),
  'image/png': (img) => img.png({ compressionLevel: 9 }),
  'image/webp': (img) => img.webp({ quality: 82 }),
  'image/avif': (img) => img.avif({ quality: 60 }),
  'image/gif': (img) => img.gif(),
};

/** A codec backed by sharp, or null when sharp is not installed. */
export async function loadSharpCodec(specifier = 'sharp') {
  let sharp;
  try {
    sharp = (await import(specifier)).default;
  } catch {
    return null;
  }
  return {
    name: 'sharp',
    /**
     * Decode, auto-rotate, cap the longest side, re-encode in the same format (or `as`: a phone's HEIC photo becomes
     * a JPEG, when this sharp build can read HEIC at all). Metadata is not copied.
     */
    async reencode(buf, { type, maxSide, as = type }) {
      const animated = type === 'image/gif' || type === 'image/webp';
      let img = sharp(buf, { failOn: 'error', limitInputPixels: 50_000_000, animated }).rotate();
      img = img.resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true });
      const { data, info } = await OUTPUT[as](img).toBuffer({ resolveWithObject: true });
      return { buffer: data, type: as, width: info.width, height: info.pageHeight ?? info.height };
    },
  };
}
