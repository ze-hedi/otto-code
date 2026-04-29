// Valid node types
export const VALID_TYPES = [
  'web-app', 'mobile-app', 'spa',
  'api', 'microservice', 'server', 'lambda',
  'database', 'cache', 'queue',
  'load-balancer', 'cdn', 'firewall'
];

// Node metadata (icons and labels)
export const NODE_META = {
  'web-app': { icon: '🌐', label: 'Web App' },
  'mobile-app': { icon: '📱', label: 'Mobile App' },
  'spa': { icon: '⚛️', label: 'SPA' },
  'api': { icon: '🔌', label: 'REST API' },
  'microservice': { icon: '🧩', label: 'Microservice' },
  'server': { icon: '🖥️', label: 'Server' },
  'lambda': { icon: '⚡', label: 'Lambda' },
  'database': { icon: '🗄️', label: 'Database' },
  'cache': { icon: '💾', label: 'Cache' },
  'queue': { icon: '📬', label: 'Message Queue' },
  'load-balancer': { icon: '⚖️', label: 'Load Balancer' },
  'cdn': { icon: '🌍', label: 'CDN' },
  'firewall': { icon: '🛡️', label: 'Firewall' },
};

// Component categories for the sidebar
export const COMPONENT_CATEGORIES = [
  {
    title: 'Frontend',
    components: [
      { type: 'web-app', ...NODE_META['web-app'] },
      { type: 'mobile-app', ...NODE_META['mobile-app'] },
      { type: 'spa', ...NODE_META['spa'] },
    ]
  },
  {
    title: 'Backend',
    components: [
      { type: 'api', ...NODE_META['api'] },
      { type: 'microservice', ...NODE_META['microservice'] },
      { type: 'server', ...NODE_META['server'] },
      { type: 'lambda', ...NODE_META['lambda'] },
    ]
  },
  {
    title: 'Data',
    components: [
      { type: 'database', ...NODE_META['database'] },
      { type: 'cache', ...NODE_META['cache'] },
      { type: 'queue', ...NODE_META['queue'] },
    ]
  },
  {
    title: 'Infrastructure',
    components: [
      { type: 'load-balancer', ...NODE_META['load-balancer'] },
      { type: 'cdn', ...NODE_META['cdn'] },
      { type: 'firewall', ...NODE_META['firewall'] },
    ]
  },
];
