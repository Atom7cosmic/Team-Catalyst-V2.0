'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Search } from 'lucide-react';
import api from '@/lib/axios';
import { useAuth } from '@/context/AuthContext';
import toast from 'react-hot-toast';

const meetingDomains = [
  'Sprint Planning',
  'Performance Review',
  'Architecture Discussion',
  '1:1',
  'All-Hands',
  'Custom'
];

export default function NewMeetingPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [users, setUsers] = useState([]);
  const [searchUsers, setSearchUsers] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    scheduledDate: '',
    estimatedDuration: '60',
    domain: '',
    agenda: '',
    externalLink: '',
    attendees: []
  });

  useEffect(() => {
    fetchOrgTreeUsers();
  }, []);

  const fetchOrgTreeUsers = async () => {
    try {
      // Fetch users in org tree — backend already filters by access
      const response = await api.get('/users?limit=100');
      const allUsers = response.data.users || [];
      const myId = (user?._id || user?.id)?.toString();
      // Exclude self from attendee list
      setUsers(allUsers.filter(u => u._id?.toString() !== myId));
    } catch (error) {
      console.error('Failed to fetch users:', error);
      toast.error('Failed to load team members');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) { toast.error('Meeting name is required'); return; }
    if (!formData.scheduledDate) { toast.error('Date and time is required'); return; }
    if (!formData.domain) { toast.error('Please select a domain'); return; }

    setIsLoading(true);
    try {
      await api.post('/meetings', {
        ...formData,
        estimatedDuration: parseInt(formData.estimatedDuration),
        attendees: formData.attendees.map(id => ({ user: id }))
      });
      toast.success('Meeting scheduled successfully');
      router.push('/meetings/history');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to schedule meeting');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAttendeeChange = (userId) => {
    setFormData(prev => ({
      ...prev,
      attendees: prev.attendees.includes(userId)
        ? prev.attendees.filter(id => id !== userId)
        : [...prev.attendees, userId]
    }));
  };

  const filteredUsers = users.filter(u =>
    `${u.firstName} ${u.lastName} ${u.role}`.toLowerCase()
      .includes(searchUsers.toLowerCase())
  );

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto">
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle>Schedule New Meeting</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="name">Meeting Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="bg-slate-800 border-slate-700"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="bg-slate-800 border-slate-700"
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="scheduledDate">Date & Time *</Label>
                  <Input
                    id="scheduledDate"
                    type="datetime-local"
                    value={formData.scheduledDate}
                    onChange={(e) => setFormData({ ...formData, scheduledDate: e.target.value })}
                    className="bg-slate-800 border-slate-700"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="estimatedDuration">Duration (minutes)</Label>
                  <Input
                    id="estimatedDuration"
                    type="number"
                    min="1"
                    value={formData.estimatedDuration}
                    onChange={(e) => setFormData({ ...formData, estimatedDuration: e.target.value })}
                    className="bg-slate-800 border-slate-700"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Domain *</Label>
                <Select
                  value={formData.domain}
                  onValueChange={(value) => setFormData({ ...formData, domain: value })}
                >
                  <SelectTrigger className="bg-slate-800 border-slate-700">
                    <SelectValue placeholder="Select a domain" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    {meetingDomains.map((domain) => (
                      <SelectItem key={domain} value={domain}>{domain}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="agenda">Agenda</Label>
                <Textarea
                  id="agenda"
                  value={formData.agenda}
                  onChange={(e) => setFormData({ ...formData, agenda: e.target.value })}
                  className="bg-slate-800 border-slate-700"
                  rows={3}
                  placeholder="Topics to discuss..."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="externalLink">External Link (Optional)</Label>
                <Input
                  id="externalLink"
                  type="url"
                  placeholder="https://zoom.us/j/..."
                  value={formData.externalLink}
                  onChange={(e) => setFormData({ ...formData, externalLink: e.target.value })}
                  className="bg-slate-800 border-slate-700"
                />
              </div>

              <div className="space-y-2">
                <Label>
                  Attendees
                  <span className="text-slate-500 font-normal ml-2 text-sm">
                    ({formData.attendees.length} selected — your team members only)
                  </span>
                </Label>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  <Input
                    placeholder="Search team members..."
                    value={searchUsers}
                    onChange={e => setSearchUsers(e.target.value)}
                    className="pl-9 bg-slate-800 border-slate-700"
                  />
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1 border border-slate-700 rounded-lg p-2 bg-slate-800/50">
                  {filteredUsers.length === 0 ? (
                    <p className="text-slate-500 text-sm text-center py-4">No team members found</p>
                  ) : (
                    filteredUsers.map((u) => (
                      <label
                        key={u._id}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-700 cursor-pointer transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={formData.attendees.includes(u._id)}
                          onChange={() => handleAttendeeChange(u._id)}
                          className="rounded accent-blue-500"
                        />
                        <div className="flex items-center gap-2 flex-1">
                          <div className="w-7 h-7 rounded-full bg-slate-600 flex items-center justify-center text-xs font-medium text-slate-200 shrink-0">
                            {u.firstName?.[0]}{u.lastName?.[0]}
                          </div>
                          <div>
                            <p className="text-sm text-slate-200 font-medium">
                              {u.firstName} {u.lastName}
                            </p>
                            <p className="text-xs text-slate-500">{u.role}</p>
                          </div>
                        </div>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="border-slate-700"
                  onClick={() => router.push('/meetings/history')}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isLoading} className="flex-1">
                  {isLoading ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Scheduling...</>
                  ) : (
                    'Schedule Meeting'
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}