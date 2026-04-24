import { ShieldCheck, HeadphonesIcon, ActivitySquare, GitMerge } from 'lucide-react';
import { motion } from 'framer-motion';
import Link from 'next/link';

export function EnterpriseSection() {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.15 } }
  };
  
  const itemVariants = {
    hidden: { opacity: 0, y: 40 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] } }
  };

  return (
    <section id="enterprise" className="py-24 bg-slate-100/50 dark:bg-slate-900/30 border-y border-slate-200 dark:border-slate-900 relative overflow-hidden">
      <div className="max-w-[1440px] mx-auto px-6 md:px-12 relative z-10">
        <motion.div 
          initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-100px" }}
          variants={containerVariants}
          className="mb-20 space-y-6"
        >
          <motion.div variants={itemVariants} className="w-12 h-1.5 bg-primary rounded-full"></motion.div>
          <motion.h2 variants={itemVariants} className="text-4xl md:text-5xl font-extrabold tracking-tight text-slate-900 dark:text-white max-w-2xl leading-tight">
            Built for the Architectural Complexity of Enterprise
          </motion.h2>
        </motion.div>

        <motion.div 
          initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-50px" }}
          variants={containerVariants}
          className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-8"
        >

          {/* Feature 1: Security */}
          <motion.div variants={itemVariants} className="md:col-span-8 bg-white dark:bg-slate-950 p-8 md:p-12 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-xl transition-all duration-500 group">
            <div className="flex flex-col md:flex-row gap-12 items-center h-full">
              <div className="flex-1 space-y-6">
                <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-900 flex items-center justify-center text-primary group-hover:scale-110 transition-transform duration-500">
                  <ShieldCheck className="w-8 h-8" />
                </div>
                <h3 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Security &amp; Access</h3>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed text-lg">
                  Single Sign-On (SSO) with enterprise-grade encryption. We provide a fortified perimeter for your intellectual property with Zero-Trust protocols and hardware-level isolation.
                </p>
              </div>
              <div className="flex-1 w-full min-h-[240px] h-full rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-900 relative hidden md:block group-hover:shadow-inner transition-all duration-500">
                <img
                  alt="Data Center"
                  className="absolute inset-0 w-full h-full object-cover grayscale opacity-90 group-hover:scale-105 transition-transform duration-700 ease-out"
                  src="https://images.unsplash.com/photo-1558494949-ef010cbdcc31?q=80&w=2034&auto=format&fit=crop"
                />
              </div>
            </div>
          </motion.div>

          {/* Feature 2: Support */}
          <motion.div variants={itemVariants} className="md:col-span-4 bg-slate-900 dark:bg-slate-800 text-white p-8 md:p-12 rounded-3xl flex flex-col justify-between shadow-lg overflow-hidden relative group hover:-translate-y-1 transition-all duration-500">
            <div className="space-y-6 relative z-10">
              <div className="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center text-white group-hover:scale-110 transition-transform duration-500">
                <HeadphonesIcon className="w-8 h-8" />
              </div>
              <h3 className="text-3xl font-bold tracking-tight">Dedicated Support</h3>
              <p className="text-white/80 leading-relaxed text-lg">
                24/7 concierge support and strategic account management for global operations across every time zone.
              </p>
            </div>
            <div className="mt-12 relative z-10">
              <Link className="inline-flex items-center gap-2 font-bold tracking-tight hover:opacity-80 transition-all text-xl group-hover:gap-4" href="/contact">
                Meet your Team &rarr;
              </Link>
            </div>
            <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-white/5 rounded-full blur-2xl group-hover:bg-white/10 transition-colors duration-700 ease-out"></div>
          </motion.div>

          {/* Feature 3: Reliability */}
          <motion.div variants={itemVariants} className="md:col-span-5 bg-white dark:bg-slate-950 p-8 md:p-12 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-xl transition-all duration-500 hover:-translate-y-1">
            <div className="space-y-6 h-full flex flex-col justify-center">
              <div className="flex items-baseline gap-1 relative">
                <span className="text-7xl md:text-8xl font-black tracking-tighter text-slate-900 dark:text-white">99.99</span>
                <span className="text-3xl font-bold text-primary">%</span>
              </div>
              <h3 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white pt-2">Reliability SLA</h3>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed text-lg">
                Our Uptime guarantee isn&apos;t just a promise; it&apos;s a structural mandate backed by multi-region redundancy and real-time failover logic.
              </p>
            </div>
          </motion.div>

          {/* Feature 4: Flexibility */}
          <motion.div variants={itemVariants} className="md:col-span-7 bg-white dark:bg-slate-950 p-8 md:p-12 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden hover:shadow-xl transition-all duration-500 hover:-translate-y-1 group">
            <div className="relative z-10 space-y-6 max-w-xl h-full flex flex-col justify-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-900 flex items-center justify-center text-primary group-hover:scale-110 transition-transform duration-500">
                <GitMerge className="w-8 h-8" />
              </div>
              <h3 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Flexibility &amp; Custom Workflows</h3>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed text-lg">
                Designed for your unique organizational structure. OrgOS adapts to your established hierarchy, not the other way around. Craft bespoke approval chains and data pipelines.
              </p>
            </div>
            <div className="absolute right-0 bottom-0 text-[180px] leading-none opacity-[0.03] dark:opacity-[0.05] pointer-events-none translate-x-12 translate-y-12 group-hover:-translate-y-4 group-hover:-translate-x-4 transition-transform duration-1000 ease-out">
              <ActivitySquare className="w-full h-full" />
            </div>
          </motion.div>

        </motion.div>
      </div>
    </section>
  );
}
