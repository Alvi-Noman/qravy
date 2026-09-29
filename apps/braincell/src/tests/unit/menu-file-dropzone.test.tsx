import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MenuFileDropzone, { MAX_PHOTOS } from '../../components/menu-import/MenuFileDropzone';

beforeAll(() => {
  // jsdom has no object URLs
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:test/${n++}`);
  URL.revokeObjectURL = vi.fn();
});

const pdf = (name = 'menu.pdf') => new File(['%PDF-1.7'], name, { type: 'application/pdf' });
const jpg = (name: string) => new File(['x'], name, { type: 'image/jpeg' });

function drop(files: File[]) {
  const zone = screen.getByText(/Drop your menu PDF or photos here|Add more photos/).closest('button')!;
  fireEvent.drop(zone, { dataTransfer: { files } });
}

describe('<MenuFileDropzone />', () => {
  it('uploads a single PDF straight away', () => {
    const onSubmit = vi.fn();
    render(<MenuFileDropzone onSubmit={onSubmit} />);
    drop([pdf()]);
    expect(onSubmit).toHaveBeenCalledWith([expect.objectContaining({ name: 'menu.pdf' })]);
  });

  it('refuses PDFs mixed with photos', () => {
    const onSubmit = vi.fn();
    render(<MenuFileDropzone onSubmit={onSubmit} />);
    drop([pdf(), jpg('p1.jpg')]);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/one PDF on its own/)).toBeTruthy();
  });

  it('lets the owner order photos before reading them', async () => {
    const onSubmit = vi.fn();
    render(<MenuFileDropzone onSubmit={onSubmit} />);
    drop([jpg('page-a.jpg'), jpg('page-b.jpg')]);

    await screen.findByText('Read menu (2 photos)');
    // move page-b before page-a
    fireEvent.click(screen.getAllByLabelText('Move earlier')[1]);
    fireEvent.click(screen.getByText('Read menu (2 photos)'));
    expect(onSubmit.mock.calls[0][0].map((f: File) => f.name)).toEqual(['page-b.jpg', 'page-a.jpg']);
  });

  it('reverses the whole photo order in one click', async () => {
    const onSubmit = vi.fn();
    render(<MenuFileDropzone onSubmit={onSubmit} />);
    drop([jpg('1.jpg'), jpg('2.jpg'), jpg('3.jpg'), jpg('4.jpg')]);

    fireEvent.click(await screen.findByText('Reverse order'));
    fireEvent.click(screen.getByText('Read menu (4 photos)'));
    expect(onSubmit.mock.calls[0][0].map((f: File) => f.name)).toEqual(['4.jpg', '3.jpg', '2.jpg', '1.jpg']);
  });

  it('hides "Reverse order" when there is only one photo', async () => {
    render(<MenuFileDropzone onSubmit={vi.fn()} />);
    drop([jpg('only.jpg')]);
    await screen.findByText('Read menu (1 photo)');
    expect(screen.queryByText('Reverse order')).toBeNull();
  });

  it(`limits photos to ${MAX_PHOTOS}`, async () => {
    render(<MenuFileDropzone onSubmit={vi.fn()} />);
    drop(Array.from({ length: MAX_PHOTOS + 1 }, (_, i) => jpg(`p${i}.jpg`)));
    await waitFor(() => expect(screen.getByText(/up to 10 photos\. For longer menus/)).toBeTruthy());
  });

  it('rejects unsupported files', () => {
    render(<MenuFileDropzone onSubmit={vi.fn()} />);
    drop([new File(['x'], 'menu.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })]);
    expect(screen.getByText(/"menu\.docx" isn’t supported/)).toBeTruthy();
  });
});
