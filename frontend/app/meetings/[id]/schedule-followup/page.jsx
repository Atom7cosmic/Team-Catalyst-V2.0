'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Calendar, Clock, Users, Loader2, CheckCircle } from 'lucide-react';
import { format, addDays } from 'date-fns';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import api from '@/lib/axios';
import { CardSkeleton } from '@/components/shared/Skeleton';
import toast from 'react-hot-toast';

const followupSchema = z.object({
  name: z.string().min(1, 'Meeting name is required'),
  description: z.string().optional(),
  scheduledDate: z.string().min(1, 'Date is required'),
  estimatedDuration: z.number().min(15, 'Duration must be at least 15 minutes'),
  domain: z.string().min(1, 'Domain is required'),
  agenda: z.string().optional(),
});

export default function ScheduleFollowupPage({ params }) {
  const router = useRouter();
  const [parentMeeting, setParentMeeting] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(followupSchema),
    defaultValues: {
      name: '',
      description: '',
      scheduledDate: format(addDays(new Date(), 7), "yyyy-MM-dd'T'HH:mm"),
      estimatedDuration: 60,
      domain: '',
      agenda: '',
    },
  });

  useEffect(() => {
    fetchParentMeeting();
  }, [params?.id]);

  const fetchParentMeeting = async () => {
    if (!params?.id) return;
    try {
      const response = await api.get(`/meetings/${params.id}`);
      setParentMeeting(response.data.meeting);
      // Pre-fill some fields
      setValue('name', `Follow-up: ${response.data.meeting.name}`);
      setValue('domain', response.data.meeting.domain);
      if (response.data.meeting.followUpTopics?.length > 0) {
        setValue('agenda', response.data.meeting.followUpTopics.join('\n'));
      }
    } catch (error) {
      console.error('Failed to fetch meeting:', error);
      toast.error('Failed to fetch parent meeting');
      router.push('/meetings/history');
    } finally {
      setIsLoading(false);
    }
  };

  const onSubmit = async (data) => {
    setIsSubmitting(true);
    try {
      await api.post(`/meetings/${params.id}/schedule-followup`, {
        ...data,
        scheduledDate: new Date(data.scheduledDate).toISOString(),
      });
      toast.success('Follow-up meeting scheduled successfully');
      router.push(`/meetings/${params.id}`);
    } catch (error) {
      console.error('Failed to schedule follow-up:', error);
      toast.error('Failed to schedule follow-up meeting');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.back()}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <CardSkeleton className="flex-1" />
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Schedule Follow-up Meeting</h1>
            <p className="text-muted-foreground">Follow-up to: {parentMeeting?.name}</p>
          </div>
        </div>

        <Card className="bg-card border-muted">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Meeting Details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="name">Meeting Name</Label>
                <Input
                  id="name"
                  {...register('name')}
                  className="bg-muted border-slate-700"
                />
                {errors.name && (
                  <p className="text-sm text-red-400">{errors.name.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  {...register('description')}
                  className="bg-muted border-slate-700"
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="scheduledDate">Date & Time</Label>
                  <Input
                    id="scheduledDate"
                    type="datetime-local"
                    {...register('scheduledDate')}
                    className="bg-muted border-slate-700"
                  />
                  {errors.scheduledDate && (
                    <p className="text-sm text-red-400">{errors.scheduledDate.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="estimatedDuration">Duration (minutes)</Label>
                  <Input
                    id="estimatedDuration"
                    type="number"
                    min={15}
                    step={15}
                    {...register('estimatedDuration', { valueAsNumber: true })}
                    className="bg-muted border-slate-700"
                  />
                  {errors.estimatedDuration && (
                    <p className="text-sm text-red-400">{errors.estimatedDuration.message}</p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="domain">Domain</Label>
                <select
                  id="domain"
                  {...register('domain')}
                  className="w-full px-3 py-2 rounded-md bg-muted border border-slate-700 text-foreground"
                >
                  <option value="Sprint Planning">Sprint Planning</option>
                  <option value="Performance Review">Performance Review</option>
                  <option value="Architecture Discussion">Architecture Discussion</option>
                  <option value="1:1">1:1</option>
                  <option value="All-Hands">All-Hands</option>
                  <option value="Custom">Custom</option>
                </select>
                {errors.domain && (
                  <p className="text-sm text-red-400">{errors.domain.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="agenda">Agenda</Label>
                <Textarea
                  id="agenda"
                  {...register('agenda')}
                  className="bg-muted border-slate-700"
                  rows={5}
                  placeholder="Meeting agenda items..."
                />
              </div>

              <div className="flex justify-end gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.back()}
                  className="border-slate-700"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Scheduling...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="mr-2 h-4 w-4" />
                      Schedule Follow-up
                    </>
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
