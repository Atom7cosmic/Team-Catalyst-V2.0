import { Check } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';

export function PricingSection() {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.15 } }
  };
  
  const itemVariants = {
    hidden: { opacity: 0, y: 40 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] } }
  };

  return (
    <section id="pricing" className="py-24 relative overflow-hidden bg-background">
       <div className="container mx-auto px-6 max-w-5xl text-center relative z-10">
          <motion.div 
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-100px" }}
            variants={containerVariants}
          >
              <motion.h2 variants={itemVariants} className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
                 Enterprise Licensing
              </motion.h2>
              <motion.p variants={itemVariants} className="text-xl text-muted-foreground max-w-2xl mx-auto mb-16">
                 Predictable, scalable pricing for organizations that demand elite performance. No hidden fees.
              </motion.p>
          </motion.div>

          <motion.div 
            initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-50px" }}
            variants={containerVariants}
            className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto text-left"
          >
             {/* Professional Tier */}
             <motion.div variants={itemVariants} className="p-8 rounded-3xl border border-white/10 bg-surface/40 flex flex-col h-full hover:border-white/20 transition-colors duration-300 shadow-sm">
                <h3 className="text-2xl font-bold text-foreground">Professional</h3>
                <p className="text-muted-foreground mt-2">For scaling mid-market teams.</p>

                <div className="mt-8 mb-8">
                   <span className="text-5xl font-bold tracking-tight">$999</span>
                   <span className="text-muted-foreground">/user/mo</span>
                </div>

                <div className="space-y-4 mb-8 flex-1">
                   <div className="flex items-start gap-3">
                      <Check className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                      <span className="text-sm font-medium">Unlimited Workspaces & Sprints</span>
                   </div>
                   <div className="flex items-start gap-3">
                      <Check className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                      <span className="text-sm font-medium">Advanced Meeting Analytics</span>
                   </div>
                   <div className="flex items-start gap-3">
                      <Check className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                      <span className="text-sm font-medium">Standard SLA (99%)</span>
                   </div>
                   <div className="flex items-start gap-3">
                      <Check className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                      <span className="text-sm font-medium">Email & Chat Support</span>
                   </div>
                </div>

                <Link href="/login" className="w-full">
                   <Button className="w-full text-lg h-12 bg-white text-black hover:bg-neutral-200 transition-transform hover:scale-[1.02]" variant="secondary">
                      Purchase License
                   </Button>
                </Link>
             </motion.div>

             {/* Enterprise Tier */}
             <motion.div variants={itemVariants} className="p-8 rounded-3xl border-2 border-primary/50 bg-primary/5 flex flex-col h-full relative shadow-lg group">
                {/* Subtle shine effect wrapper */}
                <div className="absolute inset-0 rounded-3xl overflow-hidden pointer-events-none">
                  <div className="absolute inset-0 bg-gradient-to-tr from-primary/0 via-primary/5 to-primary/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 ease-in-out"></div>
                </div>
                
                <div className="absolute top-0 right-8 -translate-y-1/2 bg-primary text-primary-foreground px-4 py-1 rounded-full text-xs font-bold uppercase tracking-wider shadow-md z-10">
                   Recommended
                </div>

                <h3 className="text-2xl font-bold text-foreground">Enterprise</h3>
                <p className="text-muted-foreground mt-2">For multi-national operations.</p>

                <div className="mt-8 mb-8">
                   <span className="text-5xl font-bold tracking-tight">Custom</span>
                </div>

                <div className="space-y-4 mb-8 flex-1">
                   <div className="flex items-start gap-3">
                      <Check className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                      <span className="text-sm font-medium">Everything in Professional</span>
                   </div>
                   <div className="flex items-start gap-3">
                      <Check className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                      <span className="text-sm font-medium">Dedicated Solutions Engineer</span>
                   </div>
                   <div className="flex items-start gap-3">
                      <Check className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                      <span className="text-sm font-medium">Enterprise SLA (99.99%)</span>
                   </div>
                   <div className="flex items-start gap-3">
                      <Check className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                      <span className="text-sm font-medium">Custom SAML & SSO Config</span>
                   </div>
                   <div className="flex items-start gap-3">
                      <Check className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                      <span className="text-sm font-medium">Self-Hosted / VPC Options</span>
                   </div>
                </div>

                <Link href="/contact" className="w-full relative z-10">
                   <Button className="w-full text-lg h-12 bg-primary text-primary-foreground hover:bg-primary/90 transition-transform hover:scale-[1.02] shadow-md">
                      Contact Sales
                   </Button>
                </Link>
             </motion.div>
          </motion.div>
       </div>
    </section>
  );
}
