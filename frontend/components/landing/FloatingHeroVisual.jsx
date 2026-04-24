'use client';

import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { useRef, useEffect } from 'react';
import { LayoutDashboard, Route, CheckSquare, Layers, CreditCard, Settings, Search, Bell, ChevronDown, ArrowRight, Plus, MoreHorizontal } from 'lucide-react';

export function FloatingHeroVisual() {
  const containerRef = useRef(null);

  // Mouse position tracking for parallax
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  // Smooth springs for mouse movement
  const springX = useSpring(mouseX, { stiffness: 50, damping: 20 });
  const springY = useSpring(mouseY, { stiffness: 50, damping: 20 });

  // Transforms for different layers (varying intensities for depth)
  // Negative values move opposite to mouse (feels like they are in front)
  // Positive values move with mouse (feels like they are behind)
  const layer1X = useTransform(springX, [-0.5, 0.5], [-20, 20]);
  const layer1Y = useTransform(springY, [-0.5, 0.5], [-20, 20]);
  
  const layer2X = useTransform(springX, [-0.5, 0.5], [30, -30]);
  const layer2Y = useTransform(springY, [-0.5, 0.5], [30, -30]);
  
  const layer3X = useTransform(springX, [-0.5, 0.5], [-45, 45]);
  const layer3Y = useTransform(springY, [-0.5, 0.5], [-45, 45]);

  const layerBgX = useTransform(springX, [-0.5, 0.5], [15, -15]);
  const layerBgY = useTransform(springY, [-0.5, 0.5], [15, -15]);

  // Handle mouse move
  const handleMouseMove = (e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    
    // Calculate normalized mouse position (-0.5 to 0.5)
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    
    mouseX.set(x);
    mouseY.set(y);
  };

  // Handle mouse leave (reset to center)
  const handleMouseLeave = () => {
    mouseX.set(0);
    mouseY.set(0);
  };

  // Animation variants for the initial staggered fan-out
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { 
      opacity: 1,
      transition: { 
        staggerChildren: 0.15,
        delayChildren: 0.3
      }
    }
  };

  const cardVariants = {
    hidden: { opacity: 0, scale: 0.8, y: 50 },
    visible: { 
      opacity: 1, 
      scale: 1, 
      y: 0,
      transition: { 
        type: "spring",
        stiffness: 100,
        damping: 15
      }
    }
  };

  return (
    <div 
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="relative w-full h-[550px] lg:h-[650px] flex items-center justify-center overflow-visible select-none"
    >
      <motion.div 
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="relative w-full h-full flex items-center justify-center lg:justify-end pr-0 lg:pr-10 perspective-[1000px]"
      >
        {/* Main Dashboard Mockup */}
        <motion.div 
          variants={cardVariants}
          style={{ 
            x: layer1X, 
            y: layer1Y,
            rotateX: useTransform(springY, [-0.5, 0.5], [10, -10]),
            rotateY: useTransform(springX, [-0.5, 0.5], [-10, 10])
          }}
          className="w-full max-w-[650px] h-[420px] bg-white/95 dark:bg-slate-950/95 backdrop-blur-2xl rounded-2xl shadow-[0_40px_80px_-20px_rgba(0,0,0,0.15)] border border-slate-200/60 dark:border-slate-800/60 flex overflow-hidden transform-gpu"
        >
          {/* Sidebar */}
          <div className="w-[140px] border-r border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/20 hidden sm:flex flex-col py-4 px-3">
             <div className="flex items-center gap-1.5 mb-8 px-1">
               <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center"><div className="w-2 h-2 rounded-full bg-primary"></div></div>
               <span className="text-[11px] font-bold tracking-widest uppercase">Org-OS</span>
             </div>
             <div className="flex flex-col gap-1">
               <div className="text-[10px] font-semibold bg-primary/10 text-primary px-2 py-1.5 rounded-md flex items-center gap-2"><LayoutDashboard className="w-3 h-3" /> Dashboard</div>
               <div className="text-[10px] font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 px-2 py-1.5 rounded-md flex items-center gap-2 transition-colors"><Route className="w-3 h-3" /> Workflows</div>
               <div className="text-[10px] font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 px-2 py-1.5 rounded-md flex items-center gap-2 transition-colors"><CheckSquare className="w-3 h-3" /> Tasks</div>
               <div className="text-[10px] font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 px-2 py-1.5 rounded-md flex items-center gap-2 transition-colors"><Layers className="w-3 h-3" /> Resources</div>
             </div>
             <div className="mt-auto flex flex-col gap-1">
               <div className="text-[10px] font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 px-2 py-1.5 rounded-md flex items-center gap-2 transition-colors"><CreditCard className="w-3 h-3" /> Pricing</div>
               <div className="text-[10px] font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 px-2 py-1.5 rounded-md flex items-center gap-2 transition-colors"><Settings className="w-3 h-3" /> Settings</div>
             </div>
          </div>

          {/* Main Content Area */}
          <div className="flex-1 flex flex-col bg-white dark:bg-slate-950/50">
            {/* Topbar */}
            <div className="h-12 border-b border-slate-100 dark:border-slate-800/60 flex items-center justify-between px-5">
               <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900/50 px-2 py-1 rounded border border-slate-200 dark:border-slate-800 w-48">
                 <Search className="w-3 h-3 text-slate-400" />
                 <span className="text-[10px] text-slate-400">Search...</span>
               </div>
               <div className="flex items-center gap-3">
                 <Bell className="w-3.5 h-3.5 text-slate-400" />
                 <div className="flex items-center gap-2 pl-3 border-l border-slate-200 dark:border-slate-800">
                   <img src="https://ui-avatars.com/api/?name=Sarah&background=f1f5f9&color=0f172a" className="w-5 h-5 rounded-full border border-slate-200" alt="Avatar" />
                   <div className="hidden md:block leading-none">
                     <p className="text-[10px] font-bold">Sarah Jenkins</p>
                     <p className="text-[8px] text-slate-500">Director</p>
                   </div>
                 </div>
               </div>
            </div>

            {/* Dashboard Content */}
            <div className="p-5 flex-1 overflow-hidden">
               <div className="flex items-end justify-between mb-4">
                 <div>
                   <h3 className="text-lg font-black tracking-tight leading-none mb-1">Project Titan</h3>
                   <p className="text-[10px] text-slate-500">Project infrastructure status for sci-tech workflows.</p>
                 </div>
                 <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-[10px] font-semibold border border-slate-200 dark:border-slate-700">
                   <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Monitor <ChevronDown className="w-3 h-3" />
                 </div>
               </div>

               {/* Widgets Grid */}
               <div className="grid grid-cols-3 grid-rows-2 gap-3 h-[250px]">
                 
                 {/* Main Flowchart Widget */}
                 <div className="col-span-2 row-span-1 border border-slate-100 dark:border-slate-800/60 rounded-xl p-3 relative overflow-hidden bg-slate-50/30 dark:bg-slate-900/20 shadow-sm">
                   <div className="flex justify-between items-center mb-3">
                     <span className="text-[11px] font-bold">Project Workflows</span>
                     <span className="text-[11px] font-bold text-emerald-500">78%</span>
                   </div>
                   {/* Flowchart Mock */}
                   <div className="flex items-center gap-2 mt-2">
                     <div className="border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1.5 rounded text-[8px] font-semibold shadow-sm w-16 text-center">Plan</div>
                     <ArrowRight className="w-3 h-3 text-slate-300" />
                     <div className="border border-primary/30 bg-primary/5 p-1.5 rounded text-[8px] font-semibold text-primary shadow-sm w-16 text-center border-l-2 border-l-primary">Execute</div>
                     <ArrowRight className="w-3 h-3 text-slate-300" />
                     <div className="border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1.5 rounded text-[8px] font-semibold text-slate-400 shadow-sm w-16 text-center">Analyze</div>
                   </div>
                   <div className="mt-3 flex items-center gap-1 border border-dashed border-slate-300 dark:border-slate-700 bg-transparent p-1.5 rounded text-[8px] font-semibold text-slate-400 w-16 justify-center cursor-pointer hover:bg-slate-50">
                     <Plus className="w-3 h-3" /> Add
                   </div>
                 </div>

                 {/* Performance Chart Widget */}
                 <div className="col-span-1 row-span-2 border border-slate-100 dark:border-slate-800/60 rounded-xl p-3 bg-white dark:bg-slate-900 shadow-sm flex flex-col">
                   <div className="flex justify-between items-center mb-1">
                     <span className="text-[11px] font-bold">Performance</span>
                     <MoreHorizontal className="w-3 h-3 text-slate-400" />
                   </div>
                   <div className="mb-2">
                     <p className="text-[9px] text-slate-500">Growth</p>
                     <p className="text-sm font-black">24% <span className="text-[8px] text-emerald-500 font-bold ml-1">+2%</span></p>
                   </div>
                   {/* Mock Line Chart */}
                   <div className="flex-1 relative w-full mt-2">
                     <svg viewBox="0 0 100 50" className="absolute inset-0 w-full h-full overflow-visible">
                       <path d="M0,40 Q10,30 20,35 T40,25 T60,10 T80,20 T100,5" fill="none" stroke="currentColor" className="text-primary opacity-30" strokeWidth="2" />
                       <path d="M0,45 Q15,40 25,40 T45,30 T65,15 T85,25 T100,10" fill="none" stroke="currentColor" className="text-primary" strokeWidth="2" strokeLinecap="round" />
                       <circle cx="65" cy="15" r="2" fill="currentColor" className="text-primary" />
                     </svg>
                   </div>
                 </div>

                 {/* Team Activity Widget */}
                 <div className="col-span-1 row-span-1 border border-slate-100 dark:border-slate-800/60 rounded-xl p-3 bg-white dark:bg-slate-900 shadow-sm">
                   <div className="flex justify-between items-center mb-2">
                     <span className="text-[11px] font-bold">Team Activity</span>
                   </div>
                   <div className="flex flex-col gap-2">
                     <div className="flex items-center justify-between">
                       <div className="flex items-center gap-1.5">
                         <img src="https://ui-avatars.com/api/?name=Alex&background=random" className="w-4 h-4 rounded-full" />
                         <div><p className="text-[8px] font-bold">Alex</p><p className="text-[6px] text-slate-400">2m ago</p></div>
                       </div>
                       <span className="text-[7px] bg-emerald-100 text-emerald-700 px-1 py-0.5 rounded font-bold">Completed</span>
                     </div>
                     <div className="flex items-center justify-between">
                       <div className="flex items-center gap-1.5">
                         <img src="https://ui-avatars.com/api/?name=Ben&background=random" className="w-4 h-4 rounded-full" />
                         <div><p className="text-[8px] font-bold">Ben</p><p className="text-[6px] text-slate-400">1h ago</p></div>
                       </div>
                       <span className="text-[7px] bg-amber-100 text-amber-700 px-1 py-0.5 rounded font-bold">Review</span>
                     </div>
                   </div>
                 </div>

                 {/* Tasks Widget */}
                 <div className="col-span-1 row-span-1 border border-slate-100 dark:border-slate-800/60 rounded-xl p-3 bg-white dark:bg-slate-900 shadow-sm">
                   <div className="flex justify-between items-center mb-2">
                     <span className="text-[11px] font-bold">Tasks</span>
                   </div>
                   <div className="flex flex-col gap-1.5">
                     <div className="flex items-start gap-1.5">
                       <input type="checkbox" checked readOnly className="w-2.5 h-2.5 mt-0.5 accent-primary" />
                       <p className="text-[8px] text-slate-500 line-through">Deploy server nodes</p>
                     </div>
                     <div className="flex items-start gap-1.5">
                       <input type="checkbox" readOnly className="w-2.5 h-2.5 mt-0.5 accent-primary" />
                       <p className="text-[8px] font-semibold text-slate-700 dark:text-slate-200">Review analytics auth</p>
                     </div>
                   </div>
                 </div>

               </div>
            </div>
          </div>
         </motion.div>
      </motion.div>
    </div>
  );
}
