'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Shield, Search, Download, Filter } from 'lucide-react';
import { format } from 'date-fns';
import api from '@/lib/axios';
import { useAuth } from '@/context/AuthContext';
import { TableSkeleton } from '@/components/shared/Skeleton';
import toast from 'react-hot-toast';

export default function AuditPage() {
  const router = useRouter();
  const { isSuperior, isLoading: authLoading } = useAuth();
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    if (!authLoading && !isSuperior) {
      router.push('/dashboard');
    }
  }, [authLoading, isSuperior, router]);

  useEffect(() => {
    fetchLogs();
  }, [page]);

  const fetchLogs = async () => {
    try {
      const response = await api.get(`/audit?page=${page}&limit=50`);
      setLogs(response.data.logs || []);
      setTotalPages(response.data.pagination?.pages || 1);
    } catch (error) {
      console.error('Failed to fetch audit logs:', error);
      toast.error('Failed to fetch audit logs');
    } finally {
      setIsLoading(false);
    }
  };

  const filteredLogs = logs.filter(log =>
    log.action?.toLowerCase().includes(search.toLowerCase()) ||
    log.user?.firstName?.toLowerCase().includes(search.toLowerCase()) ||
    log.user?.lastName?.toLowerCase().includes(search.toLowerCase())
  );

  const exportCSV = () => {
    if (filteredLogs.length === 0) {
      toast.error('No logs to export');
      return;
    }

    const headers = ['Timestamp', 'User', 'Email', 'Action', 'Resource', 'Status', 'IP Address'];
    const rows = filteredLogs.map(log => [
      format(new Date(log.createdAt), 'yyyy-MM-dd HH:mm:ss'),
      `${log.user?.firstName || ''} ${log.user?.lastName || ''}`.trim(),
      log.user?.email || '',
      log.action || '',
      log.resourceType || '',
      log.success ? 'Success' : 'Failed',
      log.ipAddress || '',
    ]);

    const csv = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `audit-logs-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported successfully');
  };

  const getActionColor = (action) => {
    if (action?.includes('delete') || action?.includes('remove')) return 'bg-red-500/20 text-red-500';
    if (action?.includes('create') || action?.includes('add')) return 'bg-green-500/20 text-green-500';
    if (action?.includes('update') || action?.includes('edit')) return 'bg-blue-500/20 text-blue-500';
    return 'bg-slate-500/20 text-muted-foreground';
  };

  if (authLoading || isLoading) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <h1 className="text-3xl font-bold">Audit Logs</h1>
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
            <h1 className="text-3xl font-bold">Audit Logs</h1>
            <p className="text-muted-foreground">System activity and change tracking</p>
          </div>
          <Button variant="outline" onClick={exportCSV}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>

        <Card className="bg-card border-muted">
          <CardHeader>
            <div className="flex items-center gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
                <Input
                  placeholder="Search audit logs..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10 bg-muted border-slate-700"
                />
              </div>
              <Button variant="outline" className="border-slate-700">
                <Filter className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {filteredLogs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Shield className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No audit logs found</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-muted">
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium">Timestamp</th>
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium">User</th>
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium">Action</th>
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium">Resource</th>
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium">Status</th>
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium">IP Address</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLogs.map((log) => (
                      <tr key={log._id} className="border-b border-muted/50 hover:bg-muted/50">
                        <td className="py-3 px-4 text-slate-300">
                          {format(new Date(log.createdAt), 'MMM d, yyyy HH:mm')}
                        </td>
                        <td className="py-3 px-4">
                          <div>
                            <p className="text-foreground">{log.user?.firstName} {log.user?.lastName}</p>
                            <p className="text-xs text-slate-500">{log.user?.email}</p>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <Badge className={getActionColor(log.action)}>
                            {log.action}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-slate-300">
                          {log.resourceType}
                          {log.resourceId && (
                            <span className="text-xs text-slate-500 block">
                              {log.resourceId.substring(0, 8)}...
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <Badge className={log.success ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}>
                            {log.success ? 'Success' : 'Failed'}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-muted-foreground text-sm">{log.ipAddress}</td>
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
    </DashboardLayout>
  );
}