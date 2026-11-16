'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import '@/components/layout/sis-shell.css';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { AccountAccessAlert } from '@/components/layout/account-access-alert';
import { PresenceHeartbeat } from '@/components/presence/presence-heartbeat';
import { BrowserNotificationsListener } from '@/components/notifications/browser-notifications-listener';

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations('DashboardShell');
  const headerT = useTranslations('Header');

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [compactViewport, setCompactViewport] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const previousPath = useRef(pathname);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    const mobileQuery = window.matchMedia('(max-width: 767px)');
    const compactQuery = window.matchMedia('(max-width: 1279px)');
    const updateViewports = () => {
      setIsMobile(mobileQuery.matches);
      setCompactViewport(compactQuery.matches);
      if (!mobileQuery.matches) setSidebarOpen(false);
    };

    updateViewports();
    mobileQuery.addEventListener('change', updateViewports);
    compactQuery.addEventListener('change', updateViewports);
    return () => {
      mobileQuery.removeEventListener('change', updateViewports);
      compactQuery.removeEventListener('change', updateViewports);
    };
  }, []);

  useEffect(() => {
    if (previousPath.current !== pathname) {
      previousPath.current = pathname;
      mainRef.current?.focus({ preventScroll: true });
    }
  }, [pathname]);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="bg-background flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="border-primary h-8 w-8 animate-spin rounded-full border-2 border-t-transparent" />
          <p className="text-muted-foreground text-sm">{t('loading')}</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="sis-shell">
      {/* Reports this tab's online/away presence once we know a user is
          signed in. Headless — renders nothing. */}
      <PresenceHeartbeat />
      {/* Desktop alerts for new customer messages (opt-in via Settings →
          Your profile). Headless — renders nothing. */}
      <BrowserNotificationsListener />
      <a
        href="#main-content"
        tabIndex={sidebarOpen && isMobile ? -1 : undefined}
        aria-hidden={sidebarOpen && isMobile ? true : undefined}
        className="sis-shell__skip-link"
      >
        {headerT('skipToContent')}
      </a>
      <Sidebar
        open={sidebarOpen}
        onClose={closeSidebar}
        collapsed={compactViewport || railCollapsed}
        onToggleCollapse={() => setRailCollapsed((value) => !value)}
        isMobile={isMobile}
      />
      <div
        className="sis-shell__content"
        inert={sidebarOpen && isMobile ? true : undefined}
      >
        <Header onOpenSidebar={() => setSidebarOpen(true)} />
        <main
          ref={mainRef}
          id="main-content"
          tabIndex={-1}
          className="sis-shell__main"
        >
          {pathname === '/inbox' ? (
            <h1 className="sr-only">{headerT('inbox')}</h1>
          ) : null}
          {/* Above every page: writes are being rejected and here's why.
              Renders nothing unless the account/role failed to resolve. */}
          <AccountAccessAlert />
          {children}
        </main>
      </div>
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DashboardShellInner>{children}</DashboardShellInner>
    </AuthProvider>
  );
}
