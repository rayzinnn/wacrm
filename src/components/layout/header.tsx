'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Building2,
  LogOut,
  Menu,
  Settings as SettingsIcon,
  User,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ModeToggle } from '@/components/layout/mode-toggle';

const pageTitles: Record<string, string> = {
  '/dashboard': 'dashboard',
  '/inbox': 'inbox',
  '/notifications': 'notifications',
  '/contacts': 'contacts',
  '/pipelines': 'pipelines',
  '/broadcasts': 'broadcasts',
  '/automations': 'automations',
  '/flows': 'flows',
  '/agents': 'aiAgents',
  '/settings': 'settings',
};

function getPageTitleKey(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  const parentPath = Object.keys(pageTitles)
    .filter((path) => pathname.startsWith(`${path}/`))
    .sort((a, b) => b.length - a.length)[0];
  return parentPath ? pageTitles[parentPath] : 'dashboard';
}

interface HeaderProps {
  onOpenSidebar?: () => void;
}

export function Header({ onOpenSidebar }: HeaderProps) {
  const t = useTranslations('Header');
  const sidebarT = useTranslations('Sidebar');
  const pathname = usePathname();
  const { profile, account, accountRole, signOut } = useAuth();
  const titleKey = getPageTitleKey(pathname);
  const roleKey = accountRole
    ? `role${accountRole[0].toUpperCase()}${accountRole.slice(1)}`
    : null;
  const userName = profile?.full_name ?? t('defaultUser');
  const accountContext = account?.name
    ? `${account.name}${roleKey ? ` · ${sidebarT(roleKey)}` : ''}`
    : '';
  const initial =
    profile?.full_name?.charAt(0)?.toUpperCase() ??
    profile?.email?.charAt(0)?.toUpperCase() ??
    'U';

  return (
    <header className="sis-shell__topbar">
      <div className="sis-shell__header-left">
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label={t('openMenu')}
          aria-controls="primary-navigation"
          className="sis-shell__menu-trigger"
        >
          <Menu aria-hidden="true" className="size-5" />
        </button>
        <div className="sis-shell__header-page">
          <p className="sis-shell__page-context">{t(titleKey as string)}</p>
          {accountContext ? (
            <p className="sis-shell__workspace-context" title={accountContext}>
              <Building2 aria-hidden="true" className="size-3.5 shrink-0" />
              <span>{accountContext}</span>
            </p>
          ) : null}
        </div>
      </div>

      <div className="sis-shell__header-actions">
        <ModeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t('openAccountMenu')}
            className="sis-shell__header-profile"
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
            <span className="sis-shell__header-profile-name">{userName}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={6}
            className="bg-popover text-popover-foreground ring-border min-w-56"
          >
            <div className="px-2 py-1.5">
              <p className="text-foreground truncate text-sm font-medium">
                {userName}
              </p>
              <p className="text-muted-foreground truncate text-xs">
                {profile?.email ?? ''}
              </p>
              {accountContext ? (
                <p className="text-muted-foreground mt-1 truncate text-xs">
                  {accountContext}
                </p>
              ) : null}
            </div>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              render={
                <Link
                  href="/settings?tab=profile"
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
                  className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                />
              }
            >
              <SettingsIcon className="size-4" />
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
    </header>
  );
}
