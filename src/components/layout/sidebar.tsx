'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import {
  Bell,
  Bot,
  Crown,
  GitBranch,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  Settings,
  Shield,
  User,
  UserCog,
  Users,
  UsersRound,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import type { AccountRole } from '@/lib/auth/roles';
import { useAuth } from '@/hooks/use-auth';
import { useTotalUnread } from '@/hooks/use-total-unread';
import { useUnreadNotifications } from '@/hooks/use-unread-notifications';
import { getEvolutionCapabilities } from '@/lib/whatsapp/evolution/capabilities';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const ROLE_CHIP: Record<
  AccountRole,
  { icon: typeof Crown; labelKey: string; className: string }
> = {
  owner: {
    icon: Crown,
    labelKey: 'roleOwner',
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  },
  admin: {
    icon: Shield,
    labelKey: 'roleAdmin',
    className: 'border-primary/40 bg-primary/10 text-primary',
  },
  agent: {
    icon: UserCog,
    labelKey: 'roleAgent',
    className: 'border-border bg-muted text-foreground',
  },
  viewer: {
    icon: User,
    labelKey: 'roleViewer',
    className: 'border-border bg-card text-muted-foreground',
  },
};

interface NavItem {
  href: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  beta?: boolean;
}

const navItems: NavItem[] = [
  { href: '/dashboard', labelKey: 'dashboard', icon: LayoutDashboard },
  { href: '/inbox', labelKey: 'inbox', icon: MessageSquare },
  { href: '/notifications', labelKey: 'notifications', icon: Bell },
  { href: '/contacts', labelKey: 'contacts', icon: Users },
  { href: '/pipelines', labelKey: 'pipelines', icon: GitBranch },
  { href: '/broadcasts', labelKey: 'broadcasts', icon: Radio },
  { href: '/automations', labelKey: 'automations', icon: Zap },
  { href: '/flows', labelKey: 'flows', icon: Workflow, beta: true },
  { href: '/agents', labelKey: 'aiAgents', icon: Bot },
];

const bottomNavItems: NavItem[] = [
  { href: '/settings', labelKey: 'settings', icon: Settings },
];

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  isMobile?: boolean;
}

