import type { ReactElement, ReactNode } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter, type MemoryRouterProps } from 'react-router-dom';

type Options = {
  route?: string;
  router?: Partial<MemoryRouterProps>;
  wrapper?: React.ComponentType<{ children: ReactNode }>;
};

export function renderWithRouter(ui: ReactElement, options: Options = {}): RenderResult {
  const { route = '/', router, wrapper: Wrapper } = options;

  const content = (
    <MemoryRouter initialEntries={[route]} {...router}>
      {ui}
    </MemoryRouter>
  );

  return Wrapper ? render(<Wrapper>{content}</Wrapper>) : render(content);
}