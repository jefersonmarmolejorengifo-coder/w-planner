import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Blog: artículos en Markdown bajo src/content/blog. Cada uno pertenece a un
// "cluster" temático (Scrum, OKRs, reportes...) para construir autoridad por tema.
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    cluster: z.string(),
    // Enlaces internos hacia las páginas de producto (pilares comerciales).
    related: z.array(z.string()).default([]),
  }),
});

export const collections = { blog };
