import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import ImageUploadZone from '../../../components/add-product-drawer/ImageUploadZone';

type UploadResponse = {
  ok: boolean;
  key: string;
  hash: string;
  mime: string;
  size: number;
  cdn: { original: string; thumbnail: string; medium: string; large: string };
};

const successResponse: UploadResponse = {
  ok: true,
  key: 'abc123',
  hash: 'deadbeef',
  mime: 'image/jpeg',
  size: 123456,
  cdn: {
    original: 'https://ik.imagekit.io/demo/original.jpg',
    thumbnail: 'https://ik.imagekit.io/demo/thumbnail.jpg',
    medium: 'https://ik.imagekit.io/demo/medium.jpg',
    large: 'https://ik.imagekit.io/demo/large.jpg',
  },
};

const origCreate = URL.createObjectURL as any;
const origRevoke = URL.revokeObjectURL as any;
let OriginalXHR: typeof XMLHttpRequest;

let lastHeaders: Record<string, string> = {};

class MockXHRSuccess {
  readyState = 0;
  status = 0;
  responseText = '';
  onreadystatechange: (() => void) | null = null;
  onerror: (() => void) | null = null;
  upload: { onprogress: ((evt: any) => void) | null } = { onprogress: null };
  private aborted = false;

  open(_method: string, _url: string) {
    // noop
  }
  setRequestHeader(key: string, val: string) {
    lastHeaders[key.toLowerCase()] = val;
  }
  send(_body: FormData) {
    setTimeout(() => {
      if (this.aborted) return;
      this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
    }, 10);
    setTimeout(() => {
      if (this.aborted) return;
      this.status = 200;
      this.responseText = JSON.stringify(successResponse);
      this.readyState = 4;
      this.onreadystatechange?.();
    }, 30);
  }
  abort() {
    this.aborted = true;
  }
}

function renderZone(overrides?: Partial<React.ComponentProps<typeof ImageUploadZone>>) {
  const onPick = vi.fn();
  const onClear = vi.fn();
  const onUploaded = vi.fn();

  const utils = render(
    <ImageUploadZone
      preview={null}
      onPick={onPick}
      onClear={onClear}
      onUploaded={onUploaded}
      uploadUrl="/api/uploads/images"
      authToken="test-token"
      maxSizeMB={20}
      accept="image/jpeg,image/png,image/webp,image/avif,.jpg,.jpeg,.png,.webp,.avif"
      {...overrides}
    />
  );

  const input = utils.container.querySelector('input[type="file"]') as HTMLInputElement;
  return { ...utils, input, onPick, onClear, onUploaded };
}

describe('ImageUploadZone', () => {
  beforeAll(() => {
    (URL as any).createObjectURL = vi.fn(() => 'blob:preview-url');
    (URL as any).revokeObjectURL = vi.fn();
  });

  afterAll(() => {
    (URL as any).createObjectURL = origCreate;
    (URL as any).revokeObjectURL = origRevoke;
  });

  beforeEach(() => {
    lastHeaders = {};
    OriginalXHR = globalThis.XMLHttpRequest;
    (globalThis as any).XMLHttpRequest = MockXHRSuccess;
  });

  afterEach(() => {
    (globalThis as any).XMLHttpRequest = OriginalXHR;
  });

  it('uploads successfully and swaps blob preview to the CDN URL (ImageKit)', async () => {
    const { input, onPick, onUploaded } = renderZone();

    const file = new File([new Uint8Array(1024)], 'photo.jpg', { type: 'image/jpeg' });
    await userEvent.upload(input, file);

    expect(onPick).toHaveBeenCalledTimes(1);
    const [pickedFile, blobUrl] = onPick.mock.calls[0];
    expect(pickedFile).toBe(file);
    expect(blobUrl).toBe('blob:preview-url');

    const img = await screen.findByAltText('Selected preview');
    expect(img).toHaveAttribute('src', 'blob:preview-url');

    expect(lastHeaders['authorization']).toBe('Bearer test-token');

    await vi.waitFor(() => {
      expect(onUploaded).toHaveBeenCalledTimes(1);
      expect(img).toHaveAttribute('src', 'https://ik.imagekit.io/demo/medium.jpg');
    });
  });

  it('shows type error for unsupported file', async () => {
    const { input } = renderZone();

    const badFile = new File([new Uint8Array(100)], 'notes.txt', { type: 'text/plain' });
    // Important: bypass the accept filter so change event fires
    await userEvent.upload(input, badFile, { applyAccept: false });

    // Your component renders a <p role="alert"> with plain error text
    expect(await screen.findByText(/notes\.txt is not a supported type/i)).toBeInTheDocument();
    expect(screen.queryByAltText(/selected preview/i)).not.toBeInTheDocument();
  });

  it('shows size error when file exceeds 20MB', async () => {
    const { input } = renderZone();
    const size = 21 * 1024 * 1024; // ~21MB
    const big = new File([new Uint8Array(size)], 'big.jpg', { type: 'image/jpeg' });
    await userEvent.upload(input, big);

    expect(await screen.findByText(/big\.jpg exceeds 20MB/i)).toBeInTheDocument();
  });

  it('Remove clears the preview and calls onClear', async () => {
    const { input, onClear } = renderZone();

    const file = new File([new Uint8Array(1024)], 'photo.jpg', { type: 'image/jpeg' });
    await userEvent.upload(input, file);

    const img = await screen.findByAltText('Selected preview');
    await vi.waitFor(() => {
      expect(img).toHaveAttribute('src', 'https://ik.imagekit.io/demo/medium.jpg');
    });

    await userEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.queryByAltText('Selected preview')).not.toBeInTheDocument();
  });
});