import { Zip, ZipPassThrough } from "fflate";

function abortError(): DOMException {
  return new DOMException("导出已取消", "AbortError");
}

/** Incrementally stores uncompressed ZIP entries without materializing every file as Uint8Array. */
export class StreamingZipBuilder {
  private readonly zip: Zip;
  private readonly parts: Blob[] = [];
  private readonly pendingParts: Uint8Array<ArrayBuffer>[] = [];
  private pendingBytes = 0;
  private readonly completed: Promise<Blob>;
  private resolveCompleted!: (blob: Blob) => void;
  private rejectCompleted!: (error: Error) => void;
  private failed?: Error;
  private ended = false;

  constructor() {
    this.completed = new Promise<Blob>((resolve, reject) => {
      this.resolveCompleted = resolve;
      this.rejectCompleted = reject;
    });
    void this.completed.catch(() => undefined);
    this.zip = new Zip((error, chunk, final) => {
      if (error) {
        this.fail(error);
        return;
      }
      if (chunk?.length) {
        this.pendingParts.push(chunk as Uint8Array<ArrayBuffer>);
        this.pendingBytes += chunk.length;
        if (this.pendingBytes >= 4 * 1024 ** 2) this.flushPendingParts();
      }
      if (final) {
        this.flushPendingParts();
        this.resolveCompleted(new Blob(this.parts, { type: "application/zip" }));
      }
    });
  }

  private flushPendingParts(): void {
    if (!this.pendingParts.length) return;
    this.parts.push(new Blob(this.pendingParts));
    this.pendingParts.length = 0;
    this.pendingBytes = 0;
  }

  private fail(error: unknown): void {
    if (this.failed) return;
    this.failed = error instanceof Error ? error : new Error(String(error));
    this.zip.terminate();
    this.rejectCompleted(this.failed);
  }

  async add(name: string, blob: Blob, signal?: AbortSignal): Promise<void> {
    if (this.ended) throw new Error("ZIP 已结束，不能继续添加文件");
    if (this.failed) throw this.failed;
    if (signal?.aborted) throw abortError();
    const entry = new ZipPassThrough(name);
    this.zip.add(entry);
    const reader = blob.stream().getReader();
    try {
      for (;;) {
        if (signal?.aborted) throw abortError();
        const { value, done } = await reader.read();
        if (done) break;
        if (value?.length) entry.push(value);
      }
      entry.push(new Uint8Array(0), true);
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      this.fail(error);
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  async finish(): Promise<Blob> {
    if (this.failed) throw this.failed;
    if (!this.ended) {
      this.ended = true;
      this.zip.end();
    }
    return this.completed;
  }
}
