import { getCollection } from 'astro:content';

export async function GET({ site }: { site: URL }) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const docs = await getCollection('docs');
  const paths = ['/', ...docs.map((d) => `/docs/${d.id}/`)];
  const urls = paths.map((p) => `  <url><loc>${new URL(base + p, site).href}</loc></url>`).join('\n');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
