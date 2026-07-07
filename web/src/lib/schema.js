// Constructores de datos estructurados (schema.org / JSON-LD).
// Centralizados para consistencia de entidad (mismo nombre/URL en todo el sitio),
// clave para SEO y para que los motores de IA entiendan "qué/quién es esto".
import { plans, CURRENCY } from '../data/plans.js';
import { site } from '../data/site.js';

const D = site.domain;
export const orgId = `${site.companyUrl}/#organization`;

export const org = {
  '@type': 'Organization',
  '@id': orgId,
  name: site.company,
  url: site.companyUrl,
  logo: `${D}/favicon.svg`,
};

export const website = {
  '@type': 'WebSite',
  '@id': `${D}/#website`,
  url: `${D}/`,
  name: site.name,
  inLanguage: 'es',
  publisher: { '@id': orgId },
};

export const softwareApp = {
  '@type': 'SoftwareApplication',
  name: site.name,
  operatingSystem: 'Web',
  applicationCategory: 'BusinessApplication',
  applicationSubCategory: 'Project Management Software',
  inLanguage: 'es',
  url: `${D}/`,
  description:
    'Software de gestión de proyectos con IA: tableros Scrum y Kanban, Gantt, OKRs, sprints, dependencias, métricas y reportes ejecutivos generados con IA para equipos que trabajan en español.',
  publisher: { '@id': orgId },
  offers: plans.map((p) => ({
    '@type': 'Offer',
    name: p.name,
    price: String(p.price),
    priceCurrency: CURRENCY,
  })),
};

export function breadcrumb(items) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: `${D}${it.path}`,
    })),
  };
}

export function article({ title, description, path, datePublished, dateModified }) {
  return {
    '@type': 'BlogPosting',
    headline: title,
    description,
    inLanguage: 'es',
    datePublished,
    dateModified: dateModified || datePublished,
    author: { '@type': 'Organization', name: site.name, url: `${D}/` },
    publisher: { '@id': orgId },
    mainEntityOfPage: `${D}${path}`,
    image: `${D}/og-image.png`,
  };
}

export function faqPage(faqs) {
  return {
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

export function graph(...nodes) {
  return { '@context': 'https://schema.org', '@graph': nodes.flat() };
}
