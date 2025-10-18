import { render, screen } from '@testing-library/react';
import Logo from '../../components/Logo';

describe('Logo', () => {
  it('renders an accessible logo', () => {
    render(<Logo />);
    expect(screen.getByRole('img', { name: /logo/i })).toBeInTheDocument();
  });
});