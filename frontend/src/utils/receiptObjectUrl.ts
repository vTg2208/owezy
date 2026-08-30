export interface ObjectUrlFactory {
  create(blob: Blob): string;
  revoke(url: string): void;
}

const browserObjectUrls: ObjectUrlFactory = {
  create: (blob) => URL.createObjectURL(blob),
  revoke: (url) => URL.revokeObjectURL(url),
};

export class ReceiptObjectUrlLifecycle {
  private generation = 0;
  private controller: AbortController | null = null;
  private activeUrl: string | null = null;
  private disposed = false;

  constructor(private readonly objectUrls: ObjectUrlFactory = browserObjectUrls) {}

  async load(loader: (signal: AbortSignal) => Promise<Blob>): Promise<string | null> {
    if (this.disposed) return null;
    const generation = ++this.generation;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;

    let blob: Blob;
    try {
      blob = await loader(controller.signal);
    } catch (error) {
      if (this.disposed || generation !== this.generation || controller.signal.aborted) return null;
      throw error;
    } finally {
      if (this.controller === controller) this.controller = null;
    }

    const url = this.objectUrls.create(blob);
    if (this.disposed || generation !== this.generation) {
      this.objectUrls.revoke(url);
      return null;
    }
    if (this.activeUrl) this.objectUrls.revoke(this.activeUrl);
    this.activeUrl = url;
    return url;
  }

  close(): void {
    this.generation += 1;
    this.controller?.abort();
    this.controller = null;
    if (this.activeUrl) {
      this.objectUrls.revoke(this.activeUrl);
      this.activeUrl = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.close();
  }
}
