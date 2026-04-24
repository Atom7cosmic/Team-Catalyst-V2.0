'use client';

import { MarketingNavbar } from '@/components/layout/MarketingNavbar';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { ArrowRight, Gauge, ShieldCheck, Users, Search, Plus, Bell, ChevronDown, MoreHorizontal, LayoutDashboard, Route, CheckSquare, Layers, CreditCard, Settings } from 'lucide-react';
import { motion } from 'framer-motion';
import dynamic from 'next/dynamic';
import { ProductSection } from '@/components/landing/ProductSection';
import { PricingSection } from '@/components/landing/PricingSection';
import { EnterpriseSection } from '@/components/landing/EnterpriseSection';
import { FloatingHeroVisual } from '@/components/landing/FloatingHeroVisual';

const Hero3DCanvas = dynamic(
  () => import('@/components/shared/Hero3DCanvas').then(mod => mod.Hero3DCanvas),
  { 
    ssr: false, 
    loading: () => <div className="w-full h-full animate-pulse bg-primary/5 rounded-full blur-[100px]" /> 
  }
);

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#fcfbfa] text-[#1c1c1a] dark:bg-slate-950 dark:text-slate-50 selection:bg-[#c2a278]/20 transition-colors duration-300 flex flex-col font-sans overflow-x-hidden">
      <MarketingNavbar />
      
      <main className="flex-1 w-full max-w-[1400px] mx-auto px-6 lg:px-12 flex flex-col pt-8 lg:pt-10 relative pb-20">
        
        {/* Soft decorative background gradients (very subtle) */}
        <div className="absolute top-0 right-0 -mr-48 -mt-48 w-[600px] h-[600px] bg-[#f0eee6]/80 dark:bg-primary/5 rounded-full blur-[120px] pointer-events-none transition-colors duration-700" />
        
        {/* 3D Background */}
        <div className="absolute top-0 right-0 w-full lg:w-1/2 h-[600px] z-0 opacity-40 lg:opacity-100">
          <Hero3DCanvas />
        </div>

        <div className="grid lg:grid-cols-2 gap-12 lg:gap-8 items-center z-10 w-full mb-10 lg:mb-12">
          
          {/* Left Column: Typography and CTAs */}
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="flex flex-col items-start pr-0 lg:pr-12"
          >
            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="text-5xl md:text-6xl lg:text-[5rem] font-serif font-medium tracking-tight leading-[1.05] text-[#1c1c1a] dark:text-slate-100 mb-4 text-balance"
            >
              Elevate Team <br className="hidden md:block"/>
              Collaboration & <br className="hidden md:block"/>
              Workflow Efficiency
            </motion.h1>
            
            <p className="text-lg md:text-xl text-[#4a4a48] dark:text-slate-400 max-w-xl leading-snug font-normal mb-8 text-balance">
              The modern operations platform for enterprise teams—trusted, intuitive, and built to scale performance.
            </p>
            
            <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
              <Link href="/login" className="w-full sm:w-auto">
                <Button size="lg" className="w-full sm:w-full h-14 px-8 rounded-full bg-[#bda077] hover:bg-[#a98f6a] dark:bg-[#bda077]/90 dark:hover:bg-[#a98f6a] text-white shadow-sm font-medium text-lg transition-all border border-transparent">
                  Get Started Free
                </Button>
              </Link>
              <Link href="/product" className="w-full sm:w-auto">
                <Button size="lg" variant="outline" className="w-full sm:w-full h-14 px-8 rounded-full border-[#d1cec7] dark:border-slate-800 bg-white/60 dark:bg-slate-900/50 hover:bg-white dark:hover:bg-slate-800 text-[#1c1c1a] dark:text-white font-medium text-lg transition-all shadow-sm">
                  Watch Product Tour
                </Button>
              </Link>
            </div>
          </motion.div>

          {/* Right Column: Dynamic Floating Hero Animation */}
          <div className="relative w-full h-full min-h-[550px] flex justify-end">
            <FloatingHeroVisual />
          </div>
        </div>
        
        {/* Trust Metrics Bar at the very bottom */}
        <div className="w-full mt-auto pt-6 pb-6 lg:pb-8 border-t border-[#e8e6e1] dark:border-slate-800/60 z-20">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-4 max-w-5xl mx-auto items-center">
            
            <div className="flex items-center gap-4 justify-center md:justify-start">
              <div className="w-12 h-12 rounded-full border border-[#e8e6e1] dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-center flex-shrink-0 shadow-sm">
                 <Gauge className="w-5 h-5 text-[#1c1c1a] dark:text-slate-300" />
              </div>
              <div className="flex flex-col">
                 <span className="text-xl md:text-2xl font-serif font-medium text-[#1c1c1a] dark:text-white">99.9% Uptime</span>
                 <span className="text-[#73726f] dark:text-slate-400 text-sm">Guaranteed Reliability</span>
              </div>
            </div>

            <div className="flex items-center gap-4 justify-center md:justify-center px-4 md:border-l md:border-r border-[#e8e6e1] dark:border-slate-800/60">
              <div className="w-12 h-12 rounded-full border border-[#e8e6e1] dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-center flex-shrink-0 shadow-sm">
                 <ShieldCheck className="w-5 h-5 text-[#1c1c1a] dark:text-slate-300" />
              </div>
              <div className="flex flex-col">
                 <span className="text-xl md:text-2xl font-serif font-medium text-[#1c1c1a] dark:text-white">SOC-2 Compliant</span>
                 <span className="text-[#73726f] dark:text-slate-400 text-sm">Enterprise-Grade Security</span>
              </div>
            </div>

            <div className="flex items-center gap-4 justify-center md:justify-end">
              <div className="w-12 h-12 rounded-full border border-[#e8e6e1] dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-center flex-shrink-0 shadow-sm">
                 <Users className="w-5 h-5 text-[#1c1c1a] dark:text-slate-300" />
              </div>
              <div className="flex flex-col">
                 <span className="text-xl md:text-2xl font-serif font-medium text-[#1c1c1a] dark:text-white">100k+ Users</span>
                 <span className="text-[#73726f] dark:text-slate-400 text-sm">Trusted globally</span>
              </div>
            </div>

          </div>
        </div>

      </main>

      {/* Embedded Landing Page Sections */}
      <ProductSection />
      <PricingSection />
      <EnterpriseSection />

      {/* Global Footer */}
      <footer className="w-full mt-12 bg-slate-100/50 dark:bg-slate-950/30 border-t border-slate-200 dark:border-slate-800">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-12 max-w-[1440px] mx-auto px-12 py-20">
          <div className="col-span-2 md:col-span-1 space-y-6">
            <div className="text-xl font-black tracking-tight text-slate-900 dark:text-white">ORG-OS</div>
            <p className="font-sans text-xs tracking-wider text-slate-500 dark:text-slate-400 leading-relaxed uppercase font-semibold">
              This is an official and registered product of the CATALYST TECHNOLOGIES Pvt. Ltd. that is &quot;THE C. Tech.&quot;
            </p>
            <p className="font-sans text-xs tracking-wider text-slate-500 dark:text-slate-500 leading-relaxed">
              © 2024 Catalyst Technologies. All rights reserved.
            </p>
          </div>
          <div className="space-y-4">
            <h4 className="font-sans text-xs uppercase tracking-widest font-bold text-slate-900 dark:text-white">Product</h4>
            <div className="flex flex-col gap-3">
              <Link href="#" className="font-sans text-sm text-slate-600 dark:text-slate-400 dark:hover:text-white transition-colors">Documentation</Link>
              <Link href="#" className="font-sans text-sm text-slate-600 dark:text-slate-400 dark:hover:text-white transition-colors">Security</Link>
              <Link href="#pricing" className="font-sans text-sm text-slate-600 dark:text-slate-400 dark:hover:text-white transition-colors">Pricing</Link>
            </div>
          </div>
          <div className="space-y-4">
            <h4 className="font-sans text-xs uppercase tracking-widest font-bold text-slate-900 dark:text-white">Legal</h4>
            <div className="flex flex-col gap-3">
              <Link href="#" className="font-sans text-sm text-slate-600 dark:text-slate-400 dark:hover:text-white transition-colors">Privacy Policy</Link>
              <Link href="#" className="font-sans text-sm text-slate-600 dark:text-slate-400 dark:hover:text-white transition-colors">Terms of Service</Link>
            </div>
          </div>
          <div className="space-y-4">
            <h4 className="font-sans text-xs uppercase tracking-widest font-bold text-slate-900 dark:text-white">Social</h4>
            <div className="flex flex-col gap-3">
              <Link href="#" className="font-sans text-sm text-slate-600 dark:text-slate-400 dark:hover:text-white transition-colors">LinkedIn</Link>
              <Link href="#" className="font-sans text-sm text-slate-600 dark:text-slate-400 dark:hover:text-white transition-colors">Twitter</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
