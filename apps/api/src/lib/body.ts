/**
 * The request's body, or null past `max` bytes. Read off the stream with a running count, so a
 * body that lies about its length is still cut off.
 */
export async function readBounded(req: Request, max: number) {
  if (Number(req.headers.get("content-length") ?? 0) > max) {
    return null;
  }
  if (!req.body) {
    return Buffer.alloc(0);
  }
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const read = await reader.read();
    if (read.done) {
      break;
    }
    const chunk: unknown = read.value;
    if (!(chunk instanceof Uint8Array)) {
      throw new TypeError("A request body chunk wasn't bytes");
    }
    size += chunk.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
