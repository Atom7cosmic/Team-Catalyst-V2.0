'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MeetingRoom from '@/components/meeting/MeetingRoom';
import api from '@/lib/axios';
import useAuthStore from '@/store/authStore';
import toast from 'react-hot-toast';

export default function MeetingRoomPage({ params }) {
  const router = useRouter();
  const { user, isAuthenticated } = useAuthStore();
  const [meeting, setMeeting] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    fetchMeeting();
  }, [params?.id, isAuthenticated]);

  const fetchMeeting = async () => {
    if (!params?.id) return;
    try {
      const response = await api.get(`/meetings/${params.id}`);
      setMeeting(response.data.meeting);
    } catch (error) {
      console.error('Failed to fetch meeting:', error);
      toast.error('Failed to fetch meeting details');
      router.push('/meetings/history');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-muted-foreground">Loading meeting room...</p>
        </div>
      </div>
    );
  }

  if (!meeting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="text-center">
          <p className="text-muted-foreground">Meeting not found</p>
          <button
            onClick={() => router.push('/meetings/history')}
            className="mt-4 px-4 py-2 bg-blue-600 rounded hover:bg-blue-700"
          >
            Back to Meetings
          </button>
        </div>
      </div>
    );
  }

  return <MeetingRoom meetingId={params.id} user={user} />;
}
