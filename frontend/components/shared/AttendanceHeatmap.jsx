'use client';

import { useEffect, useState, useMemo } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, subMonths } from 'date-fns';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import api from '@/lib/axios';

const statusColors = {
  present:  'bg-green-500 hover:bg-green-400',
  absent:   'bg-red-500 hover:bg-red-400',
  late:     'bg-yellow-500 hover:bg-yellow-400',
  half_day: 'bg-orange-500 hover:bg-orange-400',
  wfh:      'bg-blue-500 hover:bg-blue-400',
  weekend:  'bg-muted',
  empty:    'bg-slate-700/30'
};

const statusLabels = {
  present:  'Present',
  absent:   'Absent',
  late:     'Late',
  half_day: 'Half Day',
  wfh:      'Work From Home',
  weekend:  'Weekend',
  empty:    'No Record'
};

export default function AttendanceHeatmap({ userId, attendanceData: externalData, className }) {
  const today = new Date();
  const [viewDate, setViewDate] = useState(today);
  const [attendanceData, setAttendanceData] = useState(externalData || []);
  const [isLoading, setIsLoading] = useState(false);

  const year  = viewDate.getFullYear();
  const month = viewDate.getMonth();

  // If userId provided, fetch attendance from API
  useEffect(() => {
    if (!userId) return;
    const fetchAttendance = async () => {
      setIsLoading(true);
      try {
        const startDate = format(startOfMonth(new Date(year, month)), 'yyyy-MM-dd');
        const endDate   = format(endOfMonth(new Date(year, month)),   'yyyy-MM-dd');
        const response  = await api.get(
          `/attendance?userId=${userId}&startDate=${startDate}&endDate=${endDate}`
        );
        setAttendanceData(response.data.attendance || []);
      } catch (error) {
        console.error('Failed to fetch attendance:', error);
        setAttendanceData([]);
      } finally {
        setIsLoading(false);
      }
    };
    fetchAttendance();
  }, [userId, year, month]);

  // If external data changes (non-userId mode), sync it
  useEffect(() => {
    if (!userId && externalData) setAttendanceData(externalData);
  }, [externalData, userId]);

  const calendarData = useMemo(() => {
    const start = startOfMonth(new Date(year, month));
    const end   = endOfMonth(start);
    const days  = eachDayOfInterval({ start, end });

    const attendanceMap = new Map(
      attendanceData.map(record => [
        format(new Date(record.date), 'yyyy-MM-dd'),
        record
      ])
    );

    const startDay = getDay(start);
    const weeks = [];
    let currentWeek = [];

    for (let i = 0; i < startDay; i++) currentWeek.push(null);

    days.forEach(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const record  = attendanceMap.get(dateStr);
      const isWeekend = getDay(day) === 0 || getDay(day) === 6;

      currentWeek.push({
        date:   day,
        status: record?.status || (isWeekend ? 'weekend' : 'empty'),
        isLate: record?.isLate || false,
        notes:  record?.notes  || ''
      });

      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
    });

    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) currentWeek.push(null);
      weeks.push(currentWeek);
    }

    return weeks;
  }, [attendanceData, year, month]);

  const stats = useMemo(() => ({
    present: attendanceData.filter(r => r.status === 'present').length,
    late:    attendanceData.filter(r => r.status === 'late' || r.isLate).length,
    absent:  attendanceData.filter(r => r.status === 'absent').length,
    wfh:     attendanceData.filter(r => r.status === 'wfh').length,
  }), [attendanceData]);

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className={cn('space-y-4', className)}>

      {/* Month navigator */}
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap gap-4 text-sm">
          {[
            { color: 'bg-green-500', label: 'Present', count: stats.present },
            { color: 'bg-yellow-500', label: 'Late',   count: stats.late },
            { color: 'bg-red-500',   label: 'Absent',  count: stats.absent },
            { color: 'bg-blue-500',  label: 'WFH',     count: stats.wfh },
          ].map(({ color, label, count }) => (
            <div key={label} className="flex items-center gap-2">
              <div className={cn('h-3 w-3 rounded', color)} />
              <span className="text-muted-foreground">{label}: {count}</span>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setViewDate(d => subMonths(d, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium w-28 text-center">
            {format(new Date(year, month), 'MMMM yyyy')}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setViewDate(d => subMonths(d, -1))}
            disabled={year === today.getFullYear() && month === today.getMonth()}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Calendar */}
      <TooltipProvider>
        <div className={cn(
          'rounded-lg border border-slate-700 bg-muted p-4 transition-opacity',
          isLoading && 'opacity-50'
        )}>
          {/* Week day headers */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {weekDays.map(day => (
              <div key={day} className="text-center text-xs font-medium text-slate-500">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="space-y-1">
            {calendarData.map((week, weekIdx) => (
              <div key={weekIdx} className="grid grid-cols-7 gap-1">
                {week.map((day, dayIdx) => (
                  <div key={dayIdx} className="aspect-square">
                    {day ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            className={cn(
                              'w-full h-full rounded-md transition-colors text-xs font-medium',
                              statusColors[day.status] || statusColors.empty
                            )}
                          >
                            {format(day.date, 'd')}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          className="bg-card border border-slate-700 px-3 py-2 rounded-lg shadow-lg z-50"
                        >
                          <div className="text-xs">
                            <p className="font-medium text-foreground">
                              {format(day.date, 'MMM d, yyyy')}
                            </p>
                            <p className="text-muted-foreground">
                              {statusLabels[day.status]}
                              {day.isLate && ' (Late)'}
                            </p>
                            {day.notes && (
                              <p className="text-slate-500 mt-1">{day.notes}</p>
                            )}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <div className="w-full h-full rounded-md bg-muted/50" />
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </TooltipProvider>
    </div>
  );
}