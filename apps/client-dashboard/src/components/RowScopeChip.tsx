import { useScope } from '../context/ScopeContext';

/** Variants for the scope chip when viewing All Branches. */
type ScopeKind = { kind: 'all' } | { kind: 'overridden'; count: number } | { kind: 'hidden-partial' };

/** Badge shown per row only when scope is All Branches. */
export default function RowScopeChip(props: ScopeKind): JSX.Element | null {
  const { branch } = useScope();
  if (branch.mode !== 'all') return null;

  if (props.kind === 'all') {
    return <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">All branches</span>;
  }
  if (props.kind === 'overridden') {
    return <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">Overridden ({props.count})</span>;
  }
  return <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">Hidden in some branches</span>;
}