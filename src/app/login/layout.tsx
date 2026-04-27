import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Login — AdPilot',
};

/**
 * Login layout — intentionally NO Sidebar.
 * This layout wraps ONLY the /login route.
 */
export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
