import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import type { Category } from '../../api/categories';

const COLORS = ['#6366f1', '#ec4899', '#22c55e', '#f59e0b', '#06b6d4'];

export default function CategoryDistribution({ categories }: { categories: Category[] }) {
  // Mock counts per category (later replace with backend stats!)
  const data = categories.map((c, i) => ({
    name: c.name,
    value: Math.floor(Math.random() * 50) + 5, // dummy numbers
    color: COLORS[i % COLORS.length],
  }));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-4 text-base font-semibold text-slate-800">Category Distribution</h3>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={100}
              label
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}