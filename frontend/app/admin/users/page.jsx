'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Users, Search, Shield, Power, Loader2, Mail } from 'lucide-react';
import api from '@/lib/axios';
import { useAuth } from '@/context/AuthContext';
import { TableSkeleton } from '@/components/shared/Skeleton';
import ConfirmModal from '@/components/shared/ConfirmModal';
import toast from 'react-hot-toast';

export default function AdminUsersPage() {
  const router = useRouter();
  const { isAdmin, isLoading: authLoading } = useAuth();
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [toggleModalOpen, setToggleModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      router.push('/dashboard');
    }
  }, [authLoading, isAdmin, router]);

  useEffect(() => {
    fetchUsers();
  }, [page]);

  const fetchUsers = async () => {
    try {
      const response = await api.get(`/admin/users?page=${page}&limit=50`);
      setUsers(response.data.users || []);
      setTotalPages(response.data.pagination?.pages || 1);
    } catch (error) {
      console.error('Failed to fetch users:', error);
      toast.error('Failed to fetch users');
    } finally {
      setIsLoading(false);
    }
  };

  const filteredUsers = users.filter(user =>
    user.firstName?.toLowerCase().includes(search.toLowerCase()) ||
    user.lastName?.toLowerCase().includes(search.toLowerCase()) ||
    user.email?.toLowerCase().includes(search.toLowerCase()) ||
    user.role?.toLowerCase().includes(search.toLowerCase())
  );

  const toggleUserStatus = async () => {
    if (!selectedUser) return;
    try {
      await api.put(`/admin/users/${selectedUser._id}/status`, {
        isActive: !selectedUser.isActive
      });
      setUsers(prev => prev.map(u =>
        u._id === selectedUser._id ? { ...u, isActive: !u.isActive } : u
      ));
      toast.success(`User ${selectedUser.isActive ? 'deactivated' : 'activated'} successfully`);
    } catch (error) {
      toast.error('Failed to update user status');
    } finally {
      setToggleModalOpen(false);
      setSelectedUser(null);
    }
  };

  const confirmToggle = (user) => {
    setSelectedUser(user);
    setToggleModalOpen(true);
  };

  if (authLoading || isLoading) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <h1 className="text-3xl font-bold">User Management</h1>
          <TableSkeleton rows={10} />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">User Management</h1>
            <p className="text-muted-foreground">Manage system users and their access</p>
          </div>
        </div>

        <Card className="bg-card border-muted">
          <CardHeader>
            <div className="flex items-center gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
                <Input
                  placeholder="Search users..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10 bg-muted border-slate-700"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {filteredUsers.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No users found</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-muted">
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium">User</th>
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium">Role</th>
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium">Level</th>
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium">Status</th>
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium">Joined</th>
                      <th className="text-right py-3 px-4 text-muted-foreground font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((user) => (
                      <tr key={user._id} className="border-b border-muted/50 hover:bg-muted/50">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center text-slate-300">
                              {user.firstName?.[0]}{user.lastName?.[0]}
                            </div>
                            <div>
                              <p className="font-medium text-foreground">{user.firstName} {user.lastName}</p>
                              <p className="text-sm text-slate-500">{user.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-300">
                          <div className="flex items-center gap-2">
                            {user.isAdmin && <Shield className="h-4 w-4 text-blue-400" />}
                            {user.role}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-300">{user.roleLevel}</td>
                        <td className="py-3 px-4">
                          <Badge className={user.isActive ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}>
                            {user.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-muted-foreground text-sm">
                          {new Date(user.joinedAt).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => confirmToggle(user)}
                            className={user.isActive ? 'text-red-400 hover:text-red-300' : 'text-green-400 hover:text-green-300'}
                          >
                            <Power className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {totalPages > 1 && (
              <div className="flex justify-center gap-2 mt-6">
                <Button
                  variant="outline"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="border-slate-700"
                >
                  Previous
                </Button>
                <span className="py-2 text-muted-foreground">Page {page} of {totalPages}</span>
                <Button
                  variant="outline"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="border-slate-700"
                >
                  Next
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmModal
        isOpen={toggleModalOpen}
        onClose={() => setToggleModalOpen(false)}
        onConfirm={toggleUserStatus}
        title={selectedUser?.isActive ? 'Deactivate User' : 'Activate User'}
        message={`Are you sure you want to ${selectedUser?.isActive ? 'deactivate' : 'activate'} ${selectedUser?.firstName} ${selectedUser?.lastName}?`}
        confirmText={selectedUser?.isActive ? 'Deactivate' : 'Activate'}
        type={selectedUser?.isActive ? 'danger' : 'success'}
      />
    </DashboardLayout>
  );
}
