'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bell, Check, Trash2, Info, AlertTriangle, Calendar, CheckSquare, Users } from 'lucide-react';
import { format } from 'date-fns';
import api from '@/lib/axios';
import { ListSkeleton } from '@/components/shared/Skeleton';
import ConfirmModal from '@/components/shared/ConfirmModal';
import toast from 'react-hot-toast';

const notificationIcons = {
  meeting_invite: Calendar,
  task_assigned: CheckSquare,
  recommendation: AlertTriangle,
  follow_up_reminder: Calendar,
  general: Info,
  team_update: Users
};

const notificationColors = {
  meeting_invite: 'bg-blue-500/20 text-blue-500',
  task_assigned: 'bg-green-500/20 text-green-500',
  recommendation: 'bg-red-500/20 text-red-500',
  follow_up_reminder: 'bg-yellow-500/20 text-yellow-500',
  general: 'bg-slate-500/20 text-muted-foreground',
  team_update: 'bg-purple-500/20 text-purple-500'
};

export default function NotificationsPage() {
  const router = useRouter();
  const [notifications, setNotifications] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState(null);

  useEffect(() => {
    fetchNotifications();
  }, []);

  const fetchNotifications = async () => {
    try {
      const response = await api.get('/notifications');
      setNotifications(response.data.notifications || []);
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
      toast.error('Failed to fetch notifications');
    } finally {
      setIsLoading(false);
    }
  };

  const markAsRead = async (id) => {
    try {
      await api.put(`/notifications/${id}/read`);
      setNotifications(prev => prev.map(n =>
        n._id === id ? { ...n, read: true } : n
      ));
      toast.success('Marked as read');
    } catch (error) {
      toast.error('Failed to mark as read');
    }
  };

  const markAllAsRead = async () => {
    try {
      await api.put('/notifications/read-all');
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      toast.success('All notifications marked as read');
    } catch (error) {
      toast.error('Failed to mark all as read');
    }
  };

  const deleteNotification = async () => {
    if (!selectedNotification) return;
    try {
      await api.delete(`/notifications/${selectedNotification._id}`);
      setNotifications(prev => prev.filter(n => n._id !== selectedNotification._id));
      toast.success('Notification deleted');
    } catch (error) {
      toast.error('Failed to delete notification');
    } finally {
      setDeleteModalOpen(false);
      setSelectedNotification(null);
    }
  };

  const confirmDelete = (notification) => {
    setSelectedNotification(notification);
    setDeleteModalOpen(true);
  };

  const handleNotificationClick = (notification, e) => {
    if (e.target.closest('button')) return; // Ignore button clicks

    const markReadIfUnread = () => {
      if (!notification.read) {
        markAsRead(notification._id);
      }
    };

    if (notification.link) {
      markReadIfUnread();
      router.push(notification.link);
      return;
    }

    if (notification.entityType && notification.entityId) {
      let routed = true;
      switch (notification.entityType) {
        case 'meeting':
          router.push(`/meetings/history`);
          break;
        case 'task':
          router.push(`/tasks`);
          break;
        case 'user':
          router.push(`/team/${notification.entityId}`);
          break;
        case 'recommendation':
          router.push(`/recommendations`);
          break;
        default: 
          routed = false;
          break;
      }
      if (routed) {
        markReadIfUnread();
        return;
      }
    }

    if (notification.type.includes('meeting')) {
      markReadIfUnread();
      router.push('/meetings/history');
    } else if (notification.type.includes('task')) {
      markReadIfUnread();
      router.push('/tasks');
    } else if (notification.type.includes('recommendation') || notification.type.includes('performance') || notification.type.includes('risk')) {
      markReadIfUnread();
      router.push('/recommendations');
    }
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  if (isLoading) {
    return (
      <>
        <div className="space-y-6">
          <h1 className="text-3xl font-bold">Notifications</h1>
          <ListSkeleton count={5} />
        </div>
      </>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Notifications</h1>
            <p className="text-muted-foreground">
              {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}` : 'No unread notifications'}
            </p>
          </div>
          {unreadCount > 0 && (
            <Button variant="outline" onClick={markAllAsRead} className="border-border">
              <Check className="mr-2 h-4 w-4" />
              Mark All Read
            </Button>
          )}
        </div>

        <Card className="bg-card border-muted">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              All Notifications
            </CardTitle>
          </CardHeader>
          <CardContent>
            {notifications.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Bell className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No notifications yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {notifications.map((notification) => {
                  const Icon = notificationIcons[notification.type] || Info;
                  return (
                    <div
                      key={notification._id}
                      onClick={(e) => handleNotificationClick(notification, e)}
                      className={`flex items-start gap-4 p-4 rounded-lg border transition-colors cursor-pointer hover:shadow-sm ${
                        notification.read
                          ? 'bg-muted/30 border-border/50 hover:bg-muted/50'
                          : 'bg-muted border-border hover:bg-muted/80'
                      }`}
                    >
                      <div className={`p-2 rounded-lg shrink-0 ${notificationColors[notification.type] || notificationColors.general}`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className={`font-medium ${notification.read ? 'text-muted-foreground' : 'text-foreground'}`}>
                              {notification.title}
                            </p>
                            <p className="text-sm text-muted-foreground mt-1">{notification.message}</p>
                            <p className="text-xs text-muted-foreground/70 mt-2">
                              {format(new Date(notification.createdAt), 'MMM d, yyyy HH:mm')}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {!notification.read && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => markAsRead(notification._id)}
                                className="h-8 w-8 text-muted-foreground hover:text-green-400"
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => confirmDelete(notification)}
                              className="h-8 w-8 text-muted-foreground hover:text-red-400"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                      {!notification.read && (
                        <Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400 shrink-0">New</Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmModal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={deleteNotification}
        title="Delete Notification"
        message="Are you sure you want to delete this notification? This action cannot be undone."
        confirmText="Delete"
        type="danger"
      />
    </>
  );
}