export function Sidebar({
  open = false,
  onClose,
  collapsed = false,
  onToggleCollapse,
  isMobile = false,
}: SidebarProps) {
  const t = useTranslations('Sidebar');
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const drawerRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { profile, profileLoading, account, accountRole, signOut } = useAuth();
  const totalUnread = useTotalUnread();
  const unreadNotifications = useUnreadNotifications();
  const capabilities = getEvolutionCapabilities();

  const showAccountStrip =
    !profileLoading && !!account?.name && account.name !== profile?.full_name;
  const initial =
    profile?.full_name?.charAt(0)?.toUpperCase() ??
    profile?.email?.charAt(0)?.toUpperCase() ??
    'U';
  const roleMeta = accountRole ? ROLE_CHIP[accountRole] : null;
  const RoleIcon = roleMeta?.icon;
  const userName = profile?.full_name ?? t('defaultUser');
  const accountContext = account?.name
    ? `${account.name}${accountRole ? ` · ${t(roleMeta!.labelKey)}` : ''}`
    : userName;

  useEffect(() => {
    onClose?.();
    // The callback intentionally does not make this route-only effect rerun.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!open || !isMobile) return;

    const pathAtOpen = pathnameRef.current;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => closeButtonRef.current?.focus());

    const getFocusableItems = () => {
      const selector =
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';
      const drawerItems = Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(selector) ?? []
      );
      const menuItems = Array.from(
        document.querySelectorAll<HTMLElement>(
          `[data-slot="dropdown-menu-content"] ${selector}`
        )
      ).filter((element) => element.getClientRects().length > 0);
      return [...drawerItems, ...menuItems];
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const inAccountMenu =
        event.target instanceof Element &&
        !!event.target.closest('[data-slot="dropdown-menu-content"]');

      if (event.key === 'Escape' && !inAccountMenu) {
        event.preventDefault();
        onClose?.();
        return;
      }

      if (event.key !== 'Tab') return;
      const items = getFocusableItems();
      if (items.length === 0) {
        event.preventDefault();
        closeButtonRef.current?.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const insideDrawer = drawerRef.current?.contains(target);
      const insideAccountMenu =
        target instanceof Element &&
        !!target.closest('[data-slot="dropdown-menu-content"]');
      if (!insideDrawer && !insideAccountMenu) {
        closeButtonRef.current?.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      if (pathnameRef.current === pathAtOpen) {
        requestAnimationFrame(() => previousFocus?.focus());
      }
    };
  }, [open, isMobile, onClose]);

  const renderNavItem = (item: NavItem) => {
    const label = t(item.labelKey);
    const isActive =
      pathname === item.href ||
      (item.href !== '/dashboard' && pathname.startsWith(item.href));
    const showUnreadDot =
      item.href === '/inbox' && totalUnread > 0 && !isActive;
    const showNotificationBadge =
      item.href === '/notifications' && unreadNotifications > 0;

    return (
      <li key={item.href}>
        <Link
          href={item.href}
          aria-label={label}
          aria-current={isActive ? 'page' : undefined}
          title={!isMobile && collapsed ? label : undefined}
          onClick={isMobile ? onClose : undefined}
          className={cn(
            'sis-shell__nav-link',
            isActive
              ? 'sis-shell__nav-link--active'
              : 'sis-shell__nav-link--idle'
          )}
        >
          <item.icon aria-hidden="true" className="sis-shell__nav-icon" />
          <span className="sis-shell__nav-label">{label}</span>
          {item.beta && (
            <span className="sis-shell__beta" aria-label={t('beta')}>
              {t('beta')}
            </span>
          )}
          {showUnreadDot && (
            <span
              className="sis-shell__unread-dot"
              aria-label={t('unreadConversations', { count: totalUnread })}
              title={t('unreadConversations', { count: totalUnread })}
            >
              <span aria-hidden="true" />
            </span>
          )}
          {showNotificationBadge && (
            <span
              className="sis-shell__count"
              aria-label={t('unreadNotifications', {
                count: unreadNotifications,
              })}
              title={t('unreadNotifications', { count: unreadNotifications })}
            >
              {unreadNotifications > 9 ? '9+' : unreadNotifications}
            </span>
          )}
        </Link>
      </li>
    );
  };

  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        aria-label={t('closeMenu')}
        onClick={onClose}
        className={cn(
          'sis-shell__backdrop',
          open && isMobile && 'sis-shell__backdrop--open'
        )}
      />

      <aside
        ref={drawerRef}
        id="primary-navigation"
        aria-label={t('primaryNav')}
        aria-modal={open && isMobile ? true : undefined}
        role={open && isMobile ? 'dialog' : undefined}
        inert={isMobile && !open}
        data-open={open}
        data-collapsed={collapsed}
        className="sis-shell__rail"
      >
        <div className="sis-shell__brand-row">
          <Link
            href="/dashboard"
            aria-label={t('title')}
            title={t('title')}
            className="sis-shell__brand-link"
          >
            <span className="sis-shell__brand-mark" aria-hidden="true">
              <MessageSquare className="size-4" />
            </span>
            <span className="sis-shell__brand-name">WACRM</span>
          </Link>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={t('closeMenu')}
            className="sis-shell__icon-button sis-shell__mobile-close"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? t('expandNav') : t('collapseNav')}
            title={collapsed ? t('expandNav') : t('collapseNav')}
            aria-controls="primary-navigation"
            aria-expanded={!collapsed}
            className="sis-shell__icon-button sis-shell__collapse-toggle"
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden="true" className="size-4" />
            ) : (
              <PanelLeftClose aria-hidden="true" className="size-4" />
            )}
          </button>
        </div>

        <nav className="sis-shell__nav" aria-label={t('primaryNav')}>
          <ul className="sis-shell__nav-list">
            {navItems
              .filter(
                (item) => item.href !== '/broadcasts' || capabilities.broadcasts
              )
              .map(renderNavItem)}
          </ul>
          <div className="sis-shell__divider" />
          <ul className="sis-shell__nav-list">
            {bottomNavItems.map(renderNavItem)}
          </ul>
        </nav>

        <div className="sis-shell__account">
          {showAccountStrip && account?.name ? (
            <div
              className="sis-shell__account-context"
              title={accountContext}
              aria-label={accountContext}
            >
              <UsersRound aria-hidden="true" className="size-4 shrink-0" />
              <span className="sis-shell__account-name">{account.name}</span>
              {roleMeta && RoleIcon ? (
                <span className={`sis-shell__role-chip ${roleMeta.className}`}>
                  <RoleIcon aria-hidden="true" className="size-3" />
                  {t(roleMeta.labelKey)}
                </span>
              ) : null}
            </div>
          ) : null}

          {collapsed && accountRole && roleMeta && RoleIcon ? (
            <div
              className="sis-shell__compact-role"
              title={t(roleMeta.labelKey)}
              aria-label={t(roleMeta.labelKey)}
            >
              <RoleIcon aria-hidden="true" className="size-4" />
            </div>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t('accountMenu', { name: accountContext })}
              title={accountContext}
              className="sis-shell__profile-trigger"
            >
              <Avatar className="size-9 shrink-0">
                {profile?.avatar_url ? (
                  <AvatarImage
                    src={profile.avatar_url}
                    alt={profile.full_name ?? t('defaultAvatar')}
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                  {initial}
                </AvatarFallback>
              </Avatar>
              <span className="sis-shell__profile-copy">
                <span className="sis-shell__profile-name">
                  {profile?.full_name ?? t('defaultUser')}
                </span>
                <span className="sis-shell__profile-email">
                  {profile?.email ?? ''}
                </span>
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="top"
              sideOffset={6}
              className="bg-popover text-popover-foreground ring-border min-w-56"
            >
              <div className="px-2 py-1.5">
                <p className="text-foreground truncate text-sm font-medium">
                  {profile?.full_name ?? t('defaultUser')}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {profile?.email ?? ''}
                </p>
              </div>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=profile"
                    onClick={isMobile ? onClose : undefined}
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <User className="size-4" />
                {t('menuProfile')}
              </DropdownMenuItem>
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=whatsapp"
                    onClick={isMobile ? onClose : undefined}
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <Settings className="size-4" />
                {t('menuSettings')}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                onClick={signOut}
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              >
                <LogOut className="size-4" />
                {t('menuSignOut')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </>
  );
}
