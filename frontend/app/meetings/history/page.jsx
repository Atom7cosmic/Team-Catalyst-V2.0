'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Plus, Search, Calendar, Clock,
  Users, ChevronRight, Upload, X, FileText
} from 'lucide-react';
import { format } from 'date-fns';
import api from '@/lib/axios';
import { useAuth } from '@/context/AuthContext';
import toast from 'react-hot-toast';

export default function MeetingsHistoryPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [meetings, setMeetings] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [cancellingId, setCancellingId] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(null);

  const myId = (user?._id || user?.id)?.toString();

  useEffect(() => { fetchMeetings(); }, [page]);

  const fetchMeetings = async () => {
    setIsLoading(true);
    try {
      const response = await api.get(`/meetings?page=${page}&limit=20`);
      setMeetings(response.data.meetings || []);
      setTotalPages(response.data.pagination?.pages || 1);
    } catch (error) {
      console.error('Failed to fetch meetings:', error);
      toast.error('Failed to fetch meetings');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = async (meeting) => {
    setCancellingId(meeting._id);
    try {
      await api.post(`/meetings/${meeting._id}/cancel`);
      toast.success('Meeting cancelled successfully');
      setConfirmCancel(null);
      // Update meeting in list without full reload
      setMeetings(prev =>
        prev.map(m => m._id === meeting._id ? { ...m, status: 'cancelled' } : m)
      );
    } catch (error) {
      const msg = error.response?.data?.message || 'Failed to cancel meeting';
      toast.error(msg);
      console.error('Cancel error:', error.response?.data);
    } finally {
      setCancellingId(null);
    }
  };

  const isHost = (meeting) => {
    const hostId = meeting.host?._id?.toString() || meeting.host?.toString();
    return hostId === myId;
  };

  const canCancel = (meeting) => {
    return isHost(meeting) && ['scheduled', 'live'].includes(meeting.status);
  };

  const canViewSummary = (meeting) => {
    return ['ready', 'completed', 'processing'].includes(meeting.status);
  };

  const filteredMeetings = meetings.filter(m =>
    m.name?.toLowerCase().includes(search.toLowerCase()) ||
    m.domain?.toLowerCase().includes(search.toLowerCase())
  );

  const getStatusColor = (status) => {
    switch (status) {
      case 'ready': return 'bg-green-500/20 text-green-500';
      case 'processing': return 'bg-yellow-500/20 text-yellow-500';
      case 'scheduled': return 'bg-blue-500/20 text-blue-500';
      case 'live': return 'bg-red-500/20 text-red-500';
      case 'cancelled': return 'bg-red-900/20 text-red-700';
      case 'completed': return 'bg-slate-500/20 text-slate-400';
      default: return 'bg-slate-500/20 text-slate-400';
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">

        {/* Confirm cancel modal */}
        {confirmCancel && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="fixed inset-0 bg-black/60" onClick={() => setConfirmCancel(null)} />
            <div className="relative z-50 bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-sm mx-4 space-y-4">
              <h2 className="text-lg font-bold text-slate-100">Cancel Meeting?</h2>
              <p className="text-slate-400">
                Cancel <span className="text-slate-200 font-medium">"{confirmCancel.name}"</span>?
                All attendees will be notified.
              </p>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1 border-slate-700"
                  onClick={() => setConfirmCancel(null)}
                  disabled={cancellingId === confirmCancel._id}
                >
                  Keep
                </Button>
                <Button
                  className="flex-1 bg-red-600 hover:bg-red-700"
                  onClick={() => handleCancel(confirmCancel)}
                  disabled={cancellingId === confirmCancel._id}
                >
                  {cancellingId === confirmCancel._id ? 'Cancelling...' : 'Yes, Cancel'}
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Meetings</h1>
            <p className="text-muted-foreground">View and manage your meetings</p>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="border-slate-700" onClick={() => router.push('/meetings/upload')}>
              <Upload className="mr-2 h-4 w-4" />
              Upload Recording
            </Button>
            <Button onClick={() => router.push('/meetings/new')}>
              <Plus className="mr-2 h-4 w-4" />
              Schedule Meeting
            </Button>
          </div>
        </div>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
              <Input
                placeholder="Search meetings..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 bg-slate-800 border-slate-700"
              />
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-slate-400">Loading...</div>
            ) : filteredMeetings.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <Calendar className="h-12 w-12 mx-auto mb-4 opacity-30" />
                <p>No meetings found</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredMeetings.map((meeting) => (
                  <div
                    key={meeting._id}
                    className={`flex items-center justify-between p-4 rounded-lg transition-colors
                      ${meeting.status === 'cancelled'
                        ? 'bg-slate-800/20 opacity-50'
                        : 'bg-slate-800/50 hover:bg-slate-800 cursor-pointer'
                      }`}
                    onClick={() => {
                      if (meeting.status !== 'cancelled') {
                        router.push(`/meetings/${meeting._id}`);
                      }
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-medium text-slate-100 truncate">{meeting.name}</h3>
                        <Badge className={getStatusColor(meeting.status)}>
                          {meeting.status}
                        </Badge>
                        {isHost(meeting) && meeting.status !== 'cancelled' && (
                          <Badge className="bg-blue-500/10 text-blue-400 text-xs">Host</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-sm text-slate-500 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(meeting.scheduledDate), 'MMM d, yyyy')}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {meeting.estimatedDuration || 0} min
                        </span>
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {meeting.attendees?.length || 0}
                        </span>
                        <span>{meeting.domain}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 ml-3 shrink-0"
                      onClick={e => e.stopPropagation()}>
                      {canViewSummary(meeting) && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-slate-600 text-slate-300 hover:bg-slate-700"
                          onClick={() => router.push(`/meetings/${meeting._id}`)}
                        >
                          <FileText className="h-3.5 w-3.5 mr-1" />
                          Summary
                        </Button>
                      )}
                      {canCancel(meeting) && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-red-800/50 text-red-400 hover:bg-red-900/20"
                          onClick={() => setConfirmCancel(meeting)}
                          disabled={cancellingId === meeting._id}
                        >
                          <X className="h-3.5 w-3.5 mr-1" />
                          {cancellingId === meeting._id ? 'Cancelling...' : 'Cancel'}
                        </Button>
                      )}
                      {meeting.status !== 'cancelled' && (
                        <ChevronRight className="h-5 w-5 text-slate-500" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {totalPages > 1 && (
              <div className="flex justify-center gap-2 mt-6">
                <Button variant="outline" onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1} className="border-slate-700">Previous</Button>
                <span className="py-2 text-slate-400">Page {page} of {totalPages}</span>
                <Button variant="outline" onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages} className="border-slate-700">Next</Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}