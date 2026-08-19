export interface IconMeta {
  name: string;          // PascalCase component export name: 'Home', 'ArrowForward'
  slug: string;          // kebab-case import-path segment: 'home', 'arrow-forward'
  library: 'material-symbols';
  tags: string[];        // search keywords
  category: string;      // e.g. 'Arrows', 'UI', 'Files', 'Communication'
}

