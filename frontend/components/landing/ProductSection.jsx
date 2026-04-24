import { Network, Database, ShieldCheck } from 'lucide-react';
import { motion } from 'framer-motion';

export function ProductSection() {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.2 } }
  };
  
  const itemVariants = {
    hidden: { opacity: 0, y: 30 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } }
  };

  return (
    <section id="product" className="py-24 relative overflow-hidden bg-background">
      <div className="container mx-auto px-6 max-w-5xl relative z-10">
        <motion.div 
          initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-100px" }}
          variants={containerVariants}
          className="text-center mb-20"
        >
            <motion.h2 variants={itemVariants} className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
              The Architecture of Performance
            </motion.h2>
            <motion.p variants={itemVariants} className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Team Catalyst isn&apos;t just software. It is a foundational layer for your entire organization, built on enterprise-grade infrastructure.
            </motion.p>
        </motion.div>

        <motion.div 
          initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-100px" }}
          variants={containerVariants}
          className="space-y-24"
        >
            <div className="grid md:grid-cols-2 gap-12 items-center">
                <motion.div variants={itemVariants}>
                   <h3 className="text-3xl font-bold tracking-tight mb-4">Neural Data Graph</h3>
                   <p className="text-lg text-muted-foreground mb-6">
                     Our proprietary relational database connects every sprint, meeting, and message into a single source of truth. Stop querying structured tables and start understanding the context of your company.
                   </p>
                   <ul className="space-y-3">
                       <li className="flex items-center gap-3"><Network className="w-5 h-5 text-primary"/> Graph-based indexing</li>
                       <li className="flex items-center gap-3"><Database className="w-5 h-5 text-primary"/> Zero-latency state synchronization</li>
                   </ul>
                </motion.div>
                <motion.div variants={itemVariants} className="aspect-video bg-surface-container rounded-2xl border border-white/10 flex items-center justify-center relative overflow-hidden group">
                   <div className="absolute inset-0 bg-primary/5 group-hover:bg-primary/10 transition-colors duration-500"></div>
                   <div className="absolute -inset-10 bg-gradient-to-r from-transparent via-primary/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 ease-in-out"></div>
                   <div className="text-muted-foreground blur-[1px]">Data Graph Visualizer</div>
                </motion.div>
            </div>

            <div className="grid md:grid-cols-2 gap-12 items-center">
                <motion.div variants={itemVariants} className="order-2 md:order-1 aspect-video bg-surface-container rounded-2xl border border-white/10 flex items-center justify-center relative overflow-hidden group">
                   <div className="absolute inset-0 bg-primary/5 group-hover:bg-primary/10 transition-colors duration-500"></div>
                   <div className="text-muted-foreground blur-[1px]">IAM Gateway Interface</div>
                </motion.div>
                <motion.div variants={itemVariants} className="order-1 md:order-2">
                   <h3 className="text-3xl font-bold tracking-tight mb-4">Zero Trust Gateway</h3>
                   <p className="text-lg text-muted-foreground mb-6">
                     Security is not an afterthought; it is our foundation. Team Catalyst uses a Zero Trust IAM architecture ensuring that only authenticated devices and personnel can access your mission-critical pipelines.
                   </p>
                   <ul className="space-y-3">
                       <li className="flex items-center gap-3"><ShieldCheck className="w-5 h-5 text-primary"/> Native SSO/SAML Integration</li>
                       <li className="flex items-center gap-3"><ShieldCheck className="w-5 h-5 text-primary"/> End-to-End Encryption</li>
                   </ul>
                </motion.div>
            </div>
        </motion.div>
      </div>
    </section>
  );
}
