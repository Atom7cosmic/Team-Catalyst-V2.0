'use client';
import { usePathname } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';

const NO_DASHBOARD_ROUTES = [
  '/', 
  '/login', 
  '/forgot-password', 
  '/reset-password', 
  '/onboarding', 
  '/pricing', 
  '/product', 
  '/resources', 
  '/enterprise', 
  '/features'
];

export default function ClientLayoutWrapper({ children }) {
  const pathname = usePathname();
  
  // If the path is exact match to a no-dashboard route, don't show the dashboard layout
  // Additionally, meeting room /meeting/[id] usually occupies the full screen, 
  // but DashboardLayout has headers and sidebars. Let's check what it should be.
  // Wait, MeetingRoom has fixed inset-0 z-[100] so it will overlay everything anyway!
  
  // Check if pathname is a meeting room route
  const isMeetingRoom = pathname?.match(/^\/meetings\/[^/]+\/room$/);
  
  if (NO_DASHBOARD_ROUTES.includes(pathname) || isMeetingRoom) {
    return <>{children}</>;
  }

  // DashboardLayout will now persist exactly once without remounting!
  return <DashboardLayout>{children}</DashboardLayout>;
}
