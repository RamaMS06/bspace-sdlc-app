import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { Select } from '@/shared/ui/primitives/select';

describe('Select', () => {
  it('is a real dropdown with the browser look turned off and the field look on', async () => {
    const onChange = vi.fn();
    render(
      <Select aria-label="Role" defaultValue="a" onChange={(e) => onChange(e.target.value)}>
        <option value="a">One</option>
        <option value="b">Two</option>
      </Select>,
    );
    const el = screen.getByRole('combobox', { name: 'Role' });
    // No glossy native look, no white fill: transparent with the field border like Input.
    expect(el).toHaveClass('appearance-none', 'bg-transparent', 'border-input');
    await userEvent.selectOptions(el, 'b');
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('sm is the tight height and the wrapper takes the layout class', () => {
    const { container } = render(
      <Select size="sm" aria-label="x" className="flex-1">
        <option>One</option>
      </Select>,
    );
    expect(screen.getByRole('combobox')).toHaveClass('h-8');
    expect(container.querySelector('[data-slot="select"]')).toHaveClass('flex-1');
  });
});
