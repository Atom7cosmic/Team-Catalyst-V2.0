'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'
import useAuthStore from '@/store/authStore'
import useNotificationStore from '@/store/notificationStore'
import {
  LayoutDashboard, Users, Calendar, CheckSquare, BarChart3, Bell, Settings,
  LogOut, Menu, X, Shield, ChevronDown, Database, FileText, Search, ChevronsLeft, ChevronsRight, PieChart
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import ThemeToggle from '@/components/shared/ThemeToggle'
import toast from 'react-hot-toast'

// ── Nav Grouping ────────────────────────────────────────────────────────
const userNavGroups = [
  {
    label: "Overview",
    items: [
      { name: 'Dashboard',   href: '/dashboard',         icon: LayoutDashboard },
      { name: 'Team',        href: '/team',              icon: Users },
      { name: 'Performance', href: '/recommendations',   icon: PieChart },
    ]
  },
  {
    label: "Workspace",
    items: [
      { name: 'Meetings',    href: '/meetings/history',  icon: Calendar },
      { name: 'Tasks',       href: '/tasks',             icon: CheckSquare },
      { name: 'Sprints',     href: '/sprints',           icon: BarChart3 },
    ]
  }
]

const adminNavGroups = [
  {
    label: "System",
    items: [
      { name: 'Dashboard',   href: '/dashboard',         icon: LayoutDashboard },
      { name: 'Audit Logs',  href: '/audit',             icon: Shield },
      { name: 'System',      href: '/admin/system',      icon: Database },
    ]
  },
  {
    label: "Management",
    items: [
      { name: 'Admin Users', href: '/admin/users',       icon: Users },
      { name: 'Prompts',     href: '/admin/prompts',     icon: FileText },
    ]
  }
]

const SidebarNav = ({ onClose, pathname, sidebarCollapsed, isAdmin }) => {
  const navGroups = isAdmin ? adminNavGroups : userNavGroups;
  return (
    <div className="flex-1 overflow-y-auto py-4 px-3 space-y-6 scrollbar-none">
      {navGroups.map((group, idx) => (
        <div key={idx}>
          {!sidebarCollapsed && (
            <p className="px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
              {group.label}
            </p>
          )}
          <nav className="space-y-1">
            {group.items.map((item) => {
              const active = pathname === item.href
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={onClose}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group ${
                    active
                      ? 'bg-primary/10 text-primary font-medium dark:bg-primary/20'
                      : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground'
                  }`}
                  title={sidebarCollapsed ? item.name : undefined}
                >
                  <div className={`relative ${active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}`}>
                    <item.icon className="h-[18px] w-[18px] stroke-[2px]" />
                    {active && (
                      <div className="absolute -left-[14px] top-1/2 -translate-y-1/2 w-1 h-5 bg-primary rounded-r-md" />
                    )}
                  </div>
                  {!sidebarCollapsed && <span>{item.name}</span>}
                </Link>
              )
            })}
          </nav>
        </div>
      ))}
    </div>
  )
}

export default function DashboardLayout({ children }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, logout } = useAuthStore()
  const { isAdmin } = useAuth()
  const { notifications, unreadCount, fetchNotifications, markAsRead } = useNotificationStore()

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const mainRef = useRef(null)
  const userMenuRef = useRef(null)

  // Reset scroll position on navigation
  useEffect(() => {
    if (mainRef.current) {
      mainRef.current.scrollTop = 0
    }
  }, [pathname])

  const latestUnread = notifications?.find(n => !n.read)

  const handleLatestNotificationClick = () => {
    if (latestUnread) {
      markAsRead(latestUnread._id);
      if (latestUnread.link) {
        router.push(latestUnread.link);
      } else {
        router.push('/notifications');
      }
    }
  }

  // Handle click outside to close user menu
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setUserMenuOpen(false)
      }
    }
    if (userMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [userMenuOpen])

  useEffect(() => {
    fetchNotifications(50)
  }, [fetchNotifications])

  const handleLogout = async () => {
    await logout()
    toast.success('Logged out successfully')
    window.location.href = '/login'
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex">

      {/* Mobile Sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <div className="fixed inset-y-0 left-0 w-64 bg-surface border-r border-border flex flex-col shadow-2xl">
            <div className="flex h-16 items-center justify-between px-4 border-b border-border">
              <Link href="/dashboard" className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                  <span className="text-primary-foreground font-bold text-lg">O</span>
                </div>
                <span className="text-xl font-semibold tracking-tight">OrgOS</span>
              </Link>
              <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <SidebarNav onClose={() => setSidebarOpen(false)} pathname={pathname} sidebarCollapsed={sidebarCollapsed} isAdmin={isAdmin} />
          </div>
        </div>
      )}

      {/* Desktop Sidebar */}
      <motion.div 
        initial={{ x: -280 }}
        animate={{ x: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className={`hidden lg:flex flex-col bg-surface border-r border-border transition-all duration-300 z-10 ${sidebarCollapsed ? 'w-20' : 'w-64'}`}
      >
        <div className="flex h-16 items-center px-4 border-b border-border justify-between">
          <Link href="/dashboard" className={`flex items-center gap-2 overflow-hidden ${sidebarCollapsed ? 'justify-center w-full' : ''}`}>
            <div className="w-8 h-8 shrink-0 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold leading-none">O</span>
            </div>
            {!sidebarCollapsed && <span className="text-xl font-semibold tracking-tight whitespace-nowrap">OrgOS</span>}
          </Link>
        </div>
        
        <SidebarNav onClose={() => {}} pathname={pathname} sidebarCollapsed={sidebarCollapsed} isAdmin={isAdmin} />

        <div className="mt-auto p-4 border-t border-border">
          <Button 
            variant="ghost" 
            className={`w-full justify-start text-muted-foreground hover:text-foreground ${sidebarCollapsed ? 'px-0 justify-center' : ''}`}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? <ChevronsRight className="h-5 w-5" /> : <><ChevronsLeft className="h-5 w-5 mr-2" /> Collapse</>}
          </Button>
        </div>
      </motion.div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">

        {/* Header */}
        <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border h-16 shrink-0">
          <div className="flex h-full items-center justify-between px-4 lg:px-8">

            <div className="flex items-center gap-4">
              <div className="lg:hidden">
                <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)}>
                  <Menu className="h-5 w-5" />
                </Button>
              </div>

              {/* Search Bar - Hidden on mobile */}
              <div className="hidden md:flex relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                <input 
                  type="text" 
                  placeholder="Search across OrgOS..." 
                  className="h-9 w-64 lg:w-80 rounded-full border border-border bg-surface/50 pl-9 pr-4 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder:text-muted-foreground"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-4">
              <ThemeToggle />

              {/* Latest Unread Notification preview */}
              {latestUnread && (
                <button 
                  onClick={handleLatestNotificationClick} 
                  className="hidden lg:flex items-center gap-2 max-w-[240px] xl:max-w-sm mr-2 px-3 py-1.5 bg-muted/50 rounded-full border border-border overflow-hidden hover:bg-muted transition-colors text-left"
                >
                  <span className="w-2 h-2 rounded-full bg-destructive flex-shrink-0 animate-pulse"></span>
                  <span className="text-xs truncate text-muted-foreground flex-1">
                    <span className="font-semibold text-foreground mr-1">{latestUnread.title}</span> 
                    <span className="opacity-80">— {latestUnread.message}</span>
                  </span>
                </button>
              )}

              <Link href="/notifications" className="relative group/bell">
                <Button variant="ghost" size="icon" className="text-muted-foreground group-hover/bell:bg-surface-hover group-hover/bell:text-foreground rounded-full h-9 w-9 transition-colors">
                  <Bell className="h=[18px] w-[18px]" strokeWidth={1.5} />
                  {unreadCount > 0 && (
                    <span className="absolute top-0 right-0 h-4 w-4 rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground flex items-center justify-center shadow-sm border border-background">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </Button>
              </Link>

              <div className="h-6 w-[1px] bg-border mx-1" />

              <div className="relative" ref={userMenuRef}>
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full hover:bg-surface-hover transition-colors"
                >
                  <Avatar className="h-8 w-8 border border-border">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
                      {user?.firstName?.[0]}{user?.lastName?.[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div className="hidden md:flex flex-col items-start pr-1 text-left">
                    <span className="text-sm font-medium leading-none mb-1">
                      {user?.firstName} {user?.lastName}
                    </span>
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider leading-none">
                      {isAdmin ? 'Admin' : user?.role || 'User'}
                    </span>
                  </div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground ml-1" />
                </button>

                {userMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-56 rounded-xl bg-card border border-border shadow-elevated z-50 overflow-hidden transform origin-top-right transition-all animate-in fade-in slide-in-from-top-2">
                      <div className="px-4 py-3 border-b border-border bg-surface/50">
                        <p className="text-sm font-medium">{user?.firstName} {user?.lastName}</p>
                        <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                      </div>
                      <div className="p-1">
                        <Link
                          href="/settings"
                          onClick={() => setUserMenuOpen(false)}
                          className="flex items-center gap-2 px-3 py-2 text-sm rounded-md text-foreground hover:bg-surface-hover transition-colors"
                        >
                          <Settings className="h-4 w-4 text-muted-foreground" />
                          Account Settings
                        </Link>
                      </div>
                      <div className="border-t border-border p-1">
                        <button
                          onClick={handleLogout}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <LogOut className="h-4 w-4" />
                          Log out
                        </button>
                      </div>
                    </div>
                )}
              </div>
            </div>

          </div>
        </header>

        <AnimatePresence mode="wait">
          <motion.main 
            key={pathname}
            initial={{ opacity: 0, y: 10, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.99 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            ref={mainRef} 
            className="flex-1 overflow-y-auto overscroll-none bg-background scroll-smooth flex flex-col"
          >
            <div className="mx-auto max-w-7xl w-full flex-1 flex flex-col p-4 lg:p-8">
              {children}
            </div>
          </motion.main>
        </AnimatePresence>

      </div>
    </div>
  )
}