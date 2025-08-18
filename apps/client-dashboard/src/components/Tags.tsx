import { useEffect, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { QuestionMarkCircleIcon, PlusCircleIcon, TagIcon, XMarkIcon } from '@heroicons/react/24/outline';

/**
 * @typedef {Object} TagsProps
 * @property {string[]} [value]
 * @property {(next: string[]) => void} [onChange]
 * @property {string} [helpText]
 * @property {string} [label]
 * @property {string} [buttonLabel]
 */

/**
 * Self-contained Tags block with collapsible panel, input field, selected chips, and grouped recommended tags.
 * Works controlled (value/onChange) or uncontrolled.
 * @param {TagsProps} props
 */
export default function Tags({
  value,
  onChange,
  helpText = 'Add quick labels customers can filter by.',
  label = 'Tags',
  buttonLabel = 'Add Tags',
}: {
  value?: string[];
  onChange?: (next: string[]) => void;
  helpText?: string;
  label?: string;
  buttonLabel?: string;
}) {
  type Section = { title: string; items: string[] };

  const RECOMMENDED_SECTIONS: Section[] = [
    {
      title: '🍽️ Food Type & Ingredients',
      items: [
        'Vegetarian',
        'Vegan',
        'Non-Veg',
        'Halal',
        'Kosher',
        'Gluten-free',
        'Dairy-free',
        'Nut-free',
        'Egg-free',
        'Sugar-free',
        'Low-carb',
        'High-protein',
        'Organic',
        'Farm-to-table',
        'Seasonal',
        'Locally sourced',
        'Chef’s special',
        'Signature dish',
        'Bestseller',
      ],
    },
    {
      title: '🌶️ Taste & Texture',
      items: [
        'Spicy',
        'Mild',
        'Tangy',
        'Sweet',
        'Sour',
        'Bitter',
        'Savory/Umami',
        'Smoky',
        'Creamy',
        'Crispy',
        'Crunchy',
        'Juicy',
        'Tender',
        'Soft',
        'Chewy',
        'Grilled',
        'Fried',
        'Baked',
        'Steamed',
        'Roasted',
        'Raw',
      ],
    },
    {
      title: '🕒 Occasion & Mood',
      items: [
        'Romantic',
        'For Date Night',
        'Anniversary Special',
        'Family-friendly',
        'Kids-friendly',
        'Party Dish',
        'Quick Bite',
        'Comfort Food',
        'Street Style',
        'Luxury',
        'Budget-friendly',
        'Healthy Choice',
        'Indulgent',
        'Instagrammable',
        'Trendy',
      ],
    },
    {
      title: '🗓️ Time-based Tags',
      items: [
        'Breakfast',
        'Brunch',
        'Lunch',
        'Dinner',
        'Late Night',
        'Snack',
        'Dessert',
        'Tea-time',
        'Coffee-time',
        'Seasonal (Winter Special, Summer Special, etc.)',
        'Festival Special (Christmas, Eid, Diwali, New Year, etc.)',
      ],
    },
    {
      title: '🌍 Cuisine & Origin',
      items: [
        'Italian',
        'Chinese',
        'Indian',
        'Thai',
        'Japanese',
        'Mexican',
        'Mediterranean',
        'Middle Eastern',
        'American',
        'French',
        'Fusion',
        'Traditional',
        'Street Food',
        'Homemade Style',
        'Regional Special (e.g., Bengali, Punjabi, Tex-Mex)',
      ],
    },
    {
      title: '🎉 Special Features',
      items: [
        'Limited Edition',
        'New Arrival',
        'Chef Recommended',
        'Must Try',
        'Bestseller',
        'Combo Meal',
        'Meal Deal',
        'Sharing Platter',
        'Value for Money',
      ],
    },
    {
      title: '🌦️ Weather / Season Vibe',
      items: [
        'Summer Coolers',
        'Winter Warmers',
        'Rainy Day Special',
        'Refreshing',
        'Hot & Hearty',
        'Light & Fresh',
        'Cozy',
      ],
    },
  ];

  const [open, setOpen] = useState(false);
  const [internal, setInternal] = useState<string[]>(value ?? []);
  const [input, setInput] = useState('');

  useEffect(() => {
    if (value) setInternal(value);
  }, [value]);

  const current = value ?? internal;
  const setTags = (next: string[]) => (onChange ? onChange(next) : setInternal(next));
  const norm = (t: string) => t.trim().toLowerCase();
  const hasTag = (t: string) => current.some((x) => norm(x) === norm(t));

  const addFromInput = () => {
    const t = input.trim();
    if (!t) return;
    if (!hasTag(t)) setTags([...current, t]);
    setInput('');
  };

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => setInput(e.target.value);
  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addFromInput();
    }
  };

  const toggleTag = (tag: string) => {
    setTags(hasTag(tag) ? current.filter((t) => norm(t) !== norm(tag)) : [...current, tag]);
  };

  const remove = (tag: string) => setTags(current.filter((t) => norm(t) !== norm(tag)));

  return (
    <section className="text-[#2e2e30]">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 h-5">
          <span className="text-sm font-medium leading-none">{label}</span>
          {helpText && (
            <span className="relative inline-flex items-center align-middle group cursor-pointer">
              <QuestionMarkCircleIcon className="h-4 w-4 text-[#6b7280] group-hover:text-[#374151]" />
              <span
                role="tooltip"
                className="pointer-events-none absolute left-0 top-full mt-1 z-50 w-80 max-w-[22rem] rounded-md border border-[#dbdbdb] bg-[#fcfcfc] text-[#2e2e30] text-xs px-3 py-2 shadow-md opacity-0 translate-y-0 group-hover:opacity-100 group-hover:translate-y-[2px] transition duration-150 ease-out"
              >
                {helpText}
              </span>
            </span>
          )}
        </div>

        {open && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-[#f3f4f6] text-[#6b7280] hover:text-[#374151]"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-md border border-[#dbdbdb] bg-[#fcfcfc] px-3 py-2 text-sm font-medium text-[#2e2e30] hover:border-[#111827] hover:bg-[#f3f4f6] transition-colors"
          aria-expanded={open}
        >
          <PlusCircleIcon className="h-5 w-5" />
          {buttonLabel}
        </button>
      )}

      {open && (
        <div className="mt-2 rounded-md border border-[#dbdbdb] bg-[#fcfcfc] p-3 sm:p-4">
          <div className="relative">
            <TagIcon className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-[#a9a9ab]" />
            <input
              className="w-full border border-[#dbdbdb] rounded-md bg-white px-8 py-2 text-sm text-[#2e2e30] placeholder-[#a9a9ab] hover:border-[#111827] focus:outline-none focus:ring-0 focus:border-[#111827]"
              placeholder="Add a tag and press Enter"
              value={input}
              onChange={onInputChange}
              onKeyDown={onInputKeyDown}
              aria-label="Add tag"
            />
          </div>

          {current.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {current.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full border border-[#dbdbdb] bg-white px-3 py-1.5 text-xs text-[#2e2e30]"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => remove(tag)}
                    className="text-[#6b7280] hover:text-[#374151]"
                    aria-label={`Remove ${tag}`}
                  >
                    <XMarkIcon className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="w-full h-px bg-[#e5e7eb] my-3" />

          <div className="space-y-4">
            {RECOMMENDED_SECTIONS.map((sec) => (
              <div key={sec.title} className="space-y-2">
                <div className="text-xs font-medium text-[#6b7280]">{sec.title}</div>
                <div className="flex flex-wrap gap-2">
                  {sec.items.map((s) => {
                    const selected = hasTag(s);
                    return (
                      <button
                        type="button"
                        key={s}
                        onClick={() => toggleTag(s)}
                        aria-pressed={selected}
                        className={`rounded-full border px-3 py-1.5 text-xs transition ${
                          selected
                            ? 'bg-[#111827] border-[#111827] text-white'
                            : 'bg-white border-[#dbdbdb] text-[#2e2e30] hover:border-[#111827]'
                        }`}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}