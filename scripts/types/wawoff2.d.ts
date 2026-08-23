declare module "wawoff2" {
  /** Decompress a WOFF2 file into raw TTF/OTF bytes. */
  export function decompress(data: Uint8Array): Promise<Uint8Array>;
  /** Compress raw TTF/OTF bytes into WOFF2. */
  export function compress(data: Uint8Array): Promise<Uint8Array>;
}
