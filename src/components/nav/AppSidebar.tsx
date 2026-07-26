import { Link, NavLink } from 'react-router-dom';
import { ArchMark } from '@/components/illustrations/ArchMark';
import { cn } from '@/lib/cn';
import { useAuth } from '@/lib/auth';
import {
  ACCESS_NAV_ITEMS,
  ACCESS_NAV_LABEL,
  ADMIN_NAV_ITEM,
  APP_NAV_ITEMS,
  type NavItem,
} from './items';

function itemClass({ isActive }: { isActive: boolean }) {
  return cn(
    'flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors',
    isActive ? 'bg-ink text-paper' : 'text-ink/70 hover:bg-ink/5 hover:text-ink',
  );
}

function Section({ label, items }: { label: string; items: NavItem[] }) {
  return (
    <div className="mt-6 pt-4 border-t border-ink/10">
      <p className="px-3 mb-1 text-[10px] uppercase tracking-[0.22em] text-ink/40">{label}</p>
      {items.map((it) => (
        <NavLink key={it.to} to={it.to} end={it.end} className={itemClass}>
          {it.label}
        </NavLink>
      ))}
    </div>
  );
}

export function AppSidebar() {
  const { user } = useAuth();
  return (
    <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r border-ink/10 bg-paper-cool/60 px-4 py-6 sticky top-0 h-screen overflow-y-auto">
      <Link to="/" className="flex items-center gap-2 px-2 mb-8 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink">
        <span className="grid h-8 w-8 place-items-center rounded-md bg-ink text-paper">
          <ArchMark className="h-5 w-5" />
        </span>
        <span className="font-display italic text-lg">Aql</span>
      </Link>

      {/* The product: one hub for the physical world. */}
      <nav className="flex flex-col gap-0.5">
        {APP_NAV_ITEMS.map((it) => (
          <NavLink key={it.to} to={it.to} end={it.end} className={itemClass}>
            {it.label}
          </NavLink>
        ))}

        {/* One module of that hub — the one that works end to end today. */}
        <Section label={ACCESS_NAV_LABEL} items={ACCESS_NAV_ITEMS} />

        {user?.is_platform_admin && (
          <div className="mt-6 pt-4 border-t border-ink/10">
            <p className="px-3 mb-1 text-[10px] uppercase tracking-[0.22em] text-ink/40">Operator</p>
            <NavLink to={ADMIN_NAV_ITEM.to} className={itemClass}>
              <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden />
              {ADMIN_NAV_ITEM.label}
            </NavLink>
          </div>
        )}
      </nav>
    </aside>
  );
}
