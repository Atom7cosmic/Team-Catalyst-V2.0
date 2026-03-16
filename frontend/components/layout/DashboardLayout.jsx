'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'
import useAuthStore from '@/store/authStore'
import useNotificationStore from '@/store/notificationStore'
import {
  LayoutDashboard,
  Users,
  Calendar,
  CheckSquare,
  BarChart3,
  Bell,
  Settings,
  LogOut,
  Menu,
  X,
  Shield,
  ChevronDown,
  Database,
  FileText,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import toast from 'react-hot-toast'

// ── Nav for regular users (superiors + subordinates) ──────────────────────────
const userNavigation = [
  { name: 'Dashboard',       href: '/dashboard',         icon: LayoutDashboard },
  { name: 'Team',            href: '/team',               icon: Users },
  { name: 'Meetings',        href: '/meetings/history',   icon: Calendar },
  { name: 'Tasks',           href: '/tasks',              icon: CheckSquare },
  { name: 'Sprints',         href: '/sprints',            icon: BarChart3 },
  { name: 'Recommendations', href: '/recommendations',    icon: Users },
  { name: 'Notifications',   href: '/notifications',      icon: Bell },
]

// ── Nav for admin only ────────────────────────────────────────────────────────
const adminNavigation = [
  { name: 'Dashboard',       href: '/dashboard',          icon: LayoutDashboard },
  { name: 'Admin Users',     href: '/admin/users',        icon: Users },
  { name: 'Prompt Templates',href: '/admin/prompts',      icon: FileText },
  { name: 'System',          href: '/admin/system',       icon: Database },
  { name: 'Audit Logs',      href: '/audit',              icon: Shield },
  { name: 'Notifications',   href: '/notifications',      icon: Bell },
]

export default function DashboardLayout({ children }) {
  const pathname = usePathname()
  const { user, logout } = useAuthStore()
  const { isAdmin } = useAuth()
  const { unreadCount, fetchNotifications } = useNotificationStore()

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  useEffect(() => {
    fetchNotifications(50)
  }, [fetchNotifications])

  const handleLogout = async () => {
    await logout()
    toast.success('Logged out successfully')
    window.location.href = '/login'
  }

  // Admin gets a completely different nav — no team/meetings/tasks/sprints/recommendations
  const navItems = isAdmin ? adminNavigation : userNavigation

  const SidebarNav = ({ onClose }) => (
    <nav className="flex-1 px-4 py-4 space-y-1">
      {navItems.map((item) => (
        <Link
          key={item.name}
          href={item.href}
          onClick={onClose}
          className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
            pathname === item.href
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          }`}
        >
          <item.icon className="h-5 w-5" />
          {item.name}
        </Link>
      ))}
    </nav>
  )

  return (
    <div className="min-h-screen bg-background text-foreground">

      {/* Mobile Sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 w-64 bg-card border-r border-border flex flex-col">
            <div className="flex h-16 items-center justify-between px-4 border-b border-border">
              <Link href="/dashboard" className="text-xl font-bold gradient-text">
                OrgOS
              </Link>
              <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)}>
                <X className="h-6 w-6" />
              </Button>
            </div>
            <SidebarNav onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      {/* Desktop Sidebar */}
      <div className="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-64 lg:flex-col bg-card border-r border-border">
        <div className="flex h-16 items-center px-6 border-b border-border">
          <Link href="/dashboard" className="text-xl font-bold gradient-text">
            OrgOS
          </Link>
        </div>
        <SidebarNav onClose={() => {}} />
      </div>

      {/* Main Content */}
      <div className="lg:pl-64">

        {/* Header */}
        <header className="sticky top-0 z-40 bg-background/80 backdrop-blur border-b border-border">
          <div className="flex h-16 items-center justify-between px-4 lg:px-8">

            <div className="lg:hidden">
              <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)}>
                <Menu className="h-6 w-6" />
              </Button>
            </div>

            <div className="flex items-center gap-4 ml-auto">
              <Link href="/notifications" className="relative">
                <Button variant="ghost" size="icon">
                  <Bell className="h-5 w-5" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 text-xs flex items-center justify-center">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </Button>
              </Link>

              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-3"
                >
                  <Avatar className="h-8 w-8">
                    <AvatarFallback>
                      {user?.firstName?.[0]}{user?.lastName?.[0]}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden md:block">
                    {user?.firstName} {user?.lastName}
                  </span>
                  <ChevronDown className="h-4 w-4" />
                </button>

                {userMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setUserMenuOpen(false)}
                    />
                    <div className="absolute right-0 top-full mt-2 w-48 rounded-lg bg-card border border-border shadow-lg z-50 py-1">
                      <Link
                        href="/settings"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-accent"
                      >
                        <Settings className="h-4 w-4" />
                        Settings
                      </Link>
                      <hr className="my-1 border-border" />
                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-500 hover:bg-accent"
                      >
                        <LogOut className="h-4 w-4" />
                        Logout
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

          </div>
        </header>

        <main className="p-6">
          {children}
        </main>

      </div>
    </div>
  )
}