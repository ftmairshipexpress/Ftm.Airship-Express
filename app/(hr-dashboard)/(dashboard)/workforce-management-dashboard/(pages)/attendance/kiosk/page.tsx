'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { ArrowLeft, Clock, MapPin, User, Building, IdCard, AlertCircle } from 'lucide-react';
import { useRealtimeAttendance } from '../../../hooks/useRealtime';
import { workforceApi } from '../../../lib/workforceApi';
import { Plus_Jakarta_Sans } from 'next/font/google';
import logoImg from '../../../assets/logo.png';

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'] });

export default function AttendanceKioskPage() {
  const router = useRouter();
  const { attendance, connected } = useRealtimeAttendance();
  const [currentTime, setCurrentTime] = useState(new Date());
  
  const [lastSeenKey, setLastSeenKey] = useState<string | null>(null);
  const [displayScan, setDisplayScan] = useState<any | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [telemetry, setTelemetry] = useState({ gatewayOnline: true, deviceOnline: true });

  // Gateway Telemetry Check
  useEffect(() => {
    async function checkGateway() {
      try {
        const data = await workforceApi.checkHealth();
        setTelemetry(data);
      } catch (err) {
        setTelemetry({ gatewayOnline: false, deviceOnline: false });
      }
    }
    checkGateway();
    const interval = setInterval(checkGateway, 10000);
    return () => clearInterval(interval);
  }, []);

  // Live Clock
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Monitor for new scans
  useEffect(() => {
    if (attendance && attendance.length > 0) {
      const newest = attendance[0];
      const currentKey = `${newest.id}-${newest.last_scan}`;
      const currentScanTime = new Date(newest.last_scan).getTime();
      
      // On first load, just register the latest key so we don't flash old data
      if (isInitialLoad) {
        setLastSeenKey(currentKey);
        setIsInitialLoad(false);
        return;
      }

      // If the key has changed (either a new ID entirely, or the same ID but updated timestamp)
      if (currentKey !== lastSeenKey) {
        setLastSeenKey(currentKey);
        
        // Only show if it happened within the last 60 seconds (prevents ghost pops)
        const now = new Date().getTime();
        
        if (now - currentScanTime < 60000) {
          setDisplayScan(newest);
          
          // Clear after 8 seconds
          setTimeout(() => {
            setDisplayScan(null);
          }, 8000);
        }
      }
    } else if (attendance && attendance.length === 0 && isInitialLoad) {
      setIsInitialLoad(false);
    }
  }, [attendance, isInitialLoad, lastSeenKey]);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const getGreeting = () => {
    const hour = currentTime.getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const calculateLateness = (scanDateString: string) => {
    const scan = new Date(scanDateString);
    const hour = scan.getHours();
    const min = scan.getMinutes();
    
    // Hardcoded 9:15 AM threshold for now (can be pulled from settings later)
    if (hour > 9 || (hour === 9 && min > 15)) {
      const lateMinutes = ((hour - 9) * 60) + (min - 0); // Assuming 9:00 AM start
      return { isLate: true, text: `Late by ${lateMinutes} minutes` };
    }
    return { isLate: false, text: 'Right on time!' };
  };

  return (
    <div className={`fixed inset-0 z-[9999] bg-slate-50 text-slate-900 flex flex-col items-center justify-center overflow-hidden ${jakarta.className}`}>
      
      {/* Subtle Back Button */}
      <button 
        onClick={() => router.push('/workforce-management-dashboard/attendance')}
        className="absolute top-6 left-6 p-3 bg-slate-200/50 hover:bg-slate-200 rounded-full text-slate-500 hover:text-slate-900 transition-all backdrop-blur-md z-50"
      >
        <ArrowLeft size={24} />
      </button>

      {/* Offline Hardware Banner */}
      {(!telemetry.gatewayOnline || !telemetry.deviceOnline) && (
        <div className="absolute top-6 right-6 z-50 bg-rose-50 border border-rose-200 text-rose-600 px-4 py-2.5 rounded-2xl text-sm font-bold flex items-center gap-2 shadow-lg animate-pulse">
          <AlertCircle size={18} />
          {telemetry.gatewayOnline && !telemetry.deviceOnline 
            ? 'RFID Scanner is Offline — Please contact the HR Administrator.' 
            : 'Gateway Offline — Please contact the HR Administrator.'}
        </div>
      )}

      {/* Background Ambience (Animated Pink Blobs) */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-100 mix-blend-multiply">
        <div className="absolute top-[-20%] right-[-10%] w-[800px] h-[800px] bg-pink-500/40 rounded-full blur-[140px] animate-[pulse_8s_ease-in-out_infinite]" />
        <div className="absolute bottom-[-20%] left-[-10%] w-[700px] h-[700px] bg-rose-500/40 rounded-full blur-[120px] animate-[pulse_12s_ease-in-out_infinite]" />
      </div>

      {displayScan ? (
        // ACTIVE SCAN VIEW
        <div className="relative z-10 flex flex-col items-center w-full max-w-4xl animate-in fade-in zoom-in duration-500">
          
          {/* Greeting */}
          <h1 className="text-5xl font-light text-slate-600 mb-2 tracking-tight">
            {getGreeting()}, <span className="font-bold text-slate-900">{displayScan.employee?.full_name.split(' ')[0]}!</span>
          </h1>
          
          {/* Main Card */}
          <div className="mt-8 w-full bg-white border border-slate-200 backdrop-blur-xl rounded-3xl p-10 shadow-2xl flex items-center gap-10">
            {/* Avatar */}
            <div className="w-40 h-40 shrink-0 bg-emerald-100 rounded-full flex items-center justify-center border-4 border-emerald-200">
              <span className="text-6xl font-bold text-emerald-600">{displayScan.employee?.avatar_initials}</span>
            </div>

            {/* Details */}
            <div className="flex-1 space-y-5">
              <div>
                <h2 className="text-4xl font-bold text-slate-900 tracking-tight">{displayScan.employee?.full_name}</h2>
                <div className="flex items-center gap-3 text-lg text-slate-500 mt-1">
                  <span className="flex items-center gap-1.5"><Building size={18} /> {displayScan.employee?.department || 'Unassigned'}</span>
                  <span className="opacity-30">•</span>
                  <span className="flex items-center gap-1.5"><User size={18} /> {displayScan.employee?.role || 'Staff'}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-100">
                <div className="space-y-1">
                  <p className="text-sm text-slate-400 uppercase tracking-wider font-semibold">Status</p>
                  <div className="flex items-center gap-2">
                    <span className={`flex h-3 w-3 rounded-full animate-pulse ${['On-Shift', 'Tardy'].includes(displayScan.status) ? 'bg-emerald-500' : 'bg-slate-400'}`}></span>
                    <span className={`text-xl font-bold ${['On-Shift', 'Tardy'].includes(displayScan.status) ? 'text-emerald-600' : 'text-slate-500'}`}>
                      {['On-Shift', 'Tardy'].includes(displayScan.status) ? 'Clocked In' : displayScan.status}
                    </span>
                  </div>
                </div>
                
                <div className="space-y-1">
                  <p className="text-sm text-slate-400 uppercase tracking-wider font-semibold">Timestamp</p>
                  <p className="text-xl font-mono text-slate-700">
                    {formatTime(new Date(displayScan.last_scan))}
                  </p>
                </div>
              </div>

              {/* Lateness Indicator (Only for On-Shift/Tardy) */}
              {['On-Shift', 'Tardy'].includes(displayScan.status) && (
                <div className={`mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold ${
                  calculateLateness(displayScan.last_scan).isLate 
                    ? 'bg-rose-100 text-rose-700 border border-rose-200' 
                    : 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                }`}>
                  {calculateLateness(displayScan.last_scan).text}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        // IDLE SCREENSAVER VIEW
        <div className="relative z-10 flex flex-col items-center animate-in fade-in duration-1000">
          <div className="mb-12 relative w-[500px] h-[200px]">
            <Image 
              src={logoImg} 
              alt="Airship Express" 
              fill
              className="object-contain drop-shadow-xl"
              priority
            />
          </div>
          
          <div className="text-[12rem] leading-none font-light tracking-tighter text-slate-900 drop-shadow-sm">
            {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
          </div>
          <div className="text-3xl text-slate-500 font-medium tracking-widest uppercase mt-4">
            {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>

          <div className="mt-20 flex items-center gap-4 text-slate-600 bg-white px-8 py-4 rounded-full shadow-sm border border-slate-200">
            <IdCard size={28} className="text-pink-600 animate-pulse" />
            <span className="text-lg font-medium tracking-wider">Please tap your ID card on the scanner</span>
          </div>

          {/* Connection Status */}
          <div className="absolute bottom-[-100px] flex items-center gap-2 text-xs font-mono opacity-50 text-slate-400">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-rose-500'}`}></div>
            {connected ? 'Live Sync Active' : 'Connecting to Server...'}
          </div>
        </div>
      )}
    </div>
  );
}
